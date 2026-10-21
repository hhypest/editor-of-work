import type { RepairAssessment, RepairConditions, RepairNorm, RepairPeriod } from './repair-types'

export function repairPeriodContains(period: RepairPeriod, date: string): boolean {
  return (
    (period.validFrom === null || period.validFrom <= date) &&
    (period.validTo === null || date <= period.validTo)
  )
}
const selectors = ['trackClass', 'trackGroup', 'trackCategory', 'railType', 'sleeperType'] as const

/** Конкретная норма замещает общую только при включении всех её условий. */
function moreSpecific(a: RepairNorm, b: RepairNorm): boolean {
  return (
    selectors.every((k) => b[k] === null || a[k] === b[k]) &&
    selectors.some((k) => b[k] === null && a[k] !== null)
  )
}

export function assessRepairs(
  conditions: RepairConditions,
  lastRepairYear: number | null,
  tonnageAfter: number | null,
  year: number,
  norms: readonly RepairNorm[],
  sourceProblem: string | null = null,
): readonly RepairAssessment[] {
  const codes = [...new Set(norms.map((n) => n.workCode))]
  if (!codes.length)
    return [emptyAssessment(null, null, 'no-norm', 'В редакции нет действующих норм ремонта.')]
  return codes.map((code) => {
    const group = norms.filter((n) => n.workCode === code)
    const name = group[0]?.workName ?? code
    const matches = group.filter((n) =>
      selectors.every((k) => n[k] === null || n[k] === conditions[k]),
    )
    const candidates = matches.filter((n) => !matches.some((other) => moreSpecific(other, n)))
    const norm = candidates[0]
    const uncertain = group.some(
      (n) =>
        !matches.includes(n) &&
        selectors.every((k) => n[k] === null || conditions[k] === null || n[k] === conditions[k]),
    )
    if (!norm)
      return emptyAssessment(
        code,
        name,
        uncertain ? 'incomplete' : 'no-norm',
        sourceProblem ??
          (uncertain
            ? 'Не хватает характеристик для выбора нормы.'
            : 'Нет нормы для известных класса и конструкции пути.'),
      )
    if (candidates.length !== 1)
      return emptyAssessment(
        code,
        name,
        'ambiguous-norm',
        'Подходят несколько несопоставимых норм. Уточните условия в шаблоне.',
      )
    // Нельзя выбирать общую норму, если неизвестный признак может включить более конкретную.
    if (uncertain)
      return emptyAssessment(
        code,
        name,
        'incomplete',
        sourceProblem ?? 'Не хватает характеристик для выбора нормы.',
      )
    return calculate(norm, lastRepairYear, tonnageAfter, year, sourceProblem)
  })
}

function emptyAssessment(
  code: string | null,
  name: string | null,
  status: RepairAssessment['status'],
  reason: string,
): RepairAssessment {
  return {
    workCode: code,
    workName: name,
    normId: null,
    status,
    dueYear: null,
    yearIsUpperBound: false,
    overdueYears: null,
    overdueMillionTons: null,
    reason,
  }
}

function calculate(
  norm: RepairNorm,
  lastRepairYear: number | null,
  tonnageAfter: number | null,
  year: number,
  sourceProblem: string | null,
): RepairAssessment {
  const validYear = lastRepairYear !== null && lastRepairYear <= year
  const age = validYear ? year - lastRepairYear : null
  const calendarYear =
    validYear && norm.years !== null ? Math.ceil(lastRepairYear + norm.years) : null
  const yearDue = age !== null && norm.years !== null && age >= norm.years
  const tonsDue =
    tonnageAfter !== null && norm.millionTons !== null && tonnageAfter >= norm.millionTons
  const missingYears = norm.years !== null && age === null
  const missingTons = norm.millionTons !== null && tonnageAfter === null
  const reason =
    sourceProblem ??
    (missingYears
      ? 'Неизвестен год последнего ремонта или он позже даты редакции.'
      : missingTons
        ? 'Нет тоннажа после укладки. Полный срок по двум порогам неизвестен.'
        : null)
  // В выгрузке нет истории накопления тоннажа: год пересечения порога не выдумываем.
  const dueYear = tonsDue ? Math.min(calendarYear ?? year, year) : calendarYear
  return {
    workCode: norm.workCode,
    workName: norm.workName,
    normId: norm.id,
    status:
      sourceProblem !== null
        ? 'incomplete'
        : yearDue || tonsDue
          ? 'due'
          : missingYears || missingTons
            ? 'incomplete'
            : 'planned',
    dueYear,
    yearIsUpperBound: tonsDue || (norm.millionTons !== null && calendarYear !== null),
    overdueYears: norm.years !== null && age !== null ? Math.max(0, age - norm.years) : null,
    overdueMillionTons:
      norm.millionTons !== null && tonnageAfter !== null
        ? Math.max(0, tonnageAfter - norm.millionTons)
        : null,
    reason,
  }
}
