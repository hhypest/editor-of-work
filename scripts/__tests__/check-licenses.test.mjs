import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findPackageDir, isAllowedLicense, licenseOf, parseSpdx } from '../check-licenses.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('разрешительные лицензии проходят', () => {
  for (const l of ['MIT', 'ISC', 'Apache-2.0', 'BSD-3-Clause', '(MIT OR Apache-2.0)']) {
    assert.equal(isAllowedLicense(l), true, l)
  }
})

test('копилефт и неизвестные лицензии не проходят', () => {
  for (const l of ['GPL-3.0', 'AGPL-3.0-only', 'LGPL-2.1', 'UNLICENSED', '', undefined]) {
    assert.equal(isAllowedLicense(l), false, String(l))
  }
})

test('AND требует разрешения всех частей, OR — одной', () => {
  assert.equal(isAllowedLicense('MIT AND GPL-3.0'), false)
  assert.equal(isAllowedLicense('GPL-3.0 OR MIT'), true)
})

test('читает лицензию из старых форматов package.json', () => {
  assert.equal(licenseOf({ license: { type: 'MIT' } }), 'MIT')
  assert.equal(
    licenseOf({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] }),
    'MIT OR Apache-2.0',
  )
  assert.equal(licenseOf({}), '')
})

test('вложенные скобки и WITH', () => {
  assert.equal(isAllowedLicense('(MIT OR Apache-2.0) AND ISC'), true)
  assert.equal(isAllowedLicense('((MIT AND ISC) OR GPL-3.0) AND BSD-3-Clause'), true)
  assert.equal(isAllowedLicense('(MIT OR Apache-2.0) AND GPL-3.0'), false)
  assert.equal(isAllowedLicense('GPL-2.0 WITH Classpath-exception-2.0'), false)
  assert.equal(isAllowedLicense('(MIT'), false)
  assert.deepEqual(parseSpdx('MIT OR ISC'), { or: [{ license: 'MIT' }, { license: 'ISC' }] })
})

test('находит пакет, который не экспортирует package.json', () => {
  // @standard-schema/spec экспортирует только точку входа; раньше он пропускался молча.
  assert.notEqual(findPackageDir('@standard-schema/spec', rootDir), null)
})
