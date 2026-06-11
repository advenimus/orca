import { useCallback, useEffect, useRef, useState } from 'react'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import type { TabGroupLayoutNode } from '../../../../shared/types'
import { useAppStore } from '../../store'
import TabGroupPanel from './TabGroupPanel'
import TabDragPreview from '../tab-bar/TabDragPreview'
import { type HoveredTabInsertion, type TabDropZone, useTabDragSplit } from './useTabDragSplit'

const MIN_RATIO = 0.15
const MAX_RATIO = 0.85

function ResizeHandle({
  direction,
  onResizeStart,
  onRatioChange
}: {
  direction: 'horizontal' | 'vertical'
  onResizeStart: () => void
  onRatioChange: (ratio: number) => void
}): React.JSX.Element {
  const isHorizontal = direction === 'horizontal'
  const [dragging, setDragging] = useState(false)
  const activeResizeCleanupRef = useRef<((updateDragging?: boolean) => void) | null>(null)

  useEffect(
    () => () => {
      activeResizeCleanupRef.current?.(false)
    },
    []
  )

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const handle = event.currentTarget
      const container = handle.parentElement
      if (!container) {
        return
      }
      activeResizeCleanupRef.current?.()
      onResizeStart()
      setDragging(true)
      handle.setPointerCapture(event.pointerId)

      const onPointerMove = (moveEvent: PointerEvent): void => {
        if (!handle.hasPointerCapture(event.pointerId)) {
          return
        }
        const rect = container.getBoundingClientRect()
        const ratio = isHorizontal
          ? (moveEvent.clientX - rect.left) / rect.width
          : (moveEvent.clientY - rect.top) / rect.height
        onRatioChange(Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)))
      }

      let cleaned = false
      const cleanup = (updateDragging = true): void => {
        if (cleaned) {
          return
        }
        cleaned = true
        if (updateDragging) {
          setDragging(false)
        }
        try {
          if (handle.hasPointerCapture(event.pointerId)) {
            handle.releasePointerCapture(event.pointerId)
          }
        } catch {
          // Best effort: unmount cleanup can run after Chromium has already dropped capture.
        }
        handle.removeEventListener('pointermove', onPointerMove)
        handle.removeEventListener('pointerup', onPointerUp)
        handle.removeEventListener('pointercancel', onPointerCancel)
        handle.removeEventListener('lostpointercapture', onLostPointerCapture)
        if (activeResizeCleanupRef.current === cleanup) {
          activeResizeCleanupRef.current = null
        }
      }

      const onPointerUp = (): void => {
        cleanup()
      }

      const onPointerCancel = (): void => {
        cleanup()
      }

      const onLostPointerCapture = (): void => {
        cleanup()
      }

      handle.addEventListener('pointermove', onPointerMove)
      handle.addEventListener('pointerup', onPointerUp)
      handle.addEventListener('pointercancel', onPointerCancel)
      handle.addEventListener('lostpointercapture', onLostPointerCapture)
      activeResizeCleanupRef.current = cleanup
    },
    [isHorizontal, onRatioChange, onResizeStart]
  )

  return (
    <div
      className={`shrink-0 ${
        isHorizontal ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'
      } ${dragging ? 'bg-accent' : 'bg-border hover:bg-accent/50'}`}
      onPointerDown={onPointerDown}
    />
  )
}

