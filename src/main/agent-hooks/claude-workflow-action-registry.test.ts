import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  _claudeWorkflowActionRegistryInternals,
  clearClaudeWorkflowRecoveryLookups,
  copyClaudeWorkflowResumeCommand,
  revealClaudeWorkflowScript,
  revealClaudeWorkflowTranscripts
} from './claude-workflow-action-registry'

function register(
  overrides: Partial<Parameters<typeof _claudeWorkflowActionRegistryInternals.register>[0]> = {}
) {
  return _claudeWorkflowActionRegistryInternals.register(
    {
      workflowId: 'wf-1',
      parentPaneKey: 'tab-1:11111111-1111-4111-8111-111111111111',
      scriptPath: '/tmp/workflow.js',
      transcriptDir: '/tmp/transcripts',
      resumeFromRunId: 'run-1',
      hasActiveChildWork: true,
      ...overrides
    },
    { connectionId: null, receivedAt: Date.now() }
  )
}

afterEach(() => {
  clearClaudeWorkflowRecoveryLookups()
  vi.restoreAllMocks()
})

describe('Claude workflow action registry', () => {
  it('copies resume text after validating a local script file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-workflow-'))
    try {
      const scriptPath = join(dir, 'workflow.js')
      writeFileSync(scriptPath, 'console.log("workflow")')
      register({ scriptPath })
      const writeText = vi.fn()

      const result = copyClaudeWorkflowResumeCommand('wf-1', writeText)

      expect(result).toEqual({ ok: true })
      expect(writeText).toHaveBeenCalledWith(
        [
          'Resume this Claude Code workflow:',
          `scriptPath: ${scriptPath}`,
          'resumeFromRunId: run-1'
        ].join('\n')
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns typed failures for missing, malformed, and wrong-kind script paths', () => {
    register({ scriptPath: undefined })
    expect(copyClaudeWorkflowResumeCommand('wf-1', vi.fn())).toEqual({
      ok: false,
      reason: 'missing-path'
    })

    clearClaudeWorkflowRecoveryLookups()
    register({ scriptPath: 'file:///tmp/workflow.js' })
    expect(revealClaudeWorkflowScript('wf-1', vi.fn())).toEqual({
      ok: false,
      reason: 'invalid-path'
    })

    const dir = mkdtempSync(join(tmpdir(), 'orca-workflow-'))
    try {
      clearClaudeWorkflowRecoveryLookups()
      register({ scriptPath: dir })
      expect(revealClaudeWorkflowScript('wf-1', vi.fn())).toEqual({
        ok: false,
        reason: 'wrong-kind'
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('blocks local reveal for remote workflow paths but still copies known remote text', () => {
    _claudeWorkflowActionRegistryInternals.register(
      {
        workflowId: 'wf-remote',
        parentPaneKey: 'tab-1:11111111-1111-4111-8111-111111111111',
        scriptPath: '/remote/workflow.js',
        resumeFromRunId: 'run-remote',
        hasActiveChildWork: true
      },
      { connectionId: 'conn-1', receivedAt: Date.now() }
    )
    const writeText = vi.fn()

    expect(revealClaudeWorkflowScript('wf-remote', vi.fn())).toEqual({
      ok: false,
      reason: 'remote-path'
    })
    expect(copyClaudeWorkflowResumeCommand('wf-remote', writeText)).toEqual({ ok: true })
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('scriptPath: /remote/workflow.js')
    )
  })

  it('reveals transcript directories and reports stale ids', () => {
    expect(revealClaudeWorkflowTranscripts('missing', vi.fn())).toEqual({
      ok: false,
      reason: 'stale-id'
    })

    const dir = mkdtempSync(join(tmpdir(), 'orca-workflow-'))
    try {
      const transcripts = join(dir, 'transcripts')
      mkdirSync(transcripts)
      register({ transcriptDir: transcripts })
      const show = vi.fn()

      expect(revealClaudeWorkflowTranscripts('wf-1', show)).toEqual({ ok: true })
      expect(show).toHaveBeenCalledWith(transcripts)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
