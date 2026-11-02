import { err, ok, type Result } from '@eow/shared/kernel'
import type { PlanSheetData } from '@eow/planning/sheet-api'
import {
  mm,
  type SheetError,
  type SheetPage,
  type SheetPrimitive,
  type TextMeasurer,
} from './sheet-model'
import { bold, regular, textBlock } from './sheet-text'
import { moveShapes, sheetRect as rect, sheetText as text } from './sheet-drawing'
import { measureTable, type SheetTable } from './sheet-table'

/** Верх и низ рабочей области листа А3 между шапкой и примечаниями, мм. */
export const SHEET_TOP = 53
export const SHEET_BOTTOM = 245
const MAX_PAGES = 200

/** Рамка, шапка, гриф утверждения, примечания и строка редакции листа плана. */
export interface SheetFrame {
  readonly title: string
  readonly notes: readonly string[]
  readonly footer: (number: number) => string
}

/**
 * Листы одного документа: фигуры кладутся сверху вниз, переполнение начинает новый лист.
 * Для каждого листа запоминаются работы, показанные на нём (выбор «только текущий лист»).
 */
export class SheetWriter {
  readonly pages: SheetPage[] = []
  readonly workIdsByPage: string[][] = []
  private shapes: SheetPrimitive[] = []
  private works = new Set<string>()
  y = SHEET_TOP

  constructor(
    private readonly data: PlanSheetData,
    private readonly measurer: TextMeasurer,
    private frame: SheetFrame,
  ) {}

  /** Рамка следующих листов; текущий лист закрывается со своей рамкой. */
  setFrame(frame: SheetFrame): void {
    this.frame = frame
  }

  add(shapes: readonly SheetPrimitive[]): void {
    this.shapes.push(...shapes)
  }

  addWork(id: string): void {
    this.works.add(id)
  }

  /** Есть ли место для блока высотой height до низа рабочей области. */
  fits(height: number): boolean {
    return this.y + height <= SHEET_BOTTOM
  }

  get empty(): boolean {
    return this.shapes.length === 0 && this.works.size === 0
  }

  flush(): Result<null, SheetError> {
    if (this.pages.length >= MAX_PAGES)
      return err({ message: `Документ ПД превышает ${MAX_PAGES} листов.` })
    const number = this.pages.length + 1
    const header = textBlock(this.frame.title, 15, 19, 240, 2, bold(4), this.measurer)
    if (!header.ok) return header
    const approval: SheetPrimitive[] = []
    for (const [value, ay] of [
      ['УТВЕРЖДАЮ', 17],
      [this.data.approval.title, 22],
      [this.data.approval.name, 33],
      [`«___» __________ ${this.data.approval.year} г.`, 40],
    ] as const) {
      const t = textBlock(value, 272, ay, 130, 2, regular(2.6), this.measurer)
      if (!t.ok) return t
      approval.push(...t.value)
    }
    this.pages.push({
      width: mm(420),
      height: mm(297),
      number,
      primitives: [
        rect(10, 10, 400, 277),
        ...header.value,
        ...approval,
        ...this.shapes,
        ...this.frame.notes.map((note, i) => text(note, 15, 259 + i * 6, regular(2.5))),
        text(this.frame.footer(number), 15, 281, regular(2.6)),
      ],
    })
    this.workIdsByPage.push([...this.works])
    this.works = new Set()
    this.shapes = []
    this.y = SHEET_TOP
    return ok(null)
  }

  /** Таблица с переносом: заголовок повторяется на каждом листе продолжения. */
  table(table: SheetTable): Result<null, SheetError> {
    const measured = measureTable(table, this.measurer)
    if (!measured.ok) return measured
    const m = measured.value
    const heading = (): Result<null, SheetError> => {
      const t = textBlock(m.title, 15, this.y + 4, 390, 1, bold(3), this.measurer)
      if (!t.ok) return t
      this.add([...t.value, ...moveShapes(m.header.primitives, this.y + 8)])
      this.y += 8 + m.header.height
      return ok(null)
    }
    if (!this.fits(8 + m.header.height + (m.rows[0]?.height ?? 9))) {
      const saved = this.flush()
      if (!saved.ok) return saved
    }
    let h = heading()
    if (!h.ok) return h
    for (const [index, full] of m.rows.entries()) {
      if (SHEET_TOP + 8 + m.header.height + full.height > SHEET_BOTTOM)
        return err({ message: `Строка таблицы «${m.title}» не помещается на листе с заголовком.` })
      // Внутри страницы повтор подписи группы скрыт; продолжение начинается с полной строки.
      let r = m.continued[index] ?? full
      if (!this.fits(r.height)) {
        const saved = this.flush()
        if (!saved.ok) return saved
        h = heading()
        if (!h.ok) return h
        r = full
      }
      this.add(moveShapes(r.primitives, this.y))
      const workId = table.workIds?.[index]
      if (workId !== undefined) this.addWork(workId)
      this.y += r.height
    }
    if (!m.rows.length) {
      this.add([text('Нет работ', 17, this.y + 5)])
      this.y += 9
    }
    this.y += 5
    return ok(null)
  }
}
