# 2D Code Print

Portable Tauri app (one Windows `.exe`, WebView2) that generates GS1 DataMatrix codes (AIs 01 / 17 / 10) for the BCS replenishment project.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (neirud926-prog/Tiny-2Dcode-Printing-App) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`, both created when first needed. See `docs/agents/domain.md`.

## Commands

- `npm test`: vitest (`ITEM_LIST_PATH=/path/to/item_phq.txt npm test` adds a local check over a real Item List)
- `npm run typecheck`: `tsc --noEmit` for `tsconfig.core.json` (pure `src/core/` label core and `src/render/` label renderer and print job, no Node, DOM or Electron types), `tsconfig.node.json` (the tests and the shared app logic: `src/app/` behind `window.api`, whose contract is `src/preload/api.ts`, and `src/data/` the data folder, which use no Node directly but the platform in `src/data/platform.ts`, so the Tauri webview runs them; tests use the Node platform and a temp folder) and `tsconfig.tauri.json` (the webview: `src/tauri/`, `src/renderer/src/` screens and the shared logic, no Node types)
- `npm run build`: typecheck, then build the webview to `out-tauri/` (any OS)
- `npm run tauri:dev` / `npm run tauri:build`: run the app with hot reload / build `src-tauri/target/release/tiny-2dcode.exe` (`src-tauri/` Rust shell, `src/tauri/` webview entry, `vite.tauri.config.mts`); CI builds it on Windows as `2DCodePrint-<version>.exe` and a `v*` tag publishes it as a GitHub Release. The Rust side cannot link here (no webkit): check it with `cargo check --target x86_64-pc-windows-msvc` in `src-tauri`, and run its pure tests with `rustc --edition 2021 --test src-tauri/src/scope.rs` (and `src-tauri/src/paper.rs`)
- `npm run test-vectors`: regenerate `test-vectors/internal-gtin-v1.csv`
