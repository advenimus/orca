export const ORCA_CLAUDE_AGENT_STATUS_SETTINGS_ENV = 'ORCA_CLAUDE_AGENT_STATUS_SETTINGS'
export const ORCA_CLAUDE_AGENT_STATUS_SETTINGS_FILE = 'claude-agent-status-settings.json'

type ClaudeSettingsShell = 'posix' | 'powershell' | 'cmd'

export function appendOrcaClaudeAgentStatusSettings(
  command: string,
  shell: ClaudeSettingsShell
): string {
  // Why: retained as the migration fallback until CLAUDE_CONFIG_DIR runtime
  // homes are default-on and SSH/WSL parity is proven.
  if (shell === 'powershell') {
    return `${command} --settings $Env:${ORCA_CLAUDE_AGENT_STATUS_SETTINGS_ENV}`
  }
  if (shell === 'cmd') {
    return `${command} --settings "%${ORCA_CLAUDE_AGENT_STATUS_SETTINGS_ENV}%"`
  }
  return `${command} --settings "$HOME/.orca/agent-hooks/${ORCA_CLAUDE_AGENT_STATUS_SETTINGS_FILE}"`
}
