import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import St from "gi://St";
import Meta from "gi://Meta";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { COLORS } from "./constants.js";
import { createStyledLabel, createVerticalBox, createHorizontalBox } from "./uiUtils.js";
import { createCloseButton, createCenteredBox, createHeaderLayout } from "./buttonUtils.js";
import {
  cleanupModal,
  showModalDialog,
  closeModalDialog,
  setupModalEventHandlers,
} from "./resourceUtils.js";

export class SettingsDialog {
  constructor(extension) {
    this.extension = extension;
    this.settings = extension.settings;
    this.overlay = null;
    this.currentShortcutDisplay = null;
    this.clipboardCheckbox = null;
    this.clipboardCheckboxIcon = null;
    this.skipPreviewCheckbox = null;
    this.skipPreviewCheckboxIcon = null;
    this.nonBlockingTranscriptionCheckbox = null;
    this.nonBlockingTranscriptionCheckboxIcon = null;
    this.dynamicIslandCheckbox = null;
    this.dynamicIslandCheckboxIcon = null;
    this.autoInsertWaylandCheckbox = null;
    this.autoInsertWaylandCheckboxIcon = null;
    this.showTranscriptionInlineCheckbox = null;
    this.showTranscriptionInlineCheckboxIcon = null;
    this.centerTimeoutId = null;
    this.keyPressHandler = null;
    this.clickHandler = null;
  }

  show() {
    if (this.overlay) {
      return;
    }
    this._createDialog();
    this._setupEventHandlers();
    this._showDialog();
  }

  close() {
    closeModalDialog(
      this.overlay,
      {
        keyPressHandler: this.keyPressHandler,
        clickHandler: this.clickHandler,
      },
      this.centerTimeoutId
    );
    this.centerTimeoutId = null;
    this.overlay = null;
    this.keyPressHandler = null;
    this.clickHandler = null;
  }

  // ─── Toggle helpers ───────────────────────────────────────────────────────

  _toggleBtnStyle(enabled) {
    return `
      width: 50px;
      height: 24px;
      border-radius: 12px;
      background-color: ${enabled ? COLORS.PRIMARY : "rgba(50, 50, 55, 1)"};
      border: 1.5px solid ${enabled ? COLORS.PRIMARY : "rgba(80, 80, 88, 1)"};
      transition-duration: 150ms;
    `;
  }

  _toggleLblStyle(enabled) {
    return `
      font-size: 9px;
      font-weight: bold;
      color: ${enabled ? "white" : "#666"};
      letter-spacing: 0.5px;
    `;
  }

  _makeToggle(enabled) {
    const button = new St.Button({
      style: this._toggleBtnStyle(enabled),
      reactive: true,
      can_focus: true,
    });
    const label = new St.Label({
      text: enabled ? "ON" : "OFF",
      style: this._toggleLblStyle(enabled),
      y_align: Clutter.ActorAlign.CENTER,
      x_align: Clutter.ActorAlign.CENTER,
    });
    button.add_child(label);
    return { button, label };
  }

  _updateToggle(button, label, enabled) {
    button.set_style(this._toggleBtnStyle(enabled));
    label.set_style(this._toggleLblStyle(enabled));
    label.set_text(enabled ? "ON" : "OFF");
  }

  // ─── Ghost button helper ──────────────────────────────────────────────────

  _makeGhostButton(text, color, hoverAlpha = "0.12") {
    const base = `
      color: ${color};
      border: 1.5px solid ${color};
      background-color: transparent;
      border-radius: 7px;
      padding: 7px 16px;
      font-size: 13px;
      font-weight: bold;
    `;
    const hover = `
      color: ${color};
      border: 1.5px solid ${color};
      background-color: ${color}${Math.round(parseFloat(hoverAlpha) * 255).toString(16).padStart(2, "0")};
      border-radius: 7px;
      padding: 7px 16px;
      font-size: 13px;
      font-weight: bold;
    `;
    const button = new St.Button({
      label: text,
      style: base,
      reactive: true,
      can_focus: true,
      track_hover: true,
    });
    button.connect("enter-event", () => button.set_style(hover));
    button.connect("leave-event", () => button.set_style(base));
    return button;
  }

