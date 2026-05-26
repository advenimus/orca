import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { HooksConfig } from '../agent-hooks/installer-utils'
import { isPlainObject, writeManagedScript } from '../agent-hooks/installer-utils'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import {
  applyManagedHooks,
  getManagedCommand,
  getManagedScriptPath,
  removeManagedHooks
} from './hook-settings'
import { getOrcaManagedClaudeHomePath, getSystemClaudeHomePath } from './claude-home-paths'
import { getClaudeManagedScript } from './hook-service'

const activeSettingsWrites = new Set<string>()

export function getRuntimeClaudeSettingsPath(configDir = getOrcaManagedClaudeHomePath()): string {
  return join(configDir, 'settings.json')
}

export function getSystemClaudeSettingsPath(): string {
  return join(getSystemClaudeHomePath(), 'settings.json')
}

export function syncSystemClaudeSettingsIntoRuntimeHome(
  configDir = getOrcaManagedClaudeHomePath()
): void {
  try {
    syncSystemClaudeSettingsIntoRuntimeHomeUnsafe(configDir)
  } catch (error) {
    console.warn('[claude-runtime-home] Failed to mirror system Claude settings:', error)
    throw error
  }
}

function syncSystemClaudeSettingsIntoRuntimeHomeUnsafe(configDir: string): void {
  const runtimeSettingsPath = getRuntimeClaudeSettingsPath(configDir)
  runWithSettingsWriteLock(runtimeSettingsPath, () => {
    mkdirSync(dirname(runtimeSettingsPath), { recursive: true })
    const systemConfig = readClaudeSettingsJson(getSystemClaudeSettingsPath()) ?? {}
    const { config: cleanedConfig } = removeManagedHooks(systemConfig)
    const scriptPath = getManagedScriptPath()
    writeManagedScript(scriptPath, getClaudeManagedScript())
    const nextConfig = applyManagedHooks(cleanedConfig, getManagedCommand(scriptPath))
    writeHooksConfigAtomically(runtimeSettingsPath, nextConfig)
  })
}

function readClaudeSettingsJson(settingsPath: string): HooksConfig | null {
  if (!existsSync(settingsPath)) {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeHooksConfigAtomically(settingsPath: string, config: HooksConfig): void {
  const serialized = `${JSON.stringify(config, null, 2)}\n`
  if (existsSync(settingsPath)) {
    try {
      if (readFileSync(settingsPath, 'utf-8') === serialized) {
        return
      }
      copyFileSync(settingsPath, `${settingsPath}.backup`)
    } catch {
      // If the backup read fails, continue to the atomic write. A valid runtime
      // settings file is more important than preserving a stale backup.
    }
  }
  writeFileAtomically(settingsPath, serialized, { mode: 0o600 })
}

function runWithSettingsWriteLock(targetPath: string, fn: () => void): void {
  if (activeSettingsWrites.has(targetPath)) {
    throw new Error(`Claude settings mirror write is already active for ${targetPath}`)
  }
  activeSettingsWrites.add(targetPath)
  try {
    fn()
  } finally {
    activeSettingsWrites.delete(targetPath)
  }
}
