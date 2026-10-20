---
status: accepted
---

# Tauri only from v0.3; the Electron build is removed

From v0.3.0 the app is one Tauri `.exe` (WebView2 from Windows, about 4 MB), released as `2DCodePrint-<version>.exe`. The Electron build (about 100 MB, its own Chromium) is no longer shipped and its code is removed; v0.2.1 stays on GitHub Releases for a PC that cannot run WebView2.

## Why

- The Electron `.exe` was about 25 times larger, almost all of it the bundled browser, and unpacked itself at every start from the shared drive.
- Since v0.2 the label, data and import logic is shared and runs on a small platform port, so the Tauri app is the same app; v0.2.1 proved silent printing through WebView2 on the pharmacy's printer.
- Keeping two hosts meant building, testing and keeping both working for every change, for a build nobody needed.

## Consequences

- Every PC needs the Microsoft Edge WebView2 Runtime (in Windows 11 and up-to-date Windows 10).
- The data files in `LabelData` may change format from v0.3 on; an Electron 0.2.x left running on the same `LabelData` is unsupported and may report files as changed outside the app.
- Printing, dialogs and file access are only in the Rust shell (`src-tauri/`); the shared logic behind `window.api` keeps its platform port, so it is still tested on Node.

## Considered options

- **Keep shipping both**: rejected; twice the build and test work for the larger, slower build.
- **Freeze Electron but keep its code**: rejected; code that is built and tested but never shipped still costs every change.
