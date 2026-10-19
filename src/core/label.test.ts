import { describe, expect, it } from 'vitest'
import { buildLabel, decodeLabelData, selfCheckLabel, type Label, type LabelRequest } from './label'

const today = '2026-10-19'

const request: LabelRequest = {
  itemCode: 'PARA01',
  packVolumeDigit: 0,
  expiry: '31122027',
  lot: '2512172-1',
  copies: 1
}

/** Builds a label the test expects to be valid. */
function built(overrides: Partial<LabelRequest> = {}) {
  const result = buildLabel({ ...request, ...overrides }, { today })
  if (!result.ok) throw new Error(JSON.stringify(result.errors))
  return result
}

/** The field names a refused request reports. */
function refusedFields(overrides: Partial<LabelRequest>) {
  const result = buildLabel({ ...request, ...overrides }, { today })
  return result.ok ? [] : result.errors.map((error) => error.field)
}

describe('buildLabel', () => {
  it('builds the label for a valid request', () => {
    expect(buildLabel(request, { today })).toEqual({
      ok: true,
      label: {
        internalGtin: '00425873440010',
        elementString: '010042587344001017271231102512172-1',
        hri: '(01)00425873440010(17)271231(10)2512172-1',
        itemCode: 'PARA01',
        packVolumeDigit: 0,
        packVolumeText: null,
        expiryYymmdd: '271231',
        expiryText: '31 DEC 2027',
        lot: '2512172-1',
        copies: 1
      },
      decoded: {
        internalGtin: '00425873440010',
        itemCode: 'PARA01',
        packVolumeDigit: 0,
        packVolumeMl: null,
        expiryYymmdd: '271231',
        expiryText: '31 DEC 2027',
        lot: '2512172-1'
      },
      warnings: []
    })
  })

  it('upper-cases the Item Code and the Lot', () => {
    const { label } = built({ itemCode: 'para01', lot: '15863a' })
    expect(label.itemCode).toBe('PARA01')
    expect(label.lot).toBe('15863A')
    expect(label.elementString).toBe('0100425873440010172712311015863A')
  })

  it('encodes Pack Volume into the Internal GTIN and shows it as text', () => {
    const { label } = built({ itemCode: 'PARA18', packVolumeDigit: 2 })
    expect(label.internalGtin).toBe('20425873440489')
    expect(label.packVolumeText).toBe('60 mL')
    expect(label.hri).toBe('(01)20425873440489(17)271231(10)2512172-1')
  })

  it('keeps a space inside an Item Code', () => {
    const { label } = built({ itemCode: 'AIR 01' })
    expect(label.itemCode).toBe('AIR 01')
    expect(label.internalGtin).toBe('00410718656015')
  })

  it('puts the Lot last with no trailing separator, so a 20-character Lot is carried whole', () => {
    const { label } = built({ lot: 'ABCDEFGHIJ0123456789' })
    expect(label.elementString).toBe('01004258734400101727123110ABCDEFGHIJ0123456789')
  })

  it('passes copies 1–99 through', () => {
    expect(built({ copies: 1 }).label.copies).toBe(1)
    expect(built({ copies: 99 }).label.copies).toBe(99)
  })

  it.each([0, 100, 1.5, -1, Number.NaN])('refuses %s copies', (copies) => {
    expect(refusedFields({ copies })).toEqual(['copies'])
  })

  it('refuses a malformed Item Code', () => {
    expect(refusedFields({ itemCode: 'PARA1' })).toEqual(['itemCode'])
    expect(refusedFields({ itemCode: 'PARA0!' })).toEqual(['itemCode'])
    expect(refusedFields({ itemCode: '' })).toEqual(['itemCode'])
  })

  it('refuses a Pack Volume digit outside 0–5', () => {
    expect(refusedFields({ packVolumeDigit: 7 })).toEqual(['packVolume'])
  })

  it('refuses a bad Expiry or Lot', () => {
    expect(refusedFields({ expiry: '3112202' })).toEqual(['expiry'])
    expect(refusedFields({ expiry: '31022027' })).toEqual(['expiry'])
    expect(refusedFields({ expiry: '18102026' })).toEqual(['expiry'])
    expect(refusedFields({ lot: 'VRTy T002' })).toEqual(['lot'])
  })

  it('reports every bad field at once, each with a message', () => {
    const result = buildLabel({ itemCode: 'PARA1', packVolumeDigit: 0, expiry: '', lot: 'A B', copies: 0 }, { today })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.map((error) => error.field)).toEqual(['itemCode', 'expiry', 'lot', 'copies'])
    for (const error of result.errors) expect(error.message).not.toBe('')
    expect(result.errors.find((error) => error.field === 'lot')?.message).toBe('GS1 cannot encode a space in a Lot.')
  })

  it('still builds the label when Expiry is under 3 months, with a warning', () => {
    const result = buildLabel({ ...request, expiry: '01122026' }, { today })
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([{ field: 'expiry', message: expect.stringMatching(/3 months/) }])
  })

  it('keeps the Expiry warning alongside errors in other fields', () => {
    const result = buildLabel({ ...request, expiry: '01122026', lot: '' }, { today })
    expect(result.ok).toBe(false)
    expect(result.warnings.map((warning) => warning.field)).toEqual(['expiry'])
  })

  it('judges Expiry against the today it is given, not the clock', () => {
    expect(buildLabel({ ...request, expiry: '01012026' }, { today: '2025-06-01' }).ok).toBe(true)
    expect(buildLabel({ ...request, expiry: '01012026' }, { today: '2026-01-02' }).ok).toBe(false)
  })
})

