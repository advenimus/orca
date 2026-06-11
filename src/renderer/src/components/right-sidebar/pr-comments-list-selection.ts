import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getPRCommentGroupId,
  getPRCommentGroupRoot,
  groupPRComments,
  type PRCommentGroup
} from '@/lib/pr-comment-groups'
import type { PRComment } from '../../../../shared/types'

export type PRCommentsListSelection = {
  isSelectingForAI: boolean
  selectedGroupIds: ReadonlySet<string>
  selectableGroups: PRCommentGroup[]
  selectableGroupsById: ReadonlyMap<string, PRCommentGroup>
  selectedGroups: PRCommentGroup[]
  addGroupToSelection: (groupId: string) => void
  clearSelection: () => void
  toggleGroupSelection: (groupId: string, checked: boolean) => void
}

export function usePRCommentsListSelection(
  comments: PRComment[],
  selectionContextKey: string | undefined
): PRCommentsListSelection {
  const [isSelectingForAI, setIsSelectingForAI] = useState(false)
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(() => new Set())

  // Why: selectable groups come from the unfiltered list so switching the
  // audience filter doesn't silently drop already-selected comments.
  const canonicalGroups = useMemo(() => groupPRComments(comments), [comments])
  const selectableGroups = useMemo(
    () => canonicalGroups.filter((group) => getPRCommentGroupRoot(group).isResolved !== true),
    [canonicalGroups]
  )
  const selectableGroupsById = useMemo(() => {
    const map = new Map<string, PRCommentGroup>()
    for (const group of selectableGroups) {
      map.set(getPRCommentGroupId(group), group)
    }
    return map
  }, [selectableGroups])
  const selectedGroups = useMemo(
    () =>
      [...selectedGroupIds]
        .map((groupId) => selectableGroupsById.get(groupId))
        .filter((group): group is PRCommentGroup => group !== undefined),
    [selectableGroupsById, selectedGroupIds]
  )

  // Why: a selection belongs to one review context; switching PR/MR or branch
  // must not carry checked comments over to the next review.
  useEffect(() => {
    setIsSelectingForAI(false)
    setSelectedGroupIds(new Set())
  }, [selectionContextKey])

  // Why: comments can become ineligible mid-selection (resolved elsewhere,
  // refreshed comments); prune them so "Send selected" never submits stale ids.
  useEffect(() => {
    if (!isSelectingForAI) {
      return
    }
    setSelectedGroupIds((prev) => {
      const next = new Set([...prev].filter((groupId) => selectableGroupsById.has(groupId)))
      return next.size === prev.size ? prev : next
    })
    if (selectableGroupsById.size === 0) {
      setIsSelectingForAI(false)
    }
  }, [selectableGroupsById, isSelectingForAI])

  const addGroupToSelection = useCallback(
    (groupId: string): void => {
      if (!selectableGroupsById.has(groupId)) {
        return
      }
      setIsSelectingForAI(true)
      setSelectedGroupIds(new Set([groupId]))
    },
    [selectableGroupsById]
  )

  const clearSelection = useCallback((): void => {
    setIsSelectingForAI(false)
    setSelectedGroupIds(new Set())
  }, [])

  const toggleGroupSelection = useCallback((groupId: string, checked: boolean): void => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(groupId)
      } else {
        next.delete(groupId)
      }
      return next
    })
  }, [])

  return {
    isSelectingForAI,
    selectedGroupIds,
    selectableGroups,
    selectableGroupsById,
    selectedGroups,
    addGroupToSelection,
    clearSelection,
    toggleGroupSelection
  }
}
