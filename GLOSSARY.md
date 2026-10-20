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

### Labels scanned in

**Shelf Label**:
The QR label on a shelf bin carrying the Item Code and bin, e.g. `PARA01_1C5A_B…aR` (NLTH) or `PARA01_1C5A` (another site).
_Avoid_: bin label, shelf QR code

**Dispensing-bag Label**:
The label on a dispensed bag: the Item Code alone (out-patient) or 13 characters with the Item Code at characters 5–10 (in-patient).
_Avoid_: bag sticker, patient label

### Symbols

**GS1 DataMatrix**:
The square 2D symbol carrying GS1 AI data; the only symbology this app prints.
_Avoid_: 2D code, DM code, QR code

**AI (Application Identifier)**:
A GS1 numeric prefix naming the data field that follows: 01 GTIN, 17 expiry, 10 Lot.
_Avoid_: using "AI" unqualified where it could mean artificial intelligence
