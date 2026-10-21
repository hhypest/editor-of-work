import type { Generated } from 'kysely'
interface Row {
  edition_id: number
  id: string
  import_file_id: string | null
  valid_from: string | null
  valid_to: string | null
}
export interface ManualTables {
  work_kind: Row & {
    code: string
    name: string
    unit: string
    group_name: string
    included_in_id: string | null
    symbol: Generated<string | null>
  }
  repair_norm: Row & {
    work_kind_id: string
    track_class: string | null
    track_group: string | null
    track_category: string | null
    rail_type: string | null
    sleeper_type: string | null
    years: number | null
    million_tons: number | null
  }
  tolerance: Row & {
    code: string
    name: string
    value: number
    unit: string
    conditions: string | null
  }
  seg_train_pairs: Row & {
    line_id: string
    start_km: number
    start_m: number
    end_km: number
    end_m: number
    freight: number | null
    passenger: number | null
    suburban: number | null
  }
}
