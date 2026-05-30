import { describe, expect, it } from 'vitest'

import {
  buildClaudeWorkflowResumeText,
  deriveClaudeWorkflowRecoveryMetadata
} from './claude-workflow-actions'
import { AGENT_STATUS_STALE_AFTER_MS } from './agent-status-types'

describe('Claude workflow recovery actions', () => {
  it('marks active workflows stale only after the workflow update threshold', () => {
    const base = {
      workflowId: 'wf-1',
      parentPaneKey: 'tab:leaf',
      connectionId: null,
      scriptPath: '/tmp/workflow.js',
      resumeFromRunId: 'run-1',
      hasActiveChildWork: true,
      receivedAt: 1_000,
      workflowUpdatedAt: 1_000
    }

    expect(
      deriveClaudeWorkflowRecoveryMetadata(base, 1_000 + AGENT_STATUS_STALE_AFTER_MS).isStale
    ).toBe(false)
    expect(
      deriveClaudeWorkflowRecoveryMetadata(base, 1_001 + AGENT_STATUS_STALE_AFTER_MS).isStale
    ).toBe(true)
    expect(
      deriveClaudeWorkflowRecoveryMetadata({ ...base, hasActiveChildWork: false }, 99_000_000)
        .isStale
    ).toBe(false)
  })

  it('requires both script path and resume run id for copy availability', () => {
    const metadata = deriveClaudeWorkflowRecoveryMetadata(
      {
        workflowId: 'wf-1',
        parentPaneKey: 'tab:leaf',
        connectionId: null,
        resumeFromRunId: 'run-1',
        hasActiveChildWork: true,
        receivedAt: 1_000
      },
      1_000
    )

    expect(metadata.isResumable).toBe(false)
    expect(metadata.actions.copyResumeCommand).toEqual({
      available: false,
      disabledReason: 'missing-script'
    })
  })

  it('keeps copy available for SSH workflows while disabling local reveal actions', () => {
    const metadata = deriveClaudeWorkflowRecoveryMetadata(
      {
        workflowId: 'wf-1',
        parentPaneKey: 'tab:leaf',
        connectionId: 'conn-1',
        scriptPath: '/remote/workflow.js',
        transcriptDir: '/remote/transcripts',
        resumeFromRunId: 'run-1',
        hasActiveChildWork: true,
        receivedAt: 1_000
      },
      1_000
    )

    expect(metadata.actions.copyResumeCommand).toEqual({ available: true })
    expect(metadata.actions.revealScript).toEqual({
      available: false,
      disabledReason: 'remote-path'
    })
    expect(metadata.actions.revealTranscripts).toEqual({
      available: false,
      disabledReason: 'remote-path'
    })
  })

  it('formats resume paste text on separate editable lines', () => {
    expect(
      buildClaudeWorkflowResumeText({
        scriptPath: '/tmp/workflow.js',
        resumeFromRunId: 'run-1'
      })
    ).toBe(
      [
        'Resume this Claude Code workflow:',
        'scriptPath: /tmp/workflow.js',
        'resumeFromRunId: run-1'
      ].join('\n')
    )
  })
})
