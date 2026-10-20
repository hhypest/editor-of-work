// Проверка лицензий зависимостей, которые попадают в программу (CONTRIBUTING.md, «Зависимости и лицензии»).
// Проверяются зависимости из "dependencies" со всеми вложенными и Electron, который входит в exe.
// Запуск: npm run check:licenses
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export const ALLOWED_LICENSES = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'OFL-1.1',
  'Unlicense',
])

/** Пакеты, которые не входят в dependencies, но поставляются в exe. */
export const SHIPPED_DEV_PACKAGES = ['electron']

/**
 * Разрешена ли SPDX-лицензия: для OR достаточно одной разрешённой альтернативы,
 * для AND разрешены должны быть все части.
 */
export function isAllowedLicense(expression) {
  if (typeof expression !== 'string' || expression.trim() === '') return false
  const expr = expression.trim().replace(/^\((.*)\)$/, '$1')
  if (/\sOR\s/i.test(expr)) return expr.split(/\s+OR\s+/i).some((part) => isAllowedLicense(part))
  if (/\sAND\s/i.test(expr)) return expr.split(/\s+AND\s+/i).every((part) => isAllowedLicense(part))
  return ALLOWED_LICENSES.has(expr)
}

export function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type
  if (Array.isArray(pkg.licenses) && pkg.licenses.length > 0) {
    return pkg.licenses.map((l) => (typeof l === 'string' ? l : l.type)).join(' OR ')
  }
  return ''
}

function readPackageJson(name, fromDir) {
  const require = createRequire(join(fromDir, 'noop.js'))
  try {
    const path = require.resolve(`${name}/package.json`)
    return { pkg: JSON.parse(readFileSync(path, 'utf8')), dir: dirname(path) }
  } catch {
    return null
  }
}

export function collectShipped(rootDir) {
  const root = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))
  const queue = [
    ...Object.keys(root.dependencies ?? {}).map((name) => [name, rootDir]),
    ...SHIPPED_DEV_PACKAGES.map((name) => [name, rootDir]),
  ]
  const seen = new Map()
  while (queue.length > 0) {
    const [name, from] = queue.shift()
    const found = readPackageJson(name, from)
    if (!found) continue
    const key = `${found.pkg.name}@${found.pkg.version}`
    if (seen.has(key)) continue
    seen.set(key, licenseOf(found.pkg))
    for (const dep of Object.keys(found.pkg.dependencies ?? {})) queue.push([dep, found.dir])
  }
  return seen
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
  const shipped = collectShipped(rootDir)
  const bad = [...shipped].filter(([, license]) => !isAllowedLicense(license))
  if (bad.length > 0) {
    console.error('Зависимости с неразрешённой или неизвестной лицензией:')
    for (const [pkg, license] of bad) console.error(`  ${pkg}: ${license || 'не указана'}`)
    process.exit(1)
  }
  console.log(`check:licenses — ${shipped.size} пакетов, все лицензии разрешены.`)
}
