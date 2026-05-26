import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { getOrcaUserDataPath } from '../codex/codex-home-paths'

const CLAUDE_SYSTEM_RESOURCE_ENTRIES = [
  'agents',
  'commands',
  'skills',
  'plugins',
  'output-styles'
] as const

export function getSystemClaudeHomePath(): string {
  return join(homedir(), '.claude')
}

export function getOrcaManagedClaudeHomePath(): string {
  const managedHomePath = join(getOrcaUserDataPath(), 'claude-runtime-home', 'home')
  mkdirSync(managedHomePath, { recursive: true })
  return managedHomePath
}

export function getRemoteOrcaManagedClaudeHomePath(remoteHome: string): string {
  return `${remoteHome.replace(/\/$/, '')}/.orca/claude-runtime-home/home`
}

export function syncSystemClaudeResourcesIntoManagedHome(): void {
  const systemHomePath = getSystemClaudeHomePath()
  const managedHomePath = getOrcaManagedClaudeHomePath()
  for (const entryName of CLAUDE_SYSTEM_RESOURCE_ENTRIES) {
    linkSystemClaudeResource(systemHomePath, managedHomePath, entryName)
  }
}

function linkSystemClaudeResource(
  systemHomePath: string,
  managedHomePath: string,
  entryName: string
): void {
  const sourcePath = join(systemHomePath, entryName)
  const targetPath = join(managedHomePath, entryName)
  if (!existsSync(sourcePath)) {
    removeCopiedResourceIfOwned(targetPath, managedHomePath, entryName, sourcePath)
    return
  }

  if (targetAlreadyPointsToSource(targetPath, sourcePath)) {
    clearCopiedResourceMarker(managedHomePath, entryName)
    return
  }
  const shouldRefreshFallbackCopy = targetIsOwnedFallbackCopy(
    targetPath,
    managedHomePath,
    entryName,
    sourcePath
  )
  if (existsSync(targetPath) && !shouldRefreshFallbackCopy) {
    return
  }
  if (shouldRefreshFallbackCopy) {
    rmSync(targetPath, { recursive: true, force: true })
  }

  try {
    const sourceStat = lstatSync(sourcePath)
    symlinkSync(
      sourcePath,
      targetPath,
      sourceStat.isDirectory() && process.platform === 'win32' ? 'junction' : undefined
    )
    clearCopiedResourceMarker(managedHomePath, entryName)
  } catch (error) {
    try {
      rmSync(targetPath, { recursive: true, force: true })
      // Why: Windows may reject symlinks outside developer mode. A marked copy
      // keeps user resources available without claiming ownership of real home.
      cpSync(sourcePath, targetPath, { recursive: true, force: false, errorOnExist: true })
      markCopiedResource(managedHomePath, entryName, sourcePath)
    } catch {
      console.warn('[claude-home] Failed to link system Claude resource:', entryName, error)
    }
  }
}

function targetAlreadyPointsToSource(targetPath: string, sourcePath: string): boolean {
  try {
    return (
      lstatSync(targetPath).isSymbolicLink() &&
      linkTargetsMatch(readlinkSync(targetPath), sourcePath)
    )
  } catch {
    return false
  }
}

function linkTargetsMatch(actualTarget: string, expectedTarget: string): boolean {
  if (process.platform !== 'win32') {
    return actualTarget === expectedTarget
  }
  return normalizeWindowsLinkTarget(actualTarget) === normalizeWindowsLinkTarget(expectedTarget)
}

function normalizeWindowsLinkTarget(linkTarget: string): string {
  return linkTarget.replace(/^\\\\\?\\/, '').toLowerCase()
}

function getResourceCopyMarkerPath(managedHomePath: string, entryName: string): string {
  return join(managedHomePath, '.orca-resource-copies', `${entryName}.json`)
}

function markCopiedResource(managedHomePath: string, entryName: string, sourcePath: string): void {
  const markerPath = getResourceCopyMarkerPath(managedHomePath, entryName)
  mkdirSync(dirname(markerPath), { recursive: true })
  writeFileSync(markerPath, `${JSON.stringify({ sourcePath }, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600
  })
}

function readCopiedResourceSourcePath(managedHomePath: string, entryName: string): string | null {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(getResourceCopyMarkerPath(managedHomePath, entryName), 'utf-8')
    )
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    const sourcePath = 'sourcePath' in parsed ? parsed.sourcePath : null
    return typeof sourcePath === 'string' ? sourcePath : null
  } catch {
    return null
  }
}

function clearCopiedResourceMarker(managedHomePath: string, entryName: string): void {
  rmSync(getResourceCopyMarkerPath(managedHomePath, entryName), { force: true })
}

function targetIsOwnedFallbackCopy(
  targetPath: string,
  managedHomePath: string,
  entryName: string,
  sourcePath: string
): boolean {
  if (readCopiedResourceSourcePath(managedHomePath, entryName) !== sourcePath) {
    return false
  }
  try {
    return existsSync(targetPath) && !lstatSync(targetPath).isSymbolicLink()
  } catch {
    return false
  }
}

function removeCopiedResourceIfOwned(
  targetPath: string,
  managedHomePath: string,
  entryName: string,
  sourcePath: string
): void {
  if (removeSymlinkedResourceIfOwned(targetPath, sourcePath)) {
    clearCopiedResourceMarker(managedHomePath, entryName)
    return
  }
  if (!targetIsOwnedFallbackCopy(targetPath, managedHomePath, entryName, sourcePath)) {
    return
  }
  rmSync(targetPath, { recursive: true, force: true })
  clearCopiedResourceMarker(managedHomePath, entryName)
}

function removeSymlinkedResourceIfOwned(targetPath: string, sourcePath: string): boolean {
  try {
    if (!lstatSync(targetPath).isSymbolicLink()) {
      return false
    }
    if (!linkTargetsMatch(readlinkSync(targetPath), sourcePath)) {
      return false
    }
    return removeSymlinkEntry(targetPath)
  } catch {
    return false
  }
}

function removeSymlinkEntry(targetPath: string): boolean {
  try {
    // Why: recursive rm can leave a broken directory symlink behind; unlink the
    // link entry itself so deleted system resources do not linger in runtime home.
    unlinkSync(targetPath)
    return true
  } catch {
    if (process.platform !== 'win32') {
      return false
    }
  }

  try {
    rmdirSync(targetPath)
    return true
  } catch {
    return false
  }
}
