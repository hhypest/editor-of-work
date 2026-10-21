import type { SegmentRow } from '@eow/passport/import-api'
import type { EditionData } from './edition-data'
import { compareEditionData } from './edition-diff'

const edition = {
  id: 1,
  number: 1,
  date: '2026-01-01',
  label: 'Редакция',
  status: 'active' as const,
}

const classRow = (id: string, trackClass: string | null): SegmentRow => ({
  id,
  importFileId: 'f1',
  validFrom: null,
  validTo: '9999-12-31',
  form: 'class',
  lineId: 'line-1',
  from: { km: 1, m: 0 },
  to: { km: 10, m: 0 },
  statedLength: null,
  values: { trackClass, group: null, category: null },
})

const base: EditionData = {
  edition,
  lines: [{ id: 'line-1', name: 'ГЛАВНАЯ', extents: [], kmLengths: [] }],
  segments: [classRow('["class","f","s",1]', '3')],
  stations: [],
  manual: { workKinds: [], repairNorms: [], tolerances: [], trainPairs: [], kilometres: [] },
  org: { subdivisions: [], boundaries: [], stations: [], tracks: [] },
}

describe('сравнение редакций', () => {
  it('пустые срезы не дают изменений', () => {
    const empty: EditionData = { ...base, lines: [], segments: [] }
    const diff = compareEditionData(empty, empty)
    for (const section of diff.sections) {
      expect(section.added).toEqual([])
      expect(section.removed).toEqual([])
      expect(section.changed).toEqual([])
    }
  })

  it('показывает добавленное, изменённое и удалённое по разделам', () => {
    const after: EditionData = {
      ...base,
      segments: [
        // Изменено значение поля; id из позиции в файле в сравнении не участвует.
        classRow('["class","f","s",9]', '4'),
      ],
      lines: [...base.lines, { id: 'line-2', name: 'ВТОРАЯ', extents: [], kmLengths: [] }],
    }
    const before: EditionData = {
      ...base,
      segments: [classRow('["class","f","s",1]', '3')],
    }
    const diff = compareEditionData(before, after)
    const segments = diff.sections.find((s) => s.section === 'segments')
    expect(segments?.changed).toHaveLength(1)
    expect(segments?.changed[0]?.label).toContain('ГЛАВНАЯ')
    expect(segments?.changed[0]?.changes).toEqual([
      { field: 'values.trackClass', before: '3', after: '4' },
    ])
    const lines = diff.sections.find((s) => s.section === 'lines')
    expect(lines?.added.map((r) => r.label)).toEqual(['ВТОРАЯ'])
    expect(lines?.removed).toEqual([])
  })

  it('форматирует координаты и пустые значения в изменениях', () => {
    const before: EditionData = {
      ...base,
      manual: {
        workKinds: [],
        repairNorms: [],
        tolerances: [],
        trainPairs: [
          {
            id: 'p1',
            validFrom: null,
            validTo: null,
            line: 'ГЛАВНАЯ',
            from: { km: 1, m: 0 },
            to: { km: 5, m: 250 },
            freight: 10,
            passenger: null,
            suburban: 2,
          },
        ],
        kilometres: [],
      },
    }
    const after: EditionData = {
      ...before,
      manual: {
        ...before.manual,
        trainPairs: [{ ...before.manual.trainPairs[0]!, freight: null }],
      },
    }
    const diff = compareEditionData(before, after)
    const manual = diff.sections.find((s) => s.section === 'manual')
    const changed = manual?.changed[0]
    expect(changed?.label).toBe('Пары поездов ГЛАВНАЯ: 1+000 – 5+250')
    expect(changed?.changes).toEqual([{ field: 'freight', before: '10', after: '—' }])
  })

  it('не считает изменением новую позицию строки в файле импорта', () => {
    const before: EditionData = {
      ...base,
      org: {
        ...base.org,
        subdivisions: [
          {
            id: 'ПЧ-1',
            importFileId: 'f1',
            validFrom: null,
            validTo: '9999-12-31',
            code: 'ПЧ-1',
            type: 'Дистанция пути',
            parentId: null,
            activity: null,
            active: true,
          },
        ],
      },
    }
    const after: EditionData = {
      ...before,
      org: {
        ...before.org,
        subdivisions: [{ ...before.org.subdivisions[0]!, importFileId: 'f2' }],
      },
    }
    const diff = compareEditionData(before, after)
    const org = diff.sections.find((s) => s.section === 'org')
    expect(org?.changed).toEqual([])
    expect(org?.added).toEqual([])
    expect(org?.removed).toEqual([])
  })
})
