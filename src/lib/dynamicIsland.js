import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { COLORS } from "./constants.js";
import { log, cleanupChromeWidget } from "./resourceUtils.js";

/**
 * Dynamic Island style recording indicator - a pill-shaped overlay at the top center
 * Similar to Apple's Dynamic Island but for showing recording status and transcription
 */
export class DynamicIsland {
  constructor(onCancel, onStop, onInsert, options = {}) {
    this.onCancel = onCancel;
    this.onStop = onStop;
    this.onInsert = onInsert;
    this.options = {
      showTranscription: options.showTranscription !== false,
      autoInsertOnWayland: options.autoInsertOnWayland === true,
      ...options,
    };

    this.maxDuration = options.maxDuration || 60;
    this.startTime = null;
    this.elapsedTime = 0;
    this.timerInterval = null;
    this.transcribedText = "";
    this.isPreviewMode = false;
    this.isProcessing = false;

    // Animation state
    this.expandTimeoutId = null;
    this.collapseTimeoutId = null;

    this._buildIsland();
  }

  _buildIsland() {
    // Main container - positioned at top center
    this.container = new St.Widget({
      style_class: "speech2text-dynamic-island",
      style: `
        background-color: ${COLORS.TRANSPARENT_BLACK_85};
        border-radius: 30px;
        border: 1px solid ${COLORS.PRIMARY};
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
      `,
      reactive: true,
      can_focus: true,
      track_hover: true,
    });

    // Inner layout - horizontal box
    this.innerBox = new St.BoxLayout({
      vertical: false,
      style: "spacing: 12px; padding: 12px 20px;",
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });

    this.container.add_child(this.innerBox);

    // Build the compact/recording view
    this._buildCompactView();

    // Position at top center
    this._positionAtTop();

    // Connect hover events for expansion
    this.container.connect("notify::hover", () => {
      if (this.container.hover && !this.isPreviewMode && !this.isProcessing) {
        this._expand();
      }
    });
  }

  _buildCompactView() {
    // Recording indicator (pulsing dot)
    this.recordingIndicator = new St.Widget({
      style: `
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background-color: ${COLORS.DANGER};
      `,
      y_align: Clutter.ActorAlign.CENTER,
    });

    // Microphone icon
    this.iconLabel = new St.Label({
      text: "🎤",
      style: "font-size: 20px;",
      y_align: Clutter.ActorAlign.CENTER,
    });

    // Status text
    this.statusLabel = new St.Label({
      text: "Recording...",
      style: `
        font-size: 14px;
        font-weight: 500;
        color: ${COLORS.WHITE};
      `,
      y_align: Clutter.ActorAlign.CENTER,
    });

    // Timer
    this.timerLabel = new St.Label({
      text: "0:00",
      style: `
        font-size: 14px;
        color: ${COLORS.LIGHT_GRAY};
        font-family: monospace;
      `,
      y_align: Clutter.ActorAlign.CENTER,
    });

    // Add to inner box
    this.innerBox.add_child(this.recordingIndicator);
    this.innerBox.add_child(this.iconLabel);
    this.innerBox.add_child(this.statusLabel);
    this.innerBox.add_child(this.timerLabel);

    // Start pulsing animation
    this._startPulsing();
  }

