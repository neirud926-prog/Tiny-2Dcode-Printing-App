import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { markdownToHtml } from './markdown'

describe('markdownToHtml (the printer guide shown in the app)', () => {
  it('turns headings and paragraphs into HTML, escaping the text', () => {
    expect(markdownToHtml('# Set up\n\nOne line\nand the next <b>.\n\n## Then', {})).toBe(
      '<h1>Set up</h1>\n<p>One line and the next &lt;b&gt;.</p>\n<h2>Then</h2>'
    )
  })

  it('makes numbered and bulleted lists, an item running on over indented lines', () => {
    expect(markdownToHtml('1. Open it\n2. Set the tape\n   to 24 mm\n\n- Refused\n- Warned', {})).toBe(
      '<ol>\n<li>Open it</li>\n<li>Set the tape to 24 mm</li>\n</ol>\n<ul>\n<li>Refused</li>\n<li>Warned</li>\n</ul>'
    )
  })

  it('marks **bold** and `code`, and leaves a lone * alone', () => {
    expect(markdownToHtml('Press **Apply**, then `OK` (2 * 3).', {})).toBe('<p>Press <strong>Apply</strong>, then <code>OK</code> (2 * 3).</p>')
  })

  it('puts a drawing in place of its image, labelled with the alt text (the app allows no image files)', () => {
    const svg = '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'
    expect(markdownToHtml('![The Basic tab](brother-p900w/basic-tab.svg)', { 'brother-p900w/basic-tab.svg': svg })).toBe(
      '<figure role="img" aria-label="The Basic tab"><svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg></figure>'
    )
  })

  it('refuses an image it has no drawing for, so a missing drawing fails the guide test, not the screen', () => {
    expect(() => markdownToHtml('![Gone](gone.svg)', {})).toThrow('No drawing for gone.svg')
  })
})

describe('the Brother PT-P900W guide (docs/brother-p900w-setup.md)', () => {
  it('shows with both its drawings, as the app bundles them', async () => {
    const docs = join(import.meta.dirname, '..', '..', '..', 'docs')
    const images: Record<string, string> = {}
    for (const name of await readdir(join(docs, 'brother-p900w'))) images[`brother-p900w/${name}`] = await readFile(join(docs, 'brother-p900w', name), 'utf8')
    const html = markdownToHtml(await readFile(join(docs, 'brother-p900w-setup.md'), 'utf8'), images)
    expect(html.match(/<svg /g)).toHaveLength(2)
    expect(html).toContain('<strong>Printing preferences</strong>')
  })
})