function SplitNode({
  node,
  nodePath,
  worktreeId,
  focusedGroupId,
  isWorktreeActive,
  hasSplitGroups,
  touchesTopEdge,
  touchesRightEdge,
  touchesLeftEdge,
  isTabDragActive,
  activeDropGroupId,
  activeDropZone,
  hoveredTabInsertion
}: {
  node: TabGroupLayoutNode
  nodePath: string
  worktreeId: string
  focusedGroupId?: string
  isWorktreeActive: boolean
  hasSplitGroups: boolean
  touchesTopEdge: boolean
  touchesRightEdge: boolean
  touchesLeftEdge: boolean
  isTabDragActive: boolean
  activeDropGroupId: string | null
  activeDropZone: TabDropZone | null
  hoveredTabInsertion: HoveredTabInsertion | null
}): React.JSX.Element {
  const setTabGroupSplitRatio = useAppStore((state) => state.setTabGroupSplitRatio)
  const recordFeatureInteraction = useAppStore((state) => state.recordFeatureInteraction)

  if (node.type === 'leaf') {
    return (
      <TabGroupPanel
        groupId={node.groupId}
        worktreeId={worktreeId}
        // Why: hidden worktrees stay mounted so their PTYs and split layouts
        // survive worktree switches, but only the visible worktree may own the
        // global terminal shortcuts. If an offscreen group's pane stays
        // "focused", Cmd/Ctrl+W and split shortcuts can hit the wrong worktree.
        isFocused={isWorktreeActive && node.groupId === focusedGroupId}
        hasSplitGroups={hasSplitGroups}
        touchesRightEdge={touchesRightEdge}
        touchesLeftEdge={touchesLeftEdge}
        reserveClosedExplorerToggleSpace={touchesTopEdge && touchesRightEdge}
        reserveCollapsedSidebarHeaderSpace={touchesTopEdge && touchesLeftEdge}
        isTabDragActive={isTabDragActive}
        activeDropZone={activeDropGroupId === node.groupId ? activeDropZone : null}
        hoveredTabInsertion={
          hoveredTabInsertion?.groupId === node.groupId ? hoveredTabInsertion : null
        }
      />
    )
  }

  const isHorizontal = node.direction === 'horizontal'
  const ratio = node.ratio ?? 0.5

  return (
    <div
      className="flex flex-1 min-w-0 min-h-0 overflow-hidden"
      style={{ flexDirection: isHorizontal ? 'row' : 'column' }}
    >
      <div className="flex min-w-0 min-h-0 overflow-hidden" style={{ flex: `${ratio} 1 0%` }}>
        <SplitNode
          node={node.first}
          nodePath={nodePath.length > 0 ? `${nodePath}.first` : 'first'}
          worktreeId={worktreeId}
          focusedGroupId={focusedGroupId}
          isWorktreeActive={isWorktreeActive}
          hasSplitGroups={hasSplitGroups}
          touchesTopEdge={touchesTopEdge}
          touchesRightEdge={isHorizontal ? false : touchesRightEdge}
          touchesLeftEdge={touchesLeftEdge}
          isTabDragActive={isTabDragActive}
          activeDropGroupId={activeDropGroupId}
          activeDropZone={activeDropZone}
          hoveredTabInsertion={hoveredTabInsertion}
        />
      </div>
      <ResizeHandle
        direction={node.direction}
        onResizeStart={() => recordFeatureInteraction('terminal-panes')}
        onRatioChange={(nextRatio) => setTabGroupSplitRatio(worktreeId, nodePath, nextRatio)}
      />
      <div className="flex min-w-0 min-h-0 overflow-hidden" style={{ flex: `${1 - ratio} 1 0%` }}>
        <SplitNode
          node={node.second}
          nodePath={nodePath.length > 0 ? `${nodePath}.second` : 'second'}
          worktreeId={worktreeId}
          focusedGroupId={focusedGroupId}
          isWorktreeActive={isWorktreeActive}
          hasSplitGroups={hasSplitGroups}
          touchesTopEdge={isHorizontal ? touchesTopEdge : false}
          touchesRightEdge={touchesRightEdge}
          touchesLeftEdge={isHorizontal ? false : touchesLeftEdge}
          isTabDragActive={isTabDragActive}
          activeDropGroupId={activeDropGroupId}
          activeDropZone={activeDropZone}
          hoveredTabInsertion={hoveredTabInsertion}
        />
      </div>
    </div>
  )
}

export default function TabGroupSplitLayout({
  layout,
  worktreeId,
  focusedGroupId,
  isWorktreeActive
}: {
  layout: TabGroupLayoutNode
  worktreeId: string
  focusedGroupId?: string
  isWorktreeActive: boolean
}): React.JSX.Element {
  const dragSplit = useTabDragSplit({ worktreeId, enabled: isWorktreeActive })
  const hasSplits = layout.type === 'split'

  return (
    <DndContext
      sensors={dragSplit.sensors}
      collisionDetection={dragSplit.collisionDetection}
      onDragStart={dragSplit.onDragStart}
      onDragMove={dragSplit.onDragMove}
      onDragOver={dragSplit.onDragOver}
      onDragEnd={dragSplit.onDragEnd}
      onDragCancel={dragSplit.onDragCancel}
      // Why: dnd-kit auto-scrolls the tab strip when the cursor approaches its
      // edge, which in a multi-group layout creates a feedback loop — scroll
      // shifts tabs under the cursor, `over` re-resolves, scroll runs again.
      // We don't need autoscroll for tab-bar drags (strip fits the viewport),
      // so disabling it is the simplest fix.
      autoScroll={false}
    >
      {/* Why `border-l` on the wrapper: paint the single full-height divider
          between the left sidebar and the terminal area, regardless of split
          state. The leftmost pane suppresses its own `border-l` via
          `touchesLeftEdge`, so the seam is always exactly 1px — previously
          both painted and stacked into a 2px bar.
          Why no dedicated top drag strip: the tab row (36px) is itself a
          window-drag region and now spans the full top band on its own, so
          the tabs sit flush against the window top with no card-colored gap
          above them while still aligning with the sibling `titlebar-left`. */}
      <div
        ref={dragSplit.setDragRootNode}
        className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden border-l border-border"
      >
        <div className="flex flex-1 min-w-0 min-h-0 overflow-hidden">
          <SplitNode
            node={layout}
            nodePath=""
            worktreeId={worktreeId}
            focusedGroupId={focusedGroupId}
            isWorktreeActive={isWorktreeActive}
            hasSplitGroups={hasSplits}
            touchesTopEdge={true}
            touchesRightEdge={true}
            touchesLeftEdge={true}
            isTabDragActive={dragSplit.activeDrag !== null}
            activeDropGroupId={dragSplit.hoveredDropTarget?.groupId ?? null}
            activeDropZone={dragSplit.hoveredDropTarget?.zone ?? null}
            hoveredTabInsertion={dragSplit.hoveredTabInsertion}
          />
        </div>
      </div>
      {/* Why: the sortable tab is anchored inside its source tab strip (no
          transform while dragging), and that strip uses overflow-hidden so
          the tab is invisible once the cursor leaves it. DragOverlay
          renders a ghost in a document-level portal that tracks the cursor
          across the whole window — the source tab keeps its spot, the
          ghost follows the cursor. */}
      <DragOverlay dropAnimation={null}>
        {dragSplit.activeDrag ? <TabDragPreview drag={dragSplit.activeDrag} /> : null}
      </DragOverlay>
    </DndContext>
  )
}
