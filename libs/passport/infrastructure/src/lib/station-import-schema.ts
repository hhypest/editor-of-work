import { z } from 'zod'
import { STATION_FORMS } from '@eow/passport/import-api'
import { orgFileSchema } from './org-import-schema'
export const stationFileSchema = orgFileSchema.extend({ form: z.enum(STATION_FORMS) })
const point = z.object({ km: z.number().int().nonnegative(), m: z.number().int().nonnegative() })
const crossingPlace = z.object({
  km: z.number().int().nonnegative(),
  pk: z.number().int().min(1).max(10),
  siding: z.string().nullable(),
})
const provenance = z.object({
  id: z.string().min(1),
  importFileId: z.string().min(1),
  validFrom: z.iso.date().nullable(),
  validTo: z.iso.date(),
})
const stationAxisValues = z.object({
  station: z.string().min(1),
  line: z.string().min(1),
  axis: point,
  from: point.nullable(),
  to: point.nullable(),
  firstSwitch: z.string().nullable(),
  lastSwitch: z.string().nullable(),
  trackSection: z.string().nullable(),
})
const stationTrackValues = z.object({
  station: z.string().min(1),
  purpose: z.string().min(1),
  park: z.string().nullable(),
  number: z.string().min(1),
  from: z.string().nullable(),
  via: z.array(z.string()),
  to: z.string().nullable(),
  fullLength: z.number().finite().nonnegative().nullable(),
  usefulLength: z.number().finite().nonnegative().nullable(),
  railType: z.string().nullable(),
  ballastType: z.string().nullable(),
  sleeperType: z.string().nullable(),
  lastRepairYear: z.number().int().positive().nullable(),
  lastRepairKind: z.string().nullable(),
  classCode: z.string().nullable(),
})
const stationSwitchValues = z.object({
  station: z.string().min(1),
  number: z.string().min(1),
  park: z.string().nullable(),
  purpose: z.string().nullable(),
  track: z.string().nullable(),
  side: z.string().nullable(),
  laidDate: z.iso.date().nullable(),
  control: z.string().nullable(),
  railType: z.string().nullable(),
  frogMark: z.string().nullable(),
  frogKind: z.string().nullable(),
  frogs: z.number().int().positive(),
  sleeperType: z.string().nullable(),
})
const crossingValues = z.object({
  title: z.string().min(1),
  number: z.string().min(1),
  name: z.string().nullable(),
  direction: z.string().nullable(),
  stationColumn: z.string().nullable(),
  titleStation: z.string().nullable(),
  place: crossingPlace.nullable(),
  category: z.string().nullable(),
  type: z.string().nullable(),
  region: z.string().nullable(),
  district: z.string().nullable(),
  city: z.string().nullable(),
  road: z.string().nullable(),
  regulated: z.boolean().nullable(),
  signalling: z.string().nullable(),
  surface: z.string().nullable(),
  barriers: z.string().nullable(),
  trainsPerDay: z.number().finite().nonnegative().nullable(),
  vehiclesPerDay: z.number().finite().nonnegative().nullable(),
  trainSpeed: z.number().finite().nonnegative().nullable(),
  lastOverhaul: z.iso.date().nullable(),
  lines: z.array(z.string()),
})
const territoryValues = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  parent: z.string().nullable(),
  parentType: z.string().nullable(),
})
export const stationRowSchema = z.discriminatedUnion('form', [
  provenance.extend({ form: z.literal('station-axes'), values: stationAxisValues }),
  provenance.extend({ form: z.literal('station-tracks'), values: stationTrackValues }),
  provenance.extend({ form: z.literal('switches'), values: stationSwitchValues }),
  provenance.extend({ form: z.literal('crossings-general'), values: crossingValues }),
  provenance.extend({ form: z.literal('okato'), values: territoryValues }),
])
export const stationImportSchema = z
  .object({
    date: z.iso.date(),
    expectedEditionToken: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    basisToken: z.string().regex(/^[a-f0-9]{64}$/u),
    files: z.array(stationFileSchema).min(1),
    rows: z.array(stationRowSchema),
  })
  .superRefine((data, ctx) => {
    const fail = (message: string): void => ctx.addIssue({ code: 'custom', message })
    const files = new Map(data.files.map((f) => [f.id, f]))
    if (
      files.size !== data.files.length ||
      new Set(data.files.map((f) => JSON.stringify([f.form, f.name]))).size !== data.files.length
    )
      fail('Повторяются файлы станционного импорта.')
    if (STATION_FORMS.some((form) => !data.files.some((f) => f.form === form)))
      fail('Нужен полный пакет семи станционных форм.')
    if (new Set(data.rows.map((r) => r.id)).size !== data.rows.length)
      fail('Повторяются строки станционного импорта.')
    for (const row of data.rows) {
      if (files.get(row.importFileId)?.form !== row.form)
        fail('Строка ссылается на файл другой формы.')
      if ((row.validFrom !== null && row.validFrom > data.date) || row.validTo < data.date)
        fail('Период строки не включает дату редакции.')
      if (row.form === 'station-axes' && row.values.from && row.values.to) {
        const { from, to } = row.values
        if (from.km > to.km || (from.km === to.km && from.m > to.m))
          fail('Конец границы станции раньше начала.')
      }
      if (
        row.form === 'crossings-general' &&
        new Set(row.values.lines).size !== row.values.lines.length
      )
        fail('Повторяются направления переезда.')
    }
  })
export const stationExclusionsSchema = z
  .array(z.object({ name: z.string().trim().min(1), reason: z.string().trim().min(1) }))
  .superRefine((rows, ctx) => {
    if (new Set(rows.map((r) => r.name)).size !== rows.length)
      ctx.addIssue({ code: 'custom', message: 'Повторяются исключённые станции.' })
  })
