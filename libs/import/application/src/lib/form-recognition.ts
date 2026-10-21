import { err, ok, type Result } from '@eow/shared/kernel'
import { PASSPORT_FORMS, type PassportForm } from './export-source'

/**
 * Заголовок в одном виде для всех источников: переносы строк и `<br>` — пробел,
 * лишние пробелы убраны, «ё» — «е», латинская «C» в начале «Cкорректировал» — кириллица.
 */
export function normalizeHeader(raw: string): string {
  return raw
    .replaceAll(/<br\s*\/?>/giu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .replaceAll('ё', 'е')
    .replaceAll('Ё', 'Е')
    .replace(/^C(?=[а-яА-Я])/u, 'С')
}

const key = (h: string): string => normalizeHeader(h).toLowerCase()

/**
 * Признаки формы: столбцы, которые обязаны быть, и столбцы, которых быть не должно.
 * Набор подобран так, чтобы каждая форма отличалась от остальных (тест на фикстурах).
 */
interface Signature {
  readonly required: readonly string[]
  readonly absent?: readonly string[]
}

const SIGNATURES: Readonly<Record<PassportForm, Signature>> = {
  subdivisions: {
    required: [
      'Ид подразделения',
      'Тип подразделения',
      'Подчиняется',
      'Отвечает за учет в паспорте',
    ],
  },
  boundaries: {
    required: [
      'Подразделение',
      'Главный путь',
      'КМ н.',
      'М к.',
      'Вид деятельности',
      'Дата начала действия',
    ],
  },
  'station-pd': {
    required: ['Подразделение', 'Тип подразделения', 'Станция', 'Начало действия'],
    absent: ['Путь'],
  },
  'track-pd': {
    required: ['Подразделение', 'Станция', 'Путь', 'Признак - весь путь', 'Метр начала'],
  },
  'station-axes': {
    required: ['Станция', 'Путь', 'Ось, км', 'Граница начала, км', 'Участок пути'],
  },
  okato: { required: ['ОКАТО', 'Верхний ОКАТО', 'Тип верхнего ОКАТО'] },
  class: { required: ['Главный путь', 'Класс', 'Группа', 'Категория'], absent: ['Тип'] },
  load: { required: ['Главный путь', 'Грузонапряженность', 'Осевая нагрузка'] },
  speeds: { required: ['Главный путь', 'ПАСС;', 'ГРУЗ;', 'Причина'] },
  rails: { required: ['Главный путь', 'Признак укладки', 'Дата укладки', 'Закалка'] },
  sleepers: { required: ['Подрельсовое основание', 'Эпюра шпал', 'Тип скреплений'] },
  ballast: { required: ['Главный путь', 'Род балласта', 'Толщина балласта'] },
  'crossings-general': {
    required: ['Переезд', 'Категория переезда', 'Тип переезда', 'Направление'],
  },
  'crossings-technical': { required: ['Переезд', 'Вид регулирования', 'Вид шлагбаума'] },
  'crossings-operational': {
    required: ['Переезд', 'Число поездов в сутки', 'Число автомобилей в сутки'],
  },
  'station-tracks': {
    required: ['Станция', 'Назначение путей по ТРА', 'Номер', 'Граница / От', 'Длина, м / Полн.'],
  },
  switches: { required: ['Станция', '№ стр. перевода', 'Путь', 'Крестовины / марка'] },
}

export type RecognitionError =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'ambiguous'; readonly forms: readonly PassportForm[] }

function matches(signature: Signature, present: ReadonlySet<string>): boolean {
  return (
    signature.required.every((h) => present.has(key(h))) &&
    (signature.absent ?? []).every((h) => !present.has(key(h)))
  )
}

/** Форма по набору заголовков: ровно одна подходящая, иначе ошибка. */
export function recognizeForm(headers: readonly string[]): Result<PassportForm, RecognitionError> {
  const present = new Set(headers.map(key))
  const found = PASSPORT_FORMS.filter((form) => matches(SIGNATURES[form], present))
  const [only, ...rest] = found
  if (only === undefined) return err({ kind: 'unknown' })
  if (rest.length > 0) return err({ kind: 'ambiguous', forms: found })
  return ok(only)
}
