import type { PrototypeTransfer, TransferProblem } from '@eow/import/application'
import {
  chainage,
  compareChainage,
  describePlaceSpecError,
  err,
  ok,
  KmLengths,
  mergeSpans,
  parsePlaceSpec,
  placeLength,
  spanContains,
  spansOverlap,
  type Chainage,
  type IdGenerator,
  type TrackSpan,
  type Result,
} from '@eow/shared/kernel'
import { prototypeSchema } from './prototype-schema'

export interface PrototypeImportOptions {
  readonly edition: PrototypeTransfer['basis']['edition']
  readonly ids: IdGenerator
  /** Для старого JSON без каталога: каталог из самого прототипа или выбранной редакции. */
  readonly catalog?: unknown
}

const lengths = KmLengths.standard()
const groups = { cur: 'current', cap: 'capital', other: 'other' } as const

/** Отдельный адаптер старого формата. Исходник не исполняется и не нормализуется кодом прототипа. */
export function importPrototype(
  source: string,
  options: PrototypeImportOptions,
): Result<PrototypeTransfer, readonly TransferProblem[]> {
  let raw: unknown
  try {
    raw = JSON.parse(source)
  } catch {
    return err([{ path: '', message: 'Проект прототипа не является JSON' }])
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return err([{ path: '', message: 'Ожидался объект проекта прототипа' }])
  const input = {
    ...raw,
    ...(!('catalog' in raw) && options.catalog !== undefined ? { catalog: options.catalog } : {}),
  }
  const checked = prototypeSchema.safeParse(input)
  if (!checked.success)
    return err(
      checked.error.issues.map((i) => ({
        path: i.path.join('.'),
        message:
          i.path[0] === 'catalog'
            ? 'Нужен полный каталог видов работ из прототипа или редакции паспорта'
            : `Неверное поле проекта: ${i.message}`,
      })),
    )
  const p = checked.data
  const errors: TransferProblem[] = []
  const report: TransferProblem[] = []
  const warn = (path: string, message: string) => {
    report.push({ path, message })
  }
  if (!('catalog' in raw))
    warn('catalog', 'Каталог передан отдельно: исходный файл его не содержит')

  function point(value: number, path: string): Chainage | undefined {
    let km = Math.floor(value)
    const fractionMeters = (value - km) * 1000
    let m = Math.round(fractionMeters)
    if (Math.abs(fractionMeters - m) > 1e-4) {
      errors.push({ path, message: 'Координата прототипа содержит доли метра' })
      return undefined
    }
    if (m === 1000) {
      km++
      m = 0
    }
    const result = chainage(km, m, lengths)
    if (!result.ok) {
      errors.push({ path, message: 'Неверная координата прототипа' })
      return undefined
    }
    return result.value
  }
  function span(
    line: string,
    fromValue: number,
    toValue: number,
    path: string,
  ): TrackSpan | undefined {
    const from = point(fromValue, `${path}.from`),
      to = point(toValue, `${path}.to`)
    if (!from || !to) return undefined
    if (compareChainage(from, to) >= 0) {
      errors.push({ path, message: 'Конец участка должен быть дальше начала' })
      return undefined
    }
    return { line, from, to }
  }
  const lines: PrototypeTransfer['basis']['lines'][number][] = []
  for (const [i, line] of p.lines.entries()) {
    const path = `lines.${i}`
    const extent = span(line.id, line.from, line.to, path)
    if (!extent) continue
    const gaps = line.gaps.flatMap((gap, n) => {
      const s = span(line.id, gap.from, gap.to, `${path}.gaps.${n}`)
      return s ? [s] : []
    })
    let remaining = [extent]
    for (const gap of mergeSpans(gaps)) {
      if (!spanContains(extent, gap))
        errors.push({ path: `${path}.gaps`, message: 'Разрыв выходит за протяжение направления' })
      remaining = remaining.flatMap((s) =>
        !spansOverlap(s, gap)
          ? [s]
          : [
              ...(compareChainage(s.from, gap.from) < 0 ? [{ ...s, to: gap.from }] : []),
              ...(compareChainage(gap.to, s.to) < 0 ? [{ ...s, from: gap.to }] : []),
            ],
      )
    }
    lines.push({ id: line.id, name: line.name, extent: remaining, kmLengths: lengths })
    if (line.gaps.length)
      warn(
        `${path}.gaps`,
        'Разрывы исключены из протяжения; их подписи сохранены в снимке прототипа',
      )
    for (const key of Object.keys(line))
      if (!['id', 'name', 'from', 'to', 'gaps'].includes(key))
        warn(
          `${path}.${key}`,
          'Сохранено в снимке прототипа; модель характеристики или оформления ещё не перенесена',
        )
  }
  const pds: PrototypeTransfer['basis']['pds'][number][] = p.pd.map((pd, i) => {
    const segments = pd.segs.flatMap((s, n) => {
      const result = span(s.line, s.from, s.to, `pd.${i}.segs.${n}`)
      return result ? [result] : []
    })
    if (segments.some((s, n) => segments.slice(n + 1).some((other) => spansOverlap(s, other))))
      warn(`pd.${i}.segs`, 'Перекрывающиеся границы одного ПД объединены по их общему покрытию')
    for (const key of Object.keys(pd))
      if (!['id', 'pchu', 'segs'].includes(key))
        warn(`pd.${i}.${key}`, 'Сохранено в снимке прототипа')
    return { id: pd.id, name: pd.id, pchu: pd.pchu, segments: mergeSpans(segments) }
  })
  const stations = p.stations.map((s, i) => {
    const tracks = s.layout?.tracks ?? []
    const ids = new Set(tracks.map((t) => t.id))
    if (ids.size !== tracks.length)
      errors.push({
        path: `stations.${i}.layout.tracks`,
        message: 'Идентификатор пути станции повторяется',
      })
    const numbers = tracks.filter((t) => t.num).map((t) => t.num)
    if (new Set(numbers).size !== numbers.length)
      errors.push({
        path: `stations.${i}.layout.tracks`,
        message: 'Номер пути станции повторяется; нельзя однозначно перенести привязки работ',
      })
    for (const t of tracks)
      for (const side of [t.L, t.R])
        if (side?.to && !ids.has(side.to))
          errors.push({
            path: `stations.${i}.layout.tracks`,
            message: 'Примыкание ссылается на неизвестный путь',
          })
    const switches = [
      ...new Set(
        tracks.flatMap((t) =>
          t.kind === 'главный' ? [] : [t.L, t.R].flatMap((c) => (c?.to && c.sw ? [c.sw] : [])),
        ),
      ),
    ]
    let pd = s.pd || undefined
    if (!pd && s.pos[0]?.axis !== null && s.pos[0]?.axis !== undefined) {
      const pos = s.pos[0],
        at = point(s.pos[0].axis, `stations.${i}.pos.0.axis`)
      if (at)
        pd = pds.find((d) =>
          d.segments.some(
            (g) =>
              g.line === pos.line &&
              compareChainage(g.from, at) <= 0 &&
              compareChainage(at, g.to) <= 0,
          ),
        )?.id
      if (pd) warn(`stations.${i}.pd`, 'Привязка к ПД восстановлена по первой оси, как в прототипе')
    }
    for (const key of Object.keys(s))
      if (!['id', 'name', 'pd'].includes(key))
        warn(
          `stations.${i}.${key}`,
          key === 'layout'
            ? 'Раскладка перенесена в срез станции; исходные поля также сохранены в снимке прототипа'
            : 'Сохранено в снимке прототипа',
        )
    return {
      id: s.id,
      name: s.name,
      tracks: tracks.map((t) => t.num || t.id),
      switches,
      pd,
      ...(s.layout
        ? {
            legacyLayout: {
              tracks: s.layout.tracks.map((t) => ({
                id: t.id,
                number: t.num,
                purpose: t.kind ?? '',
                label: t.label,
                row: t.row ?? 0,
                x1: t.x1,
                x2: t.x2,
                fullMeters: t.full,
                usefulMeters: t.use,
                capacity: t.cap,
                left: { switchNumber: t.L?.sw ?? '', parent: t.L?.to ?? null },
                right: { switchNumber: t.R?.sw ?? '', parent: t.R?.to ?? null },
              })),
              objects: s.layout.objects.map((o) => ({
                id: o.id,
                type: o.type,
                text: o.text,
                x: o.x,
                y: o.y,
                width: o.w,
                height: o.h,
              })),
            },
          }
        : {}),
    }
  })
  const workKinds = p.catalog.map((c) => ({
    code: c.id,
    name: c.name || c.code || c.id,
    unit: c.unit,
    group: groups[c.group],
    inPlanTable: c.inTable,
    ...(c.alsoIn ? { includedIn: c.alsoIn } : {}),
  }))
  for (const [i, kind] of p.catalog.entries())
    for (const key of Object.keys(kind))
      if (!['id', 'name', 'unit', 'group', 'inTable', 'alsoIn'].includes(key))
        warn(
          `catalog.${i}.${key}`,
          'Сохранено в снимке прототипа; внутренний идентификатор вида остаётся ключом плана',
        )
  const works: PrototypeTransfer['works'][number][] = []
  for (const [i, w] of p.works.entries()) {
    const path = `works.${i}`
    let place: PrototypeTransfer['works'][number]['place'] | undefined
    const station = w.station || undefined
    let object: { kind: 'track' | 'switch'; number: string } | undefined
    if (w.target) {
      const s = p.stations.find((candidate) => candidate.id === station)
      const number =
        w.target.type === 'track' ? s?.layout?.tracks.find((t) => t.id === w.target?.id) : undefined
      if (w.target.type === 'track' && !number)
        errors.push({
          path: `${path}.target`,
          message: 'Не найден путь, к которому привязана работа',
        })
      object = { kind: w.target.type, number: number ? number.num || number.id : w.target.id }
      if (number && !number.num)
        warn(`${path}.target`, 'У ненумерованного пути сохранён исходный идентификатор')
      if (!station)
        errors.push({
          path: `${path}.target`,
          message: 'Привязка к пути или стрелке требует станции',
        })
    }
    if (w.rangesText.trim()) {
      const text = w.rangesText
        .replace(/\b(\d+)\s*\/\s*(\d+)\b/g, '$1 км пк $2')
        .replace(/\d+[.,]\d+/g, (value) => {
          const pos = point(Number(value.replace(',', '.')), `${path}.rangesText`)
          return pos ? `${pos.km}+${pos.m}` : value
        })
      const parsed = parsePlaceSpec(text, w.line || '', lengths)
      if (!parsed.ok)
        errors.push(
          ...parsed.error.map((e) => ({
            path: `${path}.rangesText`,
            message: describePlaceSpecError(e),
          })),
        )
      else
        place = {
          kind: 'line',
          spec: parsed.value,
          ...(station ? { station } : {}),
          ...(object ? { object } : {}),
        }
    } else if (station) place = { kind: 'station', station, ...(object ? { object } : {}) }
    else errors.push({ path, message: 'У работы нет ни места на направлении, ни станции' })
    let volume = w.qty ?? undefined
    const kind = workKinds.find((k) => k.code === w.kind)
    if (volume === undefined && place?.kind === 'station' && kind?.unit.startsWith('км')) {
      volume = 0
      warn(
        `${path}.qty`,
        'Автоматический объём станционной работы без участка в прототипе равен нулю; значение сохранено явно',
      )
    }
    if (
      volume === undefined &&
      place?.kind === 'line' &&
      kind &&
      kind.unit.startsWith('км') &&
      kind.unit.trim() !== 'км'
    ) {
      volume = placeLength(place.spec, lengths) / 1000
      warn(`${path}.qty`, 'Автоматический объём прототипа сохранён явно: единица не равна «км»')
    }
    let id = w.id
    if (!id) {
      id = options.ids.next()
      warn(`${path}.id`, 'Отсутствующий идентификатор работы выдан генератором')
    }
    if (place) works.push({ id, kind: w.kind, place, volume, note: w.note, callout: w.callout })
    for (const key of Object.keys(w))
      if (
        ![
          'id',
          'kind',
          'line',
          'station',
          'rangesText',
          'qty',
          'note',
          'callout',
          'target',
        ].includes(key)
      )
        warn(`${path}.${key}`, 'Сохранено в снимке прототипа')
  }
  const manual: PrototypeTransfer['manual'][number][] = []
  for (const [key, table] of Object.entries(p.tables)) {
    const area =
      key === 'dist'
        ? ({ kind: 'district' } as const)
        : p.pd.some((pd) => pd.id === key)
          ? ({ kind: 'pd', pd: key } as const)
          : ({ kind: 'station', station: key } as const)
    for (const [sourceField, field] of [
      ['override', 'overrides'],
      ['need', 'needs'],
    ] as const)
      for (const [code, value] of Object.entries(table[sourceField]))
        if (value !== null) manual.push({ area, field, code, value })
    for (const field of Object.keys(table))
      if (!['override', 'need'].includes(field))
        warn(
          `tables.${key}.${field}`,
          'Сохранено в снимке прототипа; таблица пока не редактируется новой моделью',
        )
  }
  for (const key of Object.keys(p))
    if (!['v', 'meta', 'lines', 'pd', 'stations', 'works', 'catalog', 'tables'].includes(key))
      warn(key, 'Сохранено в снимке прототипа')
  for (const key of Object.keys(p.meta))
    if (!['year', 'approveTitle', 'approveName', 'approveDateYear'].includes(key))
      warn(`meta.${key}`, 'Сохранено в снимке прототипа')
  if (errors.length) return err(errors)
  return ok({
    year: p.meta.year,
    approval: {
      title: p.meta.approveTitle,
      name: p.meta.approveName,
      year: p.meta.approveDateYear ?? p.meta.year - 1,
    },
    basis: { edition: options.edition, lines, pds, stations, workKinds },
    works,
    manual,
    prototype: { source, report },
  })
}
