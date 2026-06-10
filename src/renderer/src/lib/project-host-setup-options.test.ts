import { describe, expect, it } from 'vitest'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { ProjectHostSetup, Repo } from '../../../shared/types'
import { buildProjectHostSetupOptions } from './project-host-setup-options'

function repo(id: string): Repo {
  return {
    id,
    path: `/repos/${id}`,
    displayName: id,
    badgeColor: '#000000',
    addedAt: 1
  }
}

function setup(
  id: string,
  projectId: string,
  hostId: ExecutionHostId,
  repoId: string,
  overrides: Partial<ProjectHostSetup> = {}
): ProjectHostSetup {
  return {
    id,
    projectId,
    hostId,
    repoId,
    path: `/repos/${repoId}`,
    displayName: repoId,
    setupState: 'ready',
    setupMethod: 'legacy-repo',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('buildProjectHostSetupOptions', () => {
  it('returns ready setup choices for one project sorted with local first', () => {
    const options = buildProjectHostSetupOptions({
      projectId: 'project-1',
      eligibleRepos: [repo('local-repo'), repo('remote-repo')],
      projectHostSetups: [
        setup('remote', 'project-1', 'ssh:builder', 'remote-repo'),
        setup('local', 'project-1', 'local', 'local-repo')
      ]
    })

    expect(options.map((option) => option.id)).toEqual(['local', 'remote'])
    expect(options[0]).toMatchObject({ label: 'Local Mac', repoId: 'local-repo' })
    expect(options[1]).toMatchObject({ label: 'builder', repoId: 'remote-repo' })
  })

  it('omits setups that are not ready or cannot create through an eligible repo', () => {
    const options = buildProjectHostSetupOptions({
      projectId: 'project-1',
      eligibleRepos: [repo('ready-repo')],
      projectHostSetups: [
        setup('ready', 'project-1', 'local', 'ready-repo'),
        setup('setting-up', 'project-1', 'ssh:builder', 'missing-repo', {
          setupState: 'setting-up'
        }),
        setup('other-project', 'project-2', 'local', 'ready-repo')
      ]
    })

    expect(options.map((option) => option.id)).toEqual(['ready'])
  })
})
