# Review Context

## Branch Info

- Base: origin/main
- Current: brennanb2025/fix-worktree-no-track

## Changed Files Summary

- M src/main/git/remove-worktree.test.ts
- M src/main/git/worktree.test.ts
- M src/main/git/worktree.ts

## Changed Line Ranges (PR Scope)

<!-- In scope: issues on these lines OR caused by these changes. Out of scope: unrelated pre-existing issues -->

| File                                  | Changed Lines                              |
| ------------------------------------- | ------------------------------------------ |
| src/main/git/remove-worktree.test.ts  | 456                                        |
| src/main/git/worktree.test.ts         | 210-260, 266, 276-281, 294, 316, 334, 339-360, 365-388, 399 |
| src/main/git/worktree.ts              | 187-240                                    |

## Review Standards Reference

- Follow /review-code standards
- Focus on: correctness, security, performance, maintainability
- Priority levels: Critical > High > Medium > Low

## File Categories

### Electron/Main (priority 1 — all files match `src/main/`)

- src/main/git/worktree.ts
- src/main/git/worktree.test.ts
- src/main/git/remove-worktree.test.ts

## Skipped Issues (Do Not Re-validate)

<!-- Issues validated but deemed not worth fixing. Do not re-validate these in future iterations. -->
<!-- Format: [file:line-range] | [severity] | [reason skipped] | [issue summary] -->
<!-- NOTE: Skips should be RARE - only purely cosmetic issues with no functional impact -->

[Initially empty — populated during validation phase]

## Iteration State

<!-- Updated after each phase to enable crash recovery -->

Current iteration: 1
Last completed phase: Validation (4 fixes scheduled)
Files fixed this iteration: []

## Validation Output (iteration 1)

### ✅ Fix
- A. worktree.ts:217-240 — Medium (Claude+Codex). Inner catch swallows ALL errors, but comment claims only exit 1 (unset) → other failures could trigger unintended writes. Tighten by inspecting error code; only treat exit 1 (with empty stdout) as unset; let other errors fall through to outer catch.
- B. worktree.ts:261-269 (addSparseWorktree rollback) — Low (Claude). Config write to push.autoSetupRemote is not rolled back when sparse setup fails. Add a single line to the existing comment block at lines 198-216 acknowledging the intentional asymmetry (consistent with "benign and idempotent" rationale).
- C. remove-worktree.test.ts:449-463 — Low (Claude). Sparse-failure test silently exercises "value already set" branch via mock fallthrough. Explicitly mock `config --get push.autoSetupRemote` to reject (unset path) and add `config --local set push.autoSetupRemote true` to expected `arrayContaining`.
- D. worktree.test.ts:243-255 — Low (Claude). Weak `.some()` assertions. Convert to full-array `toEqual` for symmetry with sibling tests.

### ⏭️ Skip
- Worktree.test.ts: add cases for set-true / set-other-value (architecture review). Skipping — current `toEqual` tightening (D) covers structural correctness; additional value-permutation tests are nice-to-have polish.
- Worktree.ts comment tightening on TOCTOU window. Skipping — subjective polish; existing comment block is already extensive.
- Worktree.ts gating behind a setting. Skipping — out of scope for this PR; would require a settings UI surface.

### 🚫 Out of scope
- src/relay/git-handler.ts:303-328 (SSH/relay worktree add path lacks --no-track and config write). Pre-existing divergence; not modified by this PR.

### ❌ False Positive
(none)

## Branch Summary (for reviewer context)

This branch fixes a UX issue with Orca-created worktrees:

1. Adds `--no-track` to `git worktree add` so the new branch doesn't inherit the base ref's upstream (prevents "behind by N" status pre-publish).
2. After worktree creation, sets `push.autoSetupRemote=true` (best-effort, warn-only on failure) so `git push` works without `-u` on first push.
3. Preserves any existing user-set value of `push.autoSetupRemote` (at any scope) by reading with `git config --get` first.
4. Updates corresponding tests for the new git invocations and the new config calls, and adds tests for the warn-on-failure path and the preserve-existing-value path.
