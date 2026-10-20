import { vi } from 'vitest'
import { createAnnualPlan, samplePlanBasis } from '@eow/planning/domain'
import type { PlanStore } from '@eow/planning/application'
import { startPlanAutosave } from './plan-autosave'

describe('автосохранение', () => {
  afterEach(() => vi.useRealTimers())
  it('сохраняет текущий снимок раз в минуту и останавливает таймер', async () => {
    vi.useFakeTimers()
    const result = createAnnualPlan(2027, samplePlanBasis())
    if (!result.ok) throw new Error('нет плана')
    const autosave = vi
      .fn<PlanStore['autosave']>()
      .mockResolvedValue({ ok: true, value: undefined })
    const store = { autosave }
    const stop = startPlanAutosave(store, () => result.value, vi.fn())
    await vi.advanceTimersByTimeAsync(59_999)
    expect(autosave).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(autosave).toHaveBeenCalledWith(result.value)
    await stop()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(autosave).toHaveBeenCalledTimes(1)
  })
})
