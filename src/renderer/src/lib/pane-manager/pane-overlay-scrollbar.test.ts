// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { attachPaneOverlayScrollbar } from './pane-overlay-scrollbar'

type ScrollListener = () => void

function createFakeTerminal({
  baseY = 100,
  viewportY = 100
}: { baseY?: number; viewportY?: number } = {}): {
  terminal: Terminal
  emitScroll: () => void
  scrollLines: ReturnType<typeof vi.fn>
  scrollToLine: ReturnType<typeof vi.fn>
  buffer: { baseY: number; viewportY: number; type: string }
} {
  const scrollListeners: ScrollListener[] = []
  const buffer = { baseY, viewportY, type: 'normal' }
  const scrollLines = vi.fn((delta: number) => {
    buffer.viewportY = Math.max(0, Math.min(buffer.baseY, buffer.viewportY + delta))
  })
  const scrollToLine = vi.fn((line: number) => {
    buffer.viewportY = Math.max(0, Math.min(buffer.baseY, line))
  })
  const subscribe = (listeners: ScrollListener[]) => (listener: ScrollListener) => {
    listeners.push(listener)
    return { dispose: () => listeners.splice(listeners.indexOf(listener), 1) }
  }
  const terminal = {
    rows: 24,
    buffer: { active: buffer },
    onScroll: subscribe(scrollListeners),
    onWriteParsed: subscribe([]),
    onResize: subscribe([]),
    scrollLines,
    scrollToLine
  } as unknown as Terminal
  return {
    terminal,
    emitScroll: () => scrollListeners.forEach((listener) => listener()),
    scrollLines,
    scrollToLine,
    buffer
  }
}

function stubHeights(host: HTMLElement): { track: HTMLElement; thumb: HTMLElement } {
  const track = host.querySelector<HTMLElement>('.pane-overlay-scrollbar')!
  const thumb = host.querySelector<HTMLElement>('.pane-overlay-scrollbar-thumb')!
  Object.defineProperty(track, 'clientHeight', { value: 400, configurable: true })
  Object.defineProperty(thumb, 'clientHeight', { value: 80, configurable: true })
  track.getBoundingClientRect = () =>
    ({ top: 0, height: 400, left: 0, width: 10, right: 10, bottom: 400, x: 0, y: 0 }) as DOMRect
  return { track, thumb }
}

describe('attachPaneOverlayScrollbar', () => {
  it('mounts the track in the host and removes it on cleanup', () => {
    const host = document.createElement('div')
    const { terminal } = createFakeTerminal()
    const cleanup = attachPaneOverlayScrollbar(terminal, host)

    expect(host.querySelector('.pane-overlay-scrollbar-thumb')).not.toBeNull()
    cleanup()
    expect(host.querySelector('.pane-overlay-scrollbar')).toBeNull()
  })

  it('reveals on wheel input and fades after the idle delay', () => {
    vi.useFakeTimers()
    try {
      const host = document.createElement('div')
      const { terminal } = createFakeTerminal()
      const cleanup = attachPaneOverlayScrollbar(terminal, host)
      const { track } = stubHeights(host)

      host.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 }))
      expect(track.classList.contains('is-visible')).toBe(true)

      vi.advanceTimersByTime(1500)
      expect(track.classList.contains('is-visible')).toBe(false)
      cleanup()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stays inert on programmatic scroll events while hidden', () => {
    // Why: workspace-switch restores fire scroll storms; the hidden overlay
    // must not add per-event work or reveal itself during them.
    const host = document.createElement('div')
    const { terminal, emitScroll } = createFakeTerminal()
    const cleanup = attachPaneOverlayScrollbar(terminal, host)
    const { track } = stubHeights(host)

    emitScroll()
    expect(track.classList.contains('is-visible')).toBe(false)
    cleanup()
  })

  it('does not reveal when there is no scrollback', () => {
    const host = document.createElement('div')
    const { terminal } = createFakeTerminal({ baseY: 0, viewportY: 0 })
    const cleanup = attachPaneOverlayScrollbar(terminal, host)
    const { track } = stubHeights(host)

    host.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 }))
    expect(track.classList.contains('is-visible')).toBe(false)
    cleanup()
  })

  it('scrolls the terminal proportionally while dragging the thumb', () => {
    const host = document.createElement('div')
    const { terminal, scrollLines, buffer } = createFakeTerminal({ baseY: 100, viewportY: 0 })
    const cleanup = attachPaneOverlayScrollbar(terminal, host)
    const { thumb } = stubHeights(host)

    thumb.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientY: 0, bubbles: true }))
    // 320px of scrollable track maps to 100 lines of scrollback; 160px = 50 lines.
    thumb.dispatchEvent(new PointerEvent('pointermove', { clientY: 160, bubbles: true }))

    expect(scrollLines).toHaveBeenCalledWith(50)
    expect(buffer.viewportY).toBe(50)
    cleanup()
  })

  it('jump-scrolls when clicking the track outside the thumb', () => {
    const host = document.createElement('div')
    const { terminal, scrollToLine } = createFakeTerminal({ baseY: 100, viewportY: 100 })
    const cleanup = attachPaneOverlayScrollbar(terminal, host)
    const { track } = stubHeights(host)

    track.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientY: 200, bubbles: true }))

    // Click at the track midpoint: half of 124 total lines, centered on the viewport.
    expect(scrollToLine).toHaveBeenCalledWith(50)
    cleanup()
  })
})
