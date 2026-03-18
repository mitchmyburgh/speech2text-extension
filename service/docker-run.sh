#!/bin/bash
# Docker wrapper script for GNOME Speech2Text Service
# Handles D-Bus socket detection, audio setup, and container lifecycle

set -e

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default values
MODE="gpu"  # gpu or cpu
ACTION="start"
CONTAINER_NAME="speech2text-service"
IMAGE_TAG="latest"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Show usage
usage() {
    cat << EOF
Usage: $0 [OPTIONS] [ACTION]

Docker wrapper for GNOME Speech2Text Service

ACTIONS:
    start       Start the service (default)
    stop        Stop the service
    restart     Restart the service
    status      Check service status
    logs        View service logs
    build       Build the Docker image
    shell       Open a shell in the container
    clean       Remove container and volumes

OPTIONS:
    -m, --mode MODE     Set mode: gpu (default) or cpu
    -h, --help          Show this help message

EXAMPLES:
    $0                  # Start GPU service with defaults
    $0 start --mode cpu # Start CPU-only service
    $0 logs             # View service logs
    $0 stop             # Stop the service

EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -m|--mode)
            MODE="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        start|stop|restart|status|logs|build|shell|clean)
            ACTION="$1"
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Validate mode
if [[ "$MODE" != "gpu" && "$MODE" != "cpu" ]]; then
    log_error "Invalid mode: $MODE. Use 'gpu' or 'cpu'"
    exit 1
fi

# Detect D-Bus session bus socket
detect_dbus_socket() {
    if [[ -n "$DBUS_SESSION_BUS_ADDRESS" ]]; then
        # Extract socket path from DBUS_SESSION_BUS_ADDRESS
        if [[ "$DBUS_SESSION_BUS_ADDRESS" == unix:path=* ]]; then
            echo "$DBUS_SESSION_BUS_ADDRESS" | sed 's/unix:path=//'
            return
        elif [[ "$DBUS_SESSION_BUS_ADDRESS" == unix:abstract=* ]]; then
            log_warn "Using abstract D-Bus socket, trying default path"
        fi
    fi
    
    # Try common paths
    local uid=$(id -u)
    local paths=(
        "/run/user/$uid/bus"
        "/var/run/user/$uid/bus"
        "$XDG_RUNTIME_DIR/bus"
        "/tmp/dbus-$(echo "$DBUS_SESSION_BUS_ADDRESS" | grep -oP 'guid=[a-f0-9]+' | cut -d= -f2)"
    )
    
    for path in "${paths[@]}"; do
        if [[ -S "$path" ]]; then
            echo "$path"
            return
        fi
    done
    
    # Default fallback
    echo "/run/user/$uid/bus"
}

# Detect PulseAudio socket
detect_pulse_socket() {
    local uid=$(id -u)
    local paths=(
        "/run/user/$uid/pulse/native"
        "$XDG_RUNTIME_DIR/pulse/native"
        "$HOME/.pulse/native"
    )
    
    for path in "${paths[@]}"; do
        if [[ -S "$path" ]]; then
            echo "$path"
            return
        fi
    done
    
    echo "/run/user/$uid/pulse/native"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        exit 1
    fi
    
    # Check docker-compose or docker compose
    if command -v docker-compose &> /dev/null; then
        COMPOSE_CMD="docker-compose"
    elif docker compose version &> /dev/null; then
        COMPOSE_CMD="docker compose"
    else
        log_error "docker-compose is not installed"
        exit 1
    fi
    
    # Check for GPU mode
    if [[ "$MODE" == "gpu" ]]; then
        if ! docker info | grep -q "nvidia"; then
            log_warn "NVIDIA runtime not detected. Falling back to CPU mode."
            MODE="cpu"
        fi
    fi
    
    # Check D-Bus
    local dbus_socket=$(detect_dbus_socket)
    if [[ ! -S "$dbus_socket" ]]; then
        log_warn "D-Bus session socket not found at $dbus_socket"
        log_warn "Make sure you have a D-Bus session running"
    fi
    
    log_success "Prerequisites check passed"
}

# Build Docker image
build_image() {
    log_info "Building Docker image for $MODE mode..."
    
    cd "$SCRIPT_DIR"
    
    if [[ "$MODE" == "gpu" ]]; then
        docker build -t "${CONTAINER_NAME}:${IMAGE_TAG}" -f Dockerfile .
    else
        docker build -t "${CONTAINER_NAME}:cpu" -f Dockerfile.cpu .
    fi
    
    log_success "Docker image built successfully"
}

