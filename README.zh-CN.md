# dsh-workos-tenant

[English README](README.md)

`dsh-workos-tenant` 是一个用于 DeepSeek Harness（DSH）的 WorkOS 多租户插件。它不修改 DSH 源码，在一个组织专用的 DSH 实例内提供：

- WorkOS AuthKit 登录、回调和退出；
- HttpOnly 会话 Cookie 和未登录请求保护；
- WorkOS 组织和用户身份绑定；
- Session、Workspace 的用户级归属和资源隔离；
- 用户级 LLM API Key 路由；
- 本地 JSON 存储；
- 可选的 Cloudflare D1 持久化。

当前包名和 DSH 插件 ID 都是 `dsh-workos-tenant`。

## 架构

浏览器访问 DSH，插件在服务端完成 WorkOS 登录回调和身份确认。每个 DSH 实例通过 `WORKOS_ORGANIZATION_ID` 绑定到一个 WorkOS 组织。Cloudflare 只负责 DNS、HTTPS、WAF 或外部部署路由；WorkOS 认证在插件内完成。

插件不会信任浏览器提交的 `organizationId`、`userId` 或角色字段。身份只能来自服务端完成的 WorkOS 授权码交换和会话 Cookie。

## 环境要求

- Node.js `>=22`；
- DSH `>=0.1.2-rc.1 <0.2.0`；
- WorkOS AuthKit 项目；
- 使用 D1 时，需要 Cloudflare API Token 和 D1 数据库。

## 安装到 DSH

本地开发时：

```bash
pnpm install

export DSH_HOME="$PWD/.dsh-local"
dsh plugin --profile web add "link:$(pwd)"
```

启动：

```bash
dsh --profile web --no-open --host 127.0.0.1 --port 3080
```

如果已经安装过旧名称 `dsh-org-tenant`，请先在 DSH 插件列表中移除旧条目，再安装新的 `dsh-workos-tenant`。

## WorkOS 配置

WorkOS 和 Cloudflare 的密钥只通过环境变量配置，不提交到 GitHub，也不放入插件设置文件：

```bash
export WORKOS_API_KEY="sk_..."
export WORKOS_CLIENT_ID="client_..."
export WORKOS_ORGANIZATION_ID="org_..."
export WORKOS_REDIRECT_URI="http://127.0.0.1:3080/auth/callback"
export WORKOS_COOKIE_SECRET="至少32个随机字符"
```

`WORKOS_ORGANIZATION_ID` 会限制当前 DSH 实例只能服务指定的 WorkOS 组织。

在 WorkOS Dashboard 中配置相同的回调地址：

```text
http://127.0.0.1:3080/auth/callback
```

WorkOS 相关路由：

```text
GET /auth/login
GET /auth/callback
GET /auth/logout
GET /auth/me
```

WorkOS API Key 和 Cookie Secret 必须只存在于 DSH 服务端环境中。

## 存储配置

默认使用本地 JSON 文件：

```text
$DSH_HOME/tenant-state.json
```

也可以指定路径：

```bash
export DSH_TENANT_STATE_FILE="/path/to/tenant-state.json"
```

本地开发不配置 D1 即可运行。

### Cloudflare D1

DSH 当前运行在 Node 服务中，不能直接使用 Cloudflare Worker 的 D1 binding。因此插件通过 Cloudflare D1 REST API 访问数据库。

```bash
export DSH_TENANT_STORAGE=d1
export CLOUDFLARE_ACCOUNT_ID="..."
export CLOUDFLARE_D1_DATABASE_ID="..."
export CLOUDFLARE_API_TOKEN="..."
export DSH_TENANT_ENCRYPTION_KEY="至少32个随机字符"
```

D1 模式会自动创建并使用 `dsh_tenant_state` 表。租户状态在发送到 D1 前会加密，其中包括用户级 LLM API Key。

D1 配置中的账号 ID、数据库 ID、API Token 和加密密钥都使用环境变量。插件设置只保留本地存储路径、存储模式和非秘密 API 地址等选项。

当前 D1 写入在单个 DSH 进程内串行化。运行多个 DSH 副本前，需要额外设计跨实例并发控制和密钥轮换机制。

## 资源隔离

启用 WorkOS 后，插件会自动包装 DSH 的 Session 和 Workspace Remote Controller：

- Session 列表和搜索结果按用户过滤；
- Session 创建和 fork 自动登记所有者；
- prompt、rename、queue、cancel、page、follow 等操作检查 Session 归属；
- Workspace 创建自动登记所有者；
- Workspace 修改、删除、排序、Session 插入和归档检查 Workspace/Session 归属；
- Workspace 和 Session 流只返回当前用户有权访问的数据；
- 组织管理员可以按策略访问组织内其他用户资源。

自定义 Controller 可以使用导出的 `TenantSessionGuard` 和 `TenantWorkspaceGuard`。

## 用户级 LLM Key

API Key 不通过浏览器返回。Session 的 API Key 根据已登记的 Session 所有者解析：

```js
const key = ctx.tenantPolicy.resolveSessionApiKey({
  sessionId,
  provider: 'openai',
})
```

插件不会把 API Key 放进普通描述接口或列表响应中。生产环境仍建议结合专用 Secret Vault 和密钥轮换机制。

## 测试

```bash
pnpm install
npm test
```

当前测试覆盖 WorkOS 会话、OAuth state、Session/Workspace 自动授权、本地加密存储和 D1 REST 请求格式。

## GitHub

仓库地址：

```text
https://github.com/gepeiyu/dsh-workos-tenant
```

上传前必须确认没有提交以下内容：

- `.env` 文件；
- WorkOS API Key、Client Secret 或 Cookie Secret；
- Cloudflare API Token 和 D1 加密密钥；
- DSH Profile；
- `tenant-state.json`；
- 私钥、JWT 或客户数据。

`.gitignore` 已排除本地环境文件、DSH Profile、依赖目录和租户状态文件。

## 许可证

MIT License。