  // ─── Dialog construction ──────────────────────────────────────────────────

  _createDialog() {
    this.overlay = new St.Widget({
      style: `background-color: rgba(0, 0, 0, 0.65);`,
      reactive: true,
      can_focus: true,
      track_hover: true,
    });

    this.settingsWindow = new St.BoxLayout({
      style_class: "settings-window",
      vertical: true,
      style: `
        background-color: rgba(18, 18, 22, 0.98);
        border-radius: 16px;
        padding: 28px 30px 24px;
        min-width: 520px;
        max-width: 580px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        spacing: 0;
      `,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });

    this.settingsWindow.add_child(this._buildHeaderSection());
    this.settingsWindow.add_child(this._makeDivider("16px", "0px"));
    this.settingsWindow.add_child(this._buildShortcutSection());
    this.settingsWindow.add_child(this._makeDivider("16px", "0px"));
    this.settingsWindow.add_child(this._buildDurationSection());
    this.settingsWindow.add_child(this._makeDivider("16px", "0px"));
    this.settingsWindow.add_child(this._buildOptionsSection());

    this.overlay.add_child(this.settingsWindow);
  }

  _makeDivider(marginTop = "12px", marginBottom = "0px") {
    return new St.Widget({
      style: `
        background-color: rgba(255, 255, 255, 0.06);
        height: 1px;
        margin-top: ${marginTop};
        margin-bottom: ${marginBottom};
      `,
      x_expand: true,
    });
  }

  _makeSectionLabel(text) {
    return new St.Label({
      text: text.toUpperCase(),
      style: `
        font-size: 10px;
        font-weight: bold;
        color: #666;
        letter-spacing: 0.8px;
        margin-bottom: 10px;
        margin-top: 16px;
      `,
    });
  }

  // ─── Header ──────────────────────────────────────────────────────────────

  _buildHeaderSection() {
    const titleContainer = new St.BoxLayout({
      vertical: false,
      style: "spacing: 12px;",
      x_align: Clutter.ActorAlign.START,
      y_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
    });

    const iconBadge = new St.Widget({
      style: `
        width: 36px;
        height: 36px;
        border-radius: 10px;
        background-color: rgba(255, 140, 0, 0.15);
        border: 1px solid rgba(255, 255, 255, 0.08);
      `,
    });
    const iconLabel = new St.Label({
      text: "🎤",
      style: "font-size: 18px;",
      y_align: Clutter.ActorAlign.CENTER,
      x_align: Clutter.ActorAlign.CENTER,
    });
    iconBadge.add_child(iconLabel);

    const titleLabel = new St.Label({
      text: "Speech2Text Settings",
      style: `
        font-size: 17px;
        font-weight: bold;
        color: white;
      `,
      y_align: Clutter.ActorAlign.CENTER,
    });

    titleContainer.add_child(iconBadge);
    titleContainer.add_child(titleLabel);

    this.closeButton = createCloseButton(30);
    return createHeaderLayout(titleContainer, this.closeButton);
  }

  // ─── Keyboard shortcut ────────────────────────────────────────────────────

  _buildShortcutSection() {
    const section = new St.BoxLayout({ vertical: true, style: "" });

    section.add_child(this._makeSectionLabel("Keyboard Shortcut"));

    // Current shortcut display
    const shortcuts = this.settings.get_strv("toggle-recording");
    const currentShortcut = shortcuts.length > 0 ? shortcuts[0] : null;
    this.currentShortcutDisplay = new St.Label({
      text: currentShortcut || "No shortcut set",
      style: `
        font-size: 13px;
        color: ${COLORS.PRIMARY};
        background-color: rgba(255, 140, 0, 0.08);
        padding: 9px 14px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        margin-bottom: 12px;
      `,
      x_expand: true,
      x_align: Clutter.ActorAlign.FILL,
    });
    section.add_child(this.currentShortcutDisplay);

    // Button row
    const buttonRow = new St.BoxLayout({
      vertical: false,
      style: "spacing: 8px;",
    });

    this.changeShortcutButton = this._makeGhostButton("Change Shortcut", COLORS.PRIMARY);
    this.resetToDefaultButton = this._makeGhostButton("Reset to Default", "#888888");
    this.removeShortcutButton = this._makeGhostButton("Remove", COLORS.DANGER);

    buttonRow.add_child(this.changeShortcutButton);
    buttonRow.add_child(this.resetToDefaultButton);
    buttonRow.add_child(this.removeShortcutButton);

    section.add_child(buttonRow);
    return section;
  }

