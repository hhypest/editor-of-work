import { overviewClient } from './overview-client'

describe('Порт предпросмотра в браузере', () => {
  it('сообщает об отсутствии настольного соединения', async () => {
    const client = overviewClient(undefined)
    expect(await client.editions()).toMatchObject({ ok: false })
    expect(await client.source(1)).toMatchObject({ ok: false })
  })
})
