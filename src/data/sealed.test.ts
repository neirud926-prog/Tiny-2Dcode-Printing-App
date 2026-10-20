import { createHmac } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { readSealed, SEALED_FILE_KEY, SEALED_MAGIC, SEALED_VERSION, seal, writeSealed } from './sealed'
import { tempFolder } from './testFolder'

const value = {
  printerName: 'ZDesigner GX420t',
  labelSize: { widthMm: 34.4, heightMm: 25 },
  note: 'Ünïcode & "quotes"',
  items: Array.from({ length: 50 }, (_, i) => ({ itemCode: `ITEM${String(i).padStart(2, '0')}`, liquid: i % 3 === 0 }))
}

describe('sealed files', () => {
  it('round-trips a value', async () => {
    const path = join(await tempFolder(), 'settings.dat')
    await writeSealed(path, value)
    expect(await readSealed(path)).toEqual({ status: 'ok', value })
  })

  it('starts with "TDCP" and the format version, and is not readable as text', async () => {
    const path = join(await tempFolder(), 'settings.dat')
    await writeSealed(path, value)
    const bytes = await readFile(path)
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('TDCP')
    expect(Buffer.from(SEALED_MAGIC).toString('latin1')).toBe('TDCP')
    expect(bytes[4]).toBe(SEALED_VERSION)
    expect(bytes.toString('latin1')).not.toContain('printerName')
    expect(bytes.toString('latin1')).not.toContain('GX420t')
  })

  it('refuses a file with any single changed byte as "changed outside the app"', async () => {
    const path = join(await tempFolder(), 'settings.dat')
    await writeSealed(path, { printerName: 'ZDesigner GX420t' })
    const original = await readFile(path)
    for (let index = 0; index < original.length; index++) {
      const changed = Buffer.from(original)
      changed[index] ^= 0x01
      await writeFile(path, changed)
      const result = await readSealed(path)
      expect(result, `byte ${index}`).toEqual({ status: 'tampered', message: 'settings.dat was changed outside the app.' })
    }
  })

  it('refuses a truncated, extended or foreign file as changed outside the app', async () => {
    const path = join(await tempFolder(), 'settings.dat')
    await writeSealed(path, value)
    const original = await readFile(path)
    for (const bytes of [original.subarray(0, original.length - 1), Buffer.concat([original, Buffer.from([0])]), Buffer.alloc(0), Buffer.from('{"printerName":"X"}')]) {
      await writeFile(path, bytes)
      expect((await readSealed(path)).status).toBe('tampered')
    }
  })

  it('reports a missing file as missing', async () => {
    expect(await readSealed(join(await tempFolder(), 'none.dat'))).toEqual({ status: 'missing' })
  })

  it('reports a file it cannot read as unreadable', async () => {
    const path = join(await tempFolder(), 'folder.dat')
    await mkdir(path)
    const result = await readSealed(path)
    expect(result.status).toBe('unreadable')
    expect(result.status === 'unreadable' && result.message).toMatch(/^folder\.dat could not be read: /)
  })

  it('reads a file sealed by Node zlib and crypto, as app versions up to 0.1.1 wrote them', async () => {
    const path = join(await tempFolder(), 'items.dat')
    const header = Buffer.concat([Buffer.from(SEALED_MAGIC), Buffer.from([SEALED_VERSION])])
    const payload = gzipSync(Buffer.from(JSON.stringify(value)))
    const mac = createHmac('sha256', SEALED_FILE_KEY).update(header).update(payload).digest()
    await writeFile(path, Buffer.concat([header, mac, payload]))
    expect(await readSealed(path)).toEqual({ status: 'ok', value })
  })

  it('writes a file Node zlib and crypto can verify and read', async () => {
    const path = join(await tempFolder(), 'items.dat')
    await writeSealed(path, value)
    const bytes = await readFile(path)
    const payload = bytes.subarray(37)
    expect(createHmac('sha256', SEALED_FILE_KEY).update(bytes.subarray(0, 5)).update(payload).digest()).toEqual(bytes.subarray(5, 37))
    expect(JSON.parse(gunzipSync(payload).toString('utf8'))).toEqual(value)
  })

  it('reports a genuine file from a newer app version as unreadable, not changed', async () => {
    const path = join(await tempFolder(), 'items.dat')
    const header = Buffer.concat([Buffer.from(SEALED_MAGIC), Buffer.from([SEALED_VERSION + 1])])
    const payload = gzipSync(Buffer.from(JSON.stringify(value)))
    const mac = createHmac('sha256', SEALED_FILE_KEY).update(header).update(payload).digest()
    await writeFile(path, Buffer.concat([header, mac, payload]))
    expect(await readSealed(path)).toEqual({
      status: 'unreadable',
      message: 'items.dat was saved by a newer version of the app; use the newer version.'
    })
  })

  it('seals in memory exactly what it writes', async () => {
    const path = join(await tempFolder(), 'settings.dat')
    await writeSealed(path, value)
    expect(new Uint8Array(await readFile(path))).toEqual(await seal(value))
  })
})

describe('writeSealed', () => {
  it('creates missing folders and replaces an existing file', async () => {
    const path = join(await tempFolder(), 'pcs', 'PHARM-01.dat')
    await writeSealed(path, { version: 1 })
    await writeSealed(path, { version: 2 })
    expect(await readSealed(path)).toEqual({ status: 'ok', value: { version: 2 } })
  })

  it('refuses a value JSON cannot hold', async () => {
    const path = join(await tempFolder(), 'bad.dat')
    await expect(writeSealed(path, undefined)).rejects.toThrow()
    expect(await readSealed(path)).toEqual({ status: 'missing' })
  })

  it('readers never see a half-written file while it is replaced', async () => {
    const path = join(await tempFolder(), 'items.dat')
    const big = (n: number) => ({ n, rows: Array.from({ length: 4000 }, (_, i) => `row ${n}-${i}-${'x'.repeat(i % 50)}`) })
    await writeSealed(path, big(0))

    let writing = true
    const writer = (async () => {
      for (let n = 1; n <= 15; n++) await writeSealed(path, big(n))
      writing = false
    })()
    const statuses = new Set<string>()
    let reads = 0
    while (writing) {
      const result = await readSealed(path)
      statuses.add(result.status)
      reads++
    }
    await writer
    expect(reads).toBeGreaterThan(0)
    expect([...statuses]).toEqual(['ok'])
    expect(await readSealed(path)).toEqual({ status: 'ok', value: big(15) })
  })
})
