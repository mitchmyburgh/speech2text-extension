import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import St from "gi://St";
import Meta from "gi://Meta";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { COLORS } from "./constants.js";
import { createStyledLabel } from "./uiUtils.js";
import { createCloseButton } from "./buttonUtils.js";
import {
  showModalDialog,
  closeModalDialog,
  setupModalEventHandlers,
} from "./resourceUtils.js";

// ─── Shared style constants ───────────────────────────────────────────────────

const BG        = "rgba(24, 24, 28, 0.99)";
const SURFACE   = "rgba(255, 255, 255, 0.05)";
const BORDER    = "rgba(255, 255, 255, 0.08)";
const TEXT      = "#e0e0e0";
const MUTED     = "#666";
const ACCENT    = COLORS.PRIMARY;   // orange, used sparingly

// ─── Small helpers ────────────────────────────────────────────────────────────

function pill(label, bg, textColor = "white") {
  return new St.Label({
    text: label,
    style: `
      background-color: ${bg};
      color: ${textColor};
      border-radius: 20px;
      padding: 3px 10px;
      font-size: 11px;
      font-weight: bold;
    `,
    y_align: Clutter.ActorAlign.CENTER,
  });
}

function subtleButton(label, onClick) {
  const base = `
    background-color: ${SURFACE};
    border: 1px solid ${BORDER};
    border-radius: 8px;
    color: ${TEXT};
    font-size: 12px;
    padding: 7px 14px;
  `;
  const hover = `
    background-color: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    color: white;
    font-size: 12px;
    padding: 7px 14px;
  `;
  const btn = new St.Button({ label, style: base, reactive: true, can_focus: true, track_hover: true });
  btn.connect("enter-event", () => btn.set_style(hover));
  btn.connect("leave-event", () => btn.set_style(base));
  if (onClick) btn.connect("clicked", onClick);
  return btn;
}

function dangerButton(label, onClick) {
  const base = `
    background-color: transparent;
    border: 1px solid rgba(255, 68, 68, 0.4);
    border-radius: 8px;
    color: #ff6b6b;
    font-size: 12px;
    padding: 7px 14px;
  `;
  const hover = `
    background-color: rgba(255, 68, 68, 0.1);
    border: 1px solid rgba(255, 68, 68, 0.6);
    border-radius: 8px;
    color: #ff6b6b;
    font-size: 12px;
    padding: 7px 14px;
  `;
  const btn = new St.Button({ label, style: base, reactive: true, can_focus: true, track_hover: true });
  btn.connect("enter-event", () => btn.set_style(hover));
  btn.connect("leave-event", () => btn.set_style(base));
  if (onClick) btn.connect("clicked", onClick);
  return btn;
}

// ─── SettingsDialog ───────────────────────────────────────────────────────────

export class SettingsDialog {
  constructor(extension) {
    this.extension = extension;
    this.settings = extension.settings;
    this.overlay = null;
    this.currentShortcutDisplay = null;

    // toggle refs: { button, label }
    this.clipboardToggle = null;
    this.nonBlockingToggle = null;
    this.skipPreviewToggle = null;
    this.dynamicIslandToggle = null;
    this.inlineToggle = null;
    this.waylandToggle = null;

    this.centerTimeoutId = null;
    this.keyPressHandler = null;
    this.clickHandler = null;

    // legacy refs kept for _setupEventHandlers compat
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
  }

  show() {
    if (this.overlay) return;
    this._createDialog();
    this._setupEventHandlers();
    this._showDialog();
  }

  close() {
    closeModalDialog(
      this.overlay,
      { keyPressHandler: this.keyPressHandler, clickHandler: this.clickHandler },
      this.centerTimeoutId
    );
    this.centerTimeoutId = null;
    this.overlay = null;
    this.keyPressHandler = null;
    this.clickHandler = null;
  }

  // ─── Toggle ───────────────────────────────────────────────────────────────

  _makeToggle(enabled) {
    const track = new St.Button({
      style: this._trackStyle(enabled),
      reactive: true,
      can_focus: true,
    });

    const knob = new St.Widget({
      style: `
        width: 16px;
        height: 16px;
        border-radius: 8px;
        background-color: white;
      `,
      reactive: false,
    });
    track.add_child(knob);
    // Use set_position for reliable placement — margin-left inside St.Button is ignored
    knob.set_position(enabled ? 21 : 3, 3);

    return { button: track, label: knob };   // "label" = knob for _updateToggle compat
  }

