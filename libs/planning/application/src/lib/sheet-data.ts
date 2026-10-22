import type { PlanSheetData } from '@eow/planning/sheet-api'
import { distance, formatPlaceSpec, err, ok, type Result } from '@eow/shared/kernel'
import { planRows, shareIn, workVolume, type AnnualPlan } from '@eow/planning/domain'

const number = (value: number): string => String(Math.round(value * 1e6) / 1e6).replace('.', ',')

export function planSheetData(
  plan: AnnualPlan,
): Result<PlanSheetData, { readonly message: string }> {
  const boundaries = [...plan.basis.pds.values()].reduce((n, p) => n + p.segments.length, 0)
  const items = plan.works.reduce(
    (n, w) => n + (w.place.kind === 'line' ? w.place.spec.items.length : 1),
    0,
  )
  const cost =
    plan.basis.pds.size *
    (5 * items * Math.max(1, boundaries) + plan.works.length + 3 * plan.basis.workKinds.size)
  if (cost > 10_000_000 || plan.works.length > 10_000 || plan.basis.pds.size > 2000)
    return err({
      message:
        'План слишком велик для предпросмотра всех ПД. Уменьшите число объектов или видов работ.',
    })
  return ok({
    year: plan.year,
    edition: { ...plan.basis.edition },
    approval: { ...plan.approval },
    lines: [...plan.basis.lines.values()].map((l) => ({
      id: l.id,
      name: l.name,
      extents: l.extent.map((s) => ({ from: s.from, to: s.to })),
      kmLengths: l.kmLengths.entries(),
    })),
    pds: [...plan.basis.pds.values()].map((pd) => {
      const area = { kind: 'pd', pd: pd.id } as const
      const works = plan.works
        .filter((w) => shareIn(w, area, plan.basis) > 0)
        .map((w) => {
          const volume = workVolume(w, plan.basis)
          const place = w.place
          const station =
            place.station === undefined ? undefined : plan.basis.stations.get(place.station)
          const object = place.object
            ? `${place.object.kind === 'track' ? 'путь' : 'стрелка'} № ${place.object.number}`
            : ''
          return {
            id: w.id,
            name: plan.basis.workKinds.get(w.kind)?.name ?? w.kind,
            place: [
              place.kind === 'line' ? formatPlaceSpec(place.spec) : '',
              station?.name ?? '',
              object,
            ]
              .filter(Boolean)
              .join(' · '),
            lineId: place.kind === 'line' ? place.spec.line : null,
            items: place.kind === 'line' ? place.spec.items : [],
            volume: Math.round(volume.amount * shareIn(w, area, plan.basis) * 1e6) / 1e6,
            unit: volume.unit,
            note: w.note,
            callout: w.callout,
          }
        })
      const tables: PlanSheetData['pds'][number]['tables'][number][] = []
      for (const [group, title] of [
        ['current', 'План текущего содержания'],
        ['capital', 'Капитальные работы'],
        ['other', 'Прочие работы'],
      ] as const) {
        const rows = planRows(plan, area, group)
        if (rows.length)
          tables.push({
            title,
            columns: [
              { title: 'Вид работ', width: 200 },
              { title: 'Ед.', width: 25 },
              { title: 'Расчёт', width: 55 },
              { title: 'План', width: 55 },
              { title: 'Потребность', width: 55 },
            ],
            rows: rows.map((r) => [
              r.name,
              r.unit,
              number(r.computed),
              number(r.value) + (r.manual ? ' *' : ''),
              r.need === undefined ? '—' : number(r.need),
            ]),
          })
      }
      tables.push({
        title: 'Показатели ПД',
        columns: [
          { title: 'Показатель', width: 280 },
          { title: 'Значение', width: 110 },
        ],
        rows: [
          [
            'Длина главных путей, м',
            number(
              pd.segments.reduce((total, s) => {
                const line = plan.basis.lines.get(s.line)
                return total + (line ? distance(s.from, s.to, line.kmLengths) : 0)
              }, 0),
            ),
          ],
          ['Работ в ПД', String(works.length)],
        ],
      })
      tables.push({
        title: 'Ведомость работ ПД',
        columns: [
          { title: '№', width: 12 },
          { title: 'Вид работ', width: 75 },
          { title: 'Место', width: 175 },
          { title: 'Объём в ПД', width: 50 },
          { title: 'Примечание', width: 78 },
        ],
        rows: works.map((w, i) => [
          String(i + 1),
          w.name,
          w.place,
          `${number(w.volume)} ${w.unit}`,
          w.note,
        ]),
      })
      return { id: pd.id, name: pd.name, pchu: pd.pchu, segments: pd.segments, works, tables }
    }),
  })
}
