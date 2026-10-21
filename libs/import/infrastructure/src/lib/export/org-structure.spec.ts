import {
  buildOrgStructure,
  parseBoundaries,
  parseStationPd,
  parseSubdivisions,
  parseTrackPd,
  subdivisionChoices,
  type ExportTable,
} from '@eow/import/application'
import type { Result } from '@eow/shared/kernel'
import { generatePassportFixtures } from '../testing/passport/generate'
import { PassportExportSource } from './passport-export-source'

async function tables(): Promise<Map<string, ExportTable>> {
  const source = new PassportExportSource()
  const out = new Map<string, ExportTable>()
  for (const f of await generatePassportFixtures()) {
    if (f.path.startsWith('frameset/')) continue
    const r = await source.read({ name: f.path, bytes: f.bytes })
    if (r.ok) for (const t of r.value) out.set(t.form, t)
  }
  return out
}

function value<T, E>(r: Result<T, E>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.value
}

describe('Оргструктура из вымышленных выгрузок', () => {
  it('прежние и новые ПД — на выбор; по новым — иерархия, станции и пути без замечаний', async () => {
    const t = await tables()
    const get = (form: string): ExportTable => {
      const x = t.get(form)
      if (!x) throw new Error(`нет ${form}`)
      return x
    }
    const subdivisions = value(parseSubdivisions(get('subdivisions')))
    const boundaries = value(parseBoundaries(get('boundaries')))
    const date = '2026-10-21'

    const choices = subdivisionChoices(subdivisions, boundaries, date)
    expect(choices.filter((c) => c.type === 'ПД').map((c) => [c.code, c.suggested])).toEqual([
      ['ПД-1', true],
      ['ПД-2', true],
      ['ПД-3', true],
      ['ПД-4', true],
      ['ПД-11', false],
      ['ПД-12', false],
      ['ПД-13', false],
      ['ПД-14', false],
    ])

    const selected = new Set(choices.filter((c) => c.suggested).map((c) => c.code))
    const org = buildOrgStructure(
      {
        subdivisions,
        boundaries,
        stationPd: value(parseStationPd(get('station-pd'))),
        trackPd: value(parseTrackPd(get('track-pd'))),
      },
      date,
      selected,
    )
    expect(org.units.filter((u) => u.type === 'ПД').map((u) => `${u.parent} → ${u.code}`)).toEqual([
      'ПЧУ-1 → ПД-1',
      'ПЧУ-1 → ПД-2',
      'ПЧУ-2 → ПД-3',
      'ПЧУ-2 → ПД-4',
    ])
    expect(org.otherUnits.map((u) => u.type)).toEqual(['ЗП', 'ПДУ', 'ПДБ', 'ПЧДЕФ'])
    expect(org.stations.get('ЗАРЕЧЬЕ')).toBe('ПД-2')
    expect(org.stations.get('РАЗЪЕЗДНАЯ')).toBe('ПД-3')
    expect(org.remarks).toEqual([])
  })
})
