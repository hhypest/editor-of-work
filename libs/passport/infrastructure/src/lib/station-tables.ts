import type { Generated } from 'kysely'
interface Row {
  edition_id: number
  id: string
  import_file_id: string | null
  valid_from: string | null
  valid_to: string | null
}
export interface StationTables {
  station_axis: Row & {
    line_id: string
    station_id: string
    axis_km: number
    axis_m: number
    start_km: Generated<number | null>
    start_m: Generated<number | null>
    end_km: Generated<number | null>
    end_m: Generated<number | null>
    first_switch: Generated<string | null>
    last_switch: Generated<string | null>
    track_section: Generated<string | null>
    details: Generated<string | null>
  }
  station_track: Row & {
    station_id: string
    number: string
    purpose: Generated<string | null>
    full_length_m: Generated<number | null>
    usable_length_m: Generated<number | null>
    capacity: Generated<number | null>
    rail_type: Generated<string | null>
    sleeper_type: Generated<string | null>
    ballast_type: Generated<string | null>
    last_repair_year: Generated<number | null>
    details: Generated<string | null>
  }
  station_switch: Row & {
    station_id: string
    number: string
    track_id: Generated<string | null>
    type: Generated<string | null>
    rail_type: Generated<string | null>
    frog: Generated<string | null>
    drive: Generated<string | null>
    sleeper_type: Generated<string | null>
    laid_year: Generated<number | null>
    last_repair_year: Generated<number | null>
    details: Generated<string | null>
  }
  territory: Row & {
    name: string
    okato: string
    type: string
    parent_id: Generated<string | null>
    details: Generated<string | null>
  }
  crossing: Row & {
    line_id: Generated<string | null>
    station_id: Generated<string | null>
    territory_id: Generated<string | null>
    number: string
    name: string
    km: Generated<number | null>
    m: Generated<number | null>
    category: Generated<string | null>
    type: Generated<string | null>
    road: Generated<string | null>
    regulated: Generated<number | null>
    signalling: Generated<string | null>
    surface: Generated<string | null>
    barriers: Generated<string | null>
    signs: Generated<string | null>
    trains_per_day: Generated<number | null>
    vehicles_per_day: Generated<number | null>
    train_speed: Generated<number | null>
    road_speed: Generated<number | null>
    visibility_m: Generated<number | null>
    last_overhaul_date: Generated<string | null>
    details: Generated<string | null>
  }
  excluded_object: Row & { object_type: string; object_id: string; reason: string }
  crossing_line: Row & { crossing_id: string; line_id: string }
}
