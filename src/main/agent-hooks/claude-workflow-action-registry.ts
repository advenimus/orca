import { dirname, isAbsolute, normalize } from 'path'
import { statSync } from 'fs'

import {
  buildClaudeWorkflowResumeText,
  deriveClaudeWorkflowRecoveryMetadata,
  type ClaudeWorkflowRecoveryActionResult,
  type ClaudeWorkflowRecoveryHookMetadata,
  type ClaudeWorkflowRecoveryLookupEntry,
  type ClaudeWorkflowRecoveryMetadata
} from '../../shared/claude-workflow-actions'

const WORKFLOW_LOOKUP_TTL_MS = 24 * 60 * 60 * 1000

const lookupByWorkflowId = new Map<string, ClaudeWorkflowRecoveryLookupEntry>()

type LocalPathKind = 'file' | 'directory'
type LocalPathValidation =
  | { ok: true; path: string }
  | Extract<ClaudeWorkflowRecoveryActionResult, { ok: false }>

function pruneExpiredWorkflowLookups(now = Date.now()): void {
  for (const [workflowId, entry] of lookupByWorkflowId) {
    if (now - entry.receivedAt > WORKFLOW_LOOKUP_TTL_MS) {
      lookupByWorkflowId.delete(workflowId)
    }
  }
}

function getLookupEntry(workflowId: unknown): ClaudeWorkflowRecoveryLookupEntry | null {
  if (typeof workflowId !== 'string' || workflowId.trim().length === 0) {
    return null
  }
  pruneExpiredWorkflowLookups()
  return lookupByWorkflowId.get(workflowId) ?? null
}

function normalizeLocalPath(rawPath: string | undefined): string | null {
  if (typeof rawPath !== 'string') {
    return null
  }
  const trimmed = rawPath.trim()
  if (trimmed.length === 0) {
    return null
  }
  // Why: Electron reveal APIs operate on local filesystem paths only. Reject
  // URI-shaped metadata up front so a malformed Claude payload cannot be
  // interpreted by the host shell as something broader than a path.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(trimmed)) {
    return null
  }
  const normalized = normalize(trimmed)
  return isAbsolute(normalized) ? normalized : null
}

function validateLocalPath(
  rawPath: string | undefined,
  expectedKind: LocalPathKind
): LocalPathValidation {
  const path = normalizeLocalPath(rawPath)
  if (!path) {
    return { ok: false, reason: rawPath ? 'invalid-path' : 'missing-path' }
  }
  let stats
  try {
    stats = statSync(path)
  } catch {
    return { ok: false, reason: 'not-found' }
  }
  const kindMatches = expectedKind === 'file' ? stats.isFile() : stats.isDirectory()
  if (!kindMatches) {
    return { ok: false, reason: 'wrong-kind' }
  }
  return { ok: true, path }
}

function getWorkflowUpdatedAt(entry: ClaudeWorkflowRecoveryLookupEntry): number {
  const scriptPath = normalizeLocalPath(entry.scriptPath)
  if (entry.connectionId !== null || !scriptPath) {
    return entry.updatedAt ?? entry.receivedAt
  }
  try {
    const stats = statSync(scriptPath)
    return Math.max(entry.updatedAt ?? 0, stats.mtimeMs, entry.receivedAt)
  } catch {
    return entry.updatedAt ?? entry.receivedAt
  }
}

function getTranscriptDirectory(entry: ClaudeWorkflowRecoveryLookupEntry): string | undefined {
  if (entry.transcriptDir) {
    return entry.transcriptDir
  }
  const transcriptPath = normalizeLocalPath(entry.transcriptPath)
  return transcriptPath ? dirname(transcriptPath) : undefined
}

export function registerClaudeWorkflowRecoveryLookup(
  metadata: ClaudeWorkflowRecoveryHookMetadata,
  args: { connectionId: string | null; receivedAt: number }
): ClaudeWorkflowRecoveryMetadata {
  const entry: ClaudeWorkflowRecoveryLookupEntry = {
    ...metadata,
    connectionId: args.connectionId,
    receivedAt: args.receivedAt
  }
  lookupByWorkflowId.set(metadata.workflowId, entry)
  pruneExpiredWorkflowLookups(args.receivedAt)
  return deriveClaudeWorkflowRecoveryMetadata(
    {
      ...entry,
      transcriptDir: getTranscriptDirectory(entry),
      workflowUpdatedAt: getWorkflowUpdatedAt(entry)
    },
    args.receivedAt
  )
}

export function dropClaudeWorkflowRecoveryLookupsForPane(paneKey: string): void {
  for (const [workflowId, entry] of lookupByWorkflowId) {
    if (entry.parentPaneKey === paneKey) {
      lookupByWorkflowId.delete(workflowId)
    }
  }
}

export function clearClaudeWorkflowRecoveryLookups(): void {
  lookupByWorkflowId.clear()
}

export function copyClaudeWorkflowResumeCommand(
  workflowId: unknown,
  writeText: (text: string) => void
): ClaudeWorkflowRecoveryActionResult {
  const entry = getLookupEntry(workflowId)
  if (!entry) {
    return { ok: false, reason: 'stale-id' }
  }
  const scriptPath = entry.scriptPath?.trim()
  const resumeFromRunId = entry.resumeFromRunId?.trim()
  if (!scriptPath) {
    return { ok: false, reason: 'missing-path' }
  }
  if (!resumeFromRunId) {
    return { ok: false, reason: 'missing-run-id' }
  }
  if (entry.connectionId === null) {
    const validated = validateLocalPath(scriptPath, 'file')
    if (!validated.ok) {
      return validated
    }
  }
  try {
    writeText(buildClaudeWorkflowResumeText({ scriptPath, resumeFromRunId }))
    return { ok: true }
  } catch {
    return { ok: false, reason: 'clipboard-failed' }
  }
}

export function revealClaudeWorkflowScript(
  workflowId: unknown,
  showItemInFolder: (path: string) => void
): ClaudeWorkflowRecoveryActionResult {
  const entry = getLookupEntry(workflowId)
  if (!entry) {
    return { ok: false, reason: 'stale-id' }
  }
  if (entry.connectionId !== null) {
    return { ok: false, reason: 'remote-path' }
  }
  const validated = validateLocalPath(entry.scriptPath, 'file')
  if (!validated.ok) {
    return validated
  }
  try {
    showItemInFolder(validated.path)
    return { ok: true }
  } catch {
    return { ok: false, reason: 'launch-failed' }
  }
}

export function revealClaudeWorkflowTranscripts(
  workflowId: unknown,
  showItemInFolder: (path: string) => void
): ClaudeWorkflowRecoveryActionResult {
  const entry = getLookupEntry(workflowId)
  if (!entry) {
    return { ok: false, reason: 'stale-id' }
  }
  if (entry.connectionId !== null) {
    return { ok: false, reason: 'remote-path' }
  }
  const validated = validateLocalPath(getTranscriptDirectory(entry), 'directory')
  if (!validated.ok) {
    return validated
  }
  try {
    showItemInFolder(validated.path)
    return { ok: true }
  } catch {
    return { ok: false, reason: 'launch-failed' }
  }
}

export const _claudeWorkflowActionRegistryInternals = {
  clear: clearClaudeWorkflowRecoveryLookups,
  size: (): number => lookupByWorkflowId.size,
  register: registerClaudeWorkflowRecoveryLookup
}