  // ─── Recording duration ───────────────────────────────────────────────────

  _buildDurationSection() {
    const section = new St.BoxLayout({ vertical: true, style: "" });
    section.add_child(this._makeSectionLabel("Recording Duration"));

    const row = new St.BoxLayout({
      vertical: false,
      style: "spacing: 0px;",
      x_align: Clutter.ActorAlign.FILL,
      x_expand: true,
    });

    const hint = new St.Label({
      text: "Max recording length",
      style: "font-size: 13px; color: #bbb;",
      y_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
    });

    const controls = new St.BoxLayout({
      vertical: false,
      style: "spacing: 6px;",
      y_align: Clutter.ActorAlign.CENTER,
    });

    this.decreaseButton = this._makeStepButton("−");
    const currentDuration = this.settings.get_int("recording-duration");
    this.durationValueLabel = new St.Label({
      text: `${currentDuration}s`,
      style: `
        font-size: 14px;
        font-weight: bold;
        color: ${COLORS.PRIMARY};
        background-color: rgba(255, 140, 0, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 7px;
        padding: 6px 14px;
        min-width: 52px;
        text-align: center;
      `,
      y_align: Clutter.ActorAlign.CENTER,
      x_align: Clutter.ActorAlign.CENTER,
    });
    this.increaseButton = this._makeStepButton("+");

    controls.add_child(this.decreaseButton);
    controls.add_child(this.durationValueLabel);
    controls.add_child(this.increaseButton);

    row.add_child(hint);
    row.add_child(controls);
    section.add_child(row);
    return section;
  }

  _makeStepButton(symbol) {
    const base = `
      width: 30px;
      height: 30px;
      border-radius: 8px;
      background-color: rgba(255, 255, 255, 0.06);
      border: 1.5px solid rgba(120, 120, 128, 0.5);
      color: #ccc;
      font-size: 16px;
      font-weight: bold;
      text-align: center;
    `;
    const hover = `
      width: 30px;
      height: 30px;
      border-radius: 8px;
      background-color: rgba(255, 140, 0, 0.15);
      border: 1.5px solid rgba(255, 140, 0, 0.5);
      color: ${COLORS.PRIMARY};
      font-size: 16px;
      font-weight: bold;
      text-align: center;
    `;
    const btn = new St.Button({
      label: symbol,
      style: base,
      reactive: true,
      can_focus: true,
      track_hover: true,
    });
    btn.connect("enter-event", () => btn.set_style(hover));
    btn.connect("leave-event", () => btn.set_style(base));
    return btn;
  }

  // ─── Options ──────────────────────────────────────────────────────────────

