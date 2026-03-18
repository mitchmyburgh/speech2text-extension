# Speech2Text

![GPLv3](https://img.shields.io/badge/License-GPLv3-yellow.svg)
![Linux](https://img.shields.io/badge/Linux-FCC624?style=flat&logo=linux&logoColor=black)
![GNOME](https://img.shields.io/badge/GNOME-4A90D9?style=flat&logo=gnome&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![Python](https://img.shields.io/badge/Python-3776AB?style=flat&logo=python&logoColor=white)
![Whisper](https://img.shields.io/badge/Whisper-412991?style=flat&logo=openai&logoColor=white)
[![Download from GNOME Extensions](https://img.shields.io/badge/Download%20from-GNOME%20Extensions-blue)](https://extensions.gnome.org/extension/8238/speech2text-extension/)

A GNOME Shell extension for speech-to-text using OpenAI's [Whisper](https://github.com/openai/whisper) model. Press a shortcut, speak, and your words are transcribed locally — nothing ever leaves your machine.

## Features

- 🎤 **Local speech recognition** via OpenAI Whisper
- ⌨️ **Keyboard shortcut** to start/stop recording (default: `Ctrl+Space`)
- 🖱️ **Panel icon** for click-to-record
- 🏝️ **Dynamic Island UI** — compact pill overlay showing recording status and transcription preview
- 📋 **Copy to clipboard** with `Enter` from the preview
- ⌨️ **Auto-insert at cursor** on Wayland (via ydotool) and X11 (via xdotool)
- 🔄 **Non-blocking mode** — transcription runs in the background while you keep working
- 🌍 **Multi-language** support depending on Whisper model
- 🔒 **100% local** — no data sent to any server

## Architecture

The extension has two components that communicate over D-Bus:

| Component | What it does |
|-----------|-------------|
| **GNOME Extension** (JS) | Panel icon, keyboard shortcuts, Dynamic Island UI, settings |
| **D-Bus Service** (Python) | Audio recording, Whisper transcription, text insertion |

The service runs as a separate process and is installed independently from the extension.

---

## Installation

### Step 1 — Install the GNOME Extension

**Via GNOME Extensions website (recommended):**

[![Download from GNOME Extensions](https://img.shields.io/badge/Download%20from-GNOME%20Extensions-blue)](https://extensions.gnome.org/extension/8238/speech2text-extension/)

**Or manually from source:**

```bash
git clone https://github.com/mitchmyburgh/speech2text-extension.git
cd speech2text-extension
make install
```

After installing, reload GNOME Shell:
- **X11:** Press `Alt+F2`, type `r`, press `Enter`
- **Wayland:** Log out and back in

---

### Step 2 — Install System Dependencies

#### FFmpeg (required for audio recording)

```bash
sudo dnf install ffmpeg          # Fedora
sudo apt install ffmpeg          # Ubuntu/Debian
sudo pacman -S ffmpeg            # Arch
```

#### Clipboard support

```bash
# Wayland
sudo dnf install wl-clipboard    # Fedora
sudo apt install wl-clipboard    # Ubuntu/Debian
sudo pacman -S wl-clipboard      # Arch

# X11
sudo dnf install xclip           # Fedora
sudo apt install xclip           # Ubuntu/Debian
sudo pacman -S xclip             # Arch
```

#### Text insertion (for Auto-insert feature)

**Wayland — ydotool** (uses `/dev/uinput`, works on GNOME):

> **Note:** `wtype` does **not** work on GNOME/Mutter. GNOME does not implement the wlroots virtual keyboard protocol that wtype requires. Use `ydotool` instead.

```bash
sudo dnf install ydotool         # Fedora
sudo apt install ydotool         # Ubuntu/Debian
sudo pacman -S ydotool           # Arch
```

Add your user to the `input` group:

```bash
sudo usermod -aG input $USER
```

Create a systemd user service so `ydotoold` starts automatically on login:

```bash
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/ydotoold.service << 'EOF'
[Unit]
Description=ydotool daemon

[Service]
ExecStart=/usr/bin/ydotoold

[Install]
WantedBy=default.target
EOF

systemctl --user enable --now ydotoold
```

**Log out and back in** for the `input` group to take effect, then verify:

```bash
ydotool type "hello"
```

**X11 — xdotool:**

```bash
sudo dnf install xdotool         # Fedora
sudo apt install xdotool         # Ubuntu/Debian
sudo pacman -S xdotool           # Arch
```

---

### Step 3 — Install the D-Bus Service

The Python service handles audio recording and Whisper transcription. Install from local source:

```bash
cd speech2text-extension/service
./install-service.sh
```

Or from PyPI:

```bash
curl -sSL https://raw.githubusercontent.com/mitchmyburgh/speech2text-extension/refs/heads/main/service/install-service.sh | bash -s -- --pypi --non-interactive --whisper-model base
```

#### Whisper model options

| Model | Speed | Accuracy | RAM |
|-------|-------|----------|-----|
| `tiny` | Fastest | Lower | ~1 GB |
| `base` | Fast | Good | ~1 GB |
| `small` | Moderate | Better | ~2 GB |
| `medium` | Slower | High | ~5 GB |
| `large` | Slowest | Best | ~10 GB |

`base` is recommended for most users.

#### GPU mode (optional, NVIDIA CUDA)

```bash
./install-service.sh --gpu --whisper-model base
```

> Switching between CPU and GPU requires a full service reinstall.

---

## Usage

### Recording

1. Press `Ctrl+Space` (or click the microphone icon in the panel)
2. Speak — a Dynamic Island pill appears at the top of the screen
3. Press the shortcut again (or click Stop) to finish
4. The transcription appears in the preview

### Preview

After transcription the Dynamic Island shows the result:

- **`↵` (Enter)** — copies the text to clipboard
- **`Esc`** — dismisses without copying

### Auto-insert on Wayland

Enable **Auto-insert on Wayland** in settings (requires ydotool set up as above). When enabled, transcribed text is typed directly into the focused field — no preview shown.

### Non-blocking mode

Enable **Non-blocking transcription** in settings to keep working while Whisper processes in the background. A spinner appears next to the panel icon while transcribing.

---

## Settings

| Setting | Description |
|---------|-------------|
| Copy to clipboard automatically | Always copy transcription to clipboard |
| Auto-insert on Wayland | Type text into focused field (requires ydotool) |
| Auto-insert at cursor (X11) | Type text into focused field on X11 (requires xdotool) |
| Non-blocking transcription | Transcribe in background without blocking UI |
| Use Dynamic Island style UI | Compact pill overlay (recommended) |
| Show transcription inline | Show text in the recording pill |

---

## Troubleshooting

### Check logs

```bash
journalctl --user -f | grep -E "speech2text|Error|ydotool"
```

### Test the D-Bus service manually

```bash
# Check service is running
dbus-send --session --print-reply \
  --dest=org.gnome.Shell.Extensions.Speech2Text \
  /org/gnome/Shell/Extensions/Speech2Text \
  org.gnome.Shell.Extensions.Speech2Text.GetServiceStatus

# Test text insertion
dbus-send --session --print-reply \
  --dest=org.gnome.Shell.Extensions.Speech2Text \
  /org/gnome/Shell/Extensions/Speech2Text \
  org.gnome.Shell.Extensions.Speech2Text.TypeText \
  string:"hello world" boolean:false
```

### "failed to connect socket: No such file or directory"

The `ydotoold` daemon is not running:

```bash
systemctl --user start ydotoold
```

If the service unit doesn't exist, follow the [ydotoold setup steps](#wayland--ydotool) above.

### ydotool permission denied / can't open /dev/uinput

You haven't logged out/in since being added to the `input` group:

```bash
sudo usermod -aG input $USER
# Then log out and back in
```

### "Compositor does not support the virtual keyboard protocol"

This means `wtype` is being used — it does not work on GNOME. Install and configure `ydotool` as described in Step 2.

### Service not responding

```bash
# Restart the service
pkill -f speech2text-extension-service

# Or run manually to see output
~/.local/share/speech2text-extension-service/speech2text-extension-service
```

### Reinstall the service after updates

```bash
cd speech2text-extension/service
./install-service.sh
```

---

## Uninstallation

```bash
# Remove extension and service
make clean

# Or remove just the service
rm -rf ~/.local/share/speech2text-extension-service
rm ~/.local/share/dbus-1/services/org.gnome.Shell.Extensions.Speech2Text.service
```

---

## Privacy & Security

🔒 All speech recognition runs entirely on your local machine using OpenAI Whisper. No audio or text is ever sent to any external server.

---

## Contributing

Pull requests and issues are welcome. When reporting a bug please include:

- GNOME Shell version: `gnome-shell --version`
- Session type: `echo $XDG_SESSION_TYPE`
- OS and version: `cat /etc/os-release`
- Logs: `journalctl --user -n 100 --no-pager | grep speech2text`

## License

GPLv3 — see [LICENSE](./LICENSE).
