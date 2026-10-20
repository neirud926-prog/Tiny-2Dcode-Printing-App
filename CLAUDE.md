# 2D Code Print

Portable Electron app that generates GS1 DataMatrix codes (AIs 01 / 17 / 10) for the BCS replenishment project.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (neirud926-prog/Tiny-2Dcode-Printing-App) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`, both created when first needed. See `docs/agents/domain.md`.

## Commands

- `npm test`: vitest (`ITEM_LIST_PATH=/path/to/item_phq.txt npm test` adds a local check over a real Item List)
- `npm run typecheck`: `tsc --noEmit` for `tsconfig.core.json` (pure `src/core/` label core and `src/render/` label renderer and print job, no Node, DOM or Electron types), `tsconfig.node.json` (Electron main and preload, the tests, and the shared app logic: `src/app/` behind `window.api` and `src/data/` the data folder, which use no Node directly but the platform in `src/data/platform.ts`, so the Tauri webview runs them too; tests use the Node platform and a temp folder) and `tsconfig.web.json`
- `npm run build`: typecheck, then electron-vite build to `out/`
- `npm run dev`: run the app with hot reload
- `npm run dist:win`: build, then the portable Windows x64 `.exe` into `release/` with electron-builder (`electron-builder.yml`); CI builds it on Windows and a `v*` tag publishes it as a GitHub Release
- `npm run tauri:dev` / `npm run tauri:build`: the Tauri app (`src-tauri/` Rust shell, `src/tauri/` webview entry, `vite.tauri.config.mts` to `out-tauri/`); `npm run typecheck` includes `tsconfig.tauri.json` (no Node types). The Rust side cannot link here (no webkit): check it with `cargo check --target x86_64-pc-windows-msvc` in `src-tauri`, and run its pure tests with `rustc --edition 2021 --test src-tauri/src/scope.rs`
- `npm run test-vectors`: regenerate `test-vectors/internal-gtin-v1.csv`
