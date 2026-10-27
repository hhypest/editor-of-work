import {
  commit,
  describePlaceSpecError,
  err,
  formatPlaceSpec,
  ok,
  parsePlaceSpec,
  placeLength,
  type IdGenerator,
  type Result,
} from '@eow/shared/kernel'
import {
  areaExists,
  areaKey,
  describePlanError,
  planRows,
  setApproval,
  setManualValue,
  setPlanIndicators,
  indicatorsOf,
  expectedAreaAllowed,
  expectedIndicatorsOf,
  setExpectedIndicators,
  pdScaleOf,
  setPdScale,
  setPdHiddenTables,
  hiddenPdTablesOf,
  PD_TABLE_KINDS,
  shareIn,
  workId,
  workVolume,
  type PlanArea,
} from '@eow/planning/domain'
import {
  addWorkToPlan,
  editWork,
  removeWorkFromPlan,
  setPlanValue,
  canRedoPlan,
  canUndoPlan,
  undoPlan,
  redoPlan,
  type PlanSession,
  type WorkCommand,
  type WorkCommandError,
} from './plan-session'
import type { EditorDraft, EditorChange, EditorIssue, EditorView, PlaceHint } from './editor-model'

const issue = (message: string, field: EditorIssue['field'] = 'form'): EditorIssue => ({
  message,
  field,
  start: null,
  end: null,
})
export function editorNumber(text: string): Result<number | undefined, readonly EditorIssue[]> {
  const normalized = text.trim().replace(',', '.')
  if (!normalized) return ok(undefined)
  const number = Number(normalized)
  return /^\d+(?:\.\d+)?$/u.test(normalized) && Number.isFinite(number)
    ? ok(number)
    : err([
        issue(
          'Введите неотрицательное число; десятичная часть — через запятую или точку.',
          'volume',
        ),
      ])
}
/** Число со знаком для таблиц показателей; пустая строка — «не задано» (null), ошибка — undefined. */
function signedNumber(text: string): number | null | undefined {
  const normalized = text.trim().replace(',', '.')
  if (!normalized) return null
  const value = Number(normalized)
  return /^[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/iu.test(normalized) && Number.isFinite(value)
    ? value
    : undefined
}
export function editorArea(key: string): PlanArea | undefined {
  if (key === 'district') return { kind: 'district' }
  if (key.startsWith('pd:')) return { kind: 'pd', pd: key.slice(3) }
  if (key.startsWith('station:')) return { kind: 'station', station: key.slice(8) }
  return undefined
}
function command(draft: EditorDraft): Result<WorkCommand, readonly EditorIssue[]> {
  const volume = editorNumber(draft.volume)
  if (!volume.ok) return volume
  const object =
    draft.objectKind === 'none'
      ? {}
      : { object: { kind: draft.objectKind, number: draft.objectNumber } }
  return ok({
    kind: draft.kind,
    volume: volume.value,
    note: draft.note,
    callout: draft.callout,
    place:
      draft.mode === 'station'
        ? { kind: 'station', station: draft.station, ...object }
        : {
            kind: 'line',
            line: draft.line,
            text: draft.text,
            ...(draft.station ? { station: draft.station } : {}),
            ...object,
          },
  })
}
function errors(error: WorkCommandError): readonly EditorIssue[] {
  return error.kind === 'place'
    ? error.errors.map((e) => ({
        field: 'place',
        message: describePlaceSpecError(e),
        start: e.at.start,
        end: e.at.end,
      }))
    : error.errors.map((e) =>
        issue(
          describePlanError(e),
          e.kind === 'outside-line' || e.kind === 'empty-place' || e.kind === 'unknown-line'
            ? 'place'
            : e.kind === 'invalid-volume' || e.kind === 'volume-required'
              ? 'volume'
              : 'form',
        ),
      )
}
export function inspectEditorPlace(session: PlanSession, lineId: string, text: string): PlaceHint {
  const line = session.present.basis.lines.get(lineId)
  if (!line)
    return {
      normalized: null,
      meters: null,
      issues: [issue('Выберите направление из среза плана.', 'place')],
    }
  const parsed = parsePlaceSpec(text, lineId, line.kmLengths)
  return parsed.ok
    ? {
        normalized: formatPlaceSpec(parsed.value),
        meters: placeLength(parsed.value, line.kmLengths),
        issues: [],
      }
    : { normalized: null, meters: null, issues: errors({ kind: 'place', errors: parsed.error }) }
}
export function changeEditor(
  session: PlanSession,
  change: EditorChange,
  areaId: string,
  ids: IdGenerator,
): Result<PlanSession, readonly EditorIssue[]> {
  if (change.kind === 'undo') return ok(undoPlan(session))
  if (change.kind === 'redo') return ok(redoPlan(session))
  if (change.kind === 'pdTables') {
    const area = editorArea(areaId)
    if (area?.kind !== 'pd') return err([issue('Выберите ПД для настройки таблиц.')])
    const changed = setPdHiddenTables(session.present, area.pd, change.hidden)
    return changed.ok
      ? ok(commit(session, changed.value))
      : err(changed.error.map((e) => issue(describePlanError(e))))
  }
  if (change.kind === 'pdScale') {
    const area = editorArea(areaId)
    if (area?.kind !== 'pd') return err([issue('Выберите ПД для настройки масштаба.')])
    const changed = setPdScale(session.present, area.pd, change.scale)
    return changed.ok
      ? ok(commit(session, changed.value))
      : err(changed.error.map((e) => issue(describePlanError(e))))
  }
  if (change.kind === 'indicatorRows') {
    const area = editorArea(areaId)
    if (!area || !areaExists(area, session.present.basis))
      return err([issue('Выберите область из среза плана.')])
    const rows = []
    for (const [index, row] of change.rows.entries()) {
      const normalized = row.value.trim().replace(',', '.')
      const value = Number(normalized)
      if (!/^[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/iu.test(normalized) || !Number.isFinite(value))
        return err([
          issue(
            `Показатель ${index + 1}: введите число; десятичная часть — через запятую или точку.`,
          ),
        ])
      rows.push({ ...row, id: row.id ?? ids.next(), value })
    }
    const changed = setPlanIndicators(session.present, area, rows)
    return changed.ok
      ? ok(commit(session, changed.value))
      : err(changed.error.map((e) => issue(describePlanError(e))))
  }
  if (change.kind === 'expectedRows') {
    const area = editorArea(areaId)
    if (!area || !areaExists(area, session.present.basis))
      return err([issue('Выберите область из среза плана.')])
    const rows = []
    for (const [index, row] of change.rows.entries()) {
      const value = signedNumber(row.value)
      if (value === undefined)
        return err([
          issue(
            `Ожидаемый показатель ${index + 1}: введите число или оставьте значение пустым; десятичная часть — через запятую или точку.`,
          ),
        ])
      rows.push({ ...row, id: row.id ?? ids.next(), value })
    }
    const changed = setExpectedIndicators(session.present, area, rows)
    return changed.ok
      ? ok(commit(session, changed.value))
      : err(changed.error.map((e) => issue(describePlanError(e))))
  }
  if (change.kind === 'approval') {
    const result = setApproval(session.present, {
      title: change.title,
      name: change.name,
      year: change.year,
    })
    return result.ok
      ? ok(commit(session, result.value))
      : err(result.error.map((e) => issue(describePlanError(e))))
  }
  if (change.kind === 'manualRows') {
    const area = editorArea(areaId)
    if (!area || !areaExists(area, session.present.basis))
      return err([issue('Выберите область из среза плана.')])
    let plan = session.present
    for (const row of change.rows) {
      for (const [field, text] of [
        ['overrides', row.plan],
        ['needs', row.need],
      ] as const) {
        const value = editorNumber(text)
        if (!value.ok)
          return err(
            value.error.map((e) => ({ ...e, field: 'form', message: `${row.code}: ${e.message}` })),
          )
        const changed = setManualValue(plan, area, field, row.code, value.value)
        if (!changed.ok) return err(changed.error.map((e) => issue(describePlanError(e))))
        plan = changed.value
      }
    }
    return ok(commit(session, plan))
  }
  if (change.kind === 'manual') {
    const area = editorArea(areaId),
      value = editorNumber(change.value)
    if (!area || !areaExists(area, session.present.basis))
      return err([issue('Выберите область из среза плана.')])
    if (!value.ok) return value
    const result = setPlanValue(session, area, change.field, change.code, value.value)
    return result.ok ? result : err(errors(result.error))
  }
  if (change.kind === 'remove') {
    const result = removeWorkFromPlan(session, workId(change.id))
    return result.ok ? result : err(errors(result.error))
  }
  const input = command(change.draft)
  if (!input.ok) return input
  if (change.kind === 'add') {
    const result = addWorkToPlan(session, input.value, ids)
    return result.ok ? ok(result.value.session) : err(errors(result.error))
  }
  const result = editWork(session, workId(change.id), input.value)
  return result.ok ? result : err(errors(result.error))
}

export function editorView(
  session: PlanSession,
  key: string,
): Result<EditorView, readonly EditorIssue[]> {
  const plan = session.present,
    area = editorArea(key)
  if (!area || !areaExists(area, plan.basis))
    return err([issue('Выберите область из среза плана.')])
  const boundaries = [...plan.basis.pds.values()].reduce((n, p) => n + p.segments.length, 0)
  const items = plan.works.reduce(
    (n, w) => n + (w.place.kind === 'line' ? w.place.spec.items.length : 1),
    0,
  )
  if (plan.works.length > 10000 || items * Math.max(boundaries, 1) * 5 > 10_000_000)
    return err([issue('План слишком велик для редактора. Уменьшите число объектов.')])
  return ok({
    year: plan.year,
    edition: { ...plan.basis.edition },
    approval: { ...plan.approval },
    canUndo: canUndoPlan(session),
    canRedo: canRedoPlan(session),
    area: key,
    pdScale: area.kind === 'pd' ? pdScaleOf(plan, area.pd) : null,
    pdTables:
      area.kind === 'pd'
        ? PD_TABLE_KINDS.map((key) => ({
            key,
            label: {
              current: 'План текущего содержания',
              capital: 'Капитальные работы',
              other: 'Прочие работы',
              summary: 'Сводные показатели ПД',
              works: 'Ведомость работ ПД',
              indicators: 'Ручные показатели ПД',
              expected: 'Ожидаемые показатели',
            }[key],
            visible: !hiddenPdTablesOf(plan, area.pd).includes(key),
          }))
        : [],
    indicators: indicatorsOf(plan, area).map((row) => ({ ...row })),
    expected: expectedAreaAllowed(area)
      ? expectedIndicatorsOf(plan, area).map((row) => ({ ...row }))
      : null,
    lines: [...plan.basis.lines.values()].map((l) => ({ id: l.id, name: l.name })),
    stations: [...plan.basis.stations.values()].map((s) => ({
      id: s.id,
      name: s.name,
      tracks: s.tracks,
      switches: s.switches,
    })),
    kinds: [...plan.basis.workKinds.values()].map((k) => ({
      code: k.code,
      name: k.name,
      unit: k.unit,
    })),
    areas: [
      { key: 'district', label: 'Дистанция' },
      ...[...plan.basis.pds.values()].map((p) => ({
        key: areaKey({ kind: 'pd', pd: p.id }),
        label: p.name,
      })),
      ...[...plan.basis.stations.values()].map((s) => ({
        key: areaKey({ kind: 'station', station: s.id }),
        label: `Станция ${s.name}`,
      })),
    ],
    works: plan.works
      .filter((w) => shareIn(w, area, plan.basis) > 0)
      .map((w) => {
        const place = w.place,
          volume = workVolume(w, plan.basis)
        const station =
          place.station === undefined
            ? ''
            : (plan.basis.stations.get(place.station)?.name ?? place.station)
        const text = place.kind === 'line' ? formatPlaceSpec(place.spec) : station
        const object = place.object
          ? `${place.object.kind === 'track' ? 'путь' : 'стрелка'} № ${place.object.number}`
          : ''
        return {
          id: w.id,
          name: plan.basis.workKinds.get(w.kind)?.name ?? w.kind,
          place: [text, place.kind === 'line' ? station : '', object].filter(Boolean).join(' · '),
          volume: volume.amount,
          unit: volume.unit,
          draft: {
            kind: w.kind,
            mode: place.kind,
            line: place.kind === 'line' ? place.spec.line : '',
            text: place.kind === 'line' ? formatPlaceSpec(place.spec) : '',
            station: place.station ?? '',
            objectKind: place.object?.kind ?? 'none',
            objectNumber: place.object?.number ?? '',
            volume: w.volume === undefined ? '' : String(w.volume).replace('.', ','),
            note: w.note,
            callout: w.callout,
          },
        }
      }),
    tables: (
      [
        ['current', 'Текущее содержание'],
        ['capital', 'Капитальные работы'],
        ['other', 'Прочие работы'],
      ] as const
    ).map(([group, title]) => ({
      title,
      rows: planRows(plan, area, group).map((r) => ({ ...r, need: r.need ?? null })),
    })),
    importReport: plan.prototype?.report ?? [],
  })
}
