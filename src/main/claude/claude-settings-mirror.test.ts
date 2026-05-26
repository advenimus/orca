import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as NodeOs from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { homedirMock } = vi.hoisted(() => ({
  homedirMock: vi.fn<() => string>()
}))

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof NodeOs>('node:os')
  return {
    ...actual,
    homedir: homedirMock
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/orca-test-user-data'
  }
}))

import { syncSystemClaudeSettingsIntoRuntimeHome } from './claude-settings-mirror'

let fakeHomeDir: string
let userDataDir: string
let previousUserDataPath: string | undefined

beforeEach(() => {
  fakeHomeDir = mkdtempSync(join(tmpdir(), 'orca-claude-settings-home-'))
  userDataDir = mkdtempSync(join(tmpdir(), 'orca-claude-settings-user-data-'))
  previousUserDataPath = process.env.ORCA_USER_DATA_PATH
  process.env.ORCA_USER_DATA_PATH = userDataDir
  homedirMock.mockReturnValue(fakeHomeDir)
})

afterEach(() => {
  rmSync(fakeHomeDir, { recursive: true, force: true })
  rmSync(userDataDir, { recursive: true, force: true })
  if (previousUserDataPath === undefined) {
    delete process.env.ORCA_USER_DATA_PATH
  } else {
    process.env.ORCA_USER_DATA_PATH = previousUserDataPath
  }
  vi.clearAllMocks()
})

function readRuntimeSettings(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(userDataDir, 'claude-runtime-home', 'home', 'settings.json'), 'utf-8')
  ) as Record<string, unknown>
}

describe('syncSystemClaudeSettingsIntoRuntimeHome', () => {
  it('preserves user settings and installs managed hooks in runtime home only', () => {
    const systemClaudeDir = join(fakeHomeDir, '.claude')
    mkdirSync(systemClaudeDir, { recursive: true })
    writeFileSync(
      join(systemClaudeDir, 'settings.json'),
      `${JSON.stringify(
        {
          model: 'opus',
          env: { CLAUDE_CODE_USE_BEDROCK: '1' },
          hooks: {
            PostToolUse: [
              {
                matcher: 'Bash',
                hooks: [{ type: 'command', command: '/usr/local/bin/user-hook' }]
              }
            ],
            Stop: [
              {
                hooks: [{ type: 'command', command: '/stale/agent-hooks/claude-hook.sh' }]
              }
            ]
          }
        },
        null,
        2
      )}\n`
    )

    syncSystemClaudeSettingsIntoRuntimeHome()

    const runtimeSettings = readRuntimeSettings()
    expect(runtimeSettings.model).toBe('opus')
    expect(runtimeSettings.env).toEqual({ CLAUDE_CODE_USE_BEDROCK: '1' })
    const hooks = runtimeSettings.hooks as Record<string, { hooks?: { command: string }[] }[]>
    expect(
      hooks.PostToolUse.some((entry) => entry.hooks?.[0]?.command === '/usr/local/bin/user-hook')
    ).toBe(true)
    expect(JSON.stringify(runtimeSettings)).not.toContain('/stale/agent-hooks/claude-hook.sh')
    expect(JSON.stringify(runtimeSettings)).toContain('agent-hooks/claude-hook')
  })
})
