window.__ModuleLoader__.load({
	id: "dsh-workos-tenant",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/index.jsx
		const NS = "workos.account";
		const zh = {
			accountMenu: "账户菜单",
			logout: "退出登录",
			signedInAs: "当前用户",
			organization: "组织"
		};
		const en = {
			accountMenu: "Account menu",
			logout: "Sign out",
			signedInAs: "Signed in as",
			organization: "Organization"
		};
		const styles = `
.dsh-workos-account { min-width: 0; width: 100%; }
.dsh-workos-account__menu { display: flex; width: 100%; }
.dsh-workos-account__button {
  box-sizing: border-box;
  width: calc(100% + 4px);
  height: 42px;
  margin: 4px -2px;
  padding: 0 8px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font: inherit;
  text-align: left;
  overflow: hidden;
}
.dsh-workos-account__button:hover,
.dsh-workos-account__button[data-open] {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-workos-account__avatar {
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: 50%;
  background: var(--dsw-alias-interactive-bg-active);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dsh-workos-account__copy {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}
.dsh-workos-account__primary,
.dsh-workos-account__secondary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0;
}
.dsh-workos-account__primary { font-size: 13px; line-height: 17px; }
.dsh-workos-account__secondary {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 15px;
}
.dsh-workos-account__chevron {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  transition: transform 150ms var(--ds-ease-in-out);
}
.dsh-workos-account__button[data-open] .dsh-workos-account__chevron {
  transform: rotate(180deg);
}
.dsh-workos-account--rail { width: 36px; }
.dsh-workos-account--rail .dsh-workos-account__button {
  width: 36px;
  height: 36px;
  margin: 0;
  padding: 0;
  justify-content: center;
  border-radius: 50%;
}
.dsh-workos-account--rail .dsh-workos-account__avatar {
  width: 36px;
  height: 36px;
  background: transparent;
}
@media (prefers-reduced-motion: reduce) {
  .dsh-workos-account__chevron { transition: none; }
}
`;
		function displayAccount(account) {
			return {
				primary: account.user.name || account.user.email || account.user.id,
				organization: account.organization.name || account.organization.id
			};
		}
		function useAccount() {
			const [account, setAccount] = (0, react.useState)();
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				fetch("/auth/me", {
					credentials: "same-origin",
					cache: "no-store",
					signal: controller.signal
				}).then(async (response) => response.ok ? response.json() : void 0).then((value) => {
					if (value?.user && value?.organization) setAccount(value);
				}).catch((error) => {
					if (error.name !== "AbortError") console.error("[dsh-workos-tenant] account lookup failed", error);
				});
				return () => {
					controller.abort();
				};
			}, []);
			return account;
		}
		function AccountAction({ wide, t }) {
			const account = useAccount();
			const [open, setOpen] = (0, react.useState)(false);
			if (!account) return null;
			const { primary, organization } = displayAccount(account);
			const label = `${primary}, ${organization}`;
			const button = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: "dsh-workos-account__button",
				"aria-label": `${t("accountMenu")}: ${label}`,
				"aria-haspopup": "menu",
				"aria-expanded": open,
				"data-open": open || void 0,
				onClick: () => {
					setOpen((value) => !value);
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-workos-account__avatar",
						"aria-hidden": "true",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconUserOutline16, { size: wide ? 14 : 18 })
					}),
					wide && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsh-workos-account__copy",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-workos-account__primary",
							children: primary
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-workos-account__secondary",
							children: organization
						})]
					}),
					wide && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronUpOutline14, { className: "dsh-workos-account__chevron" })
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: `dsh-workos-account${wide ? "" : " dsh-workos-account--rail"}`,
				"data-dsh-workos-account": "",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
					className: "dsh-workos-account__menu",
					open,
					side: "top",
					align: wide ? "end" : "start",
					portal: true,
					compact: true,
					items: [
						{
							type: "label",
							id: "user",
							text: `${t("signedInAs")}: ${primary}`
						},
						{
							type: "label",
							id: "organization",
							text: `${t("organization")}: ${organization}`
						},
						{
							type: "separator",
							id: "account-separator"
						},
						{
							id: "logout",
							label: t("logout"),
							danger: true
						}
					],
					onSelect: (id) => {
						if (id !== "logout") return;
						setOpen(false);
						window.location.assign("/auth/logout");
					},
					onClose: () => {
						setOpen(false);
					},
					anchor: wide ? button : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
						label,
						side: "right",
						delayMs: 500,
						children: button
					})
				})
			});
		}
		function installStyles() {
			const id = "dsh-workos-tenant/account";
			if (document.querySelector(`style[data-plugin-css=${JSON.stringify(id)}]`)) return () => {};
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-workos-tenant";
			tag.dataset.pluginCss = id;
			tag.textContent = styles;
			document.head.appendChild(tag);
			return () => {
				tag.remove();
			};
		}
		const inject = ["slots", "locale"];
		function apply(ctx) {
			ctx.effect(installStyles, "workos-account: styles");
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "workos-account: dictionaries");
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "workos-account",
				order: 100,
				locale: NS
			}, AccountAction));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map