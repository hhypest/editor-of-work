import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  FileTypicalWorkKindCatalog,
  MAX_TYPICAL_CATALOG_BYTES,
  TYPICAL_WORK_KINDS_FILE,
  parseTypicalWorkKinds,
} from './file-typical-work-kinds'

const shipped = resolve(import.meta.dirname, '../../../catalogs', TYPICAL_WORK_KINDS_FILE)
const valid = {
  format: 1,
  title: 'Учебный перечень',
  source: 'Вымышленный источник',
  kinds: [
    { code: 'У-1', name: 'Учебная выправка', unit: 'км', group: 'current', includedIn: null },
    { code: 'У-2', name: 'в т.ч. учебная', unit: 'км', group: 'current', includedIn: 'У-1' },
  ],
}

describe('Типовой перечень видов работ', () => {
  it('поставляемый каталог проходит правила листа «Виды работ» и сохраняет порядок', async () => {
    const parsed = parseTypicalWorkKinds(await readFile(shipped, 'utf8'))
    expect(parsed.ok).toBe(true)
    const kinds = parsed.ok ? parsed.value : []
    expect(kinds).toHaveLength(122)
    expect(new Set(kinds.map((k) => k.code)).size).toBe(122)
    expect(kinds[0]).toEqual({
      code: 'ТС-001',
      name: 'Планово-предупредительная выправка пути комплексами машин (В)',
      unit: 'км',
      group: 'current',
      includedIn: null,
    })
    expect(kinds.find((k) => k.code === 'ТС-002')?.includedIn).toBe('ТС-001')
    expect(kinds.filter((k) => k.group === 'capital').map((k) => k.code)).toEqual(
      Array.from({ length: 8 }, (_, i) => `ТС-0${67 + i}`),
    )
    for (const kind of kinds)
      expect(kind.name.trim() === kind.name && kind.unit.trim() === kind.unit).toBe(true)
  })
  it('в поставляемом каталоге исправлены опечатки исходной формы, коды прежние (ADR-0036)', async () => {
    const parsed = parseTypicalWorkKinds(await readFile(shipped, 'utf8'))
    const kinds = parsed.ok ? parsed.value : []
    const text = kinds.map((k) => `${k.name} ${k.unit}`).join('\n')
    for (const typo of ['текщем', 'сроений', 'полрельсовом', 'металокомпозит', 'в ручную', 'комл'])
      expect(text).not.toContain(typo)
    expect(
      Object.fromEntries(
        ['ТС-011', 'ТС-031', 'ТС-059', 'ТС-102', 'ТС-127'].map((code) => {
          const kind = kinds.find((k) => k.code === code)
          return [code, kind && `${kind.name} | ${kind.unit}`]
        }),
      ),
    ).toEqual({
      'ТС-011':
        'Усиление кривых малого радиуса на деревянном подрельсовом основании (главные) | штук',
      'ТС-031': 'Шлифовка рельсов вручную станками | мест',
      'ТС-059':
        'при текущем содержании (пополнение плеча б.п., выплески, профильные просадки) | тыс.м3',
      'ТС-102':
        'укладка изолирующих стыков с композитными и металло-композитными накладками, а также других с улучшенными характеристиками | тыс. компл',
      'ТС-127': 'Антикоррозийная обработка металлических пролетных строений мостов | тонн',
    })
  })
  it.each([
    ['не JSON', '{', 'не является JSON'],
    ['другой формат', JSON.stringify({ ...valid, format: 2 }), 'неверная структура'],
    ['лишнее поле', JSON.stringify({ ...valid, extra: 1 }), 'неверная структура'],
    [
      'пустая единица',
      JSON.stringify({ ...valid, kinds: [{ ...valid.kinds[0], unit: ' ' }] }),
      'неверная структура',
    ],
    [
      'повтор кода',
      JSON.stringify({ ...valid, kinds: [valid.kinds[0], valid.kinds[0]] }),
      'Код вида работ должен быть уникален',
    ],
    [
      'неизвестный «входит в»',
      JSON.stringify({ ...valid, kinds: [{ ...valid.kinds[1], includedIn: 'нет' }] }),
      'Нет такого вида работ',
    ],
    [
      'разные единицы',
      JSON.stringify({ ...valid, kinds: [valid.kinds[0], { ...valid.kinds[1], unit: 'шт' }] }),
      'Единицы входящих видов работ должны совпадать',
    ],
  ])('отклоняет повреждённый каталог: %s', (_name, json, message) => {
    const parsed = parseTypicalWorkKinds(json)
    expect(parsed).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining(message) },
    })
  })
  it('читает файл, отклоняет отсутствующий и слишком большой', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eow-typical-'))
    try {
      const path = join(root, TYPICAL_WORK_KINDS_FILE)
      await writeFile(path, JSON.stringify(valid))
      expect(await new FileTypicalWorkKindCatalog(path).load()).toMatchObject({
        ok: true,
        value: valid.kinds,
      })
      expect(await new FileTypicalWorkKindCatalog(join(root, 'нет.json')).load()).toMatchObject({
        ok: false,
        error: { message: expect.stringContaining('не найден') },
      })
      await writeFile(path, ' '.repeat(MAX_TYPICAL_CATALOG_BYTES + 1))
      expect(await new FileTypicalWorkKindCatalog(path).load()).toMatchObject({
        ok: false,
        error: { message: expect.stringContaining('слишком велик') },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
