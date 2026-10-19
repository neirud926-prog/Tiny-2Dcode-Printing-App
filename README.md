# Tiny 2D-code Printing App

Portable Windows app that prints GS1 DataMatrix labels carrying an Internal GTIN, Expiry and Lot, so BCS can scan NLTH Pharmacy packs that have no manufacturer DataMatrix. See [GLOSSARY.md](GLOSSARY.md) and [docs/adr/](docs/adr/).

## Development

Requires Node 22.12 or later.

```sh
npm install     # install dependencies
npm test        # run the tests (vitest)
npm run dev     # start the app with hot reload (downloads the Electron binary on first run)
npm run build   # typecheck and build to out/
npm run dist:win      # build the portable Windows x64 .exe into release/ (CI does this on Windows; NSIS does not run on Apple silicon without Rosetta)
npm run dist:win:dir  # build the unpacked Windows folder release/win-unpacked/ (works on any OS)
```

CI (`.github/workflows/ci.yml`) runs the tests on every push and pull request, then builds the portable `.exe` on Windows and keeps it as a workflow artifact for 14 days.

### Releasing

1. Set `"version"` in `package.json` (e.g. `0.2.0`) and push to `main`.
2. Push the matching tag: `git tag v0.2.0 && git push origin v0.2.0`. CI builds the `.exe` and publishes a GitHub Release with it attached and generated notes. A tag that does not match `package.json` fails the release.

To test the release job without publishing anything, run the CI workflow by hand (Actions → CI → Run workflow) with **Release dry run** ticked: it creates a draft release, checks the `.exe` is attached, and deletes it.

## Deploying on the shared drive

