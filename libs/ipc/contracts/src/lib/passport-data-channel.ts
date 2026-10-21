import { z } from 'zod'
import { defineChannel } from './channel'

const point = z
  .object({ km: z.number().int().nonnegative(), m: z.number().int().nonnegative() })
  .strict()
const text = z.string().nullable()
const number = z.number().nullable()
const date = z.iso.date().nullable()

const orgRow = {
  id: z.string(),
  importFileId: z.string(),
  validFrom: date,
  validTo: z.string(),
}
const manualRow = {
  id: z.string(),
  validFrom: date,
  validTo: date,
}

const edition = z
  .object({
    id: z.number().int().positive(),
    number: z.number().int().positive(),
    date: z.iso.date(),
    label: z.string().min(1).max(200),
    status: z.enum(['draft', 'active', 'archived']),
  })
  .strict()

const line = z
  .object({
    id: z.string(),
    name: z.string(),
    extents: z.array(z.object({ from: point, to: point }).strict()),
    kmLengths: z.array(z.tuple([z.number(), z.number()])),
  })
  .strict()

const segmentBase = {
  ...orgRow,
  lineId: z.string(),
  from: point,
  to: point,
  statedLength: number,
}
const segment = z.discriminatedUnion('form', [
  z
    .object({
      ...segmentBase,
      form: z.literal('class'),
      values: z.object({ trackClass: text, group: text, category: text }).strict(),
    })
    .strict(),
  z
    .object({
      ...segmentBase,
      form: z.literal('load'),
      values: z.object({ grossMillionTonKm: number, axleLoad: number }).strict(),
    })
    .strict(),
  z
    .object({
      ...segmentBase,
      form: z.literal('speeds'),
      values: z
        .object({
          passenger: number,
          freight: number,
          suburban: number,
          empty: number,
          express: number,
          highSpeed: number,
          restrictionReason: text,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...segmentBase,
      form: z.literal('rails'),
      values: z
        .object({
          railType: text,
          layingSign: text,
          linkLength: text,
          hardening: text,
          purpose: text,
          plant: text,
          railClass: text,
          railGroup: text,
          laidDate: text,
          reducedWear: text,
          sideWear: number,
          waveWear: text,
          tonnageBefore: number,
          tonnageAfter: number,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...segmentBase,
      form: z.literal('sleepers'),
      values: z
        .object({
          structure: text,
          baseType: text,
          sleeperType: text,
          density: number,
          manufactureYear: number,
          fasteningType: text,
          fasteningDefective: number,
          laidFlag: text,
          padType: text,
          trackSection: text,
          upperAbsorberDate: text,
          upperRepair: text,
          upperPlant: text,
          upperDefective: number,
          lowerAbsorberDate: text,
          lowerRepair: text,
          lowerPlant: text,
          lowerDefective: number,
          secondarySleeperType: text,
          tonnageBefore: number,
          tonnageAfter: number,
          tonnage: number,
          sidingFlag: text,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...segmentBase,
      form: z.literal('ballast'),
      values: z
        .object({
          ballastType: text,
          thickness: text,
          contamination: text,
          separatingLayer: text,
          geogridType: text,
          geogridHeight: text,
          protectiveThickness: number,
          protectiveType: text,
          prismShortageRight: number,
          prismShortageLeft: number,
          shoulderShortageRight: number,
          shoulderShortageLeft: number,
          monolithicFlag: text,
          monolithicType: text,
        })
        .strict(),
    })
    .strict(),
])

const station = z.discriminatedUnion('form', [
  z
    .object({
      ...orgRow,
      form: z.literal('station-axes'),
      values: z
        .object({
          station: z.string(),
          line: z.string(),
          axis: point,
          from: point.nullable(),
          to: point.nullable(),
          firstSwitch: text,
          lastSwitch: text,
          trackSection: text,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...orgRow,
      form: z.literal('station-tracks'),
      values: z
        .object({
          station: z.string(),
          purpose: z.string(),
          park: text,
          number: z.string(),
          from: text,
          via: z.array(z.string()),
          to: text,
          fullLength: number,
          usefulLength: number,
          railType: text,
          ballastType: text,
          sleeperType: text,
          lastRepairYear: number,
          lastRepairKind: text,
          classCode: text,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...orgRow,
      form: z.literal('switches'),
      values: z
        .object({
          station: z.string(),
          number: z.string(),
          park: text,
          purpose: text,
          track: text,
          side: text,
          laidDate: text,
          control: text,
          railType: text,
          frogMark: text,
          frogKind: text,
          frogs: z.number(),
          sleeperType: text,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...orgRow,
      form: z.literal('crossings-general'),
      values: z
        .object({
          title: z.string(),
          number: z.string(),
          name: text,
          direction: text,
          stationColumn: text,
          titleStation: text,
          place: z
            .object({ km: z.number(), pk: z.number(), siding: text })
            .strict()
            .nullable(),
          category: text,
          type: text,
          region: text,
          district: text,
          city: text,
          road: text,
          regulated: z.boolean().nullable(),
          signalling: text,
          surface: text,
          barriers: text,
          trainsPerDay: number,
          vehiclesPerDay: number,
          trainSpeed: number,
          lastOverhaul: text,
          lines: z.array(z.string()),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...orgRow,
      form: z.literal('okato'),
      values: z
        .object({ name: z.string(), type: z.string(), parent: text, parentType: text })
        .strict(),
    })
    .strict(),
])

const manual = z
  .object({
    workKinds: z.array(
      z
        .object({
          ...manualRow,
          code: z.string(),
          name: z.string(),
          unit: z.string(),
          group: z.string(),
          symbol: text,
          includedIn: text,
        })
        .strict(),
    ),
    repairNorms: z.array(
      z
        .object({
          ...manualRow,
          workCode: z.string(),
          trackClass: text,
          trackGroup: text,
          trackCategory: text,
          railType: text,
          sleeperType: text,
          years: number,
          millionTons: number,
        })
        .strict(),
    ),
    tolerances: z.array(
      z
        .object({
          ...manualRow,
          code: z.string(),
          name: z.string(),
          value: z.number(),
          unit: z.string(),
          conditions: text,
        })
        .strict(),
    ),
    trainPairs: z.array(
      z
        .object({
          ...manualRow,
          line: z.string(),
          from: point,
          to: point,
          freight: number,
          passenger: number,
          suburban: number,
        })
        .strict(),
    ),
    kilometres: z.array(
      z
        .object({
          ...manualRow,
          line: z.string(),
          km: z.number(),
          length: z.number(),
        })
        .strict(),
    ),
  })
  .strict()

const org = z
  .object({
    subdivisions: z.array(
      z
        .object({
          ...orgRow,
          code: z.string(),
          type: z.string(),
          parentId: text,
          activity: text,
          active: z.boolean(),
        })
        .strict(),
    ),
    boundaries: z.array(
      z
        .object({
          ...orgRow,
          line: z.string(),
          statedLength: number,
          subdivisionId: z.string(),
          from: point,
          to: point,
        })
        .strict(),
    ),
    stations: z.array(
      z.object({ ...orgRow, station: z.string(), subdivisionId: z.string() }).strict(),
    ),
    tracks: z.array(
      z
        .object({
          ...orgRow,
          station: z.string(),
          subdivisionId: z.string(),
          track: z.string(),
          meters: z.object({ start: z.number(), end: z.number() }).strict().nullable(),
        })
        .strict(),
    ),
  })
  .strict()

/** Полный срез данных редакции: направления, характеристики пути, станции, нормативы, оргструктура. */
export const passportData = defineChannel(
  'passport:data',
  z.object({ editionId: z.number().int().positive() }).strict(),
  z.discriminatedUnion('status', [
    z
      .object({
        status: z.literal('ok'),
        data: z
          .object({
            edition,
            lines: z.array(line),
            segments: z.array(segment),
            stations: z.array(station),
            manual,
            org,
          })
          .strict(),
      })
      .strict(),
    z.object({ status: z.literal('error'), message: z.string() }).strict(),
  ]),
)
