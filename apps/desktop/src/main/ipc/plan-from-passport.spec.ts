import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openPassportDatabase } from '@eow/passport/infrastructure'
import { decodePlan, passportPlanView } from '@eow/planning/infrastructure'
import { channels, type RequestOf } from '@eow/ipc/contracts'
import { registerPlanFileHandlers } from './plan-files'
import type { Result } from '@eow/shared/kernel'
function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.value
}
it('SQLite → редакция → новый план → работа → файл → листы ПД, без изменения исходного паспорта', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eow-new-plan-cycle-'))
  const passport = await openPassportDatabase(
    join(directory, 'passport.sqlite'),
    resolve(import.meta.dirname, '../../../../../libs/passport/infrastructure/migrations'),
  )
  let stop = async (): Promise<void> => undefined
  try {
    const edition = value(await passport.createDraft({ date: '2026-01-01', label: 'Учебный срез' }))
    const db = new DatabaseSync(passport.path)
    try {
      db.prepare(
        "INSERT INTO line(edition_id,id,name,code) VALUES(?,'line','Учебное направление','L')",
      ).run(edition.id)
      db.prepare(
        "INSERT INTO line_extent(edition_id,id,line_id,start_km,start_m,end_km,end_m) VALUES(?,'extent','line',10,0,21,0)",
      ).run(edition.id)
      db.prepare(
        "INSERT INTO line_km(edition_id,id,line_id,km,length_m) VALUES(?,'km','line',20,964)",
      ).run(edition.id)
      db.prepare(
        "INSERT INTO subdivision(edition_id,id,name,code,type,active) VALUES(?,'pchu','Учебный ПЧУ','ПЧУ-1','ПЧУ',1)",
      ).run(edition.id)
      db.prepare(
        "INSERT INTO subdivision(edition_id,id,name,code,type,parent_id,active) VALUES(?,'pd','Учебный ПД','ПД-1','ПД','pchu',1)",
      ).run(edition.id)
      db.prepare(
        "INSERT INTO subdivision_segment(edition_id,id,subdivision_id,line_id,start_km,start_m,end_km,end_m) VALUES(?,'boundary','pd','line',10,0,21,0)",
      ).run(edition.id)
      db.prepare(
        "INSERT INTO work_kind(edition_id,id,code,name,unit,group_name) VALUES(?,'kind','X','Учебная выправка','км','current')",
      ).run(edition.id)
    } finally {
      db.close()
    }
    value(await passport.activate(edition.id))
    const original = value(await passport.planningData(edition.id))
    let listener!: (event: unknown, ...args: unknown[]) => unknown
    const path = join(directory, 'new.ppr.json')
    const save = vi.fn<() => Promise<string>>(async () => path)
    stop = registerPlanFileHandlers(
      {
        handle: (_name, fn) => {
          listener = fn
        },
      },
      { open: async () => path, openPrototype: async () => undefined, save },
      'test',
      passportPlanView(passport),
    )
    const invoke = async (request: RequestOf<typeof channels.planFile>) =>
      channels.planFile.response.parse(await listener({}, request))
    expect(
      await invoke({
        action: 'editor',
        command: { kind: 'editions' },
        revision: 0,
        area: 'district',
      }),
    ).toMatchObject({ status: 'editions', editions: [{ id: edition.id, status: 'active' }] })
    expect(
      await invoke({
        action: 'editor',
        command: { kind: 'create', editionId: edition.id, year: 2027 },
        revision: 0,
        area: 'district',
      }),
    ).toMatchObject({ status: 'editor', state: { revision: 1, hasFile: false } })
    expect(
      await invoke({
        action: 'editor',
        command: {
          kind: 'add',
          draft: {
            kind: 'X',
            mode: 'line',
            line: 'line',
            text: '20 км пк 10',
            station: '',
            objectKind: 'none',
            objectNumber: '',
            volume: '',
            note: 'Учебная работа',
            callout: true,
          },
        },
        revision: 1,
        area: 'district',
      }),
    ).toMatchObject({ status: 'editor', state: { view: { works: [{ volume: 0.064 }] } } })
    expect(
      await invoke({
        action: 'editor',
        command: { kind: 'save', saveAs: false },
        revision: 2,
        area: 'district',
      }),
    ).toMatchObject({ status: 'editor', state: { dirty: false, hasFile: true } })
    expect(save).toHaveBeenCalledOnce()
    const plan = value(decodePlan(await readFile(path, 'utf8')))
    expect(plan.basis.lines.get('line')?.kmLengths.lengthOf(20)).toBe(964)
    expect(plan.works).toHaveLength(1)
    expect(await invoke({ action: 'previewSheets', open: false })).toMatchObject({
      status: 'sheets',
      source: { year: 2027, pds: [{ id: 'pd', pchu: 'ПЧУ-1', works: [{ volume: 0.064 }] }] },
    })
    expect(value(await passport.planningData(edition.id))).toEqual(original)
    value(await passport.createDraft({ date: '2027-01-01', label: 'Следующая редакция' }))
    expect(value(decodePlan(await readFile(path, 'utf8')))).toEqual(plan)
  } finally {
    await stop()
    await passport.close()
    await rm(directory, { recursive: true, force: true })
  }
})
