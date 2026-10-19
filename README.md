# Tiny 2D-code Printing App

Portable Windows app that prints GS1 DataMatrix labels carrying an Internal GTIN, Expiry and Lot, so BCS can scan NLTH Pharmacy packs that have no manufacturer DataMatrix. See [GLOSSARY.md](GLOSSARY.md) and [docs/adr/](docs/adr/).

## Development

Requires Node 22.12 or later.

```sh
npm install     # install dependencies
npm test        # run the tests (vitest)
npm run dev     # start the app with hot reload (downloads the Electron binary on first run)
npm run build   # typecheck and build to out/
```

## Data folder

The app keeps its data in `LabelData\` next to the portable `.exe` (in development, `LabelData/` in the project folder, which git ignores) and checks at startup that it can write there. Every PC running the app from the same folder shares it.

- `pcs\<PC name>.dat`: this PC's printer, label size, offsets and log folder, set in the Setup step "Printer" and changed under **Settings**.
- `logs\print-log-YYYY-MM-<PC name>.csv`: one line per print: Date Time (local), Windows User, PC, Item Code, Pack Volume (mL), Internal GTIN, Expiry (YYYY-MM-DD), Lot, Copies. Each PC writes only its own file. Test prints are not logged. The log folder can be moved under **Settings**.

`.dat` files are sealed (`TDCP`, a format version byte, HMAC-SHA256, gzipped JSON) and replaced atomically, so a file changed outside the app is refused and other PCs never read a half-written one. Sealing stops casual edits; it is not encryption.

## Internal GTIN test cases

[`test-vectors/internal-gtin-v1.csv`](test-vectors/internal-gtin-v1.csv) lists synthetic Item Code → Internal GTIN pairs for scheme v1 ([ADR-0002](docs/adr/0002-internal-gtin-scheme-v1.md)), so BCS, RxStation and this app can prove their encoders identical. Columns: `item_code` (always quoted, since Item Codes may contain spaces), `pack_volume_digit`, `internal_gtin`. Regenerate it with `npm run test-vectors`.

To also run the codec over a real Item List locally (never commit it): `ITEM_LIST_PATH=/path/to/item_phq.txt npm test`.
