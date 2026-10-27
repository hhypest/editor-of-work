import type { PlanSheetData } from '@eow/planning/sheet-api'
import { distance, formatPlaceSpec, err, ok, type Result } from '@eow/shared/kernel'
import {
  datedChange,
  datedIndicatorsOf,
  expectedIndicatorsOf,
  indicatorsOf,
  itemsOf,
  printedItems,
  ITEM_TABLE_KINDS,
  ITEM_TABLE_TITLES,
  hiddenPdTablesOf,
  type PdTableKind,
  pdScaleOf,
  planRows,
  shareIn,
  workVolume,
  type AnnualPlan,
} from '@eow/planning/domain'

type PdSheetTable = PlanSheetData['pds'][number]['tables'][number]
const number = (value: number): string => String(Math.round(value * 1e6) / 1e6).replace('.', ',')
/**
 * Округление по десятичной записи: 1,255 → 1,26, а не 1,25 из-за двоичной погрешности
 * умножения. Большое конечное число не превращается в Infinity (ADR-0026).
 */
const rounded = (value: number, digits: number): string => {
  if (Math.abs(value) >= 1e15) return String(value).replace('.', ',')
  const [mantissa, exponent] = value.toExponential().split('e')
  const shifted = Math.round(Number(`${mantissa}e${Number(exponent) + digits}`))
  return String(Number(`${shifted}e-${digits}`) || 0).replace('.', ',')
}

export function planSheetData(
  plan: AnnualPlan,
  selectedPd?: string,
): Result<PlanSheetData, { readonly message: string }> {
  if (selectedPd !== undefined && !plan.basis.pds.has(selectedPd))
    return err({ message: 'ПД отсутствует в срезе плана.' })
  const boundaries = [...plan.basis.pds.values()].reduce((n, p) => n + p.segments.length, 0)
  const items = plan.works.reduce(
    (n, w) => n + (w.place.kind === 'line' ? w.place.spec.items.length : 1),
    0,
  )
  const cost =
    (selectedPd === undefined ? plan.basis.pds.size : 1) *
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
      // Соседние границы нужны геометрии, их работы и таблицы здесь не рассчитываются.
      if (selectedPd !== undefined && pd.id !== selectedPd)
        return {
          id: pd.id,
          name: pd.name,
          pchu: pd.pchu,
          scale: pdScaleOf(plan, pd.id),
          segments: pd.segments,
          works: [],
          tables: [],
        }
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
      const tables: PdSheetTable[] = []
      const hidden = hiddenPdTablesOf(plan, pd.id)
      const append = (kind: PdTableKind, table: PdSheetTable): void => {
        if (!hidden.includes(kind)) tables.push(table)
      }
      // «Показатели» на 01.01 идут первыми, как в листах прототипа; изменение и процент
      // считаются при выводе и не хранятся (ADR-0038).
      const dated = datedIndicatorsOf(plan, area)
      if (dated.length) {
        const value = (v: number | null) => (v === null ? '' : rounded(v, 3))
        const signed = (text: string, v: number) => (v > 0 && text !== '0' ? `+${text}` : text)
        append('dated', {
          title: 'Показатели',
          columns: [
            { title: 'Показатель', width: 200 },
            { title: `на 01.01.${plan.year - 1}`, width: 55 },
            { title: `на 01.01.${plan.year}`, width: 55 },
            { title: '+/−', width: 45 },
            { title: '%', width: 35 },
          ],
          rows: dated.map((row) => {
            const { delta, percent } = datedChange(row)
            return [
              row.name,
              value(row.previous),
              value(row.current),
              delta === null ? '' : signed(rounded(delta, 3), delta),
              percent === null ? '—' : rounded(percent, 1),
            ]
          }),
        })
      }
      for (const [group, title] of [
        ['current', 'План текущего содержания'],
        ['capital', 'Капитальные работы'],
        ['other', 'Прочие работы'],
      ] as const) {
        const rows = planRows(plan, area, group)
        if (rows.length)
          append(group, {
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
      append('summary', {
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
      const expected = expectedIndicatorsOf(plan, area)
      if (expected.length)
        append('expected', {
          title: `Ожидаемые показатели на 01.01.${plan.year + 1}`,
          columns: [
            { title: 'Показатель', width: 150 },
            { title: 'В т.ч.', width: 140 },
            { title: 'Ед.', width: 40 },
            { title: 'Значение', width: 60 },
          ],
          // Показатель печатается один раз на подряд идущие строки группы, как в прототипе;
          // Документы повторяют его в начале каждой страницы продолжения.
          groupColumn: 0,
          rows: expected.map((row) => [
            row.group,
            row.name,
            row.unit,
            row.value === null ? '' : String(row.value).replace('.', ','),
          ]),
        })
      // Перечни выводятся, если в области заведены строки; без объёма и стоимости — «Нет работ».
      for (const kind of ITEM_TABLE_KINDS) {
        const rows = itemsOf(plan, area, kind)
        if (rows.length)
          append(kind, {
            title: ITEM_TABLE_TITLES[kind],
            columns: [
              { title: '№', width: 15 },
              { title: 'Наименование', width: 215 },
              { title: 'Ед. изм.', width: 40 },
              { title: 'Объём', width: 55 },
              { title: 'Стоимость, тыс. руб.', width: 65 },
            ],
            rows: printedItems(rows).map((row, i) => [
              String(i + 1),
              row.name,
              row.unit,
              rounded(row.quantity, 6),
              rounded(row.cost, 2),
            ]),
          })
      }
      append('works', {
        title: 'Ведомость работ ПД',
        workIds: works.map((w) => w.id),
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
      const indicators = indicatorsOf(plan, area)
      if (indicators.length)
        append('indicators', {
          title: 'Ручные показатели ПД',
          columns: [
            { title: 'Показатель', width: 160 },
            { title: 'Ед.', width: 30 },
            { title: 'Значение', width: 60 },
            { title: 'Примечание', width: 140 },
          ],
          rows: indicators.map((row) => [
            row.name,
            row.unit,
            String(row.value).replace('.', ','),
            row.note,
          ]),
        })
      return {
        id: pd.id,
        name: pd.name,
        pchu: pd.pchu,
        scale: pdScaleOf(plan, pd.id),
        segments: pd.segments,
        works,
        tables,
      }
    }),
  })
}
