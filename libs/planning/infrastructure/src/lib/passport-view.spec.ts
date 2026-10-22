import { err, ok, spanLength } from '@eow/shared/kernel'
import { createPlanFromPassport } from '@eow/planning/application'
import { decodePlan, encodePlan } from './plan-file'
import {
  passportPlanBasis,
  passportPlanView,
  type PassportPlanData,
  type PassportPlanSource,
} from './passport-view'
const period = { validFrom: null, validTo: '9999-12-31', importFileId: 'fixture' }
function data(): PassportPlanData {
  return {
    edition: { id: 7, number: 7, label: 'Учебная редакция', date: '2027-01-01', status: 'active' },
    lines: [
      {
        id: 'line',
        name: 'Учебная',
        extents: [
          { from: { km: 20, m: 0 }, to: { km: 21, m: 0 } },
          { from: { km: 25, m: 0 }, to: { km: 26, m: 0 } },
        ],
        kmLengths: [[20, 964]],
      },
    ],
    stations: [{ id: 'station', name: 'Учебная станция', tracks: ['1'], switches: ['3'] }],
    org: {
      subdivisions: [
        {
          ...period,
          id: 'pchu',
          type: 'ПЧУ',
          code: 'ПЧУ-1',
          parentId: null,
          activity: null,
          active: true,
        },
        {
          ...period,
          id: 'pd',
          type: 'ПД',
          code: 'ПД-1',
          parentId: 'pchu',
          activity: null,
          active: true,
        },
        {
          ...period,
          id: 'old',
          type: 'ПД',
          code: 'Старый',
          parentId: null,
          activity: null,
          active: false,
        },
      ],
      boundaries: [
        {
          ...period,
          id: 'b',
          subdivisionId: 'pd',
          line: 'Учебная',
          statedLength: 964,
          from: { km: 20, m: 0 },
          to: { km: 21, m: 0 },
        },
      ],
      stations: [{ ...period, id: 's', station: 'Учебная станция', subdivisionId: 'pd' }],
      tracks: [],
    },
    manual: {
      workKinds: [
        {
          ...period,
          id: 'k',
          code: 'X',
          name: 'Учебная выправка',
          unit: 'км',
          group: 'current',
          symbol: null,
          includedIn: null,
        },
        {
          ...period,
          id: 'old-kind',
          code: 'OLD',
          name: 'Прошлая',
          unit: 'км',
          group: 'current',
          symbol: null,
          includedIn: null,
          validTo: '2026-12-31',
        },
      ],
      repairNorms: [],
      tolerances: [],
      trainPairs: [],
      kilometres: [],
    },
  }
}
const source = (): PassportPlanSource => ({
  list: async () =>
    ok([
      data().edition,
      { ...data().edition, id: 8, status: 'draft' },
      { ...data().edition, id: 6, status: 'archived' },
    ]),
  planningData: vi.fn<PassportPlanSource['planningData']>(async () => ok(data())),
})
describe('Адаптер паспорта для нового плана', () => {
  it('переносит нестандартный км, разрывы, действующие ПД/ПЧУ, станцию и каталог без подстановок', async () => {
    const port = passportPlanView(source())
    expect(await port.editions()).toMatchObject({
      ok: true,
      value: [
        { id: 7, status: 'active' },
        { id: 6, status: 'archived' },
      ],
    })
    const plan = await createPlanFromPassport(port, 7, 2027)
    if (!plan.ok) throw new Error(plan.error.message)
    expect(plan.value.basis.pds.get('pd')).toMatchObject({ name: 'ПД-1', pchu: 'ПЧУ-1' })
    const line = plan.value.basis.lines.get('line')!
    expect(spanLength(line.extent[0]!, line.kmLengths)).toBe(964)
    expect(line.extent).toHaveLength(2)
    expect([...plan.value.basis.workKinds.keys()]).toEqual(['X'])
    expect(plan.value.basis.stations.get('station')).toEqual({
      id: 'station',
      name: 'Учебная станция',
      tracks: ['1'],
      switches: ['3'],
      pd: 'pd',
    })
    const text = encodePlan(plan.value, 'test')
    if (!text.ok) throw new Error(text.error.message)
    expect(decodePlan(text.value)).toEqual(plan)
  })
  it('не принимает черновик по прямому запросу и возвращает ошибки чтения', async () => {
    expect(
      passportPlanBasis({ ...data(), edition: { ...data().edition, status: 'draft' } }),
    ).toMatchObject({ ok: false })
    const s = source()
    vi.mocked(s.planningData).mockResolvedValueOnce(err({ message: 'Нет доступа' }))
    expect(await passportPlanView(s).basis(7)).toEqual(err({ message: 'Нет доступа' }))
  })
  it.each(['ambiguous-line', 'gap', 'unknown-line', 'multiple-pds', 'duplicate-track'] as const)(
    'отклоняет %s без угадывания связи',
    (change) => {
      const d = data()
      const altered: PassportPlanData =
        change === 'ambiguous-line'
          ? { ...d, lines: [...d.lines, { ...d.lines[0]!, id: 'second' }] }
          : change === 'gap'
            ? {
                ...d,
                org: {
                  ...d.org,
                  boundaries: [{ ...d.org.boundaries[0]!, to: { km: 25, m: 500 } }],
                },
              }
            : change === 'unknown-line'
              ? { ...d, org: { ...d.org, boundaries: [{ ...d.org.boundaries[0]!, line: 'Нет' }] } }
              : change === 'duplicate-track'
                ? { ...d, stations: [{ ...d.stations[0]!, tracks: ['1', '1'] }] }
                : {
                    ...d,
                    org: {
                      ...d.org,
                      subdivisions: [
                        ...d.org.subdivisions,
                        { ...d.org.subdivisions[1]!, id: 'pd2' },
                      ],
                      stations: [
                        ...d.org.stations,
                        { ...d.org.stations[0]!, subdivisionId: 'pd2' },
                      ],
                    },
                  }
      expect(passportPlanBasis(altered).ok).toBe(false)
    },
  )
  it('фильтрует границы по периоду и явно обозначает отсутствие ПЧУ', () => {
    const d = data()
    const basis = passportPlanBasis({
      ...d,
      org: {
        ...d.org,
        subdivisions: d.org.subdivisions.map((u) => ({ ...u, parentId: null })),
        boundaries: [
          ...d.org.boundaries,
          { ...d.org.boundaries[0]!, validFrom: '2028-01-01', line: 'Будущее' },
        ],
      },
    })
    expect(basis).toMatchObject({
      ok: true,
      value: { pds: [{ pchu: 'Не указан', segments: [expect.any(Object)] }] },
    })
  })
  it('отклоняет одинаковые имена направлений, даже если на них не ссылаются границы ПД', () => {
    const d = data()
    expect(
      passportPlanBasis({
        ...d,
        lines: [...d.lines, { ...d.lines[0]!, id: 'second' }],
        org: { ...d.org, boundaries: [] },
      }),
    ).toMatchObject({ ok: false, error: { message: expect.stringContaining('неоднозначно') } })
  })
})
