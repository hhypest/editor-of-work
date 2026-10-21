import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { editionTables } from '../edition-tables'

/** Полностью вымышленная дистанция; одна связанная строка в каждой таблице. */
export function seedPassport(database: DatabaseSync, edition: number): void {
  const rows: Record<(typeof editionTables)[number], Record<string, SQLInputValue>> = {
    import_file: {
      name: 'Учебная таблица',
      form: 'fixture',
      imported_at: '2027-01-01',
      sha256: '0'.repeat(64),
      row_count: 1,
    },
    excluded_object: {
      object_type: 'station',
      object_id: 'excluded',
      reason: 'Учебное исключение',
    },
    line: { name: 'Вымышленное направление', code: 'L' },
    line_extent: { line_id: 'row', start_km: 700, start_m: 0, end_km: 701, end_m: 0 },
    line_km: { line_id: 'row', km: 700, length_m: 1250 },
    territory: { name: 'Вымышленная область', okato: 'fixture', type: 'region' },
    subdivision: { name: 'Учебное подразделение', code: 'fictional', type: 'ПД', active: 1 },
    subdivision_segment: {
      line_id: 'row',
      subdivision_id: 'row',
      start_km: 700,
      start_m: 0,
      end_km: 701,
      end_m: 0,
    },
    station: {
      name: 'Вымышленная станция',
      code: 'S',
      type: 'station',
      import_file_id: 'row',
      valid_from: '2027-01-01',
      valid_to: '9999-12-31',
    },
    station_axis: {
      line_id: 'row',
      station_id: 'row',
      axis_km: 700,
      axis_m: 1100,
      start_km: 700,
      start_m: 900,
      end_km: 701,
      end_m: 0,
    },
    station_pd: { station_id: 'row', subdivision_id: 'row' },
    station_track: { station_id: 'row', number: '1' },
    station_track_pd: { station_id: 'row', track_id: 'row', subdivision_id: 'row', whole_track: 1 },
    station_switch: { station_id: 'row', number: '2', track_id: 'row' },
    station_layout: { station_id: 'row', layout: '{"version":1,"tracks":[]}' },
    station_object: { station_id: 'row', type: 'building', label: 'Учебный объект', x: 1, y: 2 },
    crossing: {
      line_id: 'row',
      station_id: 'row',
      territory_id: 'row',
      number: '1',
      name: 'Учебный переезд',
      km: 700,
      m: 1200,
    },
    crossing_line: { crossing_id: 'row', line_id: 'row' },
    work_kind: {
      code: 'fixture',
      name: 'Учебная работа',
      unit: 'км',
      group_name: 'Учебная группа',
    },
    repair_norm: { work_kind_id: 'row', years: 7 },
    tolerance: { code: 'fixture', name: 'Учебный допуск', value: 3, unit: 'мм' },
    seg_class: { line_id: 'row', class: 'fixture' },
    seg_load: { line_id: 'row', gross_million_ton_km: 5 },
    seg_speed: { line_id: 'row', passenger: 60 },
    seg_rail: { line_id: 'row', type: 'fixture' },
    seg_sleeper: { line_id: 'row', base_type: 'fixture' },
    seg_ballast: { line_id: 'row', type: 'fixture' },
    seg_train_pairs: { line_id: 'row', freight: 10 },
  }
  database.exec('PRAGMA foreign_keys = ON; BEGIN')
  try {
    for (const table of editionTables) {
      // Фикстура также используется для обновления схем до миграции 005.
      if (
        table === 'crossing_line' &&
        !database
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='crossing_line'")
          .get()
      )
        continue
      const characteristic = table.startsWith('seg_')
        ? { start_km: 700, start_m: 0, end_km: 701, end_m: 0 }
        : {}
      const row = { edition_id: edition, id: 'row', ...characteristic, ...rows[table] }
      database
        .prepare(
          `INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.keys(row)
            .map(() => '?')
            .join(', ')})`,
        )
        .run(...Object.values(row))
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
