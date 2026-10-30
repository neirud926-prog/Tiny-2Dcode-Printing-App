/**
 * Writes the Brother PT-P900W guide (docs/brother-p900w-setup.md) as one printable A4 HTML page,
 * the same HTML the app shows, for CI to print to Brother-PT-P900W-setup.pdf with headless Chrome:
 *
 *   node scripts/guide-html.mts guide.html
 *   google-chrome --headless --no-pdf-header-footer --print-to-pdf=Brother-PT-P900W-setup.pdf guide.html
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { markdownToHtml } from '../src/renderer/src/markdown.ts'

const output = process.argv[2]
if (!output) throw new Error('Usage: node scripts/guide-html.mts <output.html>')

const docs = join(import.meta.dirname, '..', 'docs')
const images: Record<string, string> = {}
for (const name of readdirSync(join(docs, 'brother-p900w'))) images[`brother-p900w/${name}`] = readFileSync(join(docs, 'brother-p900w', name), 'utf8')
const body = markdownToHtml(readFileSync(join(docs, 'brother-p900w-setup.md'), 'utf8'), images)

const css = `
@page { size: A4; margin: 12mm 15mm; }
body { font-family: Arial, "Liberation Sans", sans-serif; font-size: 10.5pt; line-height: 1.35; color: #1f2933; margin: 0; }
h1 { font-size: 17pt; margin: 0 0 6pt; }
h2 { font-size: 12.5pt; margin: 12pt 0 4pt; border-bottom: 1px solid #c9ced6; padding-bottom: 2pt; }
p, ol, ul { margin: 4pt 0; }
ol, ul { padding-left: 18pt; }
li { margin: 1.5pt 0; }
figure { margin: 6pt 0; }
figure svg { width: 84mm; height: auto; display: block; font-family: Arial, "Liberation Sans", sans-serif; }
`

writeFileSync(
  output,
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Brother PT-P900W: how to set the printer</title>
<style>${css}</style>
</head>
<body>
${body}
</body>
</html>
`
)
