import { mkdtempSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getStatusOp } from './git-handler-status-ops'
import type { GitExec } from './git-handler-ops'

describe('getStatusOp', () => {
  let tmpDir: string | null = null

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true })
      tmpDir = null
    }
  })

  it('keeps large parsed status entry lists instead of treating them as a status failure', async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'relay-git-status-'))
    const statusOutput = Array.from(
      { length: 130_000 },
      (_, index) => `1 M. N... 100644 100644 100644 abcdef abcdef packages/app/file-${index}.ts`
    ).join('\n')
    const git = vi.fn<GitExec>(async (args) => {
      if (args.includes('status')) {
        return { stdout: statusOutput, stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })

    const result = await getStatusOp(git, { worktreePath: tmpDir })

    expect(result.entries).toHaveLength(130_000)
    expect(result.entries.at(-1)).toMatchObject({
      area: 'staged',
      path: 'packages/app/file-129999.ts',
      status: 'modified'
    })
  })
})
