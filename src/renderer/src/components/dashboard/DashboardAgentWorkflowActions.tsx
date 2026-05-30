import { Clipboard, Ellipsis, FileCode2, FolderOpen, PanelTopOpen } from 'lucide-react'
import React from 'react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type {
  ClaudeWorkflowRecoveryActionResult,
  ClaudeWorkflowRecoveryDisabledReason,
  ClaudeWorkflowRecoveryMetadata
} from '../../../../shared/claude-workflow-actions'

type Props = {
  workflowRecovery: ClaudeWorkflowRecoveryMetadata
  onOpenWorkflowParent?: (workflow: ClaudeWorkflowRecoveryMetadata) => boolean
  fallbackOpenParent: () => void
  stopMouseDown: (event: React.MouseEvent) => void
  stopKeyDown: (event: React.KeyboardEvent) => void
}

function workflowDisabledLabel(reason: ClaudeWorkflowRecoveryDisabledReason): string {
  switch (reason) {
    case 'missing-script':
      return 'Missing script path'
    case 'missing-run-id':
      return 'Missing resume id'
    case 'missing-transcripts':
      return 'No transcripts'
    case 'remote-path':
      return 'Remote path'
    case 'invalid-path':
      return 'Invalid path'
    case 'parent-pane-gone':
      return 'Parent pane gone'
    default:
      return 'Unavailable'
  }
}

function workflowActionErrorToast(result: ClaudeWorkflowRecoveryActionResult): string {
  if (result.ok) {
    return ''
  }
  switch (result.reason) {
    case 'missing-path':
      return 'Workflow path is missing.'
    case 'remote-path':
      return 'Remote workflow paths cannot be revealed locally.'
    case 'not-found':
      return 'Workflow file was not found.'
    case 'wrong-kind':
      return 'Workflow path has the wrong type.'
    case 'stale-id':
      return 'Workflow action expired.'
    case 'clipboard-failed':
      return 'Clipboard write failed.'
    case 'launch-failed':
      return 'Could not reveal workflow path.'
    case 'invalid-path':
      return 'Workflow path is invalid.'
    case 'missing-run-id':
      return 'Workflow resume id is missing.'
    default:
      return 'Workflow action failed.'
  }
}

function formatWorkflowMenuLabel(
  base: string,
  action: ClaudeWorkflowRecoveryMetadata['actions'][keyof ClaudeWorkflowRecoveryMetadata['actions']]
): string {
  return action.available ? base : `${base} - ${workflowDisabledLabel(action.disabledReason)}`
}

function handleWorkflowResult(result: ClaudeWorkflowRecoveryActionResult, success: string): void {
  if (result.ok) {
    toast.success(success)
    return
  }
  toast.error(workflowActionErrorToast(result))
}

const workflowMenuItemClassName = 'whitespace-nowrap'

export function DashboardAgentWorkflowActions({
  workflowRecovery,
  onOpenWorkflowParent,
  fallbackOpenParent,
  stopMouseDown,
  stopKeyDown
}: Props) {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [tooltipOpen, setTooltipOpen] = React.useState(false)
  const handleCopyWorkflowResume = (): void => {
    void window.api.agentStatus
      .copyWorkflowResumeCommand(workflowRecovery.workflowId)
      .then((result) => handleWorkflowResult(result, 'Copied workflow resume text.'))
  }
  const handleRevealWorkflowScript = (): void => {
    void window.api.agentStatus
      .revealWorkflowScript(workflowRecovery.workflowId)
      .then((result) => handleWorkflowResult(result, 'Revealed workflow script.'))
  }
  const handleRevealWorkflowTranscripts = (): void => {
    void window.api.agentStatus
      .revealWorkflowTranscripts(workflowRecovery.workflowId)
      .then((result) => handleWorkflowResult(result, 'Revealed workflow transcripts.'))
  }
  const handleOpenWorkflowParent = (): void => {
    const opened = onOpenWorkflowParent ? onOpenWorkflowParent(workflowRecovery) : true
    if (opened) {
      if (!onOpenWorkflowParent) {
        fallbackOpenParent()
      }
      return
    }
    toast.error('Parent Claude pane is no longer available.')
  }

  return (
    <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
      <Tooltip open={!menuOpen && tooltipOpen} onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground/70 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label="Workflow actions"
              onClick={(event) => event.stopPropagation()}
              onMouseDown={stopMouseDown}
              onKeyDown={stopKeyDown}
            >
              <Ellipsis className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          Workflow actions
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="w-64 border-border/80 bg-popover text-popover-foreground shadow-lg backdrop-blur-none"
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenuItem
          className={workflowMenuItemClassName}
          disabled={!workflowRecovery.actions.copyResumeCommand.available}
          onSelect={handleCopyWorkflowResume}
        >
          <Clipboard className="size-3.5" />
          {formatWorkflowMenuLabel(
            'Copy resume command',
            workflowRecovery.actions.copyResumeCommand
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          className={workflowMenuItemClassName}
          disabled={!workflowRecovery.actions.revealScript.available}
          onSelect={handleRevealWorkflowScript}
        >
          <FileCode2 className="size-3.5" />
          {formatWorkflowMenuLabel('Reveal workflow script', workflowRecovery.actions.revealScript)}
        </DropdownMenuItem>
        <DropdownMenuItem
          className={workflowMenuItemClassName}
          disabled={!workflowRecovery.actions.revealTranscripts.available}
          onSelect={handleRevealWorkflowTranscripts}
        >
          <FolderOpen className="size-3.5" />
          {formatWorkflowMenuLabel(
            'Reveal transcripts',
            workflowRecovery.actions.revealTranscripts
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className={workflowMenuItemClassName}
          disabled={!workflowRecovery.actions.openParentPane.available}
          onSelect={handleOpenWorkflowParent}
        >
          <PanelTopOpen className="size-3.5" />
          {formatWorkflowMenuLabel(
            'Open parent Claude pane',
            workflowRecovery.actions.openParentPane
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
