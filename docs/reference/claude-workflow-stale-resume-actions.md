# Claude Workflow Stale Resume Actions

## Problem

Claude dynamic workflows can be interrupted, abandoned, or left stale while the parent Claude pane looks merely idle. Orca already decays stale working agent rows after `AGENT_STATUS_STALE_AFTER_MS` (`src/shared/agent-status-types.ts`), with the dashboard deriving the same decay in `buildAgentRowsForWorktree` (`src/renderer/src/components/dashboard/useDashboardData.ts`) and sidebar rows deriving it in `buildWorktreeAgentRows` (`src/renderer/src/components/sidebar/useWorktreeAgentRows.ts`). That tells the user something stopped updating, but the current Claude hook/status path only preserves generic state, prompt, tool preview, assistant message, and interrupt fields; it does not expose workflow-specific recovery data such as `scriptPath` and `resumeFromRunId`.

## Goal

Add a compact recovery surface on existing Claude agent rows: stale/resumable workflow summaries should show a clear stale hint and offer safe actions to copy resume instructions, reveal the generated JS script, reveal transcript files, and jump back to the parent Claude pane. The primary outcome is confidence and recoverability, not automatic execution.

## Non-goals

- Do not auto-send the resume command into a Claude terminal.
- Do not mutate Claude workflow files.
- Do not add workflow status grouping, a workflow detail panel, or a new row type beyond the minimal metadata/action surface needed by existing agent rows.
- Do not depend on GitHub-only or local-only paths.
- Do not expose a generic renderer-controlled "open this path" action for workflow files.

## Design

1. Add a small workflow metadata model.
   - Use `src/shared/claude-workflow-actions.ts` for action-safe types; project-owned declarations stay in `.ts`, not `.d.ts`.
   - Add an optional workflow recovery sidecar to `AgentHookEventPayload` / the enriched main cache, `AgentStatusIpcPayload`, and `AgentStatusEntry` so `agentStatus:set` and `agentStatus:getSnapshot` carry the same shape through `useIpcEvents`.
   - Do not rely on adding unknown fields to `AgentStatusPayload` / `ParsedAgentStatusPayload` alone. `normalizeAgentStatusPayload` intentionally reconstructs a known-field object, and `useIpcEvents` currently re-normalizes only status fields before calling `setAgentStatus`; workflow recovery must be copied explicitly as a sidecar into the store.
   - The renderer-facing shape should contain an opaque `workflowId`, `parentPaneKey`, `worktreeId`, `updatedAt`, stale/resumable booleans, and per-action availability/disabled reason.
   - Keep raw `scriptPath` and `transcriptDir` in a main-process lookup keyed by `workflowId`. Do not require the renderer to pass paths back for reveal actions.
   - Preserve source identity: local entries have `connectionId: null`; SSH entries carry the remote `connectionId` and disable local reveal actions unless a real remote reveal API exists.

2. Detect stale workflow runs.
   - Add a Claude workflow response extractor alongside the current Claude hook normalization. Today `extractClaudeToolFields` only reads generic `tool_name`, `tool_input`, `tool_response`, `last_assistant_message`, and `transcript_path` data; workflow recovery fields must be parsed before the generic status normalizer truncates/drops unknown data.
   - Attach recovery metadata to the parent Claude agent row; do not create a separate workflow group.
   - Mark a workflow stale when it has active workflow child work and neither workflow file mtime nor hook `receivedAt` has advanced for `AGENT_STATUS_STALE_AFTER_MS`.
   - Do not change the generic agent state contract. The row may still decay to `idle`; workflow staleness is a separate `workflowRecovery.isStale` hint.
   - Mark `resumable` when both `scriptPath` and `resumeFromRunId` are present. Copy can be available for SSH if the remote path text is known; local reveal remains disabled for SSH paths.

3. Add safe action APIs.
   - Extend the preload `agentStatus` API, not a separate top-level namespace: `copyWorkflowResumeCommand(workflowId)`, `revealWorkflowScript(workflowId)`, and `revealWorkflowTranscripts(workflowId)`.
   - Main owns command construction, clipboard write, path lookup, path normalization, existence/type checks, and Electron `shell.showItemInFolder` calls. Do not route workflow reveal through the existing loose `shell:openPath` bridge.
   - Validate every action at click time and return a discriminated result such as `{ ok: true } | { ok: false; reason: 'missing-path' | 'remote-path' | 'not-found' | 'wrong-kind' | 'stale-id' | 'clipboard-failed' | 'launch-failed' }`.
   - For local paths, require absolute paths, use Node `path` utilities (`normalize`, `isAbsolute`) instead of string separators, and verify file vs directory with `fs.stat`.
   - "Open parent Claude pane" is renderer navigation, not main IPC: parse `parentPaneKey`, verify the tab still exists in the row's `worktreeId`, then route through `activateAndRevealWorktree` and `activateTabAndFocusPane`. If validation fails, toast and do not guess a terminal.

4. Add row-level action affordances.
   - Add an icon-only shadcn `DropdownMenu` trigger only when a `DashboardAgentRow` has workflow recovery metadata; normal agent rows must not gain the trigger.
   - Menu items: Copy resume command, Reveal workflow script, Reveal transcripts, Open parent Claude pane.
   - Disabled items carry concise visible menu text; tooltips only name icon-only triggers.
   - Stale badge/copy should be muted and consistent with existing state labels, not a bright warning banner.
   - Use shadcn primitives, lucide icons, token classes from `main.css`, and the existing `DashboardAgentRow` layout so the sidebar and dashboard stay aligned.

