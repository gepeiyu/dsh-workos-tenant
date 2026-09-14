import { Service } from '@deepseek-ai/cordis'
import { ManagedTenantConfigStore } from './config.js'

export const name = 'dsh-workos-tenant-network'
export const inject = []

export function apply(ctx) {
  const managed = new ManagedTenantConfigStore().load()
  ctx.provide('tenantNetwork', {
    allowNetworkAccess: managed.network?.allowNetworkAccess === true,
  })
}

export default apply
