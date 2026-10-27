// Заполняет выданный программой шаблон так, как это делает составитель в Excel:
// дописывает длины нестандартных километров вымышленных направлений. Только для E2E.
import { readFile, writeFile } from 'node:fs/promises'
import { XlsxManualDataTemplate } from '@eow/import/infrastructure'

async function main(): Promise<void> {
  const [path, lengths] = process.argv.slice(2)
  if (!path || !lengths) throw new Error('Нужны путь к книге и JSON длин км')
  const template = new XlsxManualDataTemplate()
  const content = await template.read(await readFile(path))
  if (!content.ok) throw new Error(JSON.stringify(content.error))
  const extra = (JSON.parse(lengths) as [string, number, number][]).map(
    ([line, km, length], i) => ({
      id: `e2e-km-${i}`,
      validFrom: null,
      validTo: null,
      line,
      km,
      length,
    }),
  )
  const written = await template.write({
    token: content.value.basisToken,
    date: content.value.date,
    lines: [],
    trackClasses: [],
    data: { ...content.value.data, kilometres: [...content.value.data.kilometres, ...extra] },
  })
  if (!written.ok) throw new Error(JSON.stringify(written.error))
  await writeFile(path, written.value)
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