  _trackStyle(enabled) {
    return `
      width: 40px;
      height: 22px;
      border-radius: 11px;
      background-color: ${enabled ? ACCENT : "rgba(110, 110, 120, 0.9)"};
      border: none;
      padding: 0;
    `;
  }

  _updateToggle(button, knob, enabled) {
    button.set_style(this._trackStyle(enabled));
    knob.set_position(enabled ? 21 : 3, 3);
  }

  // ─── Dialog layout ────────────────────────────────────────────────────────

  _createDialog() {
    this.overlay = new St.Widget({
      style: "background-color: rgba(0, 0, 0, 0.6);",
      reactive: true,
      can_focus: true,
      track_hover: true,
    });

    this.settingsWindow = new St.BoxLayout({
      vertical: true,
      style: `
        background-color: ${BG};
        border-radius: 14px;
        padding: 0px;
        min-width: 480px;
        max-width: 540px;
        spacing: 0;
      `,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });

    this.settingsWindow.add_child(this._buildHeader());
    this.settingsWindow.add_child(this._buildBody());

    this.overlay.add_child(this.settingsWindow);
  }

  _buildHeader() {
    const header = new St.BoxLayout({
      vertical: false,
      style: `
        padding: 18px 20px 16px;
        spacing: 10px;
        border-bottom: 1px solid ${BORDER};
      `,
      x_expand: true,
    });

    const title = new St.Label({
      text: "Settings",
      style: `font-size: 16px; font-weight: bold; color: white;`,
      y_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
    });

    this.closeButton = createCloseButton(28);

    header.add_child(title);
    header.add_child(this.closeButton);
    return header;
  }

  _buildBody() {
    const body = new St.BoxLayout({
      vertical: true,
      style: "padding: 0px; spacing: 0;",
      x_expand: true,
    });

    body.add_child(this._buildShortcutSection());
    body.add_child(this._buildDivider());
    body.add_child(this._buildDurationSection());
    body.add_child(this._buildDivider());
    body.add_child(this._buildOptionsSection());

    return body;
  }

  _buildDivider() {
    return new St.Widget({
      style: `background-color: ${BORDER}; height: 1px;`,
      x_expand: true,
    });
  }

  _sectionLabel(text) {
    return new St.Label({
      text: text.toUpperCase(),
      style: `
        font-size: 10px;
        font-weight: bold;
        color: ${MUTED};
        letter-spacing: 0.8px;
        margin-bottom: 10px;
      `,
    });
  }

  // ─── Shortcut section ─────────────────────────────────────────────────────

  _buildShortcutSection() {
    const section = new St.BoxLayout({
      vertical: true,
      style: "padding: 18px 20px 16px; spacing: 10px;",
    });

    section.add_child(this._sectionLabel("Keyboard Shortcut"));

    // Current shortcut display
    const shortcuts = this.settings.get_strv("toggle-recording");
    const current = shortcuts.length > 0 ? shortcuts[0] : "No shortcut set";
    this.currentShortcutDisplay = new St.Label({
      text: current,
      style: `
        font-size: 13px;
        font-family: monospace;
        color: ${TEXT};
        background-color: ${SURFACE};
        border: 1px solid ${BORDER};
        border-radius: 8px;
        padding: 9px 12px;
      `,
      x_expand: true,
    });

    // Buttons
    const btnRow = new St.BoxLayout({
      vertical: false,
      style: "spacing: 8px;",
    });

    this.changeShortcutButton = subtleButton("Change");
    this.resetToDefaultButton = subtleButton("Reset Default");
    this.removeShortcutButton = dangerButton("Remove");

    btnRow.add_child(this.changeShortcutButton);
    btnRow.add_child(this.resetToDefaultButton);
    btnRow.add_child(this.removeShortcutButton);

    section.add_child(this.currentShortcutDisplay);
    section.add_child(btnRow);
    return section;
  }

  // ─── Duration section ─────────────────────────────────────────────────────

