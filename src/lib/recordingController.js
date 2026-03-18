import GLib from "gi://GLib";
import St from "gi://St";
import Meta from "gi://Meta";
import { RecordingStateManager } from "./recordingStateManager.js";
import { RecordingDialog } from "./recordingDialog.js";
import { DynamicIsland } from "./dynamicIsland.js";
import { log } from "./resourceUtils.js";

export class RecordingController {
  constructor(uiManager, serviceManager) {
    this.uiManager = uiManager;
    this.serviceManager = serviceManager;
    this.recordingStateManager = null;
  }

  initialize() {
    // Initialize recording state manager
    this.recordingStateManager = new RecordingStateManager(
      this.uiManager.iconWidget,
      this.serviceManager.dbusManager
    );
  }

  _shouldUseDynamicIsland(settings) {
    // Use Dynamic Island by default, unless explicitly disabled
    return settings.get_boolean("use-dynamic-island") !== false;
  }

  async toggleRecording(settings) {
    // Service readiness is handled by the extension entrypoint (single source of truth).
    // Here we only ensure our local state manager exists.
    if (!this.recordingStateManager) this.initialize();

    // Now handle the actual recording toggle
    if (this.recordingStateManager.isRecording()) {
      log.debug("Stopping recording");
      const stopped = await this.recordingStateManager.stopRecording();
      if (stopped) {
        this._beginTranscriptionUi();
      }
    } else {
      log.debug("Starting recording");

      // Ensure RecordingStateManager has current service manager reference
      if (
        this.recordingStateManager &&
        this.serviceManager.dbusManager &&
        this.recordingStateManager.dbusManager !==
          this.serviceManager.dbusManager
      ) {
        this.recordingStateManager.updateDbusManager(
          this.serviceManager.dbusManager
        );
      }

      const success = await this.recordingStateManager.startRecording(settings);

      if (success) {
        // Determine which UI to use based on settings
        const useDynamicIsland = this._shouldUseDynamicIsland(settings);
        
        if (useDynamicIsland) {
          this._createDynamicIsland(settings);
        } else {
          this._createRecordingDialog(settings);
        }
      } else {
        this.uiManager.showServiceSetupDialog(
          "Failed to start recording. Please verify the Speech2Text service is installed and up to date."
        );
      }
    }
  }

  _createDynamicIsland(settings) {
    const showTranscription = settings.get_boolean("show-transcription-inline");

    const dynamicIsland = new DynamicIsland(
      () => {
        // Cancel callback
        this.recordingStateManager.cancelRecording();
        this.recordingStateManager.setRecordingDialog(null);
      },
      async () => {
        // Stop callback (onStop)
        log.debug("Stop recording button clicked in Dynamic Island");
        const stopped = await this.recordingStateManager.stopRecording();
        if (stopped) {
          this._beginTranscriptionUi();
        }
      },
      (text) => {
        // Copy callback — preview mode uses clipboard, not wtype
        log.debug(`Copying text from Dynamic Island preview: ${text}`);
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
        this.recordingStateManager.setRecordingDialog(null);
      },
      {
        maxDuration: settings.get_int("recording-duration"),
        showTranscription: showTranscription,
      }
    );

    this.recordingStateManager.setRecordingDialog(dynamicIsland);
    log.debug("RecordingController: Created Dynamic Island, opening now");
    dynamicIsland.open();
  }

  _createRecordingDialog(settings) {
    const recordingDialog = new RecordingDialog(
      () => {
        // Cancel callback
        this.recordingStateManager.cancelRecording();
        this.recordingStateManager.setRecordingDialog(null);
      },
      (text) => {
        // Insert callback
        log.debug(`Inserting text: ${text}`);
        this._typeText(text);
        this.recordingStateManager.setRecordingDialog(null);
      },
      async () => {
        // Stop callback
        log.debug("Stop recording button clicked");
        const stopped = await this.recordingStateManager.stopRecording();
        if (stopped) {
          this._beginTranscriptionUi();
        }
      },
      settings.get_int("recording-duration")
    );

    this.recordingStateManager.setRecordingDialog(recordingDialog);
    log.debug(
      "RecordingController: Created and set recording dialog, opening now"
    );
    recordingDialog.open();
  }

  handleRecordingStopped(recordingId, reason) {
    if (!this.recordingStateManager) {
      log.debug("Recording state manager not initialized");
      return;
    }

    log.debug(
      `RecordingController: Recording stopped - ID: ${recordingId}, reason: ${reason}`
    );
    if (reason === "completed") {
      // Recording completed automatically - begin transcription UI.
      const shouldShowUi =
        this.recordingStateManager.handleRecordingCompleted(recordingId);
      if (shouldShowUi) {
        this._beginTranscriptionUi();
      }
    }
    // For manual stops (reason === "stopped"), the dialog is already closed
    // in the stopRecording method
  }

