/** SQL-проекция характеристик. Полный нормализованный набор хранится в details. */
export interface SegmentStorageRow {
  edition_id: number
  id: string
  line_id: string
  start_km: number
  start_m: number
  end_km: number
  end_m: number
  import_file_id: string | null
  valid_from: string | null
  valid_to: string | null
  stated_length_m: number | null
  details: string | null
}
export interface SegmentTables {
  seg_class: SegmentStorageRow & {
    class: string | null
    group_name: string | null
    category: string | null
  }
  seg_load: SegmentStorageRow & {
    gross_million_ton_km: number | null
    axle_load: number | null
  }
  seg_speed: SegmentStorageRow & {
    passenger: number | null
    freight: number | null
    suburban: number | null
    empty: number | null
    express: number | null
    high_speed: number | null
    restriction_reason: string | null
  }
  seg_rail: SegmentStorageRow & {
    type: string | null
    laying_sign: string | null
    laid_date: string | null
    link_length_m: number | null
    continuous_welded: number | null
    hardening: string | null
    plant: string | null
    class: string | null
    group_name: string | null
    wear_mm: number | null
    tonnage_before: number | null
    tonnage_after: number | null
  }
  seg_sleeper: SegmentStorageRow & {
    base_type: string | null
    density: number | null
    fastening_type: string | null
    fastening_defective: number | null
    shock_absorbers: string | null
    tonnage: number | null
  }
  seg_ballast: SegmentStorageRow & {
    type: string | null
    thickness_cm: number | null
    contamination: number | null
    separating_layer: string | null
    protective_layer: string | null
    prism_shortage_cm: number | null
    shoulder_shortage_cm: number | null
  }
}
export const SEGMENT_TABLES = {
  class: 'seg_class',
  load: 'seg_load',
  speeds: 'seg_speed',
  rails: 'seg_rail',
  sleepers: 'seg_sleeper',
  ballast: 'seg_ballast',
} as const
