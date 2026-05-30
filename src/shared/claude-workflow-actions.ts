import { AGENT_STATUS_STALE_AFTER_MS } from './agent-status-types'

export type ClaudeWorkflowRecoveryDisabledReason =
  | 'missing-script'
  | 'missing-run-id'
  | 'missing-transcripts'
  | 'remote-path'
  | 'invalid-path'
  | 'parent-pane-gone'

export type ClaudeWorkflowRecoveryActionAvailability =
  | { available: true }
  | { available: false; disabledReason: ClaudeWorkflowRecoveryDisabledReason }

export type ClaudeWorkflowRecoveryActions = {
  copyResumeCommand: ClaudeWorkflowRecoveryActionAvailability
  revealScript: ClaudeWorkflowRecoveryActionAvailability
  revealTranscripts: ClaudeWorkflowRecoveryActionAvailability
  openParentPane: ClaudeWorkflowRecoveryActionAvailability
}

export type ClaudeWorkflowRecoveryMetadata = {
  workflowId: string
  parentPaneKey: string
  worktreeId?: string
  updatedAt: number
  hasActiveChildWork: boolean
  isStale: boolean
  isResumable: boolean
  actions: ClaudeWorkflowRecoveryActions
}

export type ClaudeWorkflowRecoveryActionFailureReason =
  | 'missing-path'
  | 'remote-path'
  | 'not-found'
  | 'wrong-kind'
  | 'stale-id'
  | 'clipboard-failed'
  | 'launch-failed'
  | 'invalid-path'
  | 'missing-run-id'

export type ClaudeWorkflowRecoveryActionResult =
  | { ok: true }
  | { ok: false; reason: ClaudeWorkflowRecoveryActionFailureReason }

export type ClaudeWorkflowRecoveryHookMetadata = {
  workflowId: string
  parentPaneKey: string
  worktreeId?: string
  scriptPath?: string
  transcriptDir?: string
  transcriptPath?: string
  resumeFromRunId?: string
  hasActiveChildWork: boolean
  updatedAt?: number
}

export type ClaudeWorkflowRecoveryLookupEntry = ClaudeWorkflowRecoveryHookMetadata & {
  connectionId: string | null
  receivedAt: number
}

export type ClaudeWorkflowRecoveryMetadataInput = {
  workflowId: string
  parentPaneKey: string
  worktreeId?: string
  connectionId: string | null
  scriptPath?: string
  transcriptDir?: string
  transcriptPath?: string
  resumeFromRunId?: string
  hasActiveChildWork: boolean
  receivedAt: number
  workflowUpdatedAt?: number
}

export function buildClaudeWorkflowResumeText(args: {
  scriptPath: string
  resumeFromRunId: string
}): string {
  return [
    'Resume this Claude Code workflow:',
    `scriptPath: ${args.scriptPath}`,
    `resumeFromRunId: ${args.resumeFromRunId}`
  ].join('\n')
}

export function buildClaudeWorkflowId(args: {
  parentPaneKey: string
  scriptPath?: string
  resumeFromRunId?: string
  transcriptDir?: string
  transcriptPath?: string
}): string {
  const input = [
    args.parentPaneKey,
    args.scriptPath ?? '',
    args.resumeFromRunId ?? '',
    args.transcriptDir ?? '',
    args.transcriptPath ?? ''
  ].join('\0')
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `claude-workflow:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function deriveClaudeWorkflowRecoveryMetadata(
  input: ClaudeWorkflowRecoveryMetadataInput,
  now: number
): ClaudeWorkflowRecoveryMetadata {
  const workflowUpdatedAt = input.workflowUpdatedAt ?? input.receivedAt
  const hasScriptPath = typeof input.scriptPath === 'string' && input.scriptPath.trim().length > 0
  const hasRunId =
    typeof input.resumeFromRunId === 'string' && input.resumeFromRunId.trim().length > 0
  const hasTranscripts =
    (typeof input.transcriptDir === 'string' && input.transcriptDir.trim().length > 0) ||
    (typeof input.transcriptPath === 'string' && input.transcriptPath.trim().length > 0)
  const isRemote = input.connectionId !== null
  const isResumable = hasScriptPath && hasRunId

  return {
    workflowId: input.workflowId,
    parentPaneKey: input.parentPaneKey,
    worktreeId: input.worktreeId,
    updatedAt: workflowUpdatedAt,
    hasActiveChildWork: input.hasActiveChildWork,
    isStale:
      input.hasActiveChildWork === true &&
      now - Math.max(workflowUpdatedAt, input.receivedAt) > AGENT_STATUS_STALE_AFTER_MS,
    isResumable,
    actions: {
      copyResumeCommand: !hasScriptPath
        ? { available: false, disabledReason: 'missing-script' }
        : !hasRunId
          ? { available: false, disabledReason: 'missing-run-id' }
          : { available: true },
      revealScript: !hasScriptPath
        ? { available: false, disabledReason: 'missing-script' }
        : isRemote
          ? { available: false, disabledReason: 'remote-path' }
          : { available: true },
      revealTranscripts: !hasTranscripts
        ? { available: false, disabledReason: 'missing-transcripts' }
        : isRemote
          ? { available: false, disabledReason: 'remote-path' }
          : { available: true },
      openParentPane: { available: true }
    }
  }
}

export function refreshClaudeWorkflowRecoveryStaleState(
  metadata: ClaudeWorkflowRecoveryMetadata,
  now: number
): ClaudeWorkflowRecoveryMetadata {
  const isStale =
    metadata.hasActiveChildWork === true && now - metadata.updatedAt > AGENT_STATUS_STALE_AFTER_MS
  return metadata.isStale === isStale ? metadata : { ...metadata, isStale }
}