  handleTranscriptionReady(recordingId, text) {
    if (!this.recordingStateManager) {
      log.debug("Recording state manager not initialized");
      return;
    }

    this._endTranscriptionUi();

    log.debug(
      `RecordingController: Transcription ready - ID: ${recordingId}, text: "${text}"`
    );
    const result = this.recordingStateManager.handleTranscriptionReady(
      recordingId,
      text,
      this.uiManager.extensionCore.settings
    );

    log.debug(
      `RecordingController: Transcription result - action: ${result?.action}`
    );

    if (result && result.action === "nonBlockingClipboard") {
      // Non-blocking mode is clipboard-only: do NOT auto-insert or show a modal preview.
      try {
        const autoCopy =
          this.uiManager.extensionCore.settings.get_boolean(
            "copy-to-clipboard"
          );

        if (autoCopy) {
          const clipboard = St.Clipboard.get_default();
          clipboard.set_text(St.ClipboardType.CLIPBOARD, result.text);
          this.uiManager.showActionableNotification(
            "Speech2Text",
            "Transcription copied to clipboard. Click to review.",
            () => this._showCopyOnlyPreviewDialog(result.text)
          );
        } else {
          this.uiManager.showActionableNotification(
            "Speech2Text",
            "Transcription ready. Click to view and copy.",
            () => this._showCopyOnlyPreviewDialog(result.text)
          );
        }
      } catch (e) {
        console.error(`Error copying to clipboard: ${e}`);
      }
      return;
    }

    if (result && result.action === "insert") {
      this._typeText(result.text);
    } else if (result && result.action === "createPreview") {
      log.debug("Creating preview for transcribed text");
      this._showPreview(result.text);
    } else if (result && result.action === "ignored") {
      log.debug("Transcription ignored - recording was cancelled");
      // Nothing to do - recording was cancelled
    }
  }

  handleRecordingError(recordingId, errorMessage) {
    if (!this.recordingStateManager) {
      log.debug("Recording state manager not initialized");
      return;
    }

    this._endTranscriptionUi();

    // Show error in the current UI if possible
    const dialog = this.recordingStateManager?.recordingDialog;
    if (dialog && typeof dialog.showError === "function") {
      dialog.showError(errorMessage);
    }

    if (
      this.uiManager.extensionCore.settings.get_boolean(
        "non-blocking-transcription"
      )
    ) {
      console.error(`Transcription failed: ${errorMessage}`);
    }

    this.recordingStateManager.handleRecordingError(recordingId, errorMessage);
  }

  _showPreview(text) {
    log.debug("Showing preview for text:", text);

    // Always use Dynamic Island for preview — check if one is already open
    const dialog = this.recordingStateManager?.recordingDialog;
    if (dialog && dialog instanceof DynamicIsland) {
      dialog.showPreview(text);
    } else {
      this._createDynamicIslandPreview(text);
    }
  }

  _showCopyOnlyPreviewDialog(text) {
    // Route through DI instead of a modal dialog
    this._showPreview(text);
  }

  _createDynamicIslandPreview(text) {
    const dynamicIsland = new DynamicIsland(
      () => { dynamicIsland.close(); },
      null,
      (finalText) => {
        log.debug(`Inserting text from preview: ${finalText}`);
        this._typeText(finalText);
      },
      { maxDuration: 0, showTranscription: true, autoInsertOnWayland: true }
    );
    dynamicIsland.open();
    dynamicIsland.showPreview(text);
  }

  async _typeText(text) {
    // Wait for GNOME Shell to remove the DI actor and for the Wayland compositor
    // to return keyboard focus to the target window before sending the paste.
    await new Promise(resolve =>
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => { resolve(); return false; })
    );
    await this.serviceManager.typeText(
      text,
      this.uiManager.extensionCore.settings.get_boolean("copy-to-clipboard")
    );
  }

  _beginTranscriptionUi() {
    const settings = this.uiManager.extensionCore.settings;
    const nonBlocking = settings.get_boolean("non-blocking-transcription");

    if (nonBlocking) {
      // Close the blocking modal (if present) and replace with a small non-modal window.
      const dialog = this.recordingStateManager?.recordingDialog;
      if (dialog) {
        try {
          dialog.close();
        } catch (e) {
          log.debug(
            "RecordingController: failed to close dialog (non-fatal):",
            e?.message || String(e)
          );
        } finally {
          this.recordingStateManager.setRecordingDialog(null);
        }
      }

      // Show processing state in tray icon (no notification - just visual indicator)
      this.uiManager.showProcessingState();
      return;
    }

    // Default behavior: use the dialog's processing UI.
    const dialog = this.recordingStateManager?.recordingDialog;
    if (dialog && typeof dialog.showProcessing === "function") {
      dialog.showProcessing();
    }
  }

  _endTranscriptionUi() {
    // Hide the processing state in tray icon
    this.uiManager.hideProcessingState();
  }

  cleanup() {
    if (this.recordingStateManager) {
      log.debug("Cleaning up recording state manager");
      this.recordingStateManager.cleanup();
      this.recordingStateManager = null;
    }

    this._endTranscriptionUi();
  }
}
