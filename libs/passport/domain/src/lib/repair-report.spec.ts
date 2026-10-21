import { calculateRepairReport } from './repair-report'
import type { RepairNorm, RepairSnapshot, RepairReport } from './repair-types'

const period = { validFrom: null, validTo: '9999-12-31' }
const span = { from: { km: 700, m: 0 }, to: { km: 701, m: 0 } }
const segment = { ...period, ...span, lineId: 'line' }
const conditions = {
  trackClass: null,
  trackGroup: null,
  trackCategory: null,
  railType: null,
  sleeperType: null,
}
function norm(patch: Partial<RepairNorm> = {}): RepairNorm {
  return {
    ...period,
    ...conditions,
    id: 'norm',
    workCode: 'repair',
    workName: 'Учебный ремонт',
    years: 10,
    millionTons: 100,
    ...patch,
  }
}
function fixture(patch: Partial<RepairSnapshot> = {}): RepairSnapshot {
  return {
    date: '2027-01-01',
    lines: [
      { id: 'line', name: 'Вымышленное направление', extents: [span], kmLengths: [[700, 1250]] },
    ],
    segments: [
      { ...segment, form: 'class', values: { trackClass: '3', group: 'Г', category: '2' } },
      {
        ...segment,
        form: 'rails',
        values: { railType: 'Р65', laidDate: '2017-12-31', tonnageAfter: 100 },
      },
      { ...segment, form: 'sleepers', values: { sleeperType: 'ЖБ' } },
    ],
    tracks: [],
    norms: [norm()],
    ...patch,
  }
}
function report(input = fixture()): RepairReport {
  const result = calculateRepairReport(input)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
const assessment = (input = fixture()) => report(input).rows[0]!.assessments[0]!
function rail(year: number | null, tons: number | null): RepairSnapshot['segments'] {
  return [
    {
      ...segment,
      form: 'rails',
      values: {
        railType: 'Р65',
        laidDate: year === null ? null : `${year}-01-01`,
        tonnageAfter: tons,
      },
    },
  ]
}

describe('Потребность в ремонте по данным редакции', () => {
  it('считает нестандартный километр и достижение обоих порогов точно на границе', () => {
    const row = report().rows[0]!
    expect(row.location).toMatchObject({ lengthM: 1250 })
    expect(row.lastRepairYear).toBe(2017)
    expect(row.assessments[0]).toMatchObject({
      status: 'due',
      dueYear: 2027,
      overdueYears: 0,
      overdueMillionTons: 0,
    })
  })
  it.each([
    [2015, 20, 'due', 2025, 2, 0],
    [2025, 120, 'due', 2027, 0, 20],
    [2015, 120, 'due', 2025, 2, 20],
    [2025, 20, 'planned', 2035, 0, 0],
    [null, 120, 'due', 2027, null, 20],
    [2015, null, 'due', 2025, 2, null],
    [null, 20, 'incomplete', null, null, 0],
    [2025, null, 'incomplete', 2035, 0, null],
  ])(
    'выбирает первый достигнутый порог: %s, %s',
    (year, tons, status, dueYear, overdueYears, overdueMillionTons) => {
      expect(assessment(fixture({ segments: rail(year, tons) }))).toMatchObject({
        status,
        dueYear,
        overdueYears,
        overdueMillionTons,
      })
    },
  )
  it('при тоннаже не придумывает точный год его достижения', () => {
    expect(assessment(fixture({ segments: rail(2025, 120) }))).toMatchObject({
      dueYear: 2027,
      yearIsUpperBound: true,
    })
    expect(assessment(fixture({ norms: [norm({ millionTons: null })] }))).toMatchObject({
      dueYear: 2027,
      yearIsUpperBound: false,
    })
  })
  it('поддерживает только календарный и только тоннажный порог, включая нулевой тоннаж', () => {
    expect(
      assessment(fixture({ segments: rail(2010, null), norms: [norm({ millionTons: null })] })),
    ).toMatchObject({ status: 'due', overdueYears: 7, reason: null })
    expect(
      assessment(fixture({ segments: rail(null, 0), norms: [norm({ years: null })] })),
    ).toMatchObject({
      status: 'planned',
      dueYear: null,
      overdueYears: null,
      overdueMillionTons: 0,
      reason: null,
    })
  })
  it('не выдает будущий год ремонта за действительный', () => {
    expect(assessment(fixture({ segments: rail(2030, null) }))).toMatchObject({
      status: 'incomplete',
      dueYear: null,
    })
  })
  it('не подставляет норматив при отсутствии или несовпадении условий', () => {
    expect(assessment(fixture({ norms: [] }))).toMatchObject({ status: 'no-norm', normId: null })
    expect(assessment(fixture({ norms: [norm({ trackClass: '9' })] }))).toMatchObject({
      status: 'no-norm',
    })
  })
  it('берёт более конкретную норму, независимо от порядка', () => {
    const specific = norm({
      id: 'specific',
      trackClass: '3',
      railType: 'Р65',
      years: 30,
      millionTons: null,
    })
    for (const norms of [
      [norm(), specific],
      [specific, norm()],
    ])
      expect(assessment(fixture({ norms }))).toMatchObject({
        normId: 'specific',
        status: 'planned',
        dueYear: 2047,
      })
  })
  it('несопоставимые и повторные нормы не выбираются по порядку', () => {
    expect(
      assessment(
        fixture({ norms: [norm({ trackClass: '3' }), norm({ id: 'other', railType: 'Р65' })] }),
      ),
    ).toMatchObject({ status: 'ambiguous-norm', normId: null })
    expect(assessment(fixture({ norms: [norm(), norm({ id: 'other' })] }))).toMatchObject({
      status: 'ambiguous-norm',
    })
  })
  it('не скрывает возможную специальную норму при неизвестной конструкции', () => {
    expect(
      assessment(
        fixture({
          segments: rail(2010, 10),
          norms: [norm(), norm({ id: 'specific', trackClass: '3' })],
        }),
      ),
    ).toMatchObject({ status: 'incomplete', normId: null })
  })
  it('возвращает отдельные оценки для каждого вида ремонта', () => {
    const rows = report(
      fixture({
        norms: [
          norm(),
          norm({
            id: 'second',
            workCode: 'second',
            workName: 'Другой ремонт',
            years: 30,
            millionTons: null,
          }),
        ],
      }),
    ).rows
    expect(rows[0]!.assessments.map((a) => a.status)).toEqual(['due', 'planned'])
  })
  it('отбирает нормы и характеристики по дате, включая границы и открытый период', () => {
    const snapshot = fixture()
    const norms = [
      norm({ validFrom: '2027-01-01', validTo: '2027-01-01' }),
      norm({ id: 'past', validTo: '2026-12-31' }),
      norm({ id: 'future', validFrom: '2027-01-02' }),
    ]
    const segments = [
      ...snapshot.segments,
      ...rail(2000, 999).map((s) => ({ ...s, validTo: '2026-12-31' })),
      ...rail(2000, 999).map((s) => ({ ...s, validFrom: '2027-01-02' })),
    ]
    expect(assessment(fixture({ norms, segments }))).toMatchObject({
      normId: 'norm',
      overdueYears: 0,
    })
    expect(assessment(fixture({ norms: [norm({ validTo: null })] })).status).toBe('due')
  })
  it('делит участки по всем границам характеристик, не захватывает разрывы', () => {
    const base = fixture()
    const line = base.lines[0]!
    const result = report(
      fixture({
        lines: [{ ...line, extents: [span, { from: { km: 703, m: 0 }, to: { km: 704, m: 0 } }] }],
        segments: [
          ...base.segments.filter((s) => s.form !== 'rails'),
          {
            ...segment,
            to: { km: 700, m: 900 },
            form: 'rails',
            values: { railType: 'Р65', laidDate: '2010-01-01', tonnageAfter: 10 },
          },
          {
            ...segment,
            from: { km: 700, m: 900 },
            form: 'rails',
            values: { railType: 'Р65', laidDate: '2025-01-01', tonnageAfter: 10 },
          },
          {
            ...segment,
            from: { km: 700, m: 1100 },
            form: 'sleepers',
            values: { sleeperType: 'Дерево' },
          },
        ],
      }),
    )
    expect(result.rows.map((r) => r.location.kind === 'line' && r.location.lengthM)).toEqual([
      900, 200, 150, 1000,
    ])
    expect(result.rows.map((r) => r.lastRepairYear)).toEqual([2010, 2025, 2025, null])
    expect(result.rows[2]!.assessments[0]!.status).toBe('incomplete')
  })
  it('показывает пропуски и пересечения исходных характеристик', () => {
    expect(assessment(fixture({ segments: [] })).status).toBe('incomplete')
    const segments = [...fixture().segments, ...rail(2000, 999)]
    expect(assessment(fixture({ segments })).reason).toContain('Перекрываются')
    expect(assessment(fixture({ segments, norms: [] })).status).toBe('no-norm')
  })
  it('для станции использует экспликацию и не выдумывает тоннаж', () => {
    const result = report(
      fixture({
        lines: [],
        tracks: [
          {
            ...period,
            station: 'Учебная',
            number: 'I',
            lastRepairYear: 2010,
            classCode: '3',
            railType: 'Р65',
            sleeperType: 'ЖБ',
          },
        ],
      }),
    )
    expect(result.rows[0]).toMatchObject({
      location: { kind: 'station', track: 'I' },
      lastRepairYear: 2010,
      tonnageAfter: null,
    })
    expect(result.rows[0]!.assessments[0]).toMatchObject({
      status: 'due',
      overdueYears: 7,
      overdueMillionTons: null,
    })
  })
  it('не включает недействующие станционные пути', () => {
    expect(
      report(
        fixture({
          lines: [],
          tracks: [
            {
              ...period,
              validTo: '2026-12-31',
              station: 'Учебная',
              number: 'I',
              lastRepairYear: 2010,
              classCode: null,
              railType: null,
              sleeperType: null,
            },
          ],
        }),
      ).rows,
    ).toEqual([])
  })
  it.each([0, -1, NaN, Infinity])('отклоняет некорректную норму %s', (years) => {
    expect(calculateRepairReport(fixture({ norms: [norm({ years })] })).ok).toBe(false)
  })
  it('отклоняет норму без порогов', () => {
    expect(
      calculateRepairReport(fixture({ norms: [norm({ years: null, millionTons: null })] })).ok,
    ).toBe(false)
  })
  it('возвращает предметную ошибку для недопустимой геометрии', () => {
    const line = fixture().lines[0]!
    for (const lines of [
      [{ ...line, kmLengths: [[700, 800] as const] }],
      [{ ...line, extents: [{ from: span.to, to: span.from }] }],
      [{ ...line, extents: [{ from: span.from, to: { km: 700, m: 1300 } }] }],
    ])
      expect(calculateRepairReport(fixture({ lines })).ok).toBe(false)
  })
  it('не меняет исходные данные при повторном расчёте', () => {
    const input = fixture()
    const copy = structuredClone(input)
    expect(report(input)).toEqual(report(input))
    expect(input).toEqual(copy)
  })
  it('не объявляет потребность по тоннажу при будущей дате укладки', () => {
    const result = report(fixture({ segments: rail(2030, 200) }))
    expect(result.rows[0]!.tonnageAfter).toBe(null)
    expect(result.rows[0]!.assessments[0]).toMatchObject({
      status: 'incomplete',
      dueYear: null,
      overdueMillionTons: null,
      yearIsUpperBound: false,
    })
  })
  it('сохраняет вид ремонта, чьи нормы не действуют на дату редакции', () => {
    const result = report(
      fixture({
        norms: [
          norm(),
          norm({
            id: 'expired',
            workCode: 'old',
            workName: 'Устаревший ремонт',
            validTo: '2026-12-31',
          }),
          norm({
            id: 'future',
            workCode: 'new',
            workName: 'Будущий ремонт',
            validFrom: '2027-01-02',
          }),
        ],
      }),
    )
    const assessments = result.rows[0]!.assessments
    expect(assessments.map((a) => [a.workCode, a.status])).toEqual([
      ['repair', 'due'],
      ['old', 'no-norm'],
      ['new', 'no-norm'],
    ])
    expect(assessments[1]).toMatchObject({ workName: 'Устаревший ремонт', normId: null })
    expect(assessments[1]!.reason).toContain('дату редакции')
  })
  it('отличает неизвестную характеристику от отсутствия подходящей нормы', () => {
    expect(
      assessment(fixture({ segments: rail(2010, 10), norms: [norm({ trackClass: '3' })] })).status,
    ).toBe('incomplete')
  })
})
