# File Explorer Case-Only Rename

## Verified Current Behavior

Case-only renames (for example `README.md` -> `readme.md`) are blocked before `rename()`:

- Renderer no-ops only for exact string equality, then calls rename.
- `renameRuntimePath` routes to `window.api.fs.rename` (local fallback) or runtime RPC `files.rename`.
- Local IPC `fs:rename` always rejects when `lstat(newPath)` succeeds.
- Runtime-local `renameFileExplorerPath` applies the same reject-on-exists check.

So on case-insensitive filesystems, the destination preflight is a false positive when `oldPath` and `newPath` refer to the same underlying file.

## Root Cause

`assertNotExists(newPath)` and `assertRuntimePathDoesNotExist(newPath)` implement a blanket no-overwrite guard that cannot distinguish:

- true collision: different destination entry already exists
- same-file case-only rename target

## Correctness Constraints

- Do not use lowercase-path equality as the primary allow condition. It is wrong on case-sensitive filesystems.
- `dev+ino` equality alone is also not sufficient: distinct hard-link names can share inode/device and would be incorrectly allowed.
- Keep symlink-leaf semantics unchanged (`preserveSymlink: true`, `lstat`-based checks).
- Keep provider/remote behavior unchanged. SSH providers own their own collision semantics.

## Proposed Rule

In both local rename implementations (`fs:rename` and runtime-local `renameFileExplorerPath`):

1. Resolve `oldPath` and `newPath` exactly as today (`preserveSymlink: true`).
2. `lstat(newPath)`:
   - `ENOENT`: proceed to `rename(oldPath, newPath)`.
   - exists: then `lstat(oldPath)`.
3. Allow only when all are true:
   - `old.dev === new.dev && old.ino === new.ino`
   - `dirname(oldPath) === dirname(newPath)`
   - `basename(oldPath) !== basename(newPath)`
   - case-fold-equal basename after normalization via a shared helper (same helper in both main-process call sites).
4. Otherwise throw the existing `"already exists"` error.
5. When allowed, always execute `rename(oldPath, newPath)` (do not short-circuit) so casing change is actually applied.

This preserves no-clobber behavior while permitting case-only rename on case-insensitive filesystems, and avoids the hard-link false allow.

### Case-Fold Helper Requirement

- Do not inline ad-hoc `toLowerCase()` in two places.
- Add one shared helper for "case-only candidate" comparison so IPC and runtime-local rename cannot drift.
- Normalize both basenames before compare (for consistency on macOS/APFS Unicode forms) and then case-fold.
- This is still a best-effort filesystem-agnostic approximation; it is not a substitute for filesystem-native collation APIs (which we do not have in Node here).

## Scope Boundaries

- Keep renderer exact-name no-op unchanged.
- Keep existing error strings for collision paths.
- Keep runtime routing unchanged: `renameRuntimePath` may call local IPC when not using runtime RPC pathing.

## Concurrency And Consistency

- Still non-atomic: TOCTOU race remains between preflight and `rename()`.
- Multi-window and external mutation behavior remains watcher-driven; this change adds no new cross-window invalidation guarantees.
- If `lstat(oldPath)` fails after destination existence was observed, propagate the filesystem error.
- No "single atomic call" claim: Node does not provide an atomic "rename-if-destination-is-same-entry-else-fail" primitive.

## Tests To Add

- `src/main/ipc/filesystem-mutations.test.ts`
  - case-only allow (same `dev/ino`, same parent, case-fold-equal different basename)
  - reject true collision (different `dev/ino`)
  - reject hard-link alias collision (same `dev/ino`, different non-case basename)
  - reject cross-parent rename even with same `dev/ino` + case-fold-equal basename
- `src/main/runtime/orca-runtime-files.test.ts`
  - add rename coverage for runtime-local `renameFileExplorerPath` with the same three cases above
  - include one parity test proving runtime-local logic matches `fs:rename` guard behavior

## Out Of Scope

- Inline rename UX, autosave quiesce, undo/redo, tab remap
- Authorization/path resolution model
- Any temporary two-step rename fallback
