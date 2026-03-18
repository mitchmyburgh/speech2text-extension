import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { COLORS } from "./constants.js";
import { createCloseButton } from "./buttonUtils.js";
import {
  log,
  readInstalledServiceConfig,
  showModalDialog,
  closeModalDialog,
  setupModalEventHandlers,
} from "./resourceUtils.js";

export class ServiceSetupDialog {
  constructor(extension, errorMessage) {
    this.extension = extension;
    this.errorMessage = errorMessage;
    this.overlay = null;
    this.centerTimeoutId = null;

    // Installed service environment state (from installer marker file).
    this._installedModel = null;
    this._installedDevice = null;
    this._installedAt = null;
    this._installStateKnown = false;

    // UI refs
    this.statusLabel = null;

    this._buildDialog();
  }

  _refreshStatusLabel() {
    const installed = readInstalledServiceConfig();
    this._installStateKnown = installed.known;
    this._installedModel = installed.model;
    this._installedDevice = installed.device;
    this._installedAt = installed.installedAt;

    if (!this.statusLabel) return;

    if (this._installStateKnown) {
      this.statusLabel.set_text(this._getInstalledConfigText());
      this.statusLabel.set_style(`
        font-size: 12px;
        font-family: monospace;
        color: #888;
        padding: 8px 10px;
        background-color: rgba(255, 255, 255, 0.04);
        border-radius: 6px;
        margin-bottom: 4px;
      `);
    } else {
      this.statusLabel.set_text(this.errorMessage || "Service not installed");
      this.statusLabel.set_style(`
        font-size: 13px;
        color: ${COLORS.DANGER};
        padding: 8px 10px;
        background-color: rgba(255, 68, 68, 0.08);
        border-radius: 6px;
        margin-bottom: 4px;
      `);
    }
  }

  _buildDialog() {
    this.overlay = new St.Widget({
      style: "background-color: rgba(0,0,0,0.6);",
      reactive: true,
      can_focus: true,
      track_hover: true,
    });

    this.dialogContainer = new St.BoxLayout({
      vertical: true,
      style: `
        background-color: rgba(24, 24, 28, 0.99);
        border-radius: 14px;
        min-width: 480px;
        max-width: 560px;
        spacing: 0;
      `,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });

    // ── Header ──
    const header = new St.BoxLayout({
      vertical: false,
      style: `
        padding: 18px 20px 16px;
        spacing: 10px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
      `,
      x_expand: true,
    });

    const title = new St.Label({
      text: "Service Setup",
      style: "font-size: 16px; font-weight: bold; color: white;",
      y_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
    });

    this.closeButton = createCloseButton(28);
    header.add_child(title);
    header.add_child(this.closeButton);

    // ── Body ──
    const body = new St.BoxLayout({
      vertical: true,
      style: "padding: 18px 20px 22px; spacing: 12px;",
      x_expand: true,
    });

    this.statusLabel = new St.Label({ text: "", style: "" });
    this._refreshStatusLabel();

    const explanation = new St.Label({
      text: "Speech2Text requires a background service for audio processing.\nSee the project repository for installation instructions.",
      style: "font-size: 13px; color: #aaa; line-height: 1.5;",
    });
    explanation.get_clutter_text().set_line_wrap(true);

    const repoLink = new St.Button({
      label: "github.com/mitchmyburgh/speech2text-extension",
      style: `
        background-color: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 8px;
        color: #ccc;
        font-size: 12px;
        font-family: monospace;
        padding: 8px 12px;
      `,
      x_align: Clutter.ActorAlign.START,
      reactive: true,
      can_focus: true,
    });
    repoLink.connect("clicked", () => {
      this._openUrl("https://github.com/mitchmyburgh/speech2text-extension");
    });

    body.add_child(this.statusLabel);
    body.add_child(explanation);
    body.add_child(repoLink);

    this.dialogContainer.add_child(header);
    this.dialogContainer.add_child(body);
    this.overlay.add_child(this.dialogContainer);

    this.closeButton.connect("clicked", () => this.close());

    const handlers = setupModalEventHandlers(this.overlay, () => this.close());
    this.keyPressHandler = handlers.keyPressHandler;
    this.clickHandler = handlers.clickHandler;
  }

  _getInstalledConfigText() {
    if (!this._installStateKnown)
      return "Installed service environment: not installed (or unknown)";
    const at = this._installedAt ? `, installed_at=${this._installedAt}` : "";
    return `Installed service environment: model=${
      this._installedModel || "unknown"
    }, device=${this._installedDevice || "unknown"}${at}`;
  }

  _copyToClipboard(text) {
    try {
      const clipboard = St.Clipboard.get_default();
      clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
      return true;
    } catch (e) {
      console.error(`Error copying to clipboard: ${e}`);
      return false;
    }
  }

  _openUrl(url) {
    try {
      // Use D-Bus portal API for opening URLs safely
      const portal = Gio.DBusProxy.new_sync(
        Gio.DBus.session,
        Gio.DBusProxyFlags.NONE,
        null,
        "org.freedesktop.portal.Desktop",
        "/org/freedesktop/portal/desktop",
        "org.freedesktop.portal.OpenURI",
        null
      );

      portal.call_sync(
        "OpenURI",
        new GLib.Variant("(ssa{sv})", ["", url, {}]),
        Gio.DBusCallFlags.NONE,
        -1,
        null
      );

      log.debug("Opening GitHub repository in browser...");
    } catch (e) {
      console.error(`Error opening URL via portal: ${e}`);
      try {
        // Fallback to xdg-open if portal fails
        Gio.app_info_launch_default_for_uri(url, null);
      } catch (fallbackError) {
        console.error(`Error opening URL: ${fallbackError}`);
        this._copyToClipboard(url);
      }
    }
  }

  show() {
    if (!this.overlay) return;
    this._refreshStatusLabel();

    // Clear any existing centering timeout
    if (this.centerTimeoutId) {
      GLib.Source.remove(this.centerTimeoutId);
    }
    // showModalDialog returns a timeout ID for widget centering
    this.centerTimeoutId = showModalDialog(this.overlay, this.dialogContainer, {
      fallbackWidth: 700,
      fallbackHeight: 500,
      onComplete: () => (this.centerTimeoutId = null),
    });
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
  }
}