describe('decodeLabelData', () => {
  it('decodes an element string into its fields', () => {
    expect(decodeLabelData('010042587344001017271231102512172-1')).toEqual({
      ok: true,
      data: {
        internalGtin: '00425873440010',
        itemCode: 'PARA01',
        packVolumeDigit: 0,
        packVolumeMl: null,
        expiryYymmdd: '271231',
        expiryText: '31 DEC 2027',
        lot: '2512172-1'
      }
    })
  })

  it('decodes Pack Volume from the Internal GTIN', () => {
    expect(decodeLabelData('012042587344048917271201101')).toMatchObject({
      ok: true,
      data: { itemCode: 'PARA18', packVolumeDigit: 2, packVolumeMl: 60, expiryText: '01 DEC 2027', lot: '1' }
    })
  })

  it.each([
    '15863A',
    'VRTY-T002',
    'MIPL/A4/UII/91',
    '(B)A52921725A4',
    '2512172-1',
    '21113HK1',
    'ABCDEFGHIJ0123456789',
    '1017(01)'
  ])('round-trips Lot %s exactly through the element string', (lot) => {
    const { label } = built({ lot })
    expect(decodeLabelData(label.elementString)).toMatchObject({ ok: true, data: { lot } })
  })

  it.each([
    ['empty', ''],
    ['bracketed HRI instead of an element string', '(01)00425873440010(17)271231(10)2512172-1'],
    ['symbology identifier left on', ']d2010042587344001017271231102512172-1'],
    ['AI 17 first', '172712310100425873440010102512172-1'],
    ['GTIN of 13 digits', '01004258734400117271231102512172-1'],
    ['no AI 10', '0100425873440010172712312512172-1'],
    ['empty Lot', '01004258734400101727123110'],
    ['trailing group separator', '010042587344001017271231102512172-1\u001d'],
    ['group separator inside the Lot', '01004258734400101727123110251\u001d2172-1'],
    ['lower-case Lot', '01004258734400101727123110abc'],
    ['Lot of 21 characters', '01004258734400101727123110ABCDEFGHIJ0123456789X'],
    ['bad check digit', '010042587344001117271231102512172-1'],
    ['manufacturer GTIN (not prefix 04)', '010400638133393117271231102512172-1'],
    ['month 13', '010042587344001017271331102512172-1'],
    ['day 00 (GS1 end of month; never printed, ADR-0001)', '010042587344001017271200102512172-1'],
    ['31 April', '010042587344001017270431102512172-1']
  ])('refuses %s', (_case, elementString) => {
    const result = decodeLabelData(elementString)
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.message).not.toBe('')
  })
})

describe('selfCheckLabel', () => {
  const { label, decoded } = built()

  it('confirms a built label decodes to what it shows', () => {
    expect(selfCheckLabel(label)).toEqual({ ok: true, decoded })
  })

  it.each<[string, Partial<Label>]>([
    ['Item Code', { itemCode: 'PARA02' }],
    ['Pack Volume', { packVolumeDigit: 2, packVolumeText: '60 mL' }],
    ['Internal GTIN', { internalGtin: '00425873440485' }],
    ['Expiry', { expiryText: '30 DEC 2027' }],
    ['Expiry', { expiryYymmdd: '271230' }],
    ['Lot', { lot: '2512172-2' }],
    ['Lot', { elementString: '010042587344001017271231102512172-2' }],
    ['element string', { hri: '(01)00425873440010(17)271231(10)2512172-2' }]
  ])('fails when the %s does not match', (what, tampered) => {
    const result = selfCheckLabel({ ...label, ...tampered })
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.message).toContain(what)
  })

  it('fails when the element string does not decode', () => {
    const result = selfCheckLabel({ ...label, elementString: '0100425873440011' })
    expect(result).toMatchObject({ ok: false })
  })
})
