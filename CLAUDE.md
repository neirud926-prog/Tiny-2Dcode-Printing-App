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
- `npm run typecheck`: `tsc --noEmit` for `tsconfig.core.json` (pure `src/core/` label core and `src/render/` label renderer and print job, no Node, DOM or Electron types), `tsconfig.node.json` (main, preload and `src/data/`, the data folder: Node only, no Electron, tested with a temp folder) and `tsconfig.web.json`
- `npm run build`: typecheck, then electron-vite build to `out/`
- `npm run dev`: run the app with hot reload
- `npm run dist:win`: build, then the portable Windows x64 `.exe` into `release/` with electron-builder (`electron-builder.yml`); CI builds it on Windows and a `v*` tag publishes it as a GitHub Release
- `npm run test-vectors`: regenerate `test-vectors/internal-gtin-v1.csv`
