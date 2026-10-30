---
status: accepted
---

# Tape prints take the tape from the driver's Printing preferences

For a Tape Size the app sends no paper size: the tape width comes from the printer driver's own Printing preferences (set once per PC, e.g. 24 mm on the Brother PT-P900W), and the app only lays the label out across the tape's printable band. Before printing it reads the driver's paper width and refuses on a known tape width mismatch; when the driver reports no usable width it prints with a warning.

## Why

- The Brother P-touch driver ignores the custom page size WebView2 sends and falls back to its default tape (36 mm, "1.4 in"), so a 24 mm cassette is refused with "the tape cassette does not match"; a 24 × 24 mm custom size still asked for 1.4 in.
- WebView2 can set only a custom size, not one of the driver's named papers, so the driver's default is the one size the app can rely on.
- Cut, half-cut, chain printing and feed margins are driver options too; all tape set-up stays in one place, Printing preferences.

## Consequences

- Each PC with a tape printer must have the right tape width set in Printing preferences; the README documents it.
- Only a tape width mismatch refuses; a length difference only warns, since a driver's paper may carry a fixed nominal length.
- Die-cut Label Sizes keep the custom page size, which works on the pharmacy's label printers.

## Considered options

- **Keep sending a custom size, rotated so its width is the tape width**: rejected; not proven to work with the Brother driver, and nothing to fall back on if it is ignored.
- **Print through GDI with the driver's named paper**: rejected for now; a second print path beside WebView2 for one printer.
