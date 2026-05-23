import { useSyncExternalStore } from 'react'

type AltKeyListener = () => void

let altPressed = false
const listeners = new Set<AltKeyListener>()
let disposeWindowListeners: (() => void) | null = null

function setAltPressed(nextPressed: boolean): void {
  if (altPressed === nextPressed) {
    return
  }
  altPressed = nextPressed
  for (const listener of listeners) {
    listener()
  }
}

function startWindowListeners(): void {
  if (disposeWindowListeners || typeof window === 'undefined') {
    return
  }

  const handleKeyChange = (event: KeyboardEvent): void => setAltPressed(event.altKey)
  const handleWindowBlur = (): void => setAltPressed(false)
  window.addEventListener('keydown', handleKeyChange, true)
  window.addEventListener('keyup', handleKeyChange, true)
  window.addEventListener('blur', handleWindowBlur)
  disposeWindowListeners = () => {
    window.removeEventListener('keydown', handleKeyChange, true)
    window.removeEventListener('keyup', handleKeyChange, true)
    window.removeEventListener('blur', handleWindowBlur)
  }
}

export function subscribeAltKey(listener: AltKeyListener): () => void {
  listeners.add(listener)
  startWindowListeners()
  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) {
      return
    }
    disposeWindowListeners?.()
    disposeWindowListeners = null
    setAltPressed(false)
  }
}

export function getAltKeySnapshot(): boolean {
  return altPressed
}

export function useAltKeyPressed(): boolean {
  // Why: the sidebar can render dozens of cards. One shared external store
  // avoids a global key listener per card and only re-renders on Alt flips.
  return useSyncExternalStore(subscribeAltKey, getAltKeySnapshot, () => false)
}
