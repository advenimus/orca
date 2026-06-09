import type { Terminal } from '@xterm/xterm'

// Why: xterm's built-in scrollbar stays disabled (see pane-terminal-options.ts) —
// it makes FitAddon reserve a column-eating gutter and destabilizes scroll
// restore after workspace switches. This overlay only *reads* xterm scroll
// state and renders its own thumb, so it cannot feed back into xterm's
// viewport sync; dragging goes through the public scrollLines/scrollToLine API
// like any user scroll.

const HIDE_DELAY_MS = 1200
const MIN_THUMB_HEIGHT_PX = 20

export function attachPaneOverlayScrollbar(terminal: Terminal, host: HTMLElement): () => void {
  if (typeof document === 'undefined') {
    return () => {}
  }
  const track = document.createElement('div')
  track.className = 'pane-overlay-scrollbar'
  const thumb = document.createElement('div')
  thumb.className = 'pane-overlay-scrollbar-thumb'
  track.appendChild(thumb)
  host.appendChild(track)

  let rafId: number | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let hovering = false
  let dragging = false
  let disposed = false

  // Why: reading clientHeight forces synchronous layout, and the thumb relays
  // out on every scroll event during PTY output storms. Cache the height and
  // let the observer refresh it so scroll-driven updates stay layout-free.
  let trackHeight = track.clientHeight
  const trackResizeObserver =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          trackHeight = track.clientHeight
          scheduleLayout()
        })
      : null
  trackResizeObserver?.observe(track)

  function totalLines(): number {
    return terminal.buffer.active.baseY + terminal.rows
  }

  function hasScrollback(): boolean {
    return terminal.buffer.active.type === 'normal' && terminal.buffer.active.baseY > 0
  }

  function layoutThumb(): void {
    if (!hasScrollback() || trackHeight <= 0) {
      track.classList.remove('is-visible')
      return
    }
    const total = totalLines()
    const thumbHeight = Math.max(
      MIN_THUMB_HEIGHT_PX,
      Math.round((terminal.rows / total) * trackHeight)
    )
    const maxTop = trackHeight - thumbHeight
    const scrollFrac = terminal.buffer.active.viewportY / terminal.buffer.active.baseY
    thumb.style.height = `${thumbHeight}px`
    thumb.style.transform = `translateY(${Math.round(maxTop * scrollFrac)}px)`
  }

  function scheduleLayout(): void {
    if (rafId !== null) {
      return
    }
    rafId = requestAnimationFrame(() => {
      rafId = null
      layoutThumb()
    })
  }

  function scheduleHide(): void {
    if (hideTimer !== null) {
      clearTimeout(hideTimer)
    }
    hideTimer = setTimeout(() => {
      hideTimer = null
      if (!hovering && !dragging) {
        track.classList.remove('is-visible')
      }
    }, HIDE_DELAY_MS)
  }

  function isVisible(): boolean {
    return track.classList.contains('is-visible')
  }

  function reveal(): void {
    if (disposed || !hasScrollback()) {
      return
    }
    if (!isVisible()) {
      // One layout read per reveal, not per scroll event while visible.
      trackHeight = track.clientHeight
      track.classList.add('is-visible')
    }
    scheduleLayout()
    scheduleHide()
  }

  // Why: while hidden the overlay must be completely inert. Workspace-switch
  // restores fire scroll/write storms, and any per-event work in that window
  // can starve xterm's deferred scroll-restore (the instability that got the
  // previous xterm scrollbar removed). Reveal only on direct user input.
  const onScroll = terminal.onScroll(() => {
    if (isVisible()) {
      scheduleLayout()
      scheduleHide()
    }
  })
  // Output growth shifts the thumb even when the viewport line is unchanged.
  const onWrite = terminal.onWriteParsed(() => {
    if (isVisible()) {
      scheduleLayout()
    }
  })
  const onResize = terminal.onResize(() => {
    if (isVisible()) {
      scheduleLayout()
    }
  })

  // Capture phase: xterm's scrollable element stops propagation of consumed
  // wheel events, so a bubble listener on the host would never fire.
  const onHostWheel = (): void => reveal()

  function lineAtTrackDelta(deltaPx: number, startLine: number): number {
    const scrollableHeight = track.clientHeight - thumb.clientHeight
    if (scrollableHeight <= 0) {
      return startLine
    }
    const lineDelta = Math.round((deltaPx / scrollableHeight) * terminal.buffer.active.baseY)
    return Math.max(0, Math.min(terminal.buffer.active.baseY, startLine + lineDelta))
  }

  let dragStartY = 0
  let dragStartLine = 0

  const onThumbPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    dragging = true
    dragStartY = event.clientY
    dragStartLine = terminal.buffer.active.viewportY
    try {
      thumb.setPointerCapture(event.pointerId)
    } catch {
      // Why: capture is best-effort; synthetic events carry no live pointerId.
    }
    track.classList.add('is-dragging')
  }

  const onThumbPointerMove = (event: PointerEvent): void => {
    if (!dragging) {
      return
    }
    const target = lineAtTrackDelta(event.clientY - dragStartY, dragStartLine)
    terminal.scrollLines(target - terminal.buffer.active.viewportY)
  }

  const endThumbDrag = (): void => {
    if (!dragging) {
      return
    }
    dragging = false
    track.classList.remove('is-dragging')
    scheduleHide()
  }

  // Jump-scroll when clicking the track outside the thumb.
  const onTrackPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || event.target === thumb || !hasScrollback()) {
      return
    }
    event.preventDefault()
    const rect = track.getBoundingClientRect()
    const frac = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0
    const target = Math.max(
      0,
      Math.min(terminal.buffer.active.baseY, Math.round(frac * totalLines() - terminal.rows / 2))
    )
    terminal.scrollToLine(target)
  }

  // Forward wheel input so the visible track doesn't dead-zone the right edge.
  const onTrackWheel = (event: WheelEvent): void => {
    event.preventDefault()
    const cellHeight = host.clientHeight / Math.max(1, terminal.rows)
    const lines = Math.round(event.deltaY / Math.max(1, cellHeight))
    if (lines !== 0) {
      terminal.scrollLines(lines)
    }
  }

  const onTrackPointerEnter = (): void => {
    hovering = true
    reveal()
  }

  const onTrackPointerLeave = (): void => {
    hovering = false
    scheduleHide()
  }

  host.addEventListener('wheel', onHostWheel, { capture: true, passive: true })
  thumb.addEventListener('pointerdown', onThumbPointerDown)
  thumb.addEventListener('pointermove', onThumbPointerMove)
  thumb.addEventListener('pointerup', endThumbDrag)
  thumb.addEventListener('pointercancel', endThumbDrag)
  track.addEventListener('pointerdown', onTrackPointerDown)
  track.addEventListener('wheel', onTrackWheel, { passive: false })
  track.addEventListener('pointerenter', onTrackPointerEnter)
  track.addEventListener('pointerleave', onTrackPointerLeave)

  return () => {
    disposed = true
    onScroll.dispose()
    onWrite.dispose()
    onResize.dispose()
    trackResizeObserver?.disconnect()
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    if (hideTimer !== null) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
    host.removeEventListener('wheel', onHostWheel, { capture: true })
    thumb.removeEventListener('pointerdown', onThumbPointerDown)
    thumb.removeEventListener('pointermove', onThumbPointerMove)
    thumb.removeEventListener('pointerup', endThumbDrag)
    thumb.removeEventListener('pointercancel', endThumbDrag)
    track.removeEventListener('pointerdown', onTrackPointerDown)
    track.removeEventListener('wheel', onTrackWheel)
    track.removeEventListener('pointerenter', onTrackPointerEnter)
    track.removeEventListener('pointerleave', onTrackPointerLeave)
    track.remove()
  }
}
