---
status: accepted
---

# Internal GTIN scheme v1: Item Code and Pack Volume encoded arithmetically under GS1 prefix 04

An Internal GTIN is calculated from the Item Code and Pack Volume, so BCS and RxStation can turn it back into the Item Code with arithmetic alone: no GTIN table, no counter, no registry. Labels are only ever scanned inside NLTH / HA, so we use GS1's company-internal prefix `04`, which GS1 never issues to manufacturers. Once labels are printed this scheme cannot change; any revision must be a new version using the reserved ranges below.

## Layout (14 digits)

```
 V | 0 4 | N N N N N N N N N N | C
 V   Pack Volume digit (table below)
 04  GS1 prefix for restricted circulation within a company
 N   Item Code as a base-40 number, zero-padded to 10 digits
 C   GS1 mod-10 check digit
```

**Character values** (fixed forever): `0`–`9` → 0–9, `A`–`Z` → 10–35, space → 36, `-` → 37, `&` → 38, `.` → 39.

**Encode:** `N = v(c1)·40⁵ + v(c2)·40⁴ + v(c3)·40³ + v(c4)·40² + v(c5)·40 + v(c6)`. The Item Code must be exactly 6 characters from the table (lower case is upper-cased; anything else is refused).
**Decode:** divide N by 40 six times; the remainders, last first, are the characters.

**Pack Volume digit V:** `0` no volume encoded (non-liquid, or a volume not listed) · `1` 30 mL · `2` 60 mL · `3` 120 mL · `4` 240 mL · `5` 480 mL · `6`–`8` reserved for future volumes (added only by a new ADR) · `9` never used (GS1 variable-measure indicator).

**Reserved for a future version:** N from 4,096,000,000 to 9,999,999,999 (v1 never produces them), and V = 6–8.

## Worked examples

| Item Code | Pack Volume | N | Internal GTIN |
|---|---|---|---|
| `PARA01` | none | 2,587,344,001 | `00425873440010` |
| `PARA18` | none | 2,587,344,048 | `00425873440485` |
| `PARA18` | 60 mL | 2,587,344,048 | `20425873440489` |
| `AIR 01` | none | 1,071,865,601 | `00410718656015` |

## Recognising an Internal GTIN when scanned (fast path first)

1. If digit 1 is 0–8, digits 2–3 are `04`, the check digit is valid and N < 4,096,000,000, decode N; if the decoded Item Code exists in the item master, it is an Internal GTIN. No table is consulted.
2. Otherwise look the GTIN up in the `gtins` table as before, then fall back to link-at-shelf.

Checked against current data (Oct 2026): the only existing `gtins` entry that passes step 1's digit checks, `00402816304400`, decodes to `2U0J10`, which is not an Item Code, so every existing row still resolves as before. For an Internal GTIN the element string is always `(01)(17)(10)` with Lot last, so the Lot is everything after AI 10; no boundary guessing.

## Considered options

- **GTIN → Item Code lookup table**: rejected; the point is that no table has to be kept in sync across BCS, RxStation and every printing PC.
- **Licensed GS1 Company Prefix**: unnecessary for internal-only labels, and it would leave too few digits to hold every Item Code.
- **Item Code in AI 240 or 91–99**: rejected; BCS identifies items through AI 01, and labels carry only AIs 01, 17 and 10.
- **A per-item pack variant list**: rejected in favour of the fixed Pack Volume table, which needs no list on any PC.
