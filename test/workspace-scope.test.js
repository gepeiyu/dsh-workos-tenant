import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { assertWorkspacePath, userWorkspaceRoot } from '../src/workspace-scope.js'

const alice = { organizationId: 'org_test', userId: 'user_alice' }

test('workspace paths are scoped by organization and user', () => {
  const base = mkdtempSync(join(tmpdir(), 'dsh-workspace-root-'))
  const config = { workspace: { root: base } }
  const root = userWorkspaceRoot(config, alice, true)
  assert.equal(root, join(base, 'org_test', 'user_alice'))
  assert.equal(assertWorkspacePath(config, alice, join(root, 'project')), join(root, 'project'))
  assert.throws(() => assertWorkspacePath(config, alice, join(base, 'org_test', 'user_bob')), /outside/)
})

test('workspace path validation rejects a symlink that escapes the user root', () => {
  const base = mkdtempSync(join(tmpdir(), 'dsh-workspace-symlink-'))
  const outside = mkdtempSync(join(tmpdir(), 'dsh-workspace-outside-'))
  const config = { workspace: { root: base } }
  const root = userWorkspaceRoot(config, alice, true)
  mkdirSync(join(root, 'project'))
  symlinkSync(outside, join(root, 'project', 'escape'))
  assert.throws(() => assertWorkspacePath(config, alice, join(root, 'project', 'escape', 'child')), /escapes/)
})

test('an empty workspace root preserves existing absolute paths', () => {
  assert.equal(assertWorkspacePath({ workspace: { root: '' } }, alice, '/existing/project'), '/existing/project')
})
