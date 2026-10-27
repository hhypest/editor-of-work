import { test } from 'node:test'
import assert from 'node:assert/strict'
import { config } from '../package-portable.mjs'

test('переносная сборка: один portable exe x64 без прав администратора и без публикации', () => {
  assert.deepEqual(config.win.target, [{ target: 'portable', arch: ['x64'] }])
  assert.equal(config.portable.requestExecutionLevel, 'user')
  // Программа не обращается к сети: ни автообновления, ни публикации из сборки.
  assert.equal(config.publish, null)
})

test('в программу попадают только собранные main, preload, интерфейс и лицензии', () => {
  assert.equal(config.directories.app, 'dist/apps/desktop')
  assert.ok(config.files.includes('!node_modules{,/**}'))
  assert.ok(config.files.includes('!**/*.map'))
  assert.deepEqual(
    config.extraResources.map((r) => r.to),
    ['ui', 'licenses/LICENSE.txt', 'licenses/3rdpartylicenses.txt'],
  )
  // Тот же Electron из lock-файла, что прошёл check:electron и test:e2e.
  assert.equal(config.electronDist, 'node_modules/electron/dist')
})
