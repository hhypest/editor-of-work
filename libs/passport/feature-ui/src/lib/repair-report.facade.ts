import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core'
import type {
  PassportEdition,
  PassportError,
  RepairReport,
  RepairReports,
} from '@eow/passport/application'
import { formatPlus, type Result } from '@eow/shared/kernel'

export interface RepairReportClient extends RepairReports {
  list(): Promise<Result<readonly PassportEdition[], PassportError>>
}
export const REPAIR_REPORT_CLIENT = new InjectionToken<RepairReportClient>('Отчёт о ремонтах')
export const REPAIR_TEXT = {
  title: 'Паспорт: потребность в ремонте',
  edition: 'Редакция паспорта',
  refresh: 'Обновить отчёт',
  loading: 'Расчёт отчёта…',
  emptyEditions: 'Нет редакций паспорта. Сначала создайте и заполните редакцию.',
  emptyRows: 'В редакции нет направлений и станционных путей для расчёта.',
  due: 'Требуется ремонт',
  planned: 'Порог не достигнут',
  incomplete: 'Недостаточно данных',
  'no-norm': 'Нет нормы',
  'ambiguous-norm': 'Неоднозначная норма',
} as const

@Injectable()
export class RepairReportFacade {
  private readonly client = inject(REPAIR_REPORT_CLIENT)
  private revision = 0
  readonly editions = signal<readonly PassportEdition[]>([])
  readonly selected = signal<number | null>(null)
  readonly report = signal<RepairReport | null>(null)
  readonly busy = signal(false)
  readonly error = signal<string | null>(null)
  readonly rows = computed(
    () =>
      this.report()?.rows.flatMap((row) =>
        row.assessments.map((a) => ({
          place:
            row.location.kind === 'line'
              ? `${row.location.lineName}: ${formatPlus(row.location.from)} – ${formatPlus(row.location.to)} (${row.location.lengthM} м)`
              : `${row.location.station}, путь ${row.location.track}`,
          lastRepairYear: row.lastRepairYear,
          tonnageAfter: row.tonnageAfter,
          assessment: a,
          status: REPAIR_TEXT[a.status],
        })),
      ) ?? [],
  )

  async load(): Promise<void> {
    const revision = ++this.revision
    this.busy.set(true)
    this.error.set(null)
    this.report.set(null)
    try {
      const result = await this.client.list()
      if (revision !== this.revision) return
      if (!result.ok) {
        this.error.set(result.error.message)
        return
      }
      this.editions.set(result.value)
      const id =
        result.value.find((e) => e.id === this.selected())?.id ??
        result.value.find((e) => e.status === 'active')?.id ??
        result.value.at(-1)?.id ??
        null
      this.selected.set(id)
      if (id !== null) await this.select(id)
    } catch {
      if (revision === this.revision)
        this.error.set('Не удалось получить редакции паспорта. Повторите попытку.')
    } finally {
      if (revision === this.revision) this.busy.set(false)
    }
  }
  async select(id: number): Promise<void> {
    if (!this.editions().some((e) => e.id === id)) return
    const revision = ++this.revision
    this.selected.set(id)
    this.busy.set(true)
    this.report.set(null)
    this.error.set(null)
    try {
      const result = await this.client.report(id)
      if (revision !== this.revision) return
      if (result.ok) this.report.set(result.value)
      else this.error.set(result.error.message)
    } catch {
      if (revision === this.revision)
        this.error.set('Не удалось получить отчёт. Повторите попытку.')
    } finally {
      if (revision === this.revision) this.busy.set(false)
    }
  }
}
