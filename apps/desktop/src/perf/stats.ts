// Сводка замеров и пороги (ADR-0045). Пороги ловят только крупную регрессию: машины CI
// медленнее и нестабильнее рабочего ПК, цели приёмки проверяются на нём.

export interface Summary {
  readonly count: number
  readonly median: number
  readonly p95: number
  readonly max: number
}

const round = (ms: number) => Math.round(ms * 10) / 10

/** Медиана, 95-й процентиль по ближайшему рангу и максимум, мс с точностью 0,1. */
export function summarize(samples: readonly number[]): Summary {
  if (!samples.length) throw new Error('Нет замеров')
  const sorted = samples.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2
      ? (sorted[middle] ?? 0)
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0
  return {
    count: sorted.length,
    median: round(median),
    p95: round(p95),
    max: round(sorted.at(-1) ?? 0),
  }
}

export interface ProfileTimings {
  readonly id: string
  readonly title: string
  readonly size: {
    readonly pds: number
    readonly works: number
    readonly stations: number
    readonly fileBytes: number
    readonly pages: number
  }
  /** Открытие файла плана командой «Открыть». */
  readonly openMs: Summary
  /** Первая подготовка листа каждого ПД: срез main, передача, раскладка. */
  readonly sheetMs: Summary
  /** Правка работы: команда редактора и ответ с новым состоянием. */
  readonly editMs: Summary
  /** Подготовка листа после правки — то, что показывает «Подготовка листа». */
  readonly afterEditMs: Summary
  /** Раскладка и передача листов всех ПД подряд, без печати PDF. */
  readonly batchMs: Summary
  readonly saveMs: Summary
}

/** Пределы крупной регрессии на любой машине. */
export const LIMITS = {
  openMs: 15_000,
  sheetP95Ms: 2000,
  editP95Ms: 2000,
  afterEditP95Ms: 2000,
  batchMsPerPage: 1000,
  saveMs: 15_000,
} as const

/** Цели приёмки 0.5.0 на рабочем ПК: лист после правки < 200 мс, 30 листов PDF < 30 с. */
export const GOALS = { afterEditMs: 200, batch30Seconds: 30 } as const

export function limitFailures(profile: ProfileTimings): string[] {
  const failures: string[] = []
  const check = (ok: boolean, text: string) => {
    if (!ok) failures.push(`${profile.title}: ${text}`)
  }
  check(profile.openMs.max <= LIMITS.openMs, `открытие ${profile.openMs.max} мс`)
  check(profile.sheetMs.p95 <= LIMITS.sheetP95Ms, `подготовка листа p95 ${profile.sheetMs.p95} мс`)
  check(profile.editMs.p95 <= LIMITS.editP95Ms, `правка p95 ${profile.editMs.p95} мс`)
  check(
    profile.afterEditMs.p95 <= LIMITS.afterEditP95Ms,
    `лист после правки p95 ${profile.afterEditMs.p95} мс`,
  )
  const perPage = profile.batchMs.median / Math.max(1, profile.size.pages)
  check(
    perPage <= LIMITS.batchMsPerPage,
    `все ПД ${Math.round(perPage)} мс на лист (${profile.size.pages} листов)`,
  )
  check(profile.saveMs.max <= LIMITS.saveMs, `сохранение ${profile.saveMs.max} мс`)
  return failures
}

/** Сравнение с целями приёмки: на CI справочно, на рабочем ПК — часть протокола. */
export function goals(profile: ProfileTimings): {
  readonly afterEdit: boolean
  readonly batch30: boolean | null
} {
  return {
    afterEdit: profile.afterEditMs.p95 < GOALS.afterEditMs,
    // Цель 30 с относится к пакету из 30 листов; здесь — только раскладка, без печати.
    batch30:
      profile.size.pages === 30 ? profile.batchMs.median < GOALS.batch30Seconds * 1000 : null,
  }
}
