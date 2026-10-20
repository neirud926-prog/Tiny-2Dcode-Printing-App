# 2D Code Print

Prints GS1 DataMatrix labels for the few NLTH Pharmacy items that have no Manufacturer GTIN (unregistered items, clinical-trial drugs), so BCS (Bar-Code Stock Replenishment) can scan them like manufacturer stock.

## Language

### Identifiers

**Item Code**:
The 6-character identifier of a pharmacy stock item in the HA item master.
_Avoid_: drug code, item number

**Manufacturer GTIN**:
The GTIN a supplier assigned and printed on its own pack.
_Avoid_: real GTIN, barcode

**Internal GTIN**:
A GTIN derived from an Item Code under GS1's internal-use prefix 04, used only for the rare items with no Manufacturer GTIN; meaningful only inside NLTH / HA. It is a GTIN like any other.
_Avoid_: self-defined GTIN, fake GTIN, dummy GTIN

**Pack Volume**:
The nominal fill volume of a liquid pack: 30, 60, 120, 240 or 480 mL.
_Avoid_: pack size, pack variant

**Lot**:
The identifier of one production or preparation run of an item, as printed on the pack.
_Avoid_: batch, batch number

### Data

**Item List**:
The HA drug master (`item_phq.txt`) imported into the app; the source of valid Item Codes.
_Avoid_: item master, drug list, DB

**Stock Onhand**:
The daily Oracle report "HA: INV Stock onhand with lot details" of the lots, expiries and quantities currently held; valid only on its Report Date.
_Avoid_: stock list, inventory file

**Pending Label**:
A label request whose Item Code is not yet in the Item List, kept until a newer Item List is imported. One whose Expiry has passed is Expired and can only be deleted.
_Avoid_: follow-up (BCS uses Follow-up for Not Match scans), to-do

### Labels printed

**GTIN Label**:
A label carrying an Internal GTIN, Expiry and Lot in a GS1 DataMatrix, for BCS to scan like manufacturer stock.
_Avoid_: 2D GTIN label, drug label

**Custom Label**:
A label with a 2D code holding short data that staff type, and optional lines of text; no fixed meaning, for any scanning need.
_Avoid_: self-defined code, free label

**Label Size**:
A named label roll size, width × height in mm, in a list shared by every PC; each PC records the one loaded in its printer.
_Avoid_: paper size, label roll setting

**Small Label**:
The built-in Label Size of 34.4 × 25 mm; always present, never changed; the only size a GTIN Label prints on, and the default.
_Avoid_: default label, standard label

**Template**:
A saved Custom Label layout for one Label Size: one code and up to six lines of text, each either fixed (saved in the Template) or fill-in (typed when printing); shared by every PC. Layouts 1 and 2 are built-in Templates.
_Avoid_: design, preset, layout file

### Labels scanned in

**Shelf Label**:
The QR label on a shelf bin carrying the Item Code and bin, e.g. `PARA01_1C5A_B…aR` (NLTH) or `PARA01_1C5A` (another site).
_Avoid_: bin label, shelf QR code

**Dispensing-bag Label**:
The label on a dispensed bag: the Item Code alone (out-patient) or 13 characters with the Item Code at characters 5–10 (in-patient).
_Avoid_: bag sticker, patient label

### Symbols

**GS1 DataMatrix**:
The square 2D symbol carrying GS1 AI data; the symbology of every GTIN Label.
_Avoid_: 2D code, DM code

**Plain code**:
A DataMatrix or QR code holding exactly the characters staff typed, with no AIs; the symbology of a Custom Label.
_Avoid_: free code, non-GS1 barcode

**AI (Application Identifier)**:
A GS1 numeric prefix naming the data field that follows: 01 GTIN, 17 expiry, 10 Lot.
_Avoid_: using "AI" unqualified where it could mean artificial intelligence