# Start service
start_service() {
    log_info "Starting Speech2Text service ($MODE mode)..."
    
    # Check if already running
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        log_warn "Container ${CONTAINER_NAME} is already running"
        return
    fi
    
    # Remove old container if exists
    if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        log_info "Removing old container..."
        docker rm -f "${CONTAINER_NAME}" > /dev/null 2>&1
    fi
    
    # Detect sockets
    local dbus_socket=$(detect_dbus_socket)
    local pulse_socket=$(detect_pulse_socket)
    local uid=$(id -u)
    
    log_info "Using D-Bus socket: $dbus_socket"
    log_info "Using PulseAudio socket: $pulse_socket"
    
    # Build docker run command
    local docker_args=(
        --name "${CONTAINER_NAME}"
        --rm
        -e "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/dbus/session_bus_socket"
        -e "WHISPER_CACHE_DIR=/app/cache"
        -e "PYTHONUNBUFFERED=1"
        -e "NVIDIA_VISIBLE_DEVICES=all"
        -e "NVIDIA_DRIVER_CAPABILITIES=compute,utility"
        -v "${dbus_socket}:/run/dbus/session_bus_socket:ro"
        -v "${pulse_socket}:/run/user/1000/pulse/native:ro"
        -v "${HOME}/.config/pulse:/root/.config/pulse:ro"
        -v "speech2text-cache:/app/cache"
        --device /dev/snd
        --group-add audio
        --network host
    )
    
    # Add GPU runtime for GPU mode
    if [[ "$MODE" == "gpu" ]]; then
        docker_args+=(--runtime=nvidia)
    fi
    
    # Run container
    docker run -d "${docker_args[@]}" "${CONTAINER_NAME}:${IMAGE_TAG}" > /dev/null
    
    # Wait for service to be ready
    log_info "Waiting for service to start..."
    local retries=30
    while [[ $retries -gt 0 ]]; do
        if docker exec "${CONTAINER_NAME}" dbus-send --session \
            --dest=org.gnome.Shell.Extensions.Speech2Text \
            --type=method_call --print-reply \
            /org/gnome/Shell/Extensions/Speech2Text \
            org.freedesktop.DBus.Peer.Ping 2>/dev/null; then
            log_success "Service is ready!"
            return
        fi
        sleep 1
        ((retries--))
    done
    
    log_error "Service failed to start within timeout"
    docker logs "${CONTAINER_NAME}"
    exit 1
}

# Stop service
stop_service() {
    log_info "Stopping Speech2Text service..."
    
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        docker stop "${CONTAINER_NAME}" > /dev/null
        log_success "Service stopped"
    else
        log_warn "Service is not running"
    fi
}

# Check status
check_status() {
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        log_success "Service is running"
        docker ps --filter "name=${CONTAINER_NAME}" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
        
        # Check D-Bus connectivity
        if docker exec "${CONTAINER_NAME}" dbus-send --session \
            --dest=org.gnome.Shell.Extensions.Speech2Text \
            --type=method_call --print-reply \
            /org/gnome/Shell/Extensions/Speech2Text \
            org.freedesktop.DBus.Peer.Ping 2>/dev/null; then
            log_success "D-Bus connectivity: OK"
        else
            log_error "D-Bus connectivity: FAILED"
        fi
    else
        log_warn "Service is not running"
    fi
}

# View logs
view_logs() {
    if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        docker logs -f "${CONTAINER_NAME}"
    else
        log_error "No container found"
    fi
}

# Open shell in container
open_shell() {
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        docker exec -it "${CONTAINER_NAME}" /bin/bash
    else
        log_error "Service is not running. Start it first with: $0 start"
    fi
}

# Clean up
clean_up() {
    log_info "Cleaning up..."
    
    stop_service
    
    # Remove container if exists
    if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        docker rm -f "${CONTAINER_NAME}" > /dev/null 2>&1
    fi
    
    # Remove volume
    docker volume rm -f speech2text-cache > /dev/null 2>&1
    
    log_success "Cleanup complete"
}

# Main execution
main() {
    check_prerequisites
    
    case "$ACTION" in
        start)
            start_service
            ;;
        stop)
            stop_service
            ;;
        restart)
            stop_service
            sleep 2
            start_service
            ;;
        status)
            check_status
            ;;
        logs)
            view_logs
            ;;
        build)
            build_image
            ;;
        shell)
            open_shell
            ;;
        clean)
            clean_up
            ;;
        *)
            log_error "Unknown action: $ACTION"
            usage
            exit 1
            ;;
    esac
}

main "$@"
