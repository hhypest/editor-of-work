// Проверка лицензий зависимостей, которые попадают в программу (CONTRIBUTING.md, «Зависимости и лицензии»).
// Проверяются зависимости из "dependencies" со всеми вложенными (включая optionalDependencies)
// и Electron, который входит в exe. Запуск: npm run check:licenses
import { existsSync, readFileSync } from 'node:fs'
import { builtinModules, createRequire } from 'node:module'
import { dirname, join } from 'node:path'
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

/** Разбор выражения SPDX с OR, AND, WITH и скобками любой вложенности. */
export function parseSpdx(expression) {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? []
  let pos = 0
  const peek = () => tokens[pos]
  const next = () => tokens[pos++]

  function primary() {
    const token = next()
    if (token === undefined) throw new Error('неожиданный конец выражения')
    if (token === '(') {
      const inner = or()
      if (next() !== ')') throw new Error('нет закрывающей скобки')
      return inner
    }
    if (token === ')' || /^(AND|OR|WITH)$/i.test(token)) throw new Error(`неожиданное «${token}»`)
    if (peek()?.toUpperCase() === 'WITH') {
      next()
      const exception = next()
      if (exception === undefined) throw new Error('нет исключения после WITH')
      return { license: token, exception }
    }
    return { license: token }
  }
  function and() {
    let left = primary()
    while (peek()?.toUpperCase() === 'AND') {
      next()
      left = { and: [left, primary()] }
    }
    return left
  }
  function or() {
    let left = and()
    while (peek()?.toUpperCase() === 'OR') {
      next()
      left = { or: [left, and()] }
    }
    return left
  }

  const tree = or()
  if (pos !== tokens.length) throw new Error(`лишнее «${tokens[pos]}»`)
  return tree
}

function allowedNode(node) {
  if ('or' in node) return node.or.some(allowedNode)
  if ('and' in node) return node.and.every(allowedNode)
  // Лицензия с исключением (WITH) допускается только при отдельном решении — сейчас таких нет.
  return node.exception === undefined && ALLOWED_LICENSES.has(node.license)
}

/** Разрешена ли SPDX-лицензия: для OR достаточно одной альтернативы, для AND — все части. */
export function isAllowedLicense(expression) {
  if (typeof expression !== 'string' || expression.trim() === '') return false
  try {
    return allowedNode(parseSpdx(expression.trim()))
  } catch {
    return false
  }
}

export function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type
  if (Array.isArray(pkg.licenses) && pkg.licenses.length > 0) {
    return pkg.licenses.map((l) => (typeof l === 'string' ? l : l.type)).join(' OR ')
  }
  return ''
}

/**
 * Каталог пакета по правилам поиска node_modules, без обращения к его "exports":
 * пакет, который не экспортирует package.json, всё равно должен быть найден и проверен.
 */
export function findPackageDir(name, fromDir) {
  const require = createRequire(join(fromDir, 'noop.js'))
  for (const base of require.resolve.paths(name) ?? []) {
    const dir = join(base, name)
    if (existsSync(join(dir, 'package.json'))) return dir
  }
  return null
}

const builtins = new Set(builtinModules)

export function collectShipped(rootDir) {
  const root = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))
  const queue = [
    ...Object.keys(root.dependencies ?? {}).map((name) => ({
      name,
      from: rootDir,
      optional: false,
    })),
    ...SHIPPED_DEV_PACKAGES.map((name) => ({ name, from: rootDir, optional: false })),
  ]
  const seen = new Map()
  const missing = []
  while (queue.length > 0) {
    const { name, from, optional } = queue.shift()
    if (builtins.has(name)) continue
    const dir = findPackageDir(name, from)
    if (!dir) {
      // Необязательная зависимость другой платформы может отсутствовать; обязательная — ошибка.
      if (!optional) missing.push(`${name} (нужен для ${from})`)
      continue
    }
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const key = `${pkg.name}@${pkg.version}`
    if (seen.has(key)) continue
    seen.set(key, licenseOf(pkg))
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      queue.push({ name: dep, from: dir, optional: false })
    }
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) {
      queue.push({ name: dep, from: dir, optional: true })
    }
  }
  return { shipped: seen, missing }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
  const { shipped, missing } = collectShipped(rootDir)
  const bad = [...shipped].filter(([, license]) => !isAllowedLicense(license))
  if (missing.length > 0) {
    console.error('Не удалось найти установленные зависимости (выполните npm ci):')
    for (const name of missing) console.error(`  ${name}`)
  }
  if (bad.length > 0) {
    console.error('Зависимости с неразрешённой или неизвестной лицензией:')
    for (const [pkg, license] of bad) console.error(`  ${pkg}: ${license || 'не указана'}`)
  }
  if (missing.length > 0 || bad.length > 0) process.exit(1)
  console.log(`check:licenses — ${shipped.size} пакетов, все лицензии разрешены.`)
}
