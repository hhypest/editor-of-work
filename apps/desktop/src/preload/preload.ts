import { contextBridge, ipcRenderer } from 'electron'
import { channels, EOW_API_KEY, type EowApi } from '@eow/ipc/contracts'

// Единственный объект, доступный renderer: по методу на канал контракта.
// Проверка данных — в main; здесь только проброс без доступа к Node.
const api = Object.fromEntries(
  Object.entries(channels).map(([key, channel]) => [
    key,
    (request: unknown) => ipcRenderer.invoke(channel.name, request),
  ]),
) as unknown as EowApi

contextBridge.exposeInMainWorld(EOW_API_KEY, Object.freeze(api))
