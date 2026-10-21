import { dateOf, numberOf, textOf } from './export-values'
import { normalizeHeader, recognizeForm } from './form-recognition'

describe('Нормализация заголовков', () => {
  it('переносы и лишние пробелы, «ё» и латинская C в «Cкорректировал»', () => {
    expect(normalizeHeader('Длина<br>участка, м')).toBe('Длина участка, м')
    expect(normalizeHeader('  Протяжение \nб/с пути, м ')).toBe('Протяжение б/с пути, м')
    expect(normalizeHeader('Cкорректировал')).toBe('Скорректировал')
    expect(normalizeHeader('Грузонапряжённость')).toBe('Грузонапряженность')
    // Латинская C внутри других слов не трогается.
    expect(normalizeHeader('ПАСС;')).toBe('ПАСС;')
  })
})

describe('Распознавание формы', () => {
  it('по обязательным столбцам, без учёта регистра', () => {
    expect(recognizeForm(['ОКАТО', 'тип', 'верхний окато', 'Тип верхнего ОКАТО'])).toEqual({
      ok: true,
      value: 'okato',
    })
  })

  it('запрещённый столбец отличает «Станции → ПД» от «Станционных путей → ПД»', () => {
    const base = ['Подразделение', 'Тип подразделения', 'Станция', 'Начало действия']
    expect(recognizeForm(base)).toEqual({ ok: true, value: 'station-pd' })
    expect(recognizeForm([...base, 'Путь'])).toEqual({ ok: false, error: { kind: 'unknown' } })
  })

  it('незнакомый набор и подходящий сразу к двум формам', () => {
    expect(recognizeForm(['А', 'Б'])).toEqual({ ok: false, error: { kind: 'unknown' } })
    const both = [
      'Главный путь',
      'Грузонапряженность',
      'Осевая нагрузка',
      'Род балласта',
      'Толщина балласта',
    ]
    expect(recognizeForm(both)).toEqual({
      ok: false,
      error: { kind: 'ambiguous', forms: ['load', 'ballast'] },
    })
  })
})

describe('Значения ячеек', () => {
  it('пусто: пустая строка, «Нет данных», «-----»; «-1» решает форма', () => {
    expect(textOf('  Нет данных ')).toBeNull()
    expect(textOf('-----')).toBeNull()
    expect(textOf('')).toBeNull()
    expect(textOf(null)).toBeNull()
    expect(textOf('-1')).toBe('-1')
    expect(textOf(' щеб  ')).toBe('щеб')
  })

  it('числа: «37.0», «37,5», числовая ячейка; не число — undefined', () => {
    expect(numberOf('37.0')).toBe(37)
    expect(numberOf('37,5')).toBe(37.5)
    expect(numberOf(1.27)).toBe(1.27)
    expect(numberOf('-1')).toBe(-1)
    expect(numberOf('Нет данных')).toBeNull()
    expect(numberOf('35-50')).toBeUndefined()
  })

  it('даты: «дд.мм.гггг» и ГГГГ-ММ-ДД; несуществующая дата — undefined', () => {
    expect(dateOf('01.04.2026')).toBe('2026-04-01')
    expect(dateOf('31.12.9999')).toBe('9999-12-31')
    expect(dateOf('2026-01-15')).toBe('2026-01-15')
    expect(dateOf('31.02.2026')).toBeUndefined()
    expect(dateOf('')).toBeNull()
  })
})
