import { Kysely, SqliteDialect, type SqliteDatabase } from 'kysely'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

function parameter(value: unknown): SQLInputValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    value instanceof Uint8Array
  )
    return value
  throw new TypeError('Недопустимый параметр SQLite.')
}

/** Узкий интерфейс SqliteDialect; отдельный нативный модуль SQLite не требуется. */
export function sqliteQueries<Schema>(database: DatabaseSync): Kysely<Schema> {
  const adapter: SqliteDatabase = {
    close: () => database.close(),
    prepare(sql) {
      const statement = database.prepare(sql)
      return {
        reader: statement.columns().length > 0,
        all: (parameters) => statement.all(...parameters.map(parameter)),
        run: (parameters) => statement.run(...parameters.map(parameter)),
        iterate: (parameters) => statement.iterate(...parameters.map(parameter)),
      }
    },
  }
  return new Kysely<Schema>({ dialect: new SqliteDialect({ database: adapter }) })
}
