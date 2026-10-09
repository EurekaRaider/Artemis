[English / 简体中文](computer-preview.md)

# Computer Use live preview development contract

Live preview serves only an authorized, observed Computer Use target. It does not increase model screenshot frequency or persist video, audio, GPU handles or per-frame messages in protocol events, transcripts or React state.

## Browser and desktop windows

The main process owns Browser instances by chat and tab. A sandboxed offscreen BrowserWindow uses Electron 43.2.0 sharedTexture. The full Browser and readonly preview subscribe to the same instance; changing chats, hiding preview or remounting React does not recreate the page. Closing the tab, deleting or archiving its chat, or closing the Artemis window releases it. Pages have no Node, preload or host IPC access. Human mouse, keyboard, text and IME input uses constrained commands bound to an active visible surface. Debugging and Computer Use share one debugger connection.

On macOS 14+, desktop preview uses ScreenCaptureKit and validates the observed window's PID, process creation time, bundle ID and uniquely matched window ID. Windows 11 uses WGC and validates the HWND, process instances, application path and interactive desktop. Capture stops when a window closes, permissions change or the desktop becomes unavailable. It never falls back to whole-screen capture. macOS delivers IOSurfaces; Windows scales and shares GPU textures in D3D11. Existing helpers continue to handle desktop input; preview is readonly.

Both previews show only the clear picture normally. Hovering reveals an X centered on the picture's upper-left vertex and a local blur; keyboard focus also reveals the close control. There is no title bar, FPS bar or Stop button. Dragging anywhere on the picture moves it; clicking expands it. Movement beyond the drag threshold prevents accidental expansion. The in-app card can resize; the transparent desktop window uses a bottom-right resize corner, showInactive and Artemis foreground state. X hides only the preview, keeps the task running and allows showing it again; stopping uses the existing Computer Use controls. Both previews show only the current chat's target. Switching chats hides the previous preview while its task continues; switching back restores it. Expanding Browser returns to its original chat and tab; desktop targets expand into a large readonly view. Pausing retains the displayed picture. Hiding removes that preview's subscriptions, while a visible full Browser can continue independently.

The in-app preview initially sits below the environment panel; the desktop window initially avoids that panel. Floating preview follows foreground state automatically, without a separate settings toggle. Development Electron must use the development helper and GPU module under `build/computer-use/development`; packaged clients still acquire them from the verified signed runtime.

## GPU lifetime and budgets

- Local capture targets 60 fps, with a normal maximum dimension of 1280 and 1920 for an expanded desktop target. Sustained load reduces pixels first.
- Each stream holds at most one frame in flight and one newest pending frame. A new pending frame immediately replaces and releases the old one.
- The sendSharedTexture Promise does not mean GPU consumption has finished. Source textures remain alive until allReferencesReleased. After drawing, the renderer closes its VideoFrame and releases the imported texture.
- GPU consumption exceeding one second stops the stream and shows an unavailable state. Closing, crashing, hiding or permission revocation must not release textures still used by the GPU prematurely.
- FPS and capture-to-draw p95 latency reflect actual drawing, reported once per second. Static or stopped streams cannot report their configured frame rate.

## Capability pack compatibility and signing

A Computer Use manifest may declare `preview: { protocol: 1, module: "relative-path.node" }`. Its signed file inventory must mark the module executable. The helper hello may return `previewIdentity: 1`. Older packs keep existing controls; desktop preview explicitly requests a pack update when support is absent.

macOS places the module in the helper application's Frameworks directory, signs the module before the application, and validates the same Team ID alongside the application's hardened runtime, notarization and staple. Windows validates the helper and module against the same Authenticode policy and checks ACLs at the actual installation path. Supplying a signed helper also requires a signed module during pack construction. The module uses Electron's delay-load hook; it cannot bypass sandboxing, content-hash trust or existing authorization.

## Verification

Development verification on macOS:

```sh
npm run build
node apps/desktop/scripts/build/build-computer-use.mjs arm64 --development
ARTEMIS_PREVIEW_DURATION_SECONDS=1800 caffeinate -di node apps/desktop/scripts/verify/native/verify-computer-preview.mjs
```

Verification uses an isolated profile and a local synthetic page, capturing only the verification application's own window. Screen Recording and Accessibility must already be available. Ignored evidence under `artifacts/verification/computer-preview/` includes per-second drawing reports, memory samples, Chinese input and hide/remount checks.

After warmup, moving content at 1280×720 on a display refreshing at 60 Hz or higher must average at least 55 fps, with capture-to-draw p95 no greater than 150 ms, and complete a 30-minute stability run. Browser and native targets require separate acceptance. This command currently verifies macOS. Windows CI compiles the helper and GPU module, but compilation does not replace Windows 11 runtime FPS, stop deadline or final installation ACL acceptance. Running a development module also does not replace signed capability pack, macOS arm64 packaging, notarization, stapling, update or rollback acceptance.
