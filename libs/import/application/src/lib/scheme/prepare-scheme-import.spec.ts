import { describe, expect, it } from 'vitest'
import type { StationSchemeBasis } from '@eow/passport/import-api'
import {
  numberKey,
  prepareSchemeImport,
  stationKey,
  type SchemeSourceFile,
} from './prepare-scheme-import'
import { fictionalDrawing } from './testing/fictional-scheme'

const AT = '2026-11-02T10:00:00.000Z'
const basis = (over: Partial<StationSchemeBasis> = {}): StationSchemeBasis => ({
  token: 'basis',
  stations: [
    { id: 'st-oz', name: 'ОЗЕРНАЯ' },
    { id: 'st-ln', name: 'Луговая' },
  ],
  tracks: [
    { stationId: 'st-oz', number: '2', fullLength: 849 },
    { stationId: 'st-oz', number: '3', fullLength: 400 },
    { stationId: 'st-oz', number: '5', fullLength: 300 },
  ],
  switches: ['1', '2', '3', '4', '5', '6', '7', '8СО'].map((number) => ({
    stationId: 'st-oz',
    number,
  })),
  layouts: [],
  ...over,
})
const file = (name = 'Схема_Озёрная.pdf'): SchemeSourceFile => ({
  name,
  sha256: 'a'.repeat(64),
  drawing: fictionalDrawing(),
})
const texts = (r: ReturnType<typeof prepareSchemeImport>) =>
  r.ok ? r.value.remarks.map((x) => x.text) : []

describe('Сверка схем станций с паспортом', () => {
  it('находит станцию без учёта регистра, «ё» и «ст.»', () => {
    expect(stationKey('ст. Озёрная')).toBe(stationKey('ОЗЕРНАЯ'))
    const r = prepareSchemeImport([file()], basis(), AT)
    expect(r.ok && r.value.command.layouts.map((l) => l.stationId)).toEqual(['st-oz'])
  })

  it('сравнивает номера без регистра и пробелов', () => {
    expect(numberKey('8со')).toBe(numberKey('8СО'))
    expect(numberKey('І')).toBe('I')
  })

  it('сообщает о путях и стрелках, которых нет с одной из сторон', () => {
    const remarks = texts(prepareSchemeImport([file()], basis(), AT))
    expect(remarks).toContain('«Схема_Озёрная.pdf»: путь 4 есть на схеме, но не в экспликации.')
    expect(remarks).toContain(
      '«Схема_Озёрная.pdf»: путь 5 есть в экспликации, но не найден на схеме.',
    )
    expect(remarks).toContain('«Схема_Озёрная.pdf»: путь 3: на схеме 412 м, в экспликации 400 м.')
  })

  it('не считает остряк из экспликации пропавшей стрелкой', () => {
    const remarks = texts(prepareSchemeImport([file()], basis(), AT))
    expect(remarks.some((r) => r.includes('стрелка 8СО'))).toBe(false)
  })

  it('пропускает схему станции, которой нет в паспорте, с замечанием', () => {
    const forest: SchemeSourceFile = {
      ...file('Лесная.pdf'),
      drawing: {
        ...fictionalDrawing(),
        texts: fictionalDrawing().texts.map((t) =>
          t.text === 'ст.Озёрная' ? { ...t, text: 'ст.Лесная' } : t,
        ),
      },
    }
    const r = prepareSchemeImport([file(), forest], basis(), AT)
    expect(r.ok && r.value.command.layouts).toHaveLength(1)
    expect(texts(r)).toContain(
      '«Лесная.pdf»: станции «Лесная» нет в паспорте; схема не будет записана.',
    )
    const none = prepareSchemeImport([forest], basis(), AT)
    expect(!none.ok && none.error.message).toContain('Ни одна схема')
  })

  it('отклоняет две схемы одной станции', () => {
    const r = prepareSchemeImport([file('a.pdf'), file('b.pdf')], basis(), AT)
    expect(!r.ok && r.error.message).toContain('одной станции')
  })

  it('отклоняет нечитаемый файл с его именем', () => {
    const broken: SchemeSourceFile = {
      name: 'x.pdf',
      sha256: 'b'.repeat(64),
      drawing: { error: 'Файл не является PDF.' },
    }
    const r = prepareSchemeImport([broken], basis(), AT)
    expect(!r.ok && r.error.message).toBe('«x.pdf»: Файл не является PDF.')
  })

  it('предупреждает о замене уже записанной раскладки и считает её', () => {
    const r = prepareSchemeImport([file()], basis({ layouts: ['st-oz'] }), AT)
    expect(r.ok && r.value.replaced).toBe(1)
    expect(texts(r)).toContain('«Схема_Озёрная.pdf»: раскладка станции «ОЗЕРНАЯ» будет заменена.')
  })

  it('ссылается из раскладки на запись файла с замечаниями', () => {
    const r = prepareSchemeImport([file()], basis(), AT)
    if (!r.ok) throw new Error(r.error.message)
    const [record] = r.value.command.files
    expect(r.value.command.layouts[0]?.importFileId).toBe(record?.id)
    expect(record?.warnings.length).toBeGreaterThan(0)
    expect(r.value.command.basisToken).toBe('basis')
  })
})
