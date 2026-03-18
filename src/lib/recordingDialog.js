import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as Config from "resource:///org/gnome/shell/misc/config.js";

import { COLORS } from "./constants.js";
import {
  cleanupChromeWidget,
  cleanupRecordingModal,
  centerWidgetOnMonitor,
  log,
} from "./resourceUtils.js";

const DIALOG_STYLE = `
  background-color: rgba(18, 18, 22, 0.98);
  border-radius: 16px;
  border: 1.5px solid rgba(255, 140, 0, 0.45);
`;

export class RecordingDialog {
  constructor(onCancel, onInsert, onStop, maxDuration = 60, options = {}) {
    log.debug("RecordingDialog constructor called");

    this.onCancel = onCancel;
    this.onInsert = onInsert;
    this.onStop = onStop;
    this.maxDuration = maxDuration;
    this.allowInsert = options?.allowInsert !== false;
    this.startTime = null;
    this.elapsedTime = 0;
    this.timerInterval = null;
    this.focusTimeoutId = null;
    this.buttonFocusTimeoutId = null;
    this.openFocusTimeoutId = null;
    this.cleanupTimeoutId = null;
    this.delayedCleanupTimeoutId = null;
    this.centerTimeoutId = null;
    this.isPreviewMode = false;
    this.transcribedText = "";

    this._buildDialog();
  }

