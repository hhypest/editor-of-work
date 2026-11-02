import type { OverviewSource } from '../sheet-model'

/**
 * Вымышленная дистанция для схем дистанции (ADR-0008): три направления, одно с разрывом
 * протяжения и нестандартными километрами, станции через 5–12 км, ПД двух ПЧУ.
 * Названия учебные.
 */
export function fictionalDistrict(): OverviewSource {
  const names = [
    'Озёрная',
    'Берёзовка',
    'Ольховый Лог',
    'Сосновка',
    'Каменка',
    'Ручьёво',
    'Луговая',
    'Песчаная',
    'Дубрава',
    'Ключи',
    'Липки',
    'Северная',
  ]
  const axes: OverviewSource['axes'][number][] = []
  const station = (lineId: string, km: number, m: number) => {
    const name = names[axes.length % names.length] ?? 'Учебная'
    axes.push({ id: `a${axes.length}`, lineId, name: `${name}-${axes.length + 1}`, at: { km, m } })
  }
  for (const km of [102, 109, 117, 124, 131, 140, 146, 155, 163, 171, 178, 186, 193, 201])
    station('L1', km, 300)
  for (const km of [12, 20, 31, 38, 61, 70, 79]) station('L2', km, 0)
  for (const km of [3, 9, 15]) station('L3', km, 500)
  return {
    edition: { id: 1, date: '2027-01-01', label: 'Учебная редакция' },
    lines: [
      {
        id: 'L1',
        name: 'Северная — Южная, главный путь 1',
        extents: [{ from: { km: 100, m: 0 }, to: { km: 205, m: 0 } }],
        kmLengths: [
          [120, 964],
          [150, 1120],
        ],
      },
      {
        id: 'L2',
        name: 'Озёрная — Ключи, главный путь 1',
        extents: [
          { from: { km: 10, m: 0 }, to: { km: 40, m: 0 } },
          { from: { km: 55, m: 0 }, to: { km: 82, m: 500 } },
        ],
        kmLengths: [],
      },
      {
        id: 'L3',
        name: 'Подъездная ветвь',
        extents: [{ from: { km: 0, m: 0 }, to: { km: 18, m: 0 } }],
        kmLengths: [],
      },
    ],
    axes,
    boundaries: [
      { lineId: 'L1', code: 'ПД-1', pchu: 'ПЧУ-1', from: { km: 100, m: 0 }, to: { km: 135, m: 0 } },
      { lineId: 'L1', code: 'ПД-2', pchu: 'ПЧУ-1', from: { km: 135, m: 0 }, to: { km: 170, m: 0 } },
      { lineId: 'L1', code: 'ПД-3', pchu: 'ПЧУ-2', from: { km: 170, m: 0 }, to: { km: 205, m: 0 } },
      { lineId: 'L2', code: 'ПД-4', pchu: 'ПЧУ-2', from: { km: 10, m: 0 }, to: { km: 40, m: 0 } },
      { lineId: 'L2', code: 'ПД-5', pchu: 'ПЧУ-2', from: { km: 55, m: 0 }, to: { km: 82, m: 500 } },
      { lineId: 'L3', code: 'ПД-6', from: { km: 0, m: 0 }, to: { km: 1, m: 0 } },
      { lineId: 'L3', code: 'ПД-7', pchu: 'ПЧУ-2', from: { km: 1, m: 0 }, to: { km: 18, m: 0 } },
    ],
    warnings: [],
  }
}