1. Download `Tiny2DCode-<version>-portable.exe` from [Releases](https://github.com/neirud926-prog/Tiny-2Dcode-Printing-App/releases). It is the whole app: no installer, no admin rights.
2. Copy it to a folder on the pharmacy shared drive that every staff member using the app can write to, e.g. `S:\Pharmacy\Label App\`. Every PC runs that same file. To upgrade, close the app on every PC, replace the `.exe` with the new one and keep `LabelData\`. The header shows the running version, e.g. `v0.1.0`.
3. First launch: Setup asks for the Item List import (shared by every PC), then for this PC's printer and label size with a test print. Every other PC asks only for its own printer and test print. Later launches open straight to the label screen. Whenever there is no Stock Onhand dated today, a launch first asks to **Import** today's Stock Onhand report (shared by every PC) or **Skip** (type Lots by hand until the next launch).

- **`LabelData\` is created next to the `.exe`** (see [Data folder](#data-folder)). It holds the shared data and each PC's settings as sealed `.dat` files: do not edit, rename or move them, since a file changed outside the app is refused. Print and import logs are CSV files in `LabelData\logs\` unless the log folder was changed under **Settings**. If the app cannot write there, it says so at startup: move the `.exe` to a folder you can write to.
- **Startup takes a few seconds.** The portable `.exe` unpacks the app into the PC's temp folder (`%TEMP%`) at every launch, runs it from there and deletes it on exit; from a network share this can take several seconds before the window appears, so double-click once and wait. The data still goes next to the `.exe`, never into the temp folder: the launcher passes the `.exe`'s folder to the app (`PORTABLE_EXECUTABLE_DIR`). If startup is too slow, use the unpacked folder build instead: run `npm ci` and `npm run dist:win:dir` in this repo, copy the whole `release/win-unpacked/` folder to the shared drive and start `Tiny 2D-code Printing App.exe` inside it. It starts without unpacking and keeps `LabelData\` inside that folder, next to its `.exe` (move an existing `LabelData\` there).
- **Windows SmartScreen may warn.** The `.exe` is not code-signed, so Windows may show "Windows protected your PC" on first run or when it is downloaded: choose **More info → Run anyway**, or unblock it under the file's **Properties**, or ask IT to allow it.
- **Offline.** The app makes no network calls: no auto-update, no telemetry, no remote content. Updates are manual, from Releases.

## Data folder

The app keeps its data in `LabelData\` next to the portable `.exe` (in development, `LabelData/` in the project folder, which git ignores) and checks at startup that it can write there. Every PC running the app from the same folder shares it.

- `items.dat`: the Item List, shared by every PC: Item Code, drug name and base unit from the HA file `item_phq.txt` (tab-separated, latin1), with the file's name and date and who imported it where. Imported in the first Setup step, "Item List", and again under **Settings** (**Re-import Item List**) or from the unknown Item Code dialog. A file is refused, and the Item List in use kept, if it is empty, most rows have fewer than 15 columns (the wrong file), or more than 1% of rows are bad (an Item Code that is not 6 characters from the 40 of ADR-0002, or no drug name or base unit); a repeated Item Code keeps its first row. A missing or changed `items.dat` sends the app back to the Setup step "Item List".
- `stock.dat`: the Stock Onhand, shared by every PC: each item's Lots with Expiry (`YYMMDD`), UOM and quantity, from the Oracle report "HA: INV Stock onhand with lot details" (a `.ps` file that is plain text; `.txt` and `.csv` are accepted too; UTF-8 or Windows-1252), with its Report Date, Organization and Subinventory, the file's name and date and who imported it where. Imported from the launch prompt, under **Settings** (**Import Stock Onhand**) or from the label screen when the one in use is not today's; each import replaces it. The report needs a `Report Date:` line in its header block and the columns Item Code, Item Description, Lot Number, Expiry Date, UOM and Onhand Quantity (found by name; Item Code and Lot Number may be Excel text `="…"`; an unquoted comma in a description is recovered in the standard 11-column layout). Rows with the same Item Code and Lot are merged by summing quantity; rows without a Lot are skipped. A file is refused, and the Stock Onhand in use kept, without a Report Date or a required column, with no rows with a Lot, or with more than 1% bad rows (an invalid Item Code, Expiry Date or quantity). Lots can be picked from it only on its Report Date.
- `pending.dat`: the Pending Labels, shared by every PC: label requests (Item Code, Pack Volume if known, Expiry, Lot, copies, who and when) saved from the unknown Item Code dialog (**Save as Pending Label**) because the Item Code is not in the Item List yet. Every change (save, delete, claim for printing, delete expired) is made while holding the lock file `pending.lock`, so two PCs never overwrite each other. A lock older than 30 seconds, left by a PC that stopped mid-change, is taken over; its age is judged by the file server's clock (from a short-lived `pending.lock.clock-<id>` file the app makes in `LabelData` and deletes again, so a PC with a wrong clock cannot break a live lock). A changed `pending.dat` is refused, never replaced. The **Pending Labels** button on the label screen shows the count and lists them; they are checked again after every Item List import (here or on another PC) and whenever the window comes back to the front. Those whose Item Code is now listed show as ready and print with one click through the same checks, self-check and print log as any label. One whose Expiry has passed shows as Expired and cannot print; **Delete expired** removes all of them at once. A Pending Label is removed when it prints (put back if the print fails) or when deleted. A liquid saved without a Pack Volume asks for one before it prints. Up to 200 are kept, expired ones included.
- `pcs\<PC name>.dat`: this PC's printer, label size, offsets and log folder, set in the Setup step "Printer" (after the Item List) and changed under **Settings**.
- `logs\print-log-YYYY-MM-<PC name>.csv`: one line per print: Date Time (local), Windows User, PC, Item Code, Pack Volume (mL), Internal GTIN, Expiry (YYYY-MM-DD), Lot, Copies. Each PC writes only its own file. Test prints are not logged. The log folder can be moved under **Settings**.
- `logs\import-log-YYYY-MM-<PC name>.csv`: one line per import, accepted or not: Date Time (local), Windows User, PC, Kind (`Item List` or `Stock Onhand`), File (full path), Rows imported, Bad rows, Result (`Imported`, `Refused: <why>`, or `Failed: <why>` when the file could not be read or saved).

On the label screen, an Item Code must be in the Item List: its drug name shows on screen (never on the label), and a liquid (base unit `ML`) needs a Pack Volume choice, 30 / 60 / 120 / 240 / 480 mL or Other (Pack Volume digit 0). An unknown Item Code cannot be printed; a dialog offers to import a newer Item List or to save the label as a Pending Label. The main process checks the Item List again before every print.

The Item Code field also takes a scan (keyboard-wedge scanner, Enter suffix). On Enter or on leaving the field, the Item Code is taken from a plain 6-character code (typed, or an out-patient dispensing-bag label), a shelf label in the shapes BCS reads (NLTH's QR `ITEMCODE_BIN_B<hash>aR` with a 4-character BIN, or another site's plain `ITEMCODE_BIN` with a BIN of 2–6 characters other than `_`, e.g. PMH's `AA 9`), or a 13-character in-patient dispensing-bag label (4 letters or digits, the Item Code, 3 letters or digits; 13 digits is an EAN-13 and is refused). Spaces inside an Item Code are kept; spaces around it are trimmed only when the value fits no pattern as it is. Anything else is refused with "Not an Item Code, shelf label or dispensing-bag label." ([`src/core/scanInput.ts`](src/core/scanInput.ts)).

Once the Item Code is found, the Lot picker lists that item's Lots from today's Stock Onhand, earliest Expiry first, each with its Expiry (`dd MMM yyyy`) and quantity, plus **Type lot manually**. Picking a Lot fills Lot and Expiry exactly as recorded and locks both fields until **Type lot manually** (which clears them). A Lot the Lot rules refuse (e.g. one with a space) or whose Expiry has passed is shown but cannot be picked; a short expiry is warned about as for a typed one. A Stock Onhand dated another day cannot be picked from: the picker shows its date and offers to import today's file. The header shows the Stock Onhand's Report Date and Subinventory, or that it is stale or missing.

`.dat` files are sealed (`TDCP`, a format version byte, HMAC-SHA256, gzipped JSON) and replaced atomically, so a file changed outside the app is refused and other PCs never read a half-written one. Sealing stops casual edits; it is not encryption.

## Internal GTIN test cases

[`test-vectors/internal-gtin-v1.csv`](test-vectors/internal-gtin-v1.csv) lists synthetic Item Code → Internal GTIN pairs for scheme v1 ([ADR-0002](docs/adr/0002-internal-gtin-scheme-v1.md)), so BCS, RxStation and this app can prove their encoders identical. Columns: `item_code` (always quoted, since Item Codes may contain spaces), `pack_volume_digit`, `internal_gtin`. Regenerate it with `npm run test-vectors`.

To also run the codec and the Item List parser over a real Item List locally (never commit it): `ITEM_LIST_PATH=/path/to/item_phq.txt npm test`. The committed `test-fixtures/item_phq-synthetic.txt` is a made-up Item List in the real layout, and `test-fixtures/stock-onhand-synthetic.ps` a made-up Stock Onhand report in the real layout (Windows-1252, CRLF).
