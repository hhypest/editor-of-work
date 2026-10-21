import { randomUUID } from 'node:crypto'
import { err, ok, type Result } from '@eow/shared/kernel'
import {
  dateOf,
  numberOf,
  type ManualDataTemplate,
  type ManualTemplateContent,
} from '@eow/import/application'
import { MANUAL_SHEETS, type ManualBasis, type ManualIssue } from '@eow/passport/import-api'
import { cell, rowNumbers, type Sheet } from '../export/sheet'
import { readXlsx } from '../export/xlsx-reader'
import { MANUAL_COLUMNS, type MANUAL_KEYS, GROUP_LABELS } from './manual-layout'
import { writeManualXlsx } from './manual-xlsx-writer'

class Reader {
  constructor(
    readonly sheet: Sheet,
    readonly row: number,
    readonly columns: ReadonlyMap<string, number>,
    readonly issues: ManualIssue[],
  ) {}
  text(column: string, required = false): string | null {
    const raw = cell(this.sheet, this.row, this.columns.get(column) ?? 0)
    const value = raw === null || raw === '' ? null : String(raw)
    if (required && (value === null || value.trim() === ''))
      this.bad(column, 'Заполните обязательное поле')
    return value
  }
  number(column: string, required = false, integer = false): number | null {
    const text = this.text(column)
    const raw = cell(this.sheet, this.row, this.columns.get(column) ?? 0)
    const value = text === null ? null : numberOf(raw)
    if (
      value === undefined ||
      (typeof value === 'number' && !Number.isFinite(value)) ||
      (text !== null && value === null) ||
      (required && value === null) ||
      (integer && value !== null && !Number.isSafeInteger(value))
    ) {
      this.bad(column, integer ? 'Нужно целое число' : 'Нужно число')
      return null
    }
    return value
  }
  date(column: string): string | null {
    const text = this.text(column),
      value = text === null ? null : dateOf(text)
    if (value === undefined || (text !== null && value === null)) {
      this.bad(column, 'Нужна дата дд.мм.гггг или ГГГГ-ММ-ДД')
      return null
    }
    return value
  }
  bad(column: string, message: string): void {
    this.issues.push({ sheet: this.sheet.name, row: this.row, column, message })
  }
}
export class XlsxManualDataTemplate implements ManualDataTemplate {
  constructor(private readonly newId: () => string = randomUUID) {}
  async write(basis: ManualBasis): Promise<Result<Uint8Array, readonly ManualIssue[]>> {
    try {
      return ok(writeManualXlsx(basis))
    } catch {
      return err([
        { sheet: 'Книга', row: 1, column: '', message: 'Не удалось выдать шаблон ручных данных' },
      ])
    }
  }
  async read(bytes: Uint8Array): Promise<Result<ManualTemplateContent, readonly ManualIssue[]>> {
    const book = readXlsx(bytes, { includeHidden: true })
    if (!book.ok)
      return err([
        { sheet: 'Книга', row: 1, column: '', message: `Файл повреждён: ${book.error.detail}` },
      ])
    const issues: ManualIssue[] = []
    for (const sheet of book.value) {
      if (book.value.filter((s) => s.name === sheet.name).length > 1)
        issues.push({ sheet: sheet.name, row: 1, column: '', message: 'Повторяется лист' })
      if (![...Object.values(MANUAL_SHEETS), '_Шаблон'].some((s) => s === sheet.name))
        issues.push({
          sheet: sheet.name,
          row: 1,
          column: '',
          message: 'Неизвестный лист; используйте выданный программой шаблон',
        })
      for (const formula of sheet.formulas ?? [])
        issues.push({
          sheet: sheet.name,
          row: formula.row,
          column: String(cell(sheet, 1, formula.col) ?? formula.col),
          message:
            'Замените формулу явным значением: сохранённый результат формулы может быть устаревшим',
        })
    }
    const meta = book.value.find((s) => s.name === '_Шаблон')
    if (!meta || cell(meta, 1, 1) !== 'editor-of-work/manual-data' || cell(meta, 1, 2) !== 1)
      issues.push({
        sheet: '_Шаблон',
        row: 1,
        column: '',
        message: 'Неизвестный формат или версия шаблона; выдайте новый шаблон в программе',
      })
    const date = meta ? cell(meta, 2, 2) : null,
      basisToken = meta ? cell(meta, 3, 2) : null
    if (
      typeof date !== 'string' ||
      dateOf(date) !== date ||
      typeof basisToken !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(basisToken)
    )
      issues.push({
        sheet: '_Шаблон',
        row: 2,
        column: '',
        message: 'Повреждена основа шаблона; выдайте новый шаблон',
      })
    const sourceRows = {
      workKinds: [] as number[],
      repairNorms: [] as number[],
      tolerances: [] as number[],
      trainPairs: [] as number[],
      kilometres: [] as number[],
    }
    const read = <T>(key: (typeof MANUAL_KEYS)[number], parse: (r: Reader) => T): T[] => {
      const sheet = book.value.find((s) => s.name === MANUAL_SHEETS[key])
      if (!sheet) {
        issues.push({
          sheet: MANUAL_SHEETS[key],
          row: 1,
          column: '',
          message: 'Отсутствует обязательный лист',
        })
        return []
      }
      const columns = new Map<string, number>()
      for (const [col, v] of sheet.cells.get(1) ?? []) {
        const header = String(v)
        if (columns.has(header) || !MANUAL_COLUMNS[key].some((h) => h === header))
          issues.push({
            sheet: sheet.name,
            row: 1,
            column: header,
            message: 'Неизвестный или повторный заголовок',
          })
        columns.set(header, col)
      }
      for (const header of MANUAL_COLUMNS[key])
        if (!columns.has(header))
          issues.push({
            sheet: sheet.name,
            row: 1,
            column: header,
            message: 'Отсутствует обязательный столбец',
          })
      const rows: T[] = []
      for (const row of rowNumbers(sheet).filter((n) => n > 1)) {
        if (![...(sheet.cells.get(row)?.values() ?? [])].some((v) => v !== null && v !== ''))
          continue
        for (const col of sheet.cells.get(row)?.keys() ?? [])
          if (![...columns.values()].includes(col))
            issues.push({
              sheet: sheet.name,
              row,
              column: String(col),
              message: 'Данные в столбце без заголовка',
            })
        sourceRows[key].push(row)
        rows.push(parse(new Reader(sheet, row, columns, issues)))
      }
      return rows
    }
    const period = (r: Reader) => ({
      id: r.text('Идентификатор') ?? this.newId(),
      validFrom: r.date('Начало действия'),
      validTo: r.date('Конец действия'),
    })
    const data = {
      workKinds: read('workKinds', (r) => {
        const label = r.text('Группа', true) ?? ''
        return {
          ...period(r),
          code: r.text('Код', true) ?? '',
          name: r.text('Название', true) ?? '',
          unit: r.text('Единица', true) ?? '',
          group: Object.entries(GROUP_LABELS).find(([, v]) => v === label)?.[0] ?? label,
          symbol: r.text('Условное обозначение'),
          includedIn: r.text('Входит в'),
        }
      }),
      repairNorms: read('repairNorms', (r) => ({
        ...period(r),
        workCode: r.text('Вид ремонта', true) ?? '',
        trackClass: r.text('Класс пути'),
        trackGroup: r.text('Группа пути'),
        trackCategory: r.text('Категория пути'),
        railType: r.text('Тип рельсов'),
        sleeperType: r.text('Тип шпал'),
        years: r.number('Лет'),
        millionTons: r.number('Млн т брутто'),
      })),
      tolerances: read('tolerances', (r) => ({
        ...period(r),
        code: r.text('Код', true) ?? '',
        name: r.text('Название', true) ?? '',
        value: r.number('Значение', true) ?? 0,
        unit: r.text('Единица', true) ?? '',
        conditions: r.text('Условия'),
      })),
      trainPairs: read('trainPairs', (r) => ({
        ...period(r),
        line: r.text('Направление', true) ?? '',
        from: {
          km: r.number('Начало, км', true, true) ?? 0,
          m: r.number('Начало, м', true, true) ?? 0,
        },
        to: {
          km: r.number('Конец, км', true, true) ?? 0,
          m: r.number('Конец, м', true, true) ?? 0,
        },
        freight: r.number('Грузовые'),
        passenger: r.number('Пассажирские'),
        suburban: r.number('Пригородные'),
      })),
      kilometres: read('kilometres', (r) => ({
        ...period(r),
        line: r.text('Направление', true) ?? '',
        km: r.number('Км', true, true) ?? 0,
        length: r.number('Длина, м', true, true) ?? 0,
      })),
    }
    return issues.length
      ? err(issues)
      : ok({ date: String(date), basisToken: String(basisToken), data, sourceRows })
  }
}
