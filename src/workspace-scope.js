import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { TenantError } from './policy.js'

function segment(value) {
  const text = String(value)
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(text)
    ? text
    : `~${Buffer.from(text).toString('base64url')}`
}

function inside(root, candidate) {
  const path = relative(root, candidate)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function existingAncestor(path) {
  let current = path
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) return current
    current = parent
  }
  return current
}

export function userWorkspaceRoot(config, identity, ensure = false) {
  const configured = config?.workspace?.root?.trim()
  if (!configured) return undefined
  const root = resolve(configured, segment(identity.organizationId), segment(identity.userId))
  for (const directory of [dirname(root), root]) {
    if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) {
      throw new TenantError('WORKSPACE_PATH_FORBIDDEN', 'User workspace directory cannot be a symbolic link', 403)
    }
  }
  if (ensure) mkdirSync(root, { recursive: true, mode: 0o700 })
  return root
}

export function assertWorkspacePath(config, identity, path, options = {}) {
  const root = userWorkspaceRoot(config, identity, options.ensureRoot)
  if (!root) return resolve(options.relativeTo ?? process.cwd(), path)
  const candidate = resolve(options.relativeTo ?? root, path)
  if (!inside(root, candidate)) {
    throw new TenantError('WORKSPACE_PATH_FORBIDDEN', 'Path is outside the current user workspace root', 403)
  }
  if (existsSync(root)) {
    const realRoot = realpathSync(root)
    const ancestor = realpathSync(existingAncestor(candidate))
    if (!inside(realRoot, ancestor)) {
      throw new TenantError('WORKSPACE_PATH_FORBIDDEN', 'Path escapes the current user workspace root', 403)
    }
  }
  return candidate
}
