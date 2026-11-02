import type { Workbook, WorkbookCell } from '../workbook-model'

/**
 * Вычислитель формул модели книги для тестов: только конструкции, которые пишет выгрузка
 * (SUM, SUMIFS, COUNTIFS, COUNTIF, INDEX/MATCH, T, CHAR, «&», арифметика). Сравнение
 * критериев — без учёта регистра, как в Excel. Независим от кода выгрузки.
 */
type Value = string | number | null
type Ref = { readonly sheet: string; readonly cells: readonly (readonly [number, number])[] }

export function evaluateWorkbook(workbook: Workbook): (sheet: string, address: string) => Value {
  const sheets = new Map(workbook.sheets.map((s) => [s.name, s]))
  const cache = new Map<string, Value>()
  const cellAt = (sheet: string, row: number, column: number): WorkbookCell | null | undefined =>
    sheets.get(sheet)?.rows[row - 1]?.[column - 1]
  const valueOf = (sheet: string, row: number, column: number): Value => {
    const id = `${sheet}!${row}:${column}`
    if (cache.has(id)) return cache.get(id) ?? null
    const cell = cellAt(sheet, row, column)
    const value =
      !cell || !('value' in cell || 'formula' in cell)
        ? null
        : 'value' in cell
          ? cell.value
          : evaluate(sheet, cell.formula.slice(1))
    cache.set(id, value)
    return value
  }
  const column = (letters: string) =>
    [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0)
  function evaluate(sheet: string, text: string): Value {
    let at = 0
    const peek = () => text[at] ?? ''
    const expect = (c: string) => {
      if (text[at] !== c) throw new Error(`Ожидался «${c}» в ${text} на ${at}`)
      at++
    }
    const parseRef = (): Ref => {
      let target = sheet
      const quoted = /^'((?:[^']|'')*)'!/u.exec(text.slice(at))
      const plain = /^([\p{L}_][\p{L}\p{N}_]*)!/u.exec(text.slice(at))
      if (quoted) {
        target = (quoted[1] ?? '').replaceAll("''", "'")
        at += quoted[0].length
      } else if (plain) {
        target = plain[1] ?? target
        at += plain[0].length
      }
      const range = /^\$?([A-Z]+)(?:\$?(\d+))?(?::\$?([A-Z]+)(?:\$?(\d+))?)?/u.exec(text.slice(at))
      if (!range) throw new Error(`Нет ссылки в ${text} на ${at}`)
      at += range[0].length
      const [, c1 = 'A', r1, c2, r2] = range
      const rows = sheets.get(target)?.rows.length ?? 0
      const fromRow = r1 ? Number(r1) : 1,
        toRow = r2 ? Number(r2) : r1 && !c2 ? Number(r1) : rows
      const fromColumn = column(c1),
        toColumn = column(c2 ?? c1)
      const cells: [number, number][] = []
      for (let r = Math.min(fromRow, toRow); r <= Math.max(fromRow, toRow); r++)
        for (let c = fromColumn; c <= toColumn; c++) cells.push([r, c])
      return { sheet: target, cells }
    }
    const values = (ref: Ref) => ref.cells.map(([r, c]) => valueOf(ref.sheet, r, c))
    const matches = (value: Value, criterion: Value): boolean => {
      const pattern = String(criterion ?? '')
      const negate = pattern.startsWith('<>')
      const wanted = negate ? pattern.slice(2) : pattern
      const equal = String(value ?? '').toLocaleLowerCase('ru') === wanted.toLocaleLowerCase('ru')
      return negate ? !equal : equal
    }
    const parseArgument = (): Value | Ref => {
      const start = at
      try {
        const ref = parseRef()
        if (peek() === ',' || peek() === ')') return ref
      } catch {
        /* не ссылка */
      }
      at = start
      return parseExpression()
    }
    const scalar = (arg: Value | Ref): Value =>
      arg !== null && typeof arg === 'object' ? (values(arg)[0] ?? null) : arg
    const call = (name: string, args: (Value | Ref)[]): Value => {
      const ref = (i: number) => {
        const arg = args[i]
        if (arg === null || typeof arg !== 'object') throw new Error(`${name}: нужен диапазон`)
        return arg
      }
      const numbers = (items: readonly Value[]) =>
        items.reduce<number>((n, v) => n + (typeof v === 'number' ? v : 0), 0)
      const where = (from: number) => {
        const sets: { cells: Value[]; criterion: Value }[] = []
        for (let i = from; i < args.length; i += 2)
          sets.push({ cells: values(ref(i)), criterion: scalar(args[i + 1] ?? null) })
        return (index: number) => sets.every((s) => matches(s.cells[index] ?? null, s.criterion))
      }
      switch (name) {
        case 'SUM':
          return numbers(
            args.flatMap((a) => (a !== null && typeof a === 'object' ? values(a) : [a])),
          )
        case 'SUMIFS': {
          const sum = values(ref(0)),
            ok = where(1)
          return numbers(sum.filter((_, i) => ok(i)))
        }
        case 'COUNTIFS':
        case 'COUNTIF': {
          const ok = where(0)
          return values(ref(0)).filter((_, i) => ok(i)).length
        }
        case 'MATCH': {
          const wanted = scalar(args[0] ?? null)
          const index = values(ref(1)).findIndex((v) => matches(v, wanted))
          if (index < 0) throw new Error(`MATCH: нет ${String(wanted)}`)
          return index + 1
        }
        case 'INDEX':
          return values(ref(0))[Number(scalar(args[1] ?? null)) - 1] ?? null
        case 'T': {
          const value = scalar(args[0] ?? null)
          return typeof value === 'string' ? value : ''
        }
        case 'CHAR':
          return String.fromCharCode(Number(scalar(args[0] ?? null)))
        default:
          throw new Error(`Неизвестная функция ${name}`)
      }
    }
    function parseFactor(): Value {
      const string = /^"((?:[^"]|"")*)"/u.exec(text.slice(at))
      if (string) {
        at += string[0].length
        return (string[1] ?? '').replaceAll('""', '"')
      }
      const number = /^\d+(?:\.\d+)?/u.exec(text.slice(at))
      if (number && !/^[A-Z$]/u.test(text.slice(at + number[0].length))) {
        at += number[0].length
        return Number(number[0])
      }
      const name = /^([A-Z]+)\(/u.exec(text.slice(at))
      if (name) {
        at += name[0].length
        const args: (Value | Ref)[] = []
        while (peek() !== ')') {
          args.push(parseArgument())
          if (peek() === ',') at++
        }
        expect(')')
        return call(name[1] ?? '', args)
      }
      return scalar(parseRef())
    }
    function parseTerm(): Value {
      let value = parseFactor()
      while (peek() === '*' || peek() === '/') {
        const op = text[at++]
        const right = Number(parseFactor())
        value = op === '*' ? Number(value) * right : Number(value) / right
      }
      return value
    }
    function parseExpression(): Value {
      let value = parseTerm()
      while (peek() === '+' || peek() === '-' || peek() === '&') {
        const op = text[at++]
        const right = parseTerm()
        value =
          op === '&'
            ? `${value ?? ''}${right ?? ''}`
            : op === '+'
              ? Number(value ?? 0) + Number(right ?? 0)
              : Number(value ?? 0) - Number(right ?? 0)
      }
      return value
    }
    const result = parseExpression()
    if (at !== text.length) throw new Error(`Не разобран хвост ${text.slice(at)}`)
    return result
  }
  return (sheet, address) => {
    const match = /^([A-Z]+)(\d+)$/u.exec(address)
    if (!match) throw new Error(address)
    return valueOf(sheet, Number(match[2]), column(match[1] ?? 'A'))
  }
}
