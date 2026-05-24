import { lstat } from 'fs/promises'
import { homedir } from 'os'
import { posix, win32 } from 'path'
import type { GitWorktreeInfo, WorktreeMeta } from '../shared/types'
import { areWorktreePathsEqual } from './ipc/worktree-logic'

type PathOps = typeof posix
type StatPath = (path: string) => Promise<unknown>

export const ORPHANED_WORKTREE_DIRECTORY_MESSAGE =
  'Worktree is no longer registered with Git but its directory remains.'

function looksLikeWindowsPath(pathValue: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(pathValue) || pathValue.startsWith('\\\\')
}

function getPathOps(...paths: string[]): PathOps {
  return paths.some(looksLikeWindowsPath) ? win32 : posix
}

function containsPath(parentPath: string, childPath: string, pathOps: PathOps): boolean {
  const relativePath = pathOps.relative(parentPath, childPath)
  return (
    relativePath === '' ||
    (!!relativePath && !relativePath.startsWith('..') && !pathOps.isAbsolute(relativePath))
  )
}

export function isDangerousWorktreeRemovalPath(worktreePath: string, repoPath: string): boolean {
  if (!worktreePath.trim()) {
    return true
  }

  if (areWorktreePathsEqual(worktreePath, repoPath)) {
    return true
  }

  const pathOps = getPathOps(worktreePath, repoPath)
  const resolvedWorktreePath = pathOps.resolve(worktreePath)
  const rootPath = pathOps.parse(resolvedWorktreePath).root
  if (resolvedWorktreePath === rootPath) {
    return true
  }

  const resolvedRepoPath = pathOps.resolve(repoPath)
  if (containsPath(resolvedWorktreePath, resolvedRepoPath, pathOps)) {
    return true
  }

  const homePath = homedir()
  return !!homePath && containsPath(resolvedWorktreePath, pathOps.resolve(homePath), pathOps)
}

export function getRegisteredDeletableWorktree(
  repoPath: string,
  requestedWorktreePath: string,
  worktrees: readonly GitWorktreeInfo[]
): GitWorktreeInfo {
  const worktree = findRegisteredDeletableWorktree(repoPath, requestedWorktreePath, worktrees)
  if (!worktree) {
    throw new Error(`Refusing to delete unregistered worktree path: ${requestedWorktreePath}`)
  }
  return worktree
}

export function findRegisteredDeletableWorktree(
  repoPath: string,
  requestedWorktreePath: string,
  worktrees: readonly GitWorktreeInfo[]
): GitWorktreeInfo | null {
  const worktree = worktrees.find((item) => areWorktreePathsEqual(item.path, requestedWorktreePath))
  if (!worktree) {
    return null
  }
  if (worktree.isMainWorktree || isDangerousWorktreeRemovalPath(worktree.path, repoPath)) {
    throw new Error(`Refusing to delete protected worktree path: ${worktree.path}`)
  }
  assertWorktreeDoesNotContainRegisteredWorktree(worktree.path, worktrees)
  return worktree
}

export function assertWorktreeDoesNotContainRegisteredWorktree(
  worktreePath: string,
  worktrees: readonly GitWorktreeInfo[]
): void {
  const nestedWorktree = worktrees.find((item) => {
    if (areWorktreePathsEqual(item.path, worktreePath)) {
      return false
    }
    return containsPath(worktreePath, item.path, getPathOps(worktreePath, item.path))
  })
  if (nestedWorktree) {
    // Why: `git worktree remove --force` treats nested worktrees as ordinary
    // untracked directories and deletes their working files while leaving Git
    // with a prunable child worktree record.
    throw new Error(
      `Refusing to delete worktree because it contains another registered worktree: ${nestedWorktree.path}`
    )
  }
}

export async function canSafelyRemoveOrphanedWorktreeDirectory(
  worktreePath: string,
  repoPath: string,
  statPath: StatPath = lstat
): Promise<boolean> {
  if (isDangerousWorktreeRemovalPath(worktreePath, repoPath)) {
    return false
  }

  try {
    const gitEntry = await statPath(getPathOps(worktreePath).join(worktreePath, '.git'))
    return isGitEntryStat(gitEntry)
  } catch {
    return false
  }
}

export function canCleanupUnregisteredOrcaWorktreeDirectory(
  meta: Pick<WorktreeMeta, 'orcaCreatedAt'> | null | undefined
): boolean {
  return typeof meta?.orcaCreatedAt === 'number'
}

function isGitEntryStat(stat: unknown): boolean {
  if (!stat || typeof stat !== 'object') {
    return false
  }
  const nodeStat = stat as {
    isFile?: () => boolean
    isDirectory?: () => boolean
    isSymbolicLink?: () => boolean
  }
  if (nodeStat.isFile?.() || nodeStat.isDirectory?.() || nodeStat.isSymbolicLink?.()) {
    return true
  }
  const fileStat = stat as { type?: unknown }
  return fileStat.type === 'file' || fileStat.type === 'directory' || fileStat.type === 'symlink'
}

function isMissingPathError(error: unknown): boolean {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as NodeJS.ErrnoException).code)
      : undefined
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return true
  }

  let message = ''
  if (error instanceof Error) {
    message = error.message
  } else if (error && typeof error === 'object' && 'message' in error) {
    message = String((error as { message: unknown }).message)
  } else if (typeof error === 'string') {
    message = error
  }
  return /\b(ENOENT|ENOTDIR)\b|no such file or directory|cannot find (?:the )?(?:file|path)|(?:file|path) not found/i.test(
    message
  )
}

export async function isWorktreePathMissing(
  worktreePath: string,
  statPath: (path: string) => Promise<unknown> = lstat
): Promise<boolean> {
  try {
    await statPath(worktreePath)
    return false
  } catch (error) {
    return isMissingPathError(error)
  }
}
