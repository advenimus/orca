import { afterEach, describe, expect, it, vi } from 'vitest'

type StoredListener = (event: KeyboardEvent) => void

function createWindowStub(): {
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  dispatch: (type: string, event: KeyboardEvent) => void
} {
  const listeners = new Map<string, Set<StoredListener>>()
  return {
    addEventListener: vi.fn((type: string, listener: StoredListener) => {
      const bucket = listeners.get(type) ?? new Set<StoredListener>()
      bucket.add(listener)
      listeners.set(type, bucket)
    }),
    removeEventListener: vi.fn((type: string, listener: StoredListener) => {
      listeners.get(type)?.delete(listener)
    }),
    dispatch: (type, event) => {
      for (const listener of listeners.get(type) ?? []) {
        listener(event)
      }
    }
  }
}

describe('alt key state', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('shares one window listener set across subscribers and only notifies on value changes', async () => {
    const windowStub = createWindowStub()
    vi.stubGlobal('window', windowStub)
    const { getAltKeySnapshot, subscribeAltKey } = await import('./alt-key-state')
    const first = vi.fn()
    const second = vi.fn()

    const unsubscribeFirst = subscribeAltKey(first)
    const unsubscribeSecond = subscribeAltKey(second)

    expect(windowStub.addEventListener).toHaveBeenCalledTimes(3)
    windowStub.dispatch('keydown', { altKey: true } as KeyboardEvent)
    expect(getAltKeySnapshot()).toBe(true)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    windowStub.dispatch('keydown', { altKey: true } as KeyboardEvent)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    unsubscribeFirst()
    expect(windowStub.removeEventListener).not.toHaveBeenCalled()
    windowStub.dispatch('keyup', { altKey: false } as KeyboardEvent)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)

    unsubscribeSecond()
    expect(windowStub.removeEventListener).toHaveBeenCalledTimes(3)
    expect(getAltKeySnapshot()).toBe(false)
  })

  it('tracks Alt on non-Mac platforms too', async () => {
    const windowStub = createWindowStub()
    vi.stubGlobal('navigator', { userAgent: 'Windows' })
    vi.stubGlobal('window', windowStub)
    const { getAltKeySnapshot, subscribeAltKey } = await import('./alt-key-state')
    const listener = vi.fn()

    const unsubscribe = subscribeAltKey(listener)

    expect(windowStub.addEventListener).toHaveBeenCalledTimes(3)
    windowStub.dispatch('keydown', { altKey: true } as KeyboardEvent)
    expect(getAltKeySnapshot()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
})
