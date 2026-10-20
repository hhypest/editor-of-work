import { channels } from './channels';

describe('контракт IPC', () => {
  it('имена каналов уникальны и имеют вид «контекст:действие»', () => {
    const names = Object.values(channels).map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z]+:[a-zA-Z]+$/);
  });

  it('app:info принимает только пустой запрос', () => {
    expect(channels.appInfo.request.safeParse({}).success).toBe(true);
    expect(channels.appInfo.request.safeParse({ path: 'C:\\' }).success).toBe(false);
  });

  it('app:info отклоняет ответ без версии', () => {
    expect(channels.appInfo.response.safeParse({ name: 'editor-of-work' }).success).toBe(false);
  });
});