  _buildDurationSection() {
    const section = new St.BoxLayout({
      vertical: true,
      style: "padding: 18px 20px 16px; spacing: 10px;",
    });

    section.add_child(this._sectionLabel("Recording Duration"));

    const row = new St.BoxLayout({
      vertical: false,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });

    const hint = new St.Label({
      text: "Max recording length",
      style: `font-size: 13px; color: ${TEXT};`,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });

    const controls = new St.BoxLayout({
      vertical: false,
      style: "spacing: 6px;",
      y_align: Clutter.ActorAlign.CENTER,
    });

    this.decreaseButton = this._stepBtn("−");
    const currentDuration = this.settings.get_int("recording-duration");
    this.durationValueLabel = new St.Label({
      text: `${currentDuration}s`,
      style: `
        font-size: 13px;
        font-weight: bold;
        color: ${TEXT};
        background-color: ${SURFACE};
        border: 1px solid ${BORDER};
        border-radius: 7px;
        padding: 6px 14px;
        min-width: 42px;
        text-align: center;
      `,
      y_align: Clutter.ActorAlign.CENTER,
      x_align: Clutter.ActorAlign.CENTER,
    });
    this.increaseButton = this._stepBtn("+");

    controls.add_child(this.decreaseButton);
    controls.add_child(this.durationValueLabel);
    controls.add_child(this.increaseButton);

    row.add_child(hint);
    row.add_child(controls);
    section.add_child(row);
    return section;
  }

  _stepBtn(symbol) {
    const base = `
      width: 28px; height: 28px; border-radius: 7px;
      background-color: ${SURFACE};
      border: 1px solid ${BORDER};
      color: ${TEXT}; font-size: 15px; font-weight: bold;
    `;
    const hover = `
      width: 28px; height: 28px; border-radius: 7px;
      background-color: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.15);
      color: white; font-size: 15px; font-weight: bold;
    `;
    const btn = new St.Button({ label: symbol, style: base, reactive: true, can_focus: true, track_hover: true });
    btn.connect("enter-event", () => btn.set_style(hover));
    btn.connect("leave-event", () => btn.set_style(base));
    return btn;
  }

  // ─── Options section ──────────────────────────────────────────────────────

  _buildOptionsSection() {
    const section = new St.BoxLayout({
      vertical: true,
      style: "padding: 18px 20px 20px; spacing: 0;",
    });

    section.add_child(this._sectionLabel("Options"));

    const rows = [];

    const addRow = (label, settingKey, ref) => {
      const enabled = this.settings.get_boolean(settingKey);
      const { button, label: knob } = this._makeToggle(enabled);
      this[ref + "Checkbox"] = button;
      this[ref + "CheckboxIcon"] = knob;
      rows.push(this._optionRow(label, button));
    };

    addRow("Copy to clipboard automatically", "copy-to-clipboard", "clipboard");
    addRow("Non-blocking transcription", "non-blocking-transcription", "nonBlockingTranscription");
    addRow("Use Dynamic Island style UI", "use-dynamic-island", "dynamicIsland");
    addRow("Show transcription inline", "show-transcription-inline", "showTranscriptionInline");

    if (!Meta.is_wayland_compositor()) {
      addRow("Auto-insert at cursor (X11)", "skip-preview-x11", "skipPreview");
    } else {
      this.skipPreviewCheckbox = null;
      this.skipPreviewCheckboxIcon = null;

      const enabled = this.settings.get_boolean("auto-insert-wayland");
      const { button, label: knob } = this._makeToggle(enabled);
      this.autoInsertWaylandCheckbox = button;
      this.autoInsertWaylandCheckboxIcon = knob;
      const sublabel = new St.Label({
        text: "Requires wtype",
        style: `font-size: 11px; color: #444; margin-top: 1px;`,
      });
      rows.push(this._optionRow("Auto-insert on Wayland", button, sublabel));
    }

    rows.forEach((row, i) => {
      section.add_child(row);
      if (i < rows.length - 1) {
        section.add_child(new St.Widget({
          style: `background-color: ${BORDER}; height: 1px; margin: 2px 0;`,
          x_expand: true,
        }));
      }
    });

    return section;
  }

