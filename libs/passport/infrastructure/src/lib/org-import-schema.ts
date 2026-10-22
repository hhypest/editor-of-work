import { z } from 'zod'
import { ORG_FORMS } from '@eow/passport/import-api'

export const orgRemarkSchema = z.object({
  text: z.string(),
  at: z
    .object({
      file: z.string(),
      sheet: z.string(),
      row: z.number().int().positive().optional(),
      column: z.string().optional(),
      header: z.string().optional(),
    })
    .optional(),
})
export const orgFileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  form: z.enum(ORG_FORMS),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  importedAt: z.iso.datetime(),
  rowCount: z.number().int().nonnegative(),
  warnings: z.array(orgRemarkSchema),
})
const point = z.object({ km: z.number().int().nonnegative(), m: z.number().int().nonnegative() })
const row = z.object({
  id: z.string().min(1),
  importFileId: z.string().min(1),
  validFrom: z.iso.date().nullable(),
  validTo: z.iso.date(),
})
const station = row.extend({ station: z.string().min(1), subdivisionId: z.string().min(1) })

export const orgSubdivisionSchema = row.extend({
  code: z.string().min(1),
  type: z.string().min(1),
  parentId: z.string().nullable(),
  activity: z.string().nullable(),
  active: z.boolean(),
})
export const orgBoundarySchema = row.extend({
  line: z.string().min(1),
  statedLength: z.number().finite().nullable(),
  subdivisionId: z.string().min(1),
  from: point,
  to: point,
})
export const orgStationSchema = station
export const orgTrackSchema = station.extend({
  track: z.string().min(1),
  meters: z
    .object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })
    .nullable(),
})

/** Данные оргструктуры редакции для просмотра и сравнения. */
export const orgDataSchema = z.object({
  subdivisions: z.array(orgSubdivisionSchema),
  boundaries: z.array(orgBoundarySchema),
  stations: z.array(orgStationSchema),
  tracks: z.array(orgTrackSchema),
})

/** Схема выбирает только разрешённые поля перед любой сериализацией в SQLite. */
export const orgImportSchema = z
  .object({
    date: z.iso.date(),
    expectedEditionToken: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    files: z.array(orgFileSchema),
    subdivisions: z.array(orgSubdivisionSchema),
    boundaries: z.array(orgBoundarySchema),
    stations: z.array(orgStationSchema),
    tracks: z.array(orgTrackSchema),
  })
  .superRefine((input, ctx) => {
    const fail = (message: string): void => ctx.addIssue({ code: 'custom', message })
    const files = new Map(input.files.map((f) => [f.id, f]))
    if (
      files.size !== input.files.length ||
      ORG_FORMS.some((f) => !input.files.some((x) => x.form === f))
    )
      fail('Нужен полный набор четырёх форм без повторяющихся идентификаторов файлов.')
    const units = new Map(input.subdivisions.map((s) => [s.id, s]))
    if (new Set(input.subdivisions.map((s) => s.code)).size !== input.subdivisions.length)
      fail('Код подразделения встречается несколько раз.')
    const groups = [
      ['subdivisions', input.subdivisions],
      ['boundaries', input.boundaries],
      ['station-pd', input.stations],
      ['track-pd', input.tracks],
    ] as const
    for (const [form, rows] of groups) {
      if (new Set(rows.map((r) => r.id)).size !== rows.length)
        fail('Повторяются идентификаторы строк.')
      for (const r of rows) {
        if (files.get(r.importFileId)?.form !== form) fail('Строка ссылается на файл другой формы.')
        if ((r.validFrom !== null && r.validFrom > input.date) || r.validTo < input.date)
          fail('Период строки не включает дату редакции.')
      }
    }
    for (const s of input.subdivisions) {
      if (s.parentId !== null && (s.type !== 'ПД' || units.get(s.parentId)?.type !== 'ПЧУ'))
        fail('Родитель ПД должен быть ПЧУ этой редакции.')
    }
    for (const b of input.boundaries) {
      if (!units.get(b.subdivisionId)?.active)
        fail('Граница относится к неотмеченному подразделению.')
      if (b.to.km < b.from.km || (b.to.km === b.from.km && b.to.m <= b.from.m))
        fail(
          'Конец границы не дальше начала. Исправьте исходную выгрузку или исключите подразделение.',
        )
    }
    if (new Set(input.stations.map((s) => s.station)).size !== input.stations.length)
      fail('Станция привязана несколько раз.')
    for (const s of [...input.stations, ...input.tracks]) {
      const unit = units.get(s.subdivisionId)
      if (!unit?.active || unit.type !== 'ПД')
        fail('Станция или путь относится к неотмеченному ПД.')
    }
    for (const t of input.tracks) {
      if (t.meters && t.meters.end < t.meters.start)
        fail('Метр конца пути меньше метра начала. Исправьте исходную выгрузку перед сохранением.')
    }
  })
