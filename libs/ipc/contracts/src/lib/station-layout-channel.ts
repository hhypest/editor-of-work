import { z } from 'zod'
import { defineChannel } from './channel'

const editionId = z.number().int().positive()
const stationId = z.string().min(1).max(600)
const id = z.string().min(1).max(64)
const cell = z.number().int().nonnegative().max(100_000)
const text = z.string().max(200)

/** Раскладка станции, формат `station_layout` версии 1 (ADR-0046). Правила проверяет main. */
export const stationLayoutDto = z
  .object({
    version: z.literal(1),
    nodes: z
      .array(
        z
          .object({
            id,
            col: cell,
            row: cell,
            kind: z.enum(['switch', 'end', 'bend', 'crossing']),
            end: z.enum(['stop', 'open']).optional(),
          })
          .strict(),
      )
      .max(20_000)
      .readonly(),
    tracks: z
      .array(
        z
          .object({
            id,
            number: text.nullable(),
            kind: z.enum(['main', 'station', 'connector', 'siding']),
            state: z.enum(['normal', 'closed', 'conserved']),
            nodes: z.array(id).min(2).max(20_000).readonly(),
            fullLength: z.number().finite().nonnegative().nullable(),
            capacity: text.nullable(),
          })
          .strict(),
      )
      .max(5_000)
      .readonly(),
    switches: z
      .array(z.object({ id, number: text.nullable(), node: id, track: id, branch: id }).strict())
      .max(5_000)
      .readonly(),
    derailers: z
      .array(z.object({ id, number: text, track: id, col: cell }).strict())
      .max(5_000)
      .readonly(),
    bridges: z
      .array(
        z.object({ id, label: text.nullable(), track: id, fromCol: cell, toCol: cell }).strict(),
      )
      .max(1_000)
      .readonly(),
    crossings: z
      .array(
        z
          .object({
            id,
            label: text,
            km: z.number().int().nonnegative().nullable(),
            pk: z.number().int().min(1).max(10).nullable(),
            col: cell,
            fromRow: cell,
            toRow: cell,
          })
          .strict(),
      )
      .max(1_000)
      .readonly(),
    objects: z
      .array(
        z
          .object({
            id: id,
            kind: z.enum(['building', 'platform']),
            label: text,
            col: cell,
            row: cell,
            width: z.number().int().min(1).max(400),
            height: z.number().int().min(1).max(20),
          })
          .strict(),
      )
      .max(1_000)
      .readonly()
      .optional(),
  })
  .strict()
  .readonly()

const failure = z.object({ status: z.literal('error'), message: z.string() }).strict()

/** Редактор станций: список станций редакции, чтение и запись раскладки. */
export const stationLayouts = defineChannel(
  'stations:layouts',
  z.discriminatedUnion('action', [
    z.object({ action: z.literal('list'), editionId }).strict(),
    z.object({ action: z.literal('load'), editionId, stationId }).strict(),
    z
      .object({
        action: z.literal('save'),
        editionId,
        stationId,
        layout: stationLayoutDto,
        version: z.string().regex(/^[0-9a-f]{64}$/u),
      })
      .strict(),
  ]),
  z.discriminatedUnion('status', [
    failure,
    z
      .object({
        status: z.literal('stations'),
        stations: z.array(
          z.object({ id: stationId, name: z.string(), hasLayout: z.boolean() }).strict(),
        ),
      })
      .strict(),
    z
      .object({
        status: z.literal('layout'),
        layout: stationLayoutDto.nullable(),
        version: z.string(),
        editable: z.boolean(),
      })
      .strict(),
    z.object({ status: z.literal('saved'), version: z.string() }).strict(),
  ]),
)
