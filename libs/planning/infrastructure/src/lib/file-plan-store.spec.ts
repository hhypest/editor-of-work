import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createAnnualPlan,
  samplePlanBasis,
  setPlanIndicators,
  setPdScale,
  setPdHiddenTables,
  type AnnualPlan,
} from '@eow/planning/domain'
import { v2Fixture } from './testing/v2-fixture'
import { v3Fixture } from './testing/v3-fixture'
import { v4Fixture } from './testing/v4-fixture'
import { FilePlanStore, nodePlanFileIO } from './file-plan-store'
import { decodePlan } from './plan-file'

function plan(year: number): AnnualPlan {
  const result = createAnnualPlan(year, samplePlanBasis())
  if (!result.ok) throw new Error('неверный год')
  return result.value
}

describe('файл плана на диске', () => {
  let directory: string
  let path: string
  let store: FilePlanStore
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'eow-plan-'))
    path = join(directory, 'вымышленный.ppr.json')
    store = new FilePlanStore(path, '0.1.0')
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  it('сохраняет состав таблиц в v5, исходный v4 в .bak и восстанавливает настройку из автокопии', async () => {
    const original = JSON.stringify(v4Fixture)
    await writeFile(path, original)
    const loaded = await store.load()
    if (!loaded.ok) throw new Error('Учебная ошибка')
    const changed = setPdHiddenTables(loaded.value, 'D', ['works', 'summary'])
    if (!changed.ok) throw new Error('Учебная ошибка')
    expect((await store.autosave(changed.value)).ok).toBe(true)
    const restarted = new FilePlanStore(path, '0.5.0')
    expect(await restarted.recovery()).toEqual({ ok: true, value: changed.value })
    expect(await readFile(path, 'utf8')).toBe(original)
    expect((await restarted.save(changed.value)).ok).toBe(true)
    expect(await readFile(`${path}.bak`, 'utf8')).toBe(original)
    expect(await restarted.load()).toEqual({ ok: true, value: changed.value })
  })

  it('записывает и открывает план с русским именем файла', async () => {
    expect(await store.save(plan(2027))).toEqual({ ok: true, value: undefined })
    expect(await store.load()).toEqual({ ok: true, value: plan(2027) })
  })
  it('открывает v2, сохраняет показатели с исходной резервной копией и восстанавливает автокопию', async () => {
    const original = JSON.stringify(v2Fixture)
    await writeFile(path, original)
    const loaded = await store.load()
    if (!loaded.ok) throw new Error('Учебная ошибка')
    const changed = setPlanIndicators(loaded.value, { kind: 'pd', pd: 'D' }, [
      { id: 'i', name: 'Учебный', unit: '', value: 0, note: '' },
    ])
    if (!changed.ok) throw new Error('Учебная ошибка')
    expect((await store.autosave(changed.value)).ok).toBe(true)
    const restarted = new FilePlanStore(path, '0.3.0')
    expect(await readFile(path, 'utf8')).toBe(original)
    expect(await restarted.recovery()).toEqual({ ok: true, value: changed.value })
    expect((await restarted.save(changed.value)).ok).toBe(true)
    expect(await readFile(`${path}.bak`, 'utf8')).toBe(original)
    expect(JSON.parse(await readFile(path, 'utf8')).format.version).toBe(6)
    expect(await restarted.load()).toEqual({ ok: true, value: changed.value })
  })
  it('сохраняет масштаб в v4, исходный v3 в .bak и восстанавливает настройку из автокопии', async () => {
    const original = JSON.stringify(v3Fixture)
    await writeFile(path, original)
    const loaded = await store.load()
    if (!loaded.ok) throw new Error('Учебная ошибка')
    const changed = setPdScale(loaded.value, 'D', 100000)
    if (!changed.ok) throw new Error('Учебная ошибка')
    expect((await store.autosave(changed.value)).ok).toBe(true)
    const restarted = new FilePlanStore(path, '0.4.0')
    expect(await restarted.recovery()).toEqual({ ok: true, value: changed.value })
    expect(await readFile(path, 'utf8')).toBe(original)
    expect((await restarted.save(changed.value)).ok).toBe(true)
    expect(await readFile(`${path}.bak`, 'utf8')).toBe(original)
    expect(await restarted.load()).toEqual({ ok: true, value: changed.value })
    expect(JSON.parse(await readFile(path, 'utf8')).plan.pdScales).toEqual([
      { pd: 'D', scale: 100000 },
    ])
  })

  it('хранит ровно пять последних предыдущих версий', async () => {
    for (let year = 2021; year <= 2027; year++) expect((await store.save(plan(year))).ok).toBe(true)
    const files = await readdir(directory)
    expect(files.filter((f) => f.endsWith('.bak'))).toHaveLength(5)
    for (let n = 1; n <= 5; n++) {
      const text = await readFile(n === 1 ? `${path}.bak` : `${path}.${n}.bak`, 'utf8')
      expect(decodePlan(text)).toMatchObject({ ok: true, value: { year: 2027 - n } })
    }
  })

  it.each(['write', 'replace'] as const)(
    'сбой %s оставляет прежний файл читаемым',
    async (failure) => {
      await store.save(plan(2026))
      const before = await readFile(path, 'utf8')
      const broken = new FilePlanStore(path, '0.1.0', {
        ...nodePlanFileIO,
        async write(target, text) {
          await nodePlanFileIO.write(target, text)
          if (failure === 'write' && !target.includes('.bak.'))
            throw new Error('имитация заполненного диска')
        },
        async replace(from, to) {
          if (failure === 'replace' && to === path) throw new Error('имитация сбоя переименования')
          await nodePlanFileIO.replace(from, to)
        },
      })
      expect((await broken.save(plan(2027))).ok).toBe(false)
      expect(await readFile(path, 'utf8')).toBe(before)
      expect((await store.load()).ok).toBe(true)
      expect((await readdir(directory)).some((f) => f.endsWith('.tmp'))).toBe(false)
    },
  )

  it('не перезаписывает файл будущей версии даже без его открытия', async () => {
    const future = '{"format":{"version":7},"data":"будущие данные"}'
    await writeFile(path, future)
    expect(await store.save(plan(2027))).toMatchObject({
      ok: false,
      error: { kind: 'future-version' },
    })
    expect(await store.autosave(plan(2027))).toMatchObject({
      ok: false,
      error: { kind: 'future-version' },
    })
    expect(await readFile(path, 'utf8')).toBe(future)
    expect(await readdir(directory)).toEqual(['вымышленный.ppr.json'])
  })

  it('сериализует конкурирующие сохранения', async () => {
    const results = await Promise.all([
      store.save(plan(2025)),
      store.save(plan(2026)),
      store.save(plan(2027)),
    ])
    expect(results.every((r) => r.ok)).toBe(true)
    expect(await store.load()).toMatchObject({ ok: true, value: { year: 2027 } })
    expect(decodePlan(await readFile(`${path}.bak`, 'utf8'))).toMatchObject({
      ok: true,
      value: { year: 2026 },
    })
  })

  it('восстановление не меняет основной файл и доступно после перезапуска', async () => {
    await store.save(plan(2026))
    await store.autosave(plan(2027))
    const restarted = new FilePlanStore(path, '0.1.0')
    expect(await restarted.load()).toMatchObject({ ok: true, value: { year: 2026 } })
    expect(await restarted.recovery()).toMatchObject({ ok: true, value: { year: 2027 } })
    await restarted.save(plan(2027))
    expect(await restarted.recovery()).toEqual({ ok: true, value: undefined })
  })

  it('позволяет явно отказаться от восстановления', async () => {
    await store.autosave(plan(2027))
    expect((await store.discardRecovery()).ok).toBe(true)
    expect(await store.recovery()).toEqual({ ok: true, value: undefined })
  })

  it('не создаёт автокопию неизменённого плана', async () => {
    await store.save(plan(2027))
    await store.autosave(plan(2027))
    expect(await store.recovery()).toEqual({ ok: true, value: undefined })
  })

  it('возврат к сохранённому состоянию убирает устаревшую автокопию', async () => {
    await store.save(plan(2026))
    await store.autosave(plan(2027))
    await store.autosave(plan(2026))
    expect(await store.recovery()).toEqual({ ok: true, value: undefined })
  })
})
