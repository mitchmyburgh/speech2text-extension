# Docker Setup for GNOME Speech2Text Service

This guide explains how to run the Speech2Text service inside a Docker container with optional CUDA/GPU support for faster Whisper transcription.

## Overview

Running the service in Docker provides several benefits:
- **Isolation**: Dependencies are contained within the image
- **CUDA Support**: Easy GPU acceleration setup
- **Portability**: Consistent environment across systems
- **Clean uninstall**: Simple container/volume removal

## Prerequisites

### Required
- Docker Engine 20.10+
- Docker Compose 2.0+ (optional, for docker-compose.yml method)
- D-Bus session bus running on host
- PulseAudio or PipeWire for audio

### For GPU Support
- NVIDIA GPU with CUDA support
- NVIDIA Container Toolkit (`nvidia-docker2`)
- NVIDIA drivers 525.60.13+

## Quick Start

### 1. Using the Wrapper Script (Recommended)

```bash
# Navigate to service directory
cd speech2text-extension/service

# Start with GPU support (auto-detects, falls back to CPU)
./docker-run.sh start

# Or explicitly use CPU mode
./docker-run.sh start --mode cpu

# Check status
./docker-run.sh status

# View logs
./docker-run.sh logs

# Stop the service
./docker-run.sh stop
```

### 2. Using Docker Compose

```bash
# GPU mode (default)
docker-compose up -d

# CPU-only mode
docker-compose --profile cpu up -d speech2text-service-cpu

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

### 3. Using Docker Directly

```bash
# Build the image
docker build -t speech2text-extension-service:latest .

# Run with GPU support
docker run -d \
  --name speech2text-service \
  --runtime=nvidia \
  -e NVIDIA_VISIBLE_DEVICES=all \
  -e NVIDIA_DRIVER_CAPABILITIES=compute,utility \
  -e DBUS_SESSION_BUS_ADDRESS=unix:path=/run/dbus/session_bus_socket \
  -v /run/user/$(id - u)/bus:/run/dbus/session_bus_socket:ro \
  -v /run/user/$(id - u)/pulse/native:/run/user/1000/pulse/native:ro \
  --device /dev/snd \
  --group-add audio \
  --network host \
  speech2text-extension-service:latest

# Run CPU-only
docker run -d \
  --name speech2text-service-cpu \
  -e DBUS_SESSION_BUS_ADDRESS=unix:path=/run/dbus/session_bus_socket \
  -v /run/user/$(id - u)/bus:/run/dbus/session_bus_socket:ro \
  -v /run/user/$(id - u)/pulse/native:/run/user/1000/pulse/native:ro \
  --device /dev/snd \
  --group-add audio \
  --network host \
  speech2text-extension-service:cpu
```

## Wrapper Script Commands

```bash
./docker-run.sh [OPTIONS] [ACTION]

Actions:
  start       Start the service (default)
  stop        Stop the service
  restart     Restart the service
  status      Check service status and D-Bus connectivity
  logs        View service logs
  build       Build the Docker image
  shell       Open a shell in the running container
  clean       Remove container and volumes

Options:
  -m, --mode MODE     Set mode: gpu (default) or cpu
  -h, --help          Show help message

Examples:
  ./docker-run.sh                  # Start GPU service
  ./docker-run.sh start --mode cpu # Start CPU-only service
  ./docker-run.sh logs             # View logs
  ./docker-run.sh restart          # Restart service
```

## NVIDIA Container Toolkit Setup

### Ubuntu/Debian

```bash
# Add NVIDIA package repositories
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | \
    sudo tee /etc/apt/sources.list.d/nvidia-docker.list

# Install nvidia-docker2
sudo apt-get update
sudo apt-get install -y nvidia-docker2

# Restart Docker
sudo systemctl restart docker

# Test GPU access
docker run --rm --runtime=nvidia nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi
```

### Verification

```bash
# Check if NVIDIA runtime is available
docker info | grep nvidia

# Should show: Runtimes: nvidia runc io.containerd.runc.v2
```

## How It Works

### D-Bus Communication

The container connects to the host's D-Bus session bus:
1. Host D-Bus socket is mounted into the container
2. Service registers on the host's session bus
3. GNOME Shell extension communicates as if service were local

```
Host D-Bus Socket → Container Mount → Service Registration
                                    ↓
Host GNOME Extension ← D-Bus Calls ← Service Methods
```

### Audio Recording

PulseAudio socket is mounted for audio access:
- Container accesses host's PulseAudio/PipeWire
- Recording happens through host audio system
- No audio drivers needed in container

### GPU Acceleration

When using GPU mode:
- NVIDIA runtime provides GPU access
- CUDA libraries are included in the image
- Whisper uses GPU for transcription (much faster)

## Troubleshooting

### D-Bus Connection Issues

```bash
# Check D-Bus socket path
echo $DBUS_SESSION_BUS_ADDRESS

# Verify socket exists
ls -la /run/user/$(id - u)/bus

# Test D-Bus from container
docker exec speech2text-service dbus-send --session \
    --dest=org.gnome.Shell.Extensions.Speech2Text \
    --type=method_call --print-reply \
    /org/gnome/Shell/Extensions/Speech2Text \
    org.freedesktop.DBus.Peer.Ping
```

### Audio Issues

```bash
# Check PulseAudio socket
ls -la /run/user/$(id - u)/pulse/native

# Test audio in container
docker exec -it speech2text-service pactl info

# Check audio permissions
sudo usermod -aG audio $USER
```

### GPU Not Detected

```bash
# Verify NVIDIA runtime
docker info | grep -i nvidia

# Test GPU in container
docker run --rm --runtime=nvidia nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi

# Check CUDA version compatibility
nvidia-smi
```

### Permission Denied

```bash
# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Fix D-Bus permissions
export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id - u)/bus
```

## Performance Comparison

| Mode | Transcription Speed | Resource Usage | Setup Complexity |
|------|-------------------|----------------|------------------|
| Native CPU | Baseline | Low | Simple |
| Docker CPU | Same as native | Low + container | Medium |
| Docker GPU | 5-10x faster | Higher | Medium |

## Building Custom Images

### With Different CUDA Version

```bash
# Edit Dockerfile or use build args
docker build \
  --build-arg CUDA_VERSION=11.8.0 \
  --build-arg BASE_DIST=ubuntu20.04 \
  -t speech2text-extension-service:cuda11 .
```

### With Custom Whisper Model

```bash
# Pre-download model in image
RUN python3 -c "import whisper; whisper.load_model('large-v3')"
```

## Uninstallation

```bash
# Using wrapper script
./docker-run.sh clean

# Or manually
docker stop speech2text-service
docker rm speech2text-service
docker volume rm speech2text-cache
docker rmi speech2text-extension-service:latest
```

## Security Considerations

- Container runs with host network access (required for D-Bus)
- Audio devices are passed through
- D-Bus socket is read-only from container
- No privileged mode required

## See Also

- [Main README](README.md)
- [Whisper Models](https://github.com/openai/whisper#available-models-and-languages)
- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)
