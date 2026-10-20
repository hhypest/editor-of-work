import { manualOf, type AnnualPlan } from './annual-plan'
import { shareIn, type PlanArea } from './distribution'
import type { WorkGroup } from './plan-basis'
import { workVolume } from './planned-work'

/** Строка таблицы плана для области. */
export interface PlanRow {
  readonly code: string
  readonly name: string
  readonly unit: string
  /** Сумма объёмов работ области с учётом долей и «входит в». */
  readonly computed: number
  /** Значение в таблице: ручное, если введено, иначе рассчитанное. */
  readonly value: number
  /** Значение введено вручную — на листе оно помечается. */
  readonly manual: boolean
  /** Потребность, если введена. */
  readonly need: number | undefined
}

/** Суммы считаются в числах с плавающей точкой; лишние знаки после 6-го — шум округления. */
function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6
}

/**
 * Объёмы работ области по кодам видов. Объём вида «входит в» добавляется и в свою строку,
 * и в строку, в которую входит (ППРК → ППР) — на один уровень, как в прототипе.
 */
export function areaVolumes(plan: AnnualPlan, area: PlanArea): ReadonlyMap<string, number> {
  const totals = new Map<string, number>()
  const add = (code: string, amount: number): void => {
    totals.set(code, (totals.get(code) ?? 0) + amount)
  }
  for (const work of plan.works) {
    const share = shareIn(work, area, plan.basis)
    if (share === 0) continue
    const amount = workVolume(work, plan.basis).amount * share
    add(work.kind, amount)
    const includedIn = plan.basis.workKinds.get(work.kind)?.includedIn
    if (includedIn !== undefined) add(includedIn, amount)
  }
  return new Map([...totals].map(([code, amount]) => [code, round6(amount)]))
}

/**
 * Таблица плана области для группы видов (текущее содержание, капитальные работы).
 * Строки — виды группы, отмеченные для таблицы, в порядке нормативов редакции.
 */
export function planRows(plan: AnnualPlan, area: PlanArea, group: WorkGroup): readonly PlanRow[] {
  const volumes = areaVolumes(plan, area)
  const manual = manualOf(plan, area)
  const rows: PlanRow[] = []
  for (const kind of plan.basis.workKinds.values()) {
    if (kind.group !== group || !kind.inPlanTable) continue
    const computed = volumes.get(kind.code) ?? 0
    const override = manual.overrides.get(kind.code)
    rows.push({
      code: kind.code,
      name: kind.name,
      unit: kind.unit,
      computed,
      value: override ?? computed,
      manual: override !== undefined,
      need: manual.needs.get(kind.code),
    })
  }
  return rows
}