  _buildExpandedView() {
    // Clear current content
    this.innerBox.remove_all_children();

    // Title row with icon and status
    const titleBox = new St.BoxLayout({
      vertical: false,
      style: "spacing: 10px;",
      x_align: Clutter.ActorAlign.CENTER,
    });

    this.expandedIcon = new St.Label({
      text: "🎤",
      style: "font-size: 24px;",
      y_align: Clutter.ActorAlign.CENTER,
    });

    this.expandedStatus = new St.Label({
      text: "Recording...",
      style: `
        font-size: 16px;
        font-weight: bold;
        color: ${COLORS.WHITE};
      `,
      y_align: Clutter.ActorAlign.CENTER,
    });

    titleBox.add_child(this.expandedIcon);
    titleBox.add_child(this.expandedStatus);

    // Progress bar
    this.progressBarContainer = new St.Widget({
      style: `
        background-color: rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        height: 8px;
        width: 200px;
      `,
    });

    this.progressBar = new St.Widget({
      style: `
        background-color: ${COLORS.PRIMARY};
        border-radius: 8px;
        height: 8px;
        width: 0px;
      `,
    });

    this.progressBarContainer.add_child(this.progressBar);

    // Timer display
    this.expandedTimer = new St.Label({
      text: "0:00 / 1:00",
      style: `
        font-size: 12px;
        color: ${COLORS.LIGHT_GRAY};
        font-family: monospace;
      `,
    });

    // Buttons
    const buttonBox = new St.BoxLayout({
      vertical: false,
      style: "spacing: 10px;",
      x_align: Clutter.ActorAlign.CENTER,
    });

    this.stopButton = this._createButton("⏹ Stop", COLORS.DANGER, () => {
      if (this.onStop) this.onStop();
    });

    this.cancelButton = this._createButton("✕ Cancel", COLORS.SECONDARY, () => {
      this.close();
      if (this.onCancel) this.onCancel();
    });

    buttonBox.add_child(this.stopButton);
    buttonBox.add_child(this.cancelButton);

    // Add all to inner box vertically
    this.innerBox.vertical = true;
    this.innerBox.style = "spacing: 12px; padding: 20px 30px;";
    this.innerBox.add_child(titleBox);
    this.innerBox.add_child(this.progressBarContainer);
    this.innerBox.add_child(this.expandedTimer);
    this.innerBox.add_child(buttonBox);

    // Update container size
    this.container.style = `
      background-color: ${COLORS.TRANSPARENT_BLACK_85};
      border-radius: 20px;
      border: 1px solid ${COLORS.PRIMARY};
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
    `;

    // Re-center
    this._positionAtTop();
  }

  _createButton(label, bgColor, onClick) {
    const button = new St.Button({
      label: label,
      style: `
        background-color: ${bgColor};
        color: white;
        border-radius: 8px;
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 500;
        border: none;
      `,
      reactive: true,
      can_focus: true,
    });

    button.connect("clicked", onClick);
    return button;
  }

  _positionAtTop() {
    const monitor = Main.layoutManager.primaryMonitor;
    const [width, height] = this.container.get_size();

    // Center horizontally, position at top with some padding
    const x = Math.round((monitor.width - (width || 200)) / 2);
    const y = 10; // 10px from top

    this.container.set_position(monitor.x + x, monitor.y + y);
  }

