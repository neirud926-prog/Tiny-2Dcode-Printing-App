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

## Internal GTIN test cases

[`test-vectors/internal-gtin-v1.csv`](test-vectors/internal-gtin-v1.csv) lists synthetic Item Code → Internal GTIN pairs for scheme v1 ([ADR-0002](docs/adr/0002-internal-gtin-scheme-v1.md)), so BCS, RxStation and this app can prove their encoders identical. Columns: `item_code` (always quoted, since Item Codes may contain spaces), `pack_volume_digit`, `internal_gtin`. Regenerate it with `npm run test-vectors`.

To also run the codec over a real Item List locally (never commit it): `ITEM_LIST_PATH=/path/to/item_phq.txt npm test`.
