/**
 * The little Markdown the printer guide (`docs/brother-p900w-setup.md`) uses, as HTML, so the app
 * shows the guide offline from the same file the repo and the PDF use.
 */
export function markdownToHtml(markdown: string, images: Readonly<Record<string, string>>): string {
  return markdown
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block !== '')
    .map((block) => blockHtml(block, images))
    .join('\n')
}

/**
 * One block: a heading, a list, a drawing or a paragraph. A drawing `![alt](path)` is put in as its
 * SVG from `images` (path → SVG markup), since the app's page allows no image files.
 */
function blockHtml(block: string, images: Readonly<Record<string, string>>): string {
  const image = /^!\[(.*)\]\((.+)\)$/.exec(block)
  if (image) {
    const svg = images[image[2]]
    if (svg === undefined) throw new Error(`No drawing for ${image[2]}`)
    return `<figure role="img" aria-label="${escapeHtml(image[1])}">${svg.trim()}</figure>`
  }
  const heading = /^(#{1,3}) (.*)$/.exec(block)
  if (heading) return `<h${heading[1].length}>${inlineHtml(heading[2])}</h${heading[1].length}>`
  const list = /^(\d+\.|-) /.exec(block)
  if (list) {
    const tag = list[1] === '-' ? 'ul' : 'ol'
    const items = block.split(/\n(?=\d+\. |- )/).map((item) => `<li>${inlineHtml(joinLines(item.replace(/^(\d+\.|-) /, '')))}</li>`)
    return `<${tag}>\n${items.join('\n')}\n</${tag}>`
  }
  return `<p>${inlineHtml(joinLines(block))}</p>`
}

function joinLines(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ')
}

function inlineHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
