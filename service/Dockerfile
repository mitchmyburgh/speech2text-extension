# Dockerfile for GNOME Speech2Text Service
# Supports both CPU and GPU (CUDA) modes

# Build arguments
ARG CUDA_VERSION=12.1.0
ARG BASE_DIST=ubuntu22.04

# Use NVIDIA CUDA base image for GPU support
FROM nvidia/cuda:${CUDA_VERSION}-base-${BASE_DIST}

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Set working directory
WORKDIR /app

# Install system dependencies
# - python3, pip: for running the service
# - libportaudio2, libasound2: for audio recording
# - libgirepository1.0-dev, libcairo2-dev: for D-Bus
# - dbus: for D-Bus communication
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-dev \
    libportaudio2 \
    libportaudiocpp0 \
    libportaudio-dev \
    libasound2 \
    libasound2-dev \
    libgirepository1.0-dev \
    libcairo2-dev \
    pkg-config \
    dbus \
    dbus-x11 \
    ca-certificates \
    git \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy the service source code
COPY src/ ./src/
COPY data/ ./data/
COPY pyproject.toml .
COPY LICENSE .
COPY README.md .

# Install the service package
RUN pip3 install --no-cache-dir .

# Create directories for runtime
RUN mkdir -p /tmp/speech2text /var/run/dbus

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
ENV PULSE_SERVER=unix:/run/user/1000/pulse/native

# Expose D-Bus socket path (for documentation purposes)
# The actual socket is mounted from host

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD dbus-send --session --dest=org.gnome.Shell.Extensions.Speech2Text \
        --type=method_call --print-reply /org/gnome/Shell/Extensions/Speech2Text \
        org.freedesktop.DBus.Peer.Ping 2>/dev/null || exit 1

# Default command - runs the D-Bus service
# Note: The service will connect to the host's D-Bus session bus
CMD ["speech2text-extension-service"]
