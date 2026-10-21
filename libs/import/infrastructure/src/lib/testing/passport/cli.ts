import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { generatePassportFixtures } from './generate'

/** `npm run fixtures [папка]` — по умолчанию tmp/fixtures/passport (вне Git). */
async function main(): Promise<void> {
  const out = resolve(process.argv[2] ?? 'tmp/fixtures/passport')
  await rm(out, { recursive: true, force: true })
  const files = await generatePassportFixtures()
  for (const f of files) {
    const target = join(out, f.path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, f.bytes)
  }
  process.stdout.write(`Фикстуры паспорта: ${files.length} файлов в ${out}\n`)
}

void main()