  _buildDialog() {
    // Semi-transparent full-screen barrier
    this.modalBarrier = new St.Widget({
      style: `background-color: rgba(0, 0, 0, 0.55);`,
      reactive: true,
      can_focus: true,
      track_hover: true,
    });

    // Main dialog
    this.container = new St.Widget({
      style: `
        ${DIALOG_STYLE}
        padding: 28px 30px 24px;
        min-width: 420px;
        max-width: 560px;
      `,
      layout_manager: new Clutter.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        spacing: 18,
      }),
      reactive: true,
      can_focus: true,
    });

    this._buildRecordingUI();
  }

  // ─── Ghost button helper ──────────────────────────────────────────────────

  _makeGhostButton(label, color) {
    const base = `
      color: ${color};
      border: 1.5px solid ${color};
      background-color: transparent;
      border-radius: 8px;
      padding: 9px 20px;
      font-size: 13px;
      font-weight: bold;
    `;
    const hover = `
      color: ${color};
      border: 1.5px solid ${color};
      background-color: rgba(255,255,255,0.06);
      border-radius: 8px;
      padding: 9px 20px;
      font-size: 13px;
      font-weight: bold;
    `;
    const btn = new St.Button({
      label,
      style: base,
      reactive: true,
      can_focus: true,
      track_hover: true,
    });
    btn.connect("enter-event", () => btn.set_style(hover));
    btn.connect("leave-event", () => btn.set_style(base));
    return btn;
  }

  _makeSectionLabel(text) {
    return new St.Label({
      text: text.toUpperCase(),
      style: `
        font-size: 10px;
        font-weight: bold;
        color: #555;
        letter-spacing: 0.8px;
      `,
    });
  }

  // ─── Recording UI ─────────────────────────────────────────────────────────

  _buildRecordingUI() {
    this.container.remove_all_children();

    // Header
    const headerRow = new St.BoxLayout({
      vertical: false,
      style: "spacing: 12px;",
      x_align: Clutter.ActorAlign.CENTER,
    });

    const iconBadge = new St.Widget({
      style: `
        width: 40px; height: 40px; border-radius: 12px;
        background-color: rgba(255, 140, 0, 0.15);
        border: 1.5px solid rgba(255, 140, 0, 0.4);
      `,
    });
    this.recordingIcon = new St.Label({
      text: "🎤",
      style: "font-size: 20px;",
      y_align: Clutter.ActorAlign.CENTER,
      x_align: Clutter.ActorAlign.CENTER,
    });
    iconBadge.add_child(this.recordingIcon);

    this.recordingLabel = new St.Label({
      text: "Recording",
      style: `font-size: 18px; font-weight: bold; color: white;`,
      y_align: Clutter.ActorAlign.CENTER,
    });

    headerRow.add_child(iconBadge);
    headerRow.add_child(this.recordingLabel);

    // Progress bar
    this.progressContainer = new St.Widget({
      style: `
        background-color: rgba(255, 255, 255, 0.07);
        border-radius: 4px;
        height: 6px;
        width: 320px;
      `,
      x_align: Clutter.ActorAlign.CENTER,
    });

    this.progressBar = new St.Widget({
      style: `
        background-color: ${COLORS.PRIMARY};
        border-radius: 4px;
        height: 6px;
        width: 0px;
      `,
    });
    this.progressBar.set_position(0, 0);
    this.progressContainer.add_child(this.progressBar);

    // Time
    this.timeDisplay = new St.Label({
      text: this._formatTime(0, this.maxDuration),
      style: `
        font-size: 12px;
        color: #666;
        font-family: monospace;
        text-align: center;
      `,
      x_align: Clutter.ActorAlign.CENTER,
    });

    // Hint
    this.instructionLabel = new St.Label({
      text: "Speak now  •  Enter to stop  •  Escape to cancel",
      style: `font-size: 12px; color: #555; text-align: center;`,
      x_align: Clutter.ActorAlign.CENTER,
    });

    // Buttons
    const buttonRow = new St.BoxLayout({
      vertical: false,
      style: "spacing: 10px;",
      x_align: Clutter.ActorAlign.CENTER,
    });

    this.stopButton = this._makeGhostButton("⏹  Stop Recording", COLORS.DANGER);
    this.cancelButton = this._makeGhostButton("Cancel", "#555");

    this.stopButton.connect("clicked", () => {
      if (this.onStop) this.onStop();
    });
    this.cancelButton.connect("clicked", () => {
      this.close();
      this.onCancel?.();
    });

    buttonRow.add_child(this.stopButton);
    buttonRow.add_child(this.cancelButton);

    // Keyboard handler
    this.keyboardHandlerId = this.modalBarrier.connect("key-press-event", (actor, event) => {
      const keyval = event.get_key_symbol();
      if (keyval === Clutter.KEY_Escape) {
        this.close();
        this.onCancel?.();
        return Clutter.EVENT_STOP;
      }
      if ((keyval === Clutter.KEY_Return || keyval === Clutter.KEY_KP_Enter) && !this.isPreviewMode) {
        if (this.onStop) this.onStop();
        return Clutter.EVENT_STOP;
      }
      return Clutter.EVENT_PROPAGATE;
    });

    this.container.add_child(headerRow);
    this.container.add_child(this.progressContainer);
    this.container.add_child(this.timeDisplay);
    this.container.add_child(this.instructionLabel);
    this.container.add_child(buttonRow);

    this.modalBarrier.add_child(this.container);
  }

  _formatTime(elapsed, max) {
    const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
    const remaining = Math.max(0, max - elapsed);
    return `${fmt(elapsed)} / ${fmt(max)}  (${fmt(remaining)} left)`;
  }

  // ─── Timer ────────────────────────────────────────────────────────────────

  startTimer() {
    this.startTime = Date.now();
    this.elapsedTime = 0;
    this._updateTimeDisplay();

    if (this.timerInterval) {
      GLib.Source.remove(this.timerInterval);
      this.timerInterval = null;
    }

    this.timerInterval = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
      if (this.startTime) {
        this._updateTimeDisplay();
        return this.elapsedTime < this.maxDuration;
      }
      return false;
    });
  }

  _updateTimeDisplay() {
    if (!this.startTime) return;
    this.elapsedTime = Math.floor((Date.now() - this.startTime) / 1000);

    if (this.timeDisplay) {
      this.timeDisplay.set_text(this._formatTime(this.elapsedTime, this.maxDuration));
    }

    if (this.progressBar && this.progressContainer) {
      const pct = Math.min(this.elapsedTime / this.maxDuration, 1.0);
      const containerWidth = 320;
      const w = Math.floor(containerWidth * pct);
      let color = COLORS.PRIMARY;
      if (pct > 0.95) color = COLORS.DANGER;
      else if (pct > 0.8) color = "#e07000";
      const radius = pct >= 1.0 ? "4px" : "4px 0 0 4px";
      this.progressBar.set_style(`
        background-color: ${color};
        border-radius: ${radius};
        height: 6px;
        width: ${w}px;
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

  // ─── State transitions ────────────────────────────────────────────────────

  showProcessing() {
    log.debug("Showing processing state");

    if (this.recordingLabel) this.recordingLabel.set_text("Transcribing…");
    if (this.recordingIcon) this.recordingIcon.set_text("🧠");
    if (this.instructionLabel) {
      this.instructionLabel.set_text("Processing your speech  •  Escape to cancel");
    }
    if (this.stopButton) this.stopButton.hide();
    if (this.cancelButton) {
      this.cancelButton.show();
      this.cancelButton.set_label("Cancel");
    }

    this.stopTimer();
    if (this.progressContainer) this.progressContainer.hide();
    if (this.timeDisplay) this.timeDisplay.hide();
  }

  showPreview(text) {
    this.isPreviewMode = true;
    this.transcribedText = text;

    log.debug(`Showing preview with text: "${text}"`);

    const isWayland = Meta.is_wayland_compositor();

    // Update header
    if (this.recordingIcon) this.recordingIcon.set_text("📝");
    if (this.recordingLabel) this.recordingLabel.set_text("Transcribed Text");

    // Hide recording-specific elements
    if (this.progressContainer) this.progressContainer.hide();
    if (this.timeDisplay) this.timeDisplay.hide();
    if (this.stopButton) this.stopButton.hide();
    if (this.cancelButton) this.cancelButton.hide();
    if (this.instructionLabel) {
      this.instructionLabel.set_text(
        isWayland
          ? "Wayland: use Copy to paste manually"
          : "Enter to insert at cursor  •  Escape to cancel"
      );
    }

    // Resize dialog
    this.container.set_style(`
      ${DIALOG_STYLE}
      padding: 28px 30px 24px;
      min-width: 520px;
      max-width: 680px;
    `);

    const monitor = Main.layoutManager.primaryMonitor;
    this.centerTimeoutId = centerWidgetOnMonitor(this.container, monitor, {
      fallbackWidth: 580,
      fallbackHeight: 360,
      onComplete: () => (this.centerTimeoutId = null),
    });

    // Text entry
    const textEntry = new St.Entry({
      text,
      style: `
        background-color: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 10px;
        color: #e8e8e8;
        font-size: 14px;
        padding: 12px 14px;
        caret-color: ${COLORS.PRIMARY};
      `,
      can_focus: true,
      reactive: true,
    });

    const ct = textEntry.get_clutter_text();
    ct.set_line_wrap(true);
    ct.set_line_wrap_mode(2);
    ct.set_single_line_mode(false);
    ct.set_activatable(false);

    this.container.add_child(textEntry);

    // Focus + select all
    if (this.focusTimeoutId) GLib.Source.remove(this.focusTimeoutId);
    this.focusTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
      ct.set_selection(0, text.length);
      this.focusTimeoutId = null;
      return false;
    });

    // Buttons
    const buttonRow = new St.BoxLayout({
      vertical: false,
      style: "spacing: 8px;",
      x_align: Clutter.ActorAlign.CENTER,
    });

    if (!isWayland && this.allowInsert) {
      const insertBtn = this._makeGhostButton("Insert", COLORS.SUCCESS);
      insertBtn.connect("clicked", () => {
        const finalText = textEntry.get_text();
        this.close();
        this.onInsert?.(finalText);
      });
      buttonRow.add_child(insertBtn);
    }

    const copyBtn = this._makeGhostButton(
      isWayland ? "Copy" : "Copy Only",
      COLORS.PRIMARY
    );
    copyBtn.connect("clicked", () => {
      this._copyToClipboard(textEntry.get_text());
      this.close();
      this.onCancel?.();
    });

    const cancelBtn = this._makeGhostButton("Cancel", "#555");
    cancelBtn.connect("clicked", () => {
      this.close();
      this.onCancel?.();
    });

    // Focus copy button for Enter key
    if (this.buttonFocusTimeoutId) GLib.Source.remove(this.buttonFocusTimeoutId);
    this.buttonFocusTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
      copyBtn.grab_key_focus();
      this.buttonFocusTimeoutId = null;
      return false;
    });

    buttonRow.add_child(copyBtn);
    buttonRow.add_child(cancelBtn);
    this.container.add_child(buttonRow);

    // Keyboard handling for preview
    this.modalBarrier.disconnect(this.keyboardHandlerId);
    this.keyboardHandlerId = this.modalBarrier.connect("key-press-event", (actor, event) => {
      const keyval = event.get_key_symbol();
      if (keyval === Clutter.KEY_Escape) {
        this.close();
        this.onCancel?.();
        return Clutter.EVENT_STOP;
      }
      if (keyval === Clutter.KEY_Return || keyval === Clutter.KEY_KP_Enter) {
        this._copyToClipboard(textEntry.get_text());
        this.close();
        this.onCancel?.();
        return Clutter.EVENT_STOP;
      }
      return Clutter.EVENT_PROPAGATE;
    });
  }

  showError(message) {
    log.warn(`Showing error: ${message}`);

    if (this.recordingLabel) {
      this.recordingLabel.set_text("Error");
      this.recordingLabel.set_style(`font-size: 18px; font-weight: bold; color: ${COLORS.DANGER};`);
    }
    if (this.recordingIcon) this.recordingIcon.set_text("⚠");
    if (this.instructionLabel) {
      this.instructionLabel.set_text(message);
      this.instructionLabel.set_style(`font-size: 13px; color: #999; text-align: center;`);
    }
    if (this.stopButton) this.stopButton.hide();
    if (this.progressContainer) this.progressContainer.hide();
    if (this.timeDisplay) this.timeDisplay.hide();
    if (this.cancelButton) {
      this.cancelButton.show();
      this.cancelButton.set_label("Close");
    }
    this.stopTimer();
  }

  _copyToClipboard(text) {
    try {
      St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
      return true;
    } catch (e) {
      console.error(`Error copying to clipboard: ${e}`);
      return false;
    }
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  open() {
    log.debug("Opening RecordingDialog");

    try {
      Main.layoutManager.addTopChrome(this.modalBarrier);

      const monitor = Main.layoutManager.primaryMonitor;
      this.modalBarrier.set_position(monitor.x, monitor.y);
      this.modalBarrier.set_size(monitor.width, monitor.height);

      if (this.centerTimeoutId) {
        GLib.Source.remove(this.centerTimeoutId);
        this.centerTimeoutId = null;
      }
      this.centerTimeoutId = centerWidgetOnMonitor(this.container, monitor, {
        fallbackWidth: 440,
        fallbackHeight: 280,
        onComplete: () => (this.centerTimeoutId = null),
      });

      this.modalBarrier.show();
      this.startTimer();

      if (this.openFocusTimeoutId) {
        GLib.Source.remove(this.openFocusTimeoutId);
        this.openFocusTimeoutId = null;
      }

      this.openFocusTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
        try {
          if (this.modalBarrier?.get_parent?.()) {
            if (this.modalBarrier.grab_key_focus) {
              this.modalBarrier.grab_key_focus();
            }
            const isWayland = Meta.is_wayland_compositor();
            if (!isWayland && global.stage?.set_key_focus) {
              global.stage.set_key_focus(this.modalBarrier);
            }
          }
        } catch (error) {
          log.debug("Failed to set focus (non-critical):", error.message);
        }
        this.openFocusTimeoutId = null;
        return false;
      });
    } catch (error) {
      console.error("Error opening recording dialog:", error);
      if (this.modalBarrier) {
        cleanupChromeWidget(this.modalBarrier, { destroy: false });
      }
      throw error;
    }
  }

  close() {
    log.debug("Closing RecordingDialog");

    if (!this.modalBarrier) {
      log.debug("Modal already cleaned up");
      return;
    }

    try {
      this.stopTimer();

      const timeouts = [
        "focusTimeoutId", "buttonFocusTimeoutId", "openFocusTimeoutId",
        "cleanupTimeoutId", "delayedCleanupTimeoutId", "centerTimeoutId",
      ];
      for (const id of timeouts) {
        if (this[id]) {
          GLib.Source.remove(this[id]);
          this[id] = null;
        }
      }

      if (this.keyboardHandlerId) {
        try {
          if (this.modalBarrier?.disconnect) {
            this.modalBarrier.disconnect(this.keyboardHandlerId);
          }
        } catch (e) {
          log.debug("Signal handler already disconnected:", e.message);
        } finally {
          this.keyboardHandlerId = null;
        }
      }

      if (this.modalBarrier) {
        try { this.modalBarrier.hide(); } catch (e) { /* non-fatal */ }

        const modal = this.modalBarrier;
        this.modalBarrier = null;

        const isGNOME48Plus = (() => {
          try {
            return parseInt(Config.PACKAGE_VERSION.split(".")[0], 10) >= 48;
          } catch (_e) {
            return true;
          }
        })();

        try {
          cleanupRecordingModal(modal, { isGNOME48Plus });
        } catch (e) {
          log.warn("Cleanup failed:", e.message);
        }
      }
    } catch (error) {
      console.error("Error closing recording dialog:", error.message);
      this.modalBarrier = null;
    }
  }
}