  _startPulsing() {
    // Simple pulse animation using opacity
    let growing = true;
    this.pulseInterval = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
      if (!this.recordingIndicator) return false;

      const opacity = growing ? 255 : 128;
      this.recordingIndicator.opacity = opacity;
      growing = !growing;

      return true;
    });
  }

  _stopPulsing() {
    if (this.pulseInterval) {
      GLib.source_remove(this.pulseInterval);
      this.pulseInterval = null;
    }
  }

  _expand() {
    if (this.isExpanded) return;
    this.isExpanded = true;

    // Clear compact timeout
    if (this.collapseTimeoutId) {
      GLib.source_remove(this.collapseTimeoutId);
      this.collapseTimeoutId = null;
    }

    this._buildExpandedView();
  }

  _collapse() {
    if (!this.isExpanded) return;
    this.isExpanded = false;

    // Rebuild compact view
    this.innerBox.remove_all_children();
    this.innerBox.vertical = false;
    this.innerBox.style = "spacing: 12px; padding: 12px 20px;";
    this.container.style = `
      background-color: ${COLORS.TRANSPARENT_BLACK_85};
      border-radius: 30px;
      border: 1px solid ${COLORS.PRIMARY};
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    `;

    this._buildCompactView();
    this._positionAtTop();
  }

  startTimer() {
    this.startTime = Date.now();
    this.elapsedTime = 0;

    this._updateTimerDisplay();

    if (this.timerInterval) {
      GLib.source_remove(this.timerInterval);
    }

    this.timerInterval = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
      if (this.startTime) {
        this._updateTimerDisplay();
        return this.elapsedTime < this.maxDuration;
      }
      return false;
    });
  }

  _updateTimerDisplay() {
    this.elapsedTime = Math.floor((Date.now() - this.startTime) / 1000);

    const mins = Math.floor(this.elapsedTime / 60);
    const secs = this.elapsedTime % 60;
    const timeStr = `${mins}:${secs.toString().padStart(2, "0")}`;

    if (this.timerLabel) {
      this.timerLabel.set_text(timeStr);
    }

    if (this.expandedTimer) {
      const maxMins = Math.floor(this.maxDuration / 60);
      const maxSecs = this.maxDuration % 60;
      this.expandedTimer.set_text(
        `${timeStr} / ${maxMins}:${maxSecs.toString().padStart(2, "0")}`
      );
    }

    // Update progress bar if expanded
    if (this.progressBar) {
      const progress = Math.min(this.elapsedTime / this.maxDuration, 1.0);
      const width = Math.floor(200 * progress);
      this.progressBar.set_width(width);

      // Change color based on progress
      let color = COLORS.PRIMARY;
      if (progress > 0.8) color = progress > 0.95 ? COLORS.DANGER : COLORS.WARNING;
      this.progressBar.set_style(`
        background-color: ${color};
        border-radius: 8px;
        height: 8px;
        width: ${width}px;
      `);
    }
  }

  stopTimer() {
    if (this.timerInterval) {
      GLib.source_remove(this.timerInterval);
      this.timerInterval = null;
    }
    this.startTime = null;
  }

  showProcessing() {
    this.isProcessing = true;
    this._stopPulsing();

    if (this.statusLabel) {
      this.statusLabel.set_text("Processing...");
    }

    if (this.expandedStatus) {
      this.expandedStatus.set_text("Processing...");
    }

    if (this.iconLabel) {
      this.iconLabel.set_text("🧠");
    }

    if (this.expandedIcon) {
      this.expandedIcon.set_text("🧠");
    }

    // Hide recording indicator
    if (this.recordingIndicator) {
      this.recordingIndicator.hide();
    }

    this.stopTimer();
  }

  showPreview(text) {
    this.isPreviewMode = true;
    this.transcribedText = text;
    this.isProcessing = false;

    log.debug(`DynamicIsland: Showing preview with text: "${text}"`);

    // Clear and rebuild for preview mode
    this.innerBox.remove_all_children();
    this.innerBox.vertical = true;
    this.innerBox.style = "spacing: 15px; padding: 20px 25px;";

    // Larger container for preview
    this.container.style = `
      background-color: ${COLORS.TRANSPARENT_BLACK_85};
      border-radius: 20px;
      border: 1px solid ${COLORS.PRIMARY};
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
      min-width: 400px;
      max-width: 600px;
    `;

    // Header
    const headerBox = new St.BoxLayout({
      vertical: false,
      style: "spacing: 10px;",
      x_align: Clutter.ActorAlign.CENTER,
    });

    const previewIcon = new St.Label({
      text: "📝",
      style: "font-size: 24px;",
    });

    const previewTitle = new St.Label({
      text: "Transcribed Text",
      style: `
        font-size: 16px;
        font-weight: bold;
        color: ${COLORS.WHITE};
      `,
    });

    headerBox.add_child(previewIcon);
    headerBox.add_child(previewTitle);

    // Text display/edit area
    const isWayland = Meta.is_wayland_compositor();
    const textEntry = new St.Entry({
      text: text,
      style: `
        background-color: rgba(255, 255, 255, 0.1);
        border: 2px solid ${COLORS.SECONDARY};
        border-radius: 10px;
        color: ${COLORS.WHITE};
        font-size: 15px;
        padding: 12px;
        width: 450px;
        caret-color: ${COLORS.PRIMARY};
      `,
      can_focus: true,
      reactive: true,
    });

    // Make it multiline
    const clutterText = textEntry.get_clutter_text();
    clutterText.set_line_wrap(true);
    clutterText.set_line_wrap_mode(2);
    clutterText.set_single_line_mode(false);
    clutterText.set_activatable(false);

    // Hint text
    const hintText = isWayland
      ? "Review the text above. Wayland requires manual paste."
      : "Review the text above. Press Enter to insert or Escape to cancel.";

    const hintLabel = new St.Label({
      text: hintText,
      style: `
        font-size: 12px;
        color: ${COLORS.DARK_GRAY};
        text-align: center;
      `,
    });

    // Buttons
    const buttonBox = new St.BoxLayout({
      vertical: false,
      style: "spacing: 12px;",
      x_align: Clutter.ActorAlign.CENTER,
    });

    // On X11, show Insert button. On Wayland with auto-insert enabled, also try
    const showInsert = !isWayland || this.options.autoInsertOnWayland;

    if (showInsert) {
      const insertButton = this._createButton("Insert Text", COLORS.SUCCESS, () => {
        const finalText = textEntry.get_text();
        this.close();
        if (this.onInsert) this.onInsert(finalText);
      });
      buttonBox.add_child(insertButton);
    }

    const copyButton = this._createButton(
      isWayland ? "Copy to Clipboard" : "Copy Only",
      COLORS.INFO,
      () => {
        const finalText = textEntry.get_text();
        this._copyToClipboard(finalText);
        this.close();
      }
    );

    const cancelButton = this._createButton("Cancel", COLORS.SECONDARY, () => {
      this.close();
      if (this.onCancel) this.onCancel();
    });

    buttonBox.add_child(copyButton);
    buttonBox.add_child(cancelButton);

    // Add all elements
    this.innerBox.add_child(headerBox);
    this.innerBox.add_child(textEntry);
    this.innerBox.add_child(hintLabel);
    this.innerBox.add_child(buttonBox);

    // Re-position
    this._positionAtTop();

    // Focus and select text
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
      clutterText.set_selection(0, text.length);
      return false;
    });

    // Keyboard handling
    this._setupPreviewKeyboardHandling(textEntry);
  }

  _setupPreviewKeyboardHandling(textEntry) {
    const isWayland = Meta.is_wayland_compositor();

    this.container.connect("key-press-event", (actor, event) => {
      const keyval = event.get_key_symbol();

      if (keyval === Clutter.KEY_Escape) {
        this.close();
        if (this.onCancel) this.onCancel();
        return Clutter.EVENT_STOP;
      }

      if ((keyval === Clutter.KEY_Return || keyval === Clutter.KEY_KP_Enter) && !isWayland) {
        const finalText = textEntry.get_text();
        this.close();
        if (this.onInsert) this.onInsert(finalText);
        return Clutter.EVENT_STOP;
      }

      return Clutter.EVENT_PROPAGATE;
    });

    this.container.grab_key_focus();
  }

  _copyToClipboard(text) {
    try {
      const clipboard = St.Clipboard.get_default();
      clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
      log.debug("✅ Text copied to clipboard from DynamicIsland");
      return true;
    } catch (e) {
      console.error("❌ Error copying to clipboard:", e);
      return false;
    }
  }

  showError(message) {
    this._stopPulsing();
    this.stopTimer();

    this.innerBox.remove_all_children();
    this.innerBox.vertical = true;
    this.innerBox.style = "spacing: 15px; padding: 20px 25px;";

    const errorIcon = new St.Label({
      text: "❌",
      style: "font-size: 32px;",
    });

    const errorTitle = new St.Label({
      text: "Error",
      style: `
        font-size: 16px;
        font-weight: bold;
        color: ${COLORS.DANGER};
      `,
    });

    const errorMessage = new St.Label({
      text: message,
      style: `
        font-size: 14px;
        color: ${COLORS.LIGHT_GRAY};
        text-align: center;
        max-width: 350px;
      `,
    });

    const closeButton = this._createButton("Close", COLORS.SECONDARY, () => {
      this.close();
      if (this.onCancel) this.onCancel();
    });

    this.innerBox.add_child(errorIcon);
    this.innerBox.add_child(errorTitle);
    this.innerBox.add_child(errorMessage);
    this.innerBox.add_child(closeButton);

    this._positionAtTop();
  }

  open() {
    log.debug("Opening Dynamic Island");

    Main.layoutManager.addTopChrome(this.container, {
      affectsStruts: false,
      trackFullscreen: false,
    });

    this._positionAtTop();
    this.container.show();
    this.startTimer();

    // Auto-collapse after 3 seconds if not hovered
    this.collapseTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
      if (!this.container.hover && !this.isPreviewMode && !this.isProcessing) {
        // Could add collapse animation here
      }
      this.collapseTimeoutId = null;
      return false;
    });
  }

  close() {
    log.debug("Closing Dynamic Island");

    this._stopPulsing();
    this.stopTimer();

    if (this.expandTimeoutId) {
      GLib.source_remove(this.expandTimeoutId);
      this.expandTimeoutId = null;
    }

    if (this.collapseTimeoutId) {
      GLib.source_remove(this.collapseTimeoutId);
      this.collapseTimeoutId = null;
    }

    cleanupChromeWidget(this.container, { destroy: true });
    this.container = null;
  }
}
