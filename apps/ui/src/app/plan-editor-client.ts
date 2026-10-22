import { channels, type EowApi } from '@eow/ipc/contracts'
import type { PlanEditorClient } from '@eow/planning/application'
export function planEditorClient(api: EowApi | undefined): PlanEditorClient {
  return {
    async send(command, revision, area) {
      if (!api) throw new Error('Редактор плана доступен в настольной программе editor-of-work.')
      const request = channels.planFile.request.safeParse({
        action: 'editor',
        command,
        revision,
        area,
      })
      if (!request.success)
        return {
          kind: 'invalid',
          issues: [
            {
              field: 'form',
              message: 'Проверьте заполнение полей, дату и длину текста.',
              start: null,
              end: null,
            },
          ],
        }
      const response = await api.planFile(request.data)
      switch (response.status) {
        case 'editor':
          return { kind: 'state', state: response.state }
        case 'place':
          return { kind: 'place', revision: response.revision, hint: response.hint }
        case 'invalid':
          return { kind: 'invalid', issues: response.issues }
        case 'cancelled':
          return { kind: 'cancelled' }
        case 'error':
          throw new Error(response.message)
        default:
          throw new Error('Не удалось получить состояние редактора плана.')
      }
    },
  }
}
