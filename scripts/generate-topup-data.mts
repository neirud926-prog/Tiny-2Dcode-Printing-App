/**
 * Generates src/data/topupBuiltIn.json, the built-in Topup Database bundled in the app, from the
 * DataBase sheet of the workbook `QRCode for Topup.xlsm`:
 *
 *   npm run topup-data -- "path/to/QRCode for Topup.xlsm"
 *
 * Reads the workbook with the app's own import (src/data/workbook.ts, src/core/topup.ts), so the
 * built-in data is exactly what importing the same workbook in Settings would give. Keeps only the
 * four columns a Topup Label is made from, one entry per line: [Item Code, Display Name (MOE),
 * Salt / Special Property (MOE), Form Code]. The date is when the workbook was last saved, as
 * recorded in it (its file date as a fallback). The workbook itself is not kept in the repo.
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { runnerImport } from 'vite'

type Topup = typeof import('../src/core/topup')
type Workbook = typeof import('../src/data/workbook')

const OUTPUT_PATH = join(import.meta.dirname, '..', 'src', 'data', 'topupBuiltIn.json')

const source = process.argv[2]
if (!source) {
  console.error('Usage: npm run topup-data -- "path/to/QRCode for Topup.xlsm"')
  process.exit(1)
}

const load = async <T,>(path: string): Promise<T> => (await runnerImport<T>(join(import.meta.dirname, path), { configFile: false, logLevel: 'error' })).module
const { parseTopupDatabase, TOPUP_SHEET_NAME } = await load<Topup>('../src/core/topup.ts')
const { readWorkbookModified, readWorkbookSheet } = await load<Workbook>('../src/data/workbook.ts')

const bytes = readFileSync(source)
const sheet = await readWorkbookSheet(bytes, TOPUP_SHEET_NAME)
if (!sheet.ok) throw new Error(sheet.message)
const parsed = parseTopupDatabase(sheet.rows)
if (!parsed.ok) throw new Error(parsed.message)

const sourceModified = (await readWorkbookModified(bytes)) ?? statSync(source).mtime.toISOString()
const entries = parsed.entries.map((entry) => JSON.stringify([entry.itemCode, entry.displayName, entry.salt, entry.formCode]))
const json = `{"sourceFileName":${JSON.stringify(basename(source))},"sourceModified":${JSON.stringify(sourceModified)},"entries":[\n${entries.join(',\n')}\n]}\n`
writeFileSync(OUTPUT_PATH, json)

const { rows, badRows, duplicates } = parsed.summary
console.log(`Wrote ${entries.length} entries (${rows} rows, ${badRows} bad, ${duplicates} repeated) dated ${sourceModified} to ${OUTPUT_PATH}`)
for (const bad of parsed.badRows) console.log(`  ${bad.message}`)