5. Generate resume text conservatively.
   - Copy human-readable paste text, not a shell command:
     ```text
     Resume this Claude Code workflow:
     scriptPath: <path>
     resumeFromRunId: <runId>
     ```
   - Do not promise a shell command if Claude Code requires invoking the built-in `Workflow` tool from the TUI.
   - Include script path and run id in separate lines so the user can paste them into Claude and edit safely.

6. Add pruning and retention.
   - Workflow metadata follows the existing live/retained agent row lifecycle; do not add a second completed-workflow list.
   - Drop renderer metadata when `dropAgentStatus`, `dismissRetainedAgent`, `dismissRetainedAgentsByWorktree`, or worktree removal drops the owning row.
   - Drop main-process path lookup entries when the owning pane/worktree is dismissed or pruned, and keep only a short retained window for clean `done` rows that already qualify for retained agent display.
   - Do not assume every renderer pruning path already notifies main. `dropAgentStatus` and `dismissRetainedAgentsByWorktree` fan out `agentStatus:drop`, but worktree-level/prune paths can remove renderer rows without an existing main lookup callback; add explicit cleanup or a bounded main-side TTL for workflow lookup entries.

## Data flow

```text
Claude workflow response extractor
  -> main workflow recovery lookup + AgentStatusIpcPayload metadata
  -> useIpcEvents normalizes status fields and copies workflow sidecar into AgentStatusEntry
  -> existing dashboard/sidebar row builders
  -> row dropdown action
  -> agentStatus action IPC for copy/reveal, renderer navigation for parent focus
  -> typed result
  -> toast
```

## Edge cases

- Workflow has `resumeFromRunId` but no `scriptPath`.
- Script was deleted by the user before clicking reveal/copy.
- Parent pane is gone but script/transcripts remain.
- Remote SSH workflow paths are not local Finder/Explorer paths.
- Claude workflow file mtimes update while the user has the menu open.
- Clipboard write fails due OS permission.
- Multiple resumed runs share one script path.
- Main-process workflow id was pruned between menu render and click.
- Malformed, relative, URI, or Windows/Posix-opposite paths arrive from Claude metadata.
- Snapshot hydration delivers older metadata after a newer live update.

## Test plan

- Unit: stale derivation from workflow update time, hook `receivedAt`, child-active signal, and threshold.
- Unit: resume copy text includes script path/run id on separate lines and handles missing fields.
- Unit: action resolver returns typed errors for missing path, remote path, stale id, not found, wrong kind, malformed path, and clipboard failure.
- Unit: Windows and POSIX path validation use `path` utilities and do not split on `/` or `\`.
- Hook/server: workflow sidecar survives Claude hook parsing, `setListener` fanout, status snapshot hydration, and remote `connectionId` stamping without passing through generic status-field normalization.
- IPC/preload: `agentStatus` API exposes the new methods in `api-types.ts`, `index.ts`, and the web preload fallback stubs.
- Renderer store: snapshot/update handling preserves workflow metadata without regressing older payloads that omit it, including older snapshot entries whose timestamps lose to newer live updates.
- Component: workflow row menu renders enabled/disabled items correctly and does not affect normal agent rows.
- Component/store: dismissing a workflow clears retained action metadata only for that workflow.
- Electron: stale row menu, copy action toast, disabled remote reveal state, parent-pane focus smoke, normal-row smoke.

## UI quality bar

- The stale state must be noticeable but not alarming: state dot plus compact label, not a modal or banner.
- Actions should be discoverable from the workflow row without bloating every normal agent row.
- Copy/reveal/open results should use short toasts; no persistent panels.
- Disabled remote/missing-path states must explain the limitation in one line.
- The row height must stay stable when the action trigger appears on hover/focus.
- Keyboard users must be able to open the menu and activate each enabled item; the outer row remains a plain clickable surface with real buttons inside.

## Review screenshots

1. Stale resumable workflow row with action menu open.
2. Disabled remote/missing-path menu state.
3. Copy resume command success toast.
4. Completed retained workflow row with reveal actions available.
5. Normal agent row smoke with no workflow action trigger.

Do not commit evidence images; attach them to the PR conversation.

## Rollout

1. Add shared workflow recovery metadata and stale/resume derivation tests.
2. Add main action lookup, IPC handlers, preload API, and typed result tests.
3. Thread metadata through renderer status snapshot/update handling and row builders.
4. Add row menu UI, parent-pane navigation, and toasts.
5. Validate in Electron with screenshots.

## Lightweight Eng Review

- Scope: Reduced to user-initiated recovery actions on existing agent rows. No automatic resume injection, because PTY keystroke injection into Claude can resume the wrong turn if focus or prompt state is stale.
- Architecture/data flow: Main owns filesystem/clipboard/action validation and stores raw paths; renderer renders available actions, calls typed IPC methods, and performs only existing pane navigation. This keeps SSH/local differences behind runtime checks.
- Failure modes covered:
  - Missing script/run id disables copy or returns a typed error.
  - Remote paths do not call local reveal APIs.
  - Parent pane focus is best-effort and never guesses a new terminal.
  - Clipboard/reveal failures surface as toasts.
  - Stale threshold updates when workflow mtimes change.
- Test coverage required:
  - Pure stale/resume command tests.
  - IPC handler tests for local, remote, missing file, malformed path, stale id.
  - Component tests for menu visibility and disabled states.
  - Electron screenshots for stale, menu, toast, disabled remote, and normal row smoke.
- Performance/blast radius: No extra filesystem crawling beyond the workflow index. Action metadata is summary-sized. Menus mount per visible row only.
- UI quality bar: Existing list-row density, icon-only trigger with tooltip, shadcn dropdown, no noisy badges or card nesting.
- Residual risks: Claude's actual resume UX is a tool call, not a stable shell command. Copy text must be explicit enough for Claude Code users without implying Orca can resume automatically.
