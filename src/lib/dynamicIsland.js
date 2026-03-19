import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { COLORS } from "./constants.js";
import { log, cleanupChromeWidget } from "./resourceUtils.js";

const BASE_STYLE = `
  background-color: rgba(22, 22, 26, 0.97);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.6);
`;

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
    this.pulseInterval = null;
    this.transcribedText = "";
    this.isPreviewMode = false;
    this.isProcessing = false;
    this.isExpanded = false;
    this.expandTimeoutId = null;
    this.collapseTimeoutId = null;

    this._buildIsland();
  }

  _buildIsland() {
    this.container = new St.Widget({
      style: `
        ${BASE_STYLE}
        border-radius: 28px;
      `,
      reactive: true,
      can_focus: true,
      track_hover: true,
    });

    this.innerBox = new St.BoxLayout({
      vertical: false,
      style: "spacing: 10px; padding: 10px 18px;",
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });

    this.container.add_child(this.innerBox);
    this._buildCompactView();
    this._positionAtTop();

    this.container.connect("notify::hover", () => {
      if (this.container.hover && !this.isPreviewMode && !this.isProcessing) {
        this._expand();
      } else if (!this.container.hover && this.isExpanded && !this.isPreviewMode) {
        if (this.collapseTimeoutId) GLib.source_remove(this.collapseTimeoutId);
        this.collapseTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
          if (!this.container?.hover) this._collapse();
          this.collapseTimeoutId = null;
          return false;
        });
      }
    });
  }

  _buildCompactView() {
    // Pulsing dot
    this.recordingDot = new St.Widget({
      style: `
        width: 8px;
        height: 8px;
        border-radius: 4px;
        background-color: ${COLORS.PRIMARY};
      `,
      y_align: Clutter.ActorAlign.CENTER,
    });

    this.iconLabel = new St.Label({
      text: "🎤",
      style: "font-size: 16px;",
      y_align: Clutter.ActorAlign.CENTER,
    });

    this.statusLabel = new St.Label({
      text: "Recording",
      style: `font-size: 13px; font-weight: bold; color: white;`,
      y_align: Clutter.ActorAlign.CENTER,
    });

    this.timerLabel = new St.Label({
      text: "0:00",
      style: `font-size: 12px; color: #888; font-family: monospace;`,
      y_align: Clutter.ActorAlign.CENTER,
    });

    this.innerBox.add_child(this.recordingDot);
    this.innerBox.add_child(this.iconLabel);
    this.innerBox.add_child(this.statusLabel);
    this.innerBox.add_child(this.timerLabel);

    this._startPulsing();
  }

  _buildExpandedView() {
    this.innerBox.remove_all_children();
    this.innerBox.vertical = true;
    this.innerBox.style = "spacing: 14px; padding: 18px 24px;";

    this.container.set_style(`
      ${BASE_STYLE}
      border-radius: 18px;
      min-width: 280px;
    `);

    // Header row
    const header = new St.BoxLayout({
      vertical: false,
      style: "spacing: 10px;",
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });

    this.expandedDot = new St.Widget({
      style: `
        width: 8px; height: 8px; border-radius: 4px;
        background-color: ${COLORS.PRIMARY};
      `,
      y_align: Clutter.ActorAlign.CENTER,
    });

    this.expandedIcon = new St.Label({
      text: "🎤",
      style: "font-size: 18px;",
      y_align: Clutter.ActorAlign.CENTER,
    });

    this.expandedStatus = new St.Label({
      text: "Recording",
      style: `font-size: 15px; font-weight: bold; color: white;`,
      y_align: Clutter.ActorAlign.CENTER,
    });

    header.add_child(this.expandedDot);
    header.add_child(this.expandedIcon);
    header.add_child(this.expandedStatus);

    // Progress bar
    this.progressBarContainer = new St.Widget({
      style: `
        background-color: rgba(255, 255, 255, 0.08);
        border-radius: 4px;
        height: 4px;
        width: 220px;
      `,
    });
    this.progressBar = new St.Widget({
      style: `
        background-color: ${COLORS.PRIMARY};
        border-radius: 4px;
        height: 4px;
        width: 0px;
      `,
    });
    this.progressBarContainer.add_child(this.progressBar);

    // Timer
    this.expandedTimer = new St.Label({
      text: "0:00 / 1:00",
      style: `font-size: 11px; color: #666; font-family: monospace;`,
      x_align: Clutter.ActorAlign.CENTER,
    });

    // Buttons
    const buttonRow = new St.BoxLayout({
      vertical: false,
      style: "spacing: 8px;",
      x_align: Clutter.ActorAlign.CENTER,
    });

    this.stopButton = this._makeButton("⏹  Stop", COLORS.DANGER);
    this.stopButton.connect("clicked", () => {
      if (this.onStop) this.onStop();
    });

    this.cancelButton = this._makeButton("✕  Cancel", "#444");
    this.cancelButton.connect("clicked", () => {
      this.close();
      if (this.onCancel) this.onCancel();
    });

    buttonRow.add_child(this.stopButton);
    buttonRow.add_child(this.cancelButton);

    this.innerBox.add_child(header);
    this.innerBox.add_child(this.progressBarContainer);
    this.innerBox.add_child(this.expandedTimer);
    this.innerBox.add_child(buttonRow);

    this._positionAtTop();
    this._startPulsing();
  }

  _makeButton(label, bgColor) {
    const base = `
      background-color: ${bgColor};
      color: white;
      border-radius: 8px;
      padding: 7px 16px;
      font-size: 12px;
      font-weight: bold;
      border: none;
    `;
    const hover = `
      background-color: ${bgColor};
      color: white;
      border-radius: 8px;
      padding: 7px 16px;
      font-size: 12px;
      font-weight: bold;
      border: none;
      opacity: 0.85;
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

  _makeGhostButton(label, color) {
    const base = `
      color: ${color};
      border: 1.5px solid ${color};
      background-color: transparent;
      border-radius: 8px;
      padding: 8px 18px;
      font-size: 13px;
      font-weight: bold;
    `;
    const hover = `
      color: ${color};
      border: 1.5px solid ${color};
      background-color: rgba(255,255,255,0.06);
      border-radius: 8px;
      padding: 8px 18px;
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

  _positionAtTop() {
    const monitor = Main.layoutManager.primaryMonitor;
    const panelHeight = Main.panel ? Main.panel.height : 32;
    const minY = monitor.y + panelHeight + 8;

    const [allocWidth, allocHeight] = this.container.get_size();
    const containerWidth = allocWidth > 0 ? allocWidth : 280;
    const containerHeight = allocHeight > 0 ? allocHeight : 50;

    let x, y;

    if (this._anchorX !== undefined && this._anchorY !== undefined) {
      // Position above the cursor anchor captured at open() time
      x = this._anchorX - Math.round(containerWidth / 2);
      y = this._anchorY - containerHeight - 12;

      // If it would overlap the panel, flip below the anchor instead
      if (y < minY) y = this._anchorY + 20;

      // Clamp to screen bounds
      x = Math.max(monitor.x + 8, Math.min(x, monitor.x + monitor.width - containerWidth - 8));
      y = Math.max(minY, Math.min(y, monitor.y + monitor.height - containerHeight - 8));
    } else {
      // Fallback: top-centre
      const containerWidthFallback = allocWidth > 0 ? allocWidth : monitor.width - 80;
      x = monitor.x + Math.round((monitor.width - containerWidthFallback) / 2);
      y = minY;
    }

    this.container.set_position(x, y);
  }

  _startPulsing() {
    this._stopPulsing();
    let visible = true;
    this.pulseInterval = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
      const dot = this.isExpanded ? this.expandedDot : this.recordingDot;
      if (!dot) return false;
      dot.set_opacity(visible ? 255 : 80);
      visible = !visible;
      return true;
    });
  }

  _stopPulsing() {
    if (this.pulseInterval) {
      GLib.source_remove(this.pulseInterval);
      this.pulseInterval = null;
    }
    if (this.recordingDot) this.recordingDot.set_opacity(255);
    if (this.expandedDot) this.expandedDot.set_opacity(255);
  }

  _expand() {
    if (this.isExpanded) return;
    this.isExpanded = true;
    if (this.collapseTimeoutId) {
      GLib.source_remove(this.collapseTimeoutId);
      this.collapseTimeoutId = null;
    }
    this._buildExpandedView();
  }

  _collapse() {
    if (!this.isExpanded) return;
    this.isExpanded = false;
    this._stopPulsing();
    this.innerBox.remove_all_children();
    this.innerBox.vertical = false;
    this.innerBox.style = "spacing: 10px; padding: 10px 18px;";
    this.container.set_style(`${BASE_STYLE} border-radius: 28px;`);
    this._buildCompactView();
    this._positionAtTop();
  }

  // ─── Timer ────────────────────────────────────────────────────────────────

  startTimer() {
    this.startTime = Date.now();
    this.elapsedTime = 0;
    this._updateTimerDisplay();

    if (this.timerInterval) GLib.source_remove(this.timerInterval);
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
    const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
    const timeStr = fmt(this.elapsedTime);

    if (this.timerLabel) this.timerLabel.set_text(timeStr);

    if (this.expandedTimer) {
      this.expandedTimer.set_text(`${timeStr} / ${fmt(this.maxDuration)}`);
    }

    if (this.progressBar && this.maxDuration > 0) {
      const pct = Math.min(this.elapsedTime / this.maxDuration, 1.0);
      const w = Math.floor(220 * pct);
      let color = COLORS.PRIMARY;
      if (pct > 0.95) color = COLORS.DANGER;
      else if (pct > 0.8) color = "#e07000";
      this.progressBar.set_style(`
        background-color: ${color};
        border-radius: 4px;
        height: 4px;
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

  // ─── States ───────────────────────────────────────────────────────────────

  showProcessing() {
    this.isProcessing = true;
    this.isExpanded = false;
    this._stopPulsing();
    this.stopTimer();

    this.innerBox.remove_all_children();
    this.innerBox.vertical = false;
    this.innerBox.style = "spacing: 10px; padding: 10px 20px;";
    this.container.set_style(`${BASE_STYLE} border-radius: 28px;`);

    const spinner = new St.Label({
      text: "🧠",
      style: "font-size: 16px;",
      y_align: Clutter.ActorAlign.CENTER,
    });

    const label = new St.Label({
      text: "Transcribing…",
      style: "font-size: 13px; font-weight: bold; color: #bbb;",
      y_align: Clutter.ActorAlign.CENTER,
    });

    this.innerBox.add_child(spinner);
    this.innerBox.add_child(label);
    this._positionAtTop();
  }

  showPreview(text) {
    this.isPreviewMode = true;
    this.transcribedText = text;
    this.isProcessing = false;
    this._stopPulsing();
    this.stopTimer();

    this.innerBox.remove_all_children();
    this.innerBox.vertical = true;
    this.innerBox.style = "spacing: 10px; padding: 14px 20px;";
    this.innerBox.x_expand = true;

    this.container.set_style(`
      ${BASE_STYLE}
      border-radius: 18px;
      min-width: 280px;
      max-width: 560px;
    `);

    // Plain text display — no editable entry
    const textLbl = new St.Label({
      text,
      style: `
        color: #e8e8e8;
        font-size: 14px;
      `,
      x_expand: true,
    });
    textLbl.get_clutter_text().set_line_wrap(true);
    textLbl.get_clutter_text().set_line_wrap_mode(2);

    // Keyboard hint row
    const hintLbl = new St.Label({
      text: "↵ copy  ·  Esc cancel",
      style: "font-size: 11px; color: #555;",
      x_align: Clutter.ActorAlign.CENTER,
    });

    this.innerBox.add_child(textLbl);
    this.innerBox.add_child(hintLbl);

    this._positionAtTop();
    this._setupPreviewKeyboardHandling(text);
  }

  _setupPreviewKeyboardHandling(text) {
    this.container.connect("key-press-event", (actor, event) => {
      const keyval = event.get_key_symbol();
      if (keyval === Clutter.KEY_Escape) {
        this.close();
        if (this.onCancel) this.onCancel();
        return Clutter.EVENT_STOP;
      }
      if (keyval === Clutter.KEY_Return || keyval === Clutter.KEY_KP_Enter) {
        this.close();
        if (this.onInsert) this.onInsert(text);
        return Clutter.EVENT_STOP;
      }
      return Clutter.EVENT_PROPAGATE;
    });
    this.container.grab_key_focus();
  }

  showError(message) {
    this._stopPulsing();
    this.stopTimer();

    this.innerBox.remove_all_children();
    this.innerBox.vertical = true;
    this.innerBox.style = "spacing: 12px; padding: 18px 22px;";
    this.container.set_style(`
      ${BASE_STYLE}
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      min-width: 300px;
    `);

    const errorIcon = new St.Label({
      text: "⚠",
      style: `font-size: 22px; color: ${COLORS.DANGER};`,
      x_align: Clutter.ActorAlign.CENTER,
    });

    const errorMsg = new St.Label({
      text: message,
      style: `font-size: 13px; color: #ccc; text-align: center;`,
      x_align: Clutter.ActorAlign.CENTER,
    });

    const closeBtn = this._makeGhostButton("Close", "#666");
    closeBtn.connect("clicked", () => {
      this.close();
      if (this.onCancel) this.onCancel();
    });

    this.innerBox.add_child(errorIcon);
    this.innerBox.add_child(errorMsg);
    this.innerBox.add_child(closeBtn);
    this._positionAtTop();
  }

  _copyToClipboard(text) {
    try {
      St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
      return true;
    } catch (e) {
      console.error("Error copying to clipboard:", e);
      return false;
    }
  }

  open() {
    log.debug("Opening Dynamic Island");
    // Capture mouse position so the DI appears near the active input
    const [mx, my] = global.get_pointer();
    this._anchorX = mx;
    this._anchorY = my;

    Main.layoutManager.addTopChrome(this.container, {
      affectsStruts: false,
      trackFullscreen: false,
    });
    this._positionAtTop();
    this.container.show();
    this.startTimer();
  }

  close() {
    log.debug("Closing Dynamic Island");
    this._stopPulsing();
    this.stopTimer();

    if (this.expandTimeoutId) { GLib.source_remove(this.expandTimeoutId); this.expandTimeoutId = null; }
    if (this.collapseTimeoutId) { GLib.source_remove(this.collapseTimeoutId); this.collapseTimeoutId = null; }

    cleanupChromeWidget(this.container, { destroy: true });
    this.container = null;
  }
}
