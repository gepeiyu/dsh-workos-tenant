import { createHash } from 'node:crypto'

const TENANT_PROVIDER_PATTERN = /^tenant_[a-f0-9]{16}__/

function identityKey(identity) {
  return `${identity.organizationId}:${identity.userId}`
}

export function tenantProviderPrefix(identity) {
  const digest = createHash('sha256').update(identityKey(identity)).digest('hex').slice(0, 16)
  return `tenant_${digest}__`
}

export function tenantCredentialRef(identity, ref) {
  const digest = createHash('sha256').update(identityKey(identity)).digest('hex').slice(0, 16)
  return `DSH_TENANT_${digest.toUpperCase()}_${ref}`
}

export function isConfigurationAdmin(identity) {
  return identity?.role === 'owner' || identity?.role === 'admin'
}

export function isTenantProvider(provider) {
  return TENANT_PROVIDER_PATTERN.test(provider)
}

export function canSeeProvider(identity, provider) {
  return !isTenantProvider(provider) || provider.startsWith(tenantProviderPrefix(identity))
}

export function filterModelCatalog(identity, value) {
  if (!value || isConfigurationAdmin(identity)) return value
  const allowed = row => canSeeProvider(identity, row.id)
  return {
    ...value,
    groups: (value.groups ?? []).filter(allowed),
    failures: (value.failures ?? []).filter(allowed),
  }
}

function pathsForNamespace(directory, namespace) {
  const paths = directory
    .filter(entry => entry.settingsNs === namespace && entry.settingsPath?.length > 0)
    .map(entry => entry.settingsPath.slice(0, -1))
  return paths.filter((path, index) =>
    paths.findIndex(other => JSON.stringify(other) === JSON.stringify(path)) === index)
}

function pathStartsWith(path, prefix) {
  return prefix.every((segment, index) => path[index] === segment)
}

function rewritePath(identity, path, roots) {
  const root = roots.find(candidate => pathStartsWith(path, candidate) && path.length > candidate.length)
  if (!root) throw new Error('Members may only edit user-scoped model providers')
  const index = root.length
  const provider = path[index]
  const prefix = tenantProviderPrefix(identity)
  if (typeof provider !== 'string' || provider.length === 0) {
    throw new Error('Model provider id is required')
  }
  if (isTenantProvider(provider) && !provider.startsWith(prefix)) {
    throw new Error('Model provider belongs to another user')
  }
  return [
    ...path.slice(0, index),
    provider.startsWith(prefix) ? provider : `${prefix}${provider}`,
    ...path.slice(index + 1),
  ]
}

export function rewriteMemberModelOps(identity, directory, namespace, ops) {
  const roots = pathsForNamespace(directory, namespace)
  if (roots.length === 0) throw new Error('This model provider has shared configuration')
  return ops.map(op => ({ ...op, path: rewritePath(identity, op.path, roots) }))
}

function filterProviderDict(identity, object) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return object
  return Object.fromEntries(Object.entries(object).filter(([provider]) =>
    canSeeProvider(identity, provider)))
}

function filterAtRoot(identity, object, root) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return object
  if (root.length === 0) return filterProviderDict(identity, object)
  const [head, ...tail] = root
  if (!(head in object)) return object
  return { ...object, [head]: filterAtRoot(identity, object[head], tail) }
}

export function filterMemberNamespace(identity, directory, descriptor) {
  const roots = pathsForNamespace(directory, descriptor.ns)
  if (roots.length === 0) return descriptor
  const filter = value => roots.reduce(
    (current, root) => filterAtRoot(identity, current, root),
    value,
  )
  return {
    ...descriptor,
    value: filter(descriptor.value),
    ...(descriptor.base === undefined ? {} : { base: filter(descriptor.base) }),
    ...(descriptor.user === undefined ? {} : { user: filter(descriptor.user) }),
  }
}

export function filterMemberProviders(identity, providers) {
  return providers.filter(entry => canSeeProvider(identity, entry.provider))
}

export function rpcForbidden(request, message = 'Administrator permission is required') {
  return {
    rpcId: request.rpcId,
    result: {
      ok: false,
      error: {
        code: 'forbidden',
        message,
        details: {},
      },
    },
  }
}

export function mapRpcValue(response, transform) {
  if (!response?.result?.ok) return response
  return {
    ...response,
    result: {
      ...response.result,
      value: transform(response.result.value),
    },
  }
}