  _buildOptionsSection() {
    const section = new St.BoxLayout({ vertical: true, style: "" });
    section.add_child(this._makeSectionLabel("Options"));

    const rows = [];

    // copy-to-clipboard
    {
      const enabled = this.settings.get_boolean("copy-to-clipboard");
      const { button, label } = this._makeToggle(enabled);
      this.clipboardCheckbox = button;
      this.clipboardCheckboxIcon = label;
      rows.push(this._makeOptionRow("Copy to clipboard automatically", button));
    }

    // non-blocking transcription
    {
      const enabled = this.settings.get_boolean("non-blocking-transcription");
      const { button, label } = this._makeToggle(enabled);
      this.nonBlockingTranscriptionCheckbox = button;
      this.nonBlockingTranscriptionCheckboxIcon = label;
      rows.push(this._makeOptionRow("Non-blocking transcription", button));
    }

    // dynamic island
    {
      const enabled = this.settings.get_boolean("use-dynamic-island");
      const { button, label } = this._makeToggle(enabled);
      this.dynamicIslandCheckbox = button;
      this.dynamicIslandCheckboxIcon = label;
      rows.push(this._makeOptionRow("Use Dynamic Island style UI", button));
    }

    // show transcription inline
    {
      const enabled = this.settings.get_boolean("show-transcription-inline");
      const { button, label } = this._makeToggle(enabled);
      this.showTranscriptionInlineCheckbox = button;
      this.showTranscriptionInlineCheckboxIcon = label;
      rows.push(this._makeOptionRow("Show transcription inline (Dynamic Island)", button));
    }

    // X11 auto-insert
    if (!Meta.is_wayland_compositor()) {
      const enabled = this.settings.get_boolean("skip-preview-x11");
      const { button, label } = this._makeToggle(enabled);
      this.skipPreviewCheckbox = button;
      this.skipPreviewCheckboxIcon = label;
      rows.push(this._makeOptionRow("Auto-insert at cursor (X11)", button));
    } else {
      this.skipPreviewCheckbox = null;
      this.skipPreviewCheckboxIcon = null;
    }

    // Wayland auto-insert
    if (Meta.is_wayland_compositor()) {
      const enabled = this.settings.get_boolean("auto-insert-wayland");
      const { button, label } = this._makeToggle(enabled);
      this.autoInsertWaylandCheckbox = button;
      this.autoInsertWaylandCheckboxIcon = label;
      const sublabel = new St.Label({
        text: "Install wtype package for best results",
        style: "font-size: 11px; color: #555; margin-top: 1px;",
      });
      rows.push(this._makeOptionRow("Auto-insert on Wayland (requires wtype)", button, sublabel));
    }

    rows.forEach((row, i) => {
      section.add_child(row);
      if (i < rows.length - 1) {
        section.add_child(new St.Widget({
          style: "background-color: rgba(255,255,255,0.04); height: 1px;",
          x_expand: true,
        }));
      }
    });

    return section;
  }

