/**
 * Decodes a text report exported from Oracle or saved by Excel, whose encoding is not declared:
 * UTF-8 when the bytes are valid UTF-8 (a BOM is dropped), UTF-16 when it starts with a UTF-16 byte
 * order mark, and otherwise Windows-1252 (latin1 with typographic characters at 0x80–0x9F).
 */

const UTF8_BOM = [0xef, 0xbb, 0xbf]

/** Windows-1252 bytes 0x80–0x9F; the five it leaves undefined keep their latin1 code points. */
const WINDOWS_1252_HIGH =
  '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f' +
  '\u0090‘’“”•–—˜™š›œ\u009džŸ'

export function decodeReportText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  const body = UTF8_BOM.every((byte, i) => bytes[i] === byte) ? bytes.subarray(UTF8_BOM.length) : bytes
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body)
  } catch {
    return decodeWindows1252(body)
  }
}

function decodeWindows1252(bytes: Uint8Array): string {
  let text = ''
  for (let start = 0; start < bytes.length; start += 8192) {
    // Array.from, not Uint8Array.map, which would cut the code points back to bytes.
    const codes = Array.from(bytes.subarray(start, start + 8192), (byte) => (byte >= 0x80 && byte <= 0x9f ? WINDOWS_1252_HIGH.charCodeAt(byte - 0x80) : byte))
    text += String.fromCharCode(...codes)
  }
  return text
}