  _optionRow(labelText, toggle, sublabel = null) {
    const row = new St.BoxLayout({
      vertical: false,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
      style: "padding: 9px 0;",
    });

    const labelBox = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });

    const lbl = new St.Label({
      text: labelText,
      style: `font-size: 13px; color: ${TEXT};`,
      y_align: Clutter.ActorAlign.CENTER,
    });
    labelBox.add_child(lbl);
    if (sublabel) labelBox.add_child(sublabel);

    row.add_child(labelBox);
    row.add_child(toggle);
    return row;
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  _setupEventHandlers() {
    this.closeButton.connect("clicked", () => this.close());

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
      const def = "<Super><Alt>r";
      this.settings.set_strv("toggle-recording", [def]);
      this.currentShortcutDisplay.set_text(def);
      this.extension.keybindingManager?.setupKeybinding();
    });

    this.removeShortcutButton.connect("clicked", () => {
      Main.wm.removeKeybinding("toggle-recording");
      this.settings.set_strv("toggle-recording", []);
      this.currentShortcutDisplay.set_text("No shortcut set");
    });

    this.decreaseButton.connect("clicked", () => {
      const v = Math.max(10, this.settings.get_int("recording-duration") - 10);
      this.settings.set_int("recording-duration", v);
      this.durationValueLabel.set_text(`${v}s`);
    });

    this.increaseButton.connect("clicked", () => {
      const v = Math.min(300, this.settings.get_int("recording-duration") + 10);
      this.settings.set_int("recording-duration", v);
      this.durationValueLabel.set_text(`${v}s`);
    });

    this._wireToggle("copy-to-clipboard", "clipboardCheckbox", "clipboardCheckboxIcon");

    // Non-blocking ↔ skip-preview mutual exclusion
    if (this.nonBlockingTranscriptionCheckbox) {
      this.nonBlockingTranscriptionCheckbox.connect("clicked", () => {
        const newState = !this.settings.get_boolean("non-blocking-transcription");
        this.settings.set_boolean("non-blocking-transcription", newState);
        if (newState && this.settings.get_boolean("skip-preview-x11")) {
          this.settings.set_boolean("skip-preview-x11", false);
          this._updateToggle(this.skipPreviewCheckbox, this.skipPreviewCheckboxIcon, false);
        }
        if (this.skipPreviewCheckbox) {
          this.skipPreviewCheckbox.reactive = !newState;
          this.skipPreviewCheckbox.set_opacity(!newState ? 255 : 80);
        }
        this._updateToggle(this.nonBlockingTranscriptionCheckbox, this.nonBlockingTranscriptionCheckboxIcon, newState);
      });

      const nbNow = this.settings.get_boolean("non-blocking-transcription");
      if (this.skipPreviewCheckbox) {
        this.skipPreviewCheckbox.reactive = !nbNow;
        this.skipPreviewCheckbox.set_opacity(!nbNow ? 255 : 80);
      }
    }

    if (this.skipPreviewCheckbox) {
      this.skipPreviewCheckbox.connect("clicked", () => {
        if (this.settings.get_boolean("non-blocking-transcription")) return;
        const newState = !this.settings.get_boolean("skip-preview-x11");
        this.settings.set_boolean("skip-preview-x11", newState);
        this._updateToggle(this.skipPreviewCheckbox, this.skipPreviewCheckboxIcon, newState);
      });
    }

    this._wireToggle("use-dynamic-island", "dynamicIslandCheckbox", "dynamicIslandCheckboxIcon");
    this._wireToggle("show-transcription-inline", "showTranscriptionInlineCheckbox", "showTranscriptionInlineCheckboxIcon");
    this._wireToggle("auto-insert-wayland", "autoInsertWaylandCheckbox", "autoInsertWaylandCheckboxIcon");

    const handlers = setupModalEventHandlers(this.overlay, () => this.close());
    this.keyPressHandler = handlers.keyPressHandler;
    this.clickHandler = handlers.clickHandler;
  }

  _wireToggle(settingKey, btnRef, knobRef) {
    const btn = this[btnRef];
    const knob = this[knobRef];
    if (!btn) return;
    btn.connect("clicked", () => {
      const newState = !this.settings.get_boolean(settingKey);
      this.settings.set_boolean(settingKey, newState);
      this._updateToggle(btn, knob, newState);
    });
  }

  _showDialog() {
    if (this.centerTimeoutId) GLib.Source.remove(this.centerTimeoutId);
    this.centerTimeoutId = showModalDialog(this.overlay, this.settingsWindow, {
      fallbackWidth: 520,
      fallbackHeight: 500,
      onComplete: () => (this.centerTimeoutId = null),
    });
  }
}