  _makeOptionRow(text, toggleButton, sublabel = null) {
    const row = new St.BoxLayout({
      vertical: false,
      style: "spacing: 0px; padding: 10px 0;",
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });

    const labelBox = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });

    const label = new St.Label({
      text,
      style: "font-size: 13px; color: #ccc;",
      y_align: Clutter.ActorAlign.CENTER,
    });
    labelBox.add_child(label);
    if (sublabel) {
      labelBox.add_child(sublabel);
    }

    row.add_child(labelBox);
    row.add_child(toggleButton);
    return row;
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  _setupEventHandlers() {
    this.closeButton.connect("clicked", () => this.close());

    // Shortcut buttons
    this.changeShortcutButton.connect("clicked", () => {
      this.extension.uiManager.captureNewShortcut((newShortcut) => {
        if (newShortcut) {
          this.settings.set_strv("toggle-recording", [newShortcut]);
          this.currentShortcutDisplay.set_text(newShortcut);
          this.extension.keybindingManager?.setupKeybinding();
        }
      });
    });

    this.resetToDefaultButton.connect("clicked", () => {
      const defaultShortcut = "<Super><Alt>r";
      this.settings.set_strv("toggle-recording", [defaultShortcut]);
      this.currentShortcutDisplay.set_text(defaultShortcut);
      this.extension.keybindingManager?.setupKeybinding();
    });

    this.removeShortcutButton.connect("clicked", () => {
      Main.wm.removeKeybinding("toggle-recording");
      this.settings.set_strv("toggle-recording", []);
      this.currentShortcutDisplay.set_text("No shortcut set");
    });

    // Duration controls
    this.decreaseButton.connect("clicked", () => {
      let current = this.settings.get_int("recording-duration");
      let newValue = Math.max(10, current - 10);
      this.settings.set_int("recording-duration", newValue);
      this.durationValueLabel.set_text(`${newValue}s`);
    });

    this.increaseButton.connect("clicked", () => {
      let current = this.settings.get_int("recording-duration");
      let newValue = Math.min(300, current + 10);
      this.settings.set_int("recording-duration", newValue);
      this.durationValueLabel.set_text(`${newValue}s`);
    });

    // Copy to clipboard toggle
    this.clipboardCheckbox.connect("clicked", () => {
      const newState = !this.settings.get_boolean("copy-to-clipboard");
      this.settings.set_boolean("copy-to-clipboard", newState);
      this._updateToggle(this.clipboardCheckbox, this.clipboardCheckboxIcon, newState);
    });

    // Mutual-exclusion helpers for non-blocking ↔ skip-preview
    const _setSkipPreviewUi = (enabled) => {
      if (!this.skipPreviewCheckbox || !this.skipPreviewCheckboxIcon) return;
      this._updateToggle(this.skipPreviewCheckbox, this.skipPreviewCheckboxIcon, enabled);
    };

    const _setNonBlockingUi = (enabled) => {
      if (!this.nonBlockingTranscriptionCheckbox || !this.nonBlockingTranscriptionCheckboxIcon) return;
      this._updateToggle(this.nonBlockingTranscriptionCheckbox, this.nonBlockingTranscriptionCheckboxIcon, enabled);
    };

    const _setSkipPreviewInteractive = (enabled) => {
      if (!this.skipPreviewCheckbox) return;
      this.skipPreviewCheckbox.reactive = enabled;
      this.skipPreviewCheckbox.can_focus = enabled;
      this.skipPreviewCheckbox.set_opacity(enabled ? 255 : 100);
    };

    // Non-blocking transcription toggle
    if (this.nonBlockingTranscriptionCheckbox) {
      this.nonBlockingTranscriptionCheckbox.connect("clicked", () => {
        const newState = !this.settings.get_boolean("non-blocking-transcription");
        this.settings.set_boolean("non-blocking-transcription", newState);
        if (newState && this.settings.get_boolean("skip-preview-x11")) {
          this.settings.set_boolean("skip-preview-x11", false);
          _setSkipPreviewUi(false);
        }
        _setSkipPreviewInteractive(!newState);
        _setNonBlockingUi(newState);
      });

      const nonBlockingNow = this.settings.get_boolean("non-blocking-transcription");
      _setSkipPreviewInteractive(!nonBlockingNow);
    }

    // Skip-preview toggle (X11 only)
    if (this.skipPreviewCheckbox) {
      this.skipPreviewCheckbox.connect("clicked", () => {
        if (this.settings.get_boolean("non-blocking-transcription")) return;
        const newState = !this.settings.get_boolean("skip-preview-x11");
        this.settings.set_boolean("skip-preview-x11", newState);
        if (newState && this.settings.get_boolean("non-blocking-transcription")) {
          this.settings.set_boolean("non-blocking-transcription", false);
          _setNonBlockingUi(false);
        }
        _setSkipPreviewUi(newState);
      });
    }

    // Dynamic Island toggle
    if (this.dynamicIslandCheckbox) {
      this.dynamicIslandCheckbox.connect("clicked", () => {
        const newState = !this.settings.get_boolean("use-dynamic-island");
        this.settings.set_boolean("use-dynamic-island", newState);
        this._updateToggle(this.dynamicIslandCheckbox, this.dynamicIslandCheckboxIcon, newState);
      });
    }

    // Show transcription inline toggle
    if (this.showTranscriptionInlineCheckbox) {
      this.showTranscriptionInlineCheckbox.connect("clicked", () => {
        const newState = !this.settings.get_boolean("show-transcription-inline");
        this.settings.set_boolean("show-transcription-inline", newState);
        this._updateToggle(this.showTranscriptionInlineCheckbox, this.showTranscriptionInlineCheckboxIcon, newState);
      });
    }

    // Auto-insert Wayland toggle
    if (this.autoInsertWaylandCheckbox) {
      this.autoInsertWaylandCheckbox.connect("clicked", () => {
        const newState = !this.settings.get_boolean("auto-insert-wayland");
        this.settings.set_boolean("auto-insert-wayland", newState);
        this._updateToggle(this.autoInsertWaylandCheckbox, this.autoInsertWaylandCheckboxIcon, newState);
      });
    }

    const handlers = setupModalEventHandlers(this.overlay, () => this.close());
    this.keyPressHandler = handlers.keyPressHandler;
    this.clickHandler = handlers.clickHandler;
  }

  _showDialog() {
    if (this.centerTimeoutId) {
      GLib.Source.remove(this.centerTimeoutId);
    }
    this.centerTimeoutId = showModalDialog(this.overlay, this.settingsWindow, {
      fallbackWidth: 550,
      fallbackHeight: 520,
      onComplete: () => (this.centerTimeoutId = null),
    });
  }
}
