import {
  checkKmLengths,
  isSegmentForm,
  parseBoundaries,
  parseSegments,
  type ImportedBoundary,
  type ParsedSegment,
} from '@eow/import/application'
import { generatePassportFixtures } from '../testing/passport/generate'
import { EDITORS } from '../testing/passport/model'
import { PassportExportSource } from './passport-export-source'

const boundaries: ImportedBoundary[] = []

async function segments(): Promise<ParsedSegment[]> {
  const source = new PassportExportSource()
  const out: ParsedSegment[] = []
  for (const f of await generatePassportFixtures()) {
    if (f.path.startsWith('frameset/')) continue
    const r = await source.read({ name: f.path, bytes: f.bytes })
    if (!r.ok) continue
    for (const t of r.value) {
      if (t.form === 'boundaries') {
        const b = parseBoundaries(t)
        if (b.ok) boundaries.push(...b.value)
      }
      if (!isSegmentForm(t.form)) continue
      const p = parseSegments(t)
      if (!p.ok) throw new Error(JSON.stringify(p.error[0]))
      out.push(...p.value)
    }
  }
  return out
}

describe('Характеристики по отрезкам из вымышленных выгрузок', () => {
  let all: ParsedSegment[]
  beforeAll(async () => {
    all = await segments()
  })

  it('все шесть форм разобраны', () => {
    expect(new Set(all.map((s) => s.form))).toEqual(
      new Set(['class', 'load', 'speeds', 'rails', 'sleepers', 'ballast']),
    )
  })

  it('ни ФИО из «Скорректировал», ни прежние коды ПД в разобранные данные не попадают', () => {
    const text = JSON.stringify(all.map(({ at: _at, ...rest }) => rest))
    for (const name of EDITORS.filter((e) => e !== '')) expect(text).not.toContain(name)
    expect(text).not.toMatch(/ПД-1[1-4]/u)
  })

  it('рельсы: «б.п.» — бесстыковой путь, число — длина звена; дата укладки — ГГГГ-ММ-ДД', () => {
    const rails = all.filter((s) => s.form === 'rails')
    expect(rails.some((r) => r.values.linkLength === 'б.п.')).toBe(true)
    expect(rails.some((r) => Number(r.values.linkLength) === 25)).toBe(true)
    expect(rails[0]?.values.laidDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u)
  })

  it('балласт: «-1» в толщине защитного слоя — слоя нет; «Нет данных» — пусто', () => {
    const ballast = all.filter((s) => s.form === 'ballast')
    expect(ballast.every((b) => b.values.protectiveThickness === null)).toBe(true)
  })

  it('сверка длин по всем формам находит нестандартные км и одну ошибку строки', () => {
    const r = checkKmLengths(all)
    expect(r.candidates.map((c) => `${c.km}:${c.length}`).toSorted()).toEqual([
      '115:990',
      '20:964',
      '41:1045',
    ])
    // Отрезок формы «Класс пути» с длиной на 7 м больше — ошибка в самой строке.
    expect(r.mismatches).toMatchObject([{ stated: 8157, computed: 8150, kms: [] }])
  })

  it('границы подразделений с «Длиной участка» участвуют в той же сверке', () => {
    expect(boundaries.length).toBeGreaterThan(0)
    const r = checkKmLengths([...all, ...boundaries])
    expect(r.candidates.map((c) => `${c.km}:${c.length}`).toSorted()).toEqual([
      '115:990',
      '20:964',
      '41:1045',
    ])
    expect(r.mismatches).toHaveLength(1)
  })
})
