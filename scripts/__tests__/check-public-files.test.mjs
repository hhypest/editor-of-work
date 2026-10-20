import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findForbiddenFiles } from '../check-public-files.mjs'

test('находит выгрузки, базы, планы, PDF и архивы', () => {
  const paths = [
    'docs/architecture.md',
    'fixtures/96857397.xls',
    'data/Экспликация.XLSX',
    'data/passport.sqlite',
    'plans/2027.ppr.json',
    'out/лист.pdf',
    'archive.7z',
    'private-data/readme.txt',
    'apps/ui/src/app/app.ts',
    'data/passport.sqlite-wal',
    'backup.tar.gz',
  ]
  assert.deepEqual(findForbiddenFiles(paths), [
    'fixtures/96857397.xls',
    'data/Экспликация.XLSX',
    'data/passport.sqlite',
    'plans/2027.ppr.json',
    'out/лист.pdf',
    'archive.7z',
    'private-data/readme.txt',
    'data/passport.sqlite-wal',
    'backup.tar.gz',
  ])
})

test('пропускает исходники и обычный JSON', () => {
  assert.deepEqual(findForbiddenFiles(['package.json', 'libs/x/src/index.ts', 'nx.json']), [])
})
