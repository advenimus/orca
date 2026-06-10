import {
  getExecutionHostLabel,
  LOCAL_EXECUTION_HOST_ID,
  type ExecutionHostId
} from '../../../shared/execution-host'
import type { ProjectHostSetup, Repo } from '../../../shared/types'

export type ProjectHostSetupOption = {
  id: string
  projectId: string
  hostId: ExecutionHostId
  repoId: string
  label: string
  detail: string
  path: string
}

type BuildProjectHostSetupOptionsInput = {
  projectId: string | null
  projectHostSetups: readonly ProjectHostSetup[]
  eligibleRepos: readonly Repo[]
}

export function buildProjectHostSetupOptions({
  projectId,
  projectHostSetups,
  eligibleRepos
}: BuildProjectHostSetupOptionsInput): ProjectHostSetupOption[] {
  if (!projectId) {
    return []
  }
  const eligibleRepoIds = new Set(eligibleRepos.map((repo) => repo.id))
  return projectHostSetups
    .filter(
      (setup) =>
        setup.projectId === projectId &&
        setup.setupState === 'ready' &&
        eligibleRepoIds.has(setup.repoId)
    )
    .map((setup) => ({
      id: setup.id,
      projectId: setup.projectId,
      hostId: setup.hostId,
      repoId: setup.repoId,
      label: getExecutionHostLabel(setup.hostId),
      detail: setup.displayName,
      path: setup.path
    }))
    .sort((a, b) => compareProjectHostSetupOptions(a, b))
}

function compareProjectHostSetupOptions(
  a: ProjectHostSetupOption,
  b: ProjectHostSetupOption
): number {
  if (a.hostId === LOCAL_EXECUTION_HOST_ID && b.hostId !== LOCAL_EXECUTION_HOST_ID) {
    return -1
  }
  if (b.hostId === LOCAL_EXECUTION_HOST_ID && a.hostId !== LOCAL_EXECUTION_HOST_ID) {
    return 1
  }
  return a.label.localeCompare(b.label) || a.path.localeCompare(b.path)
}
