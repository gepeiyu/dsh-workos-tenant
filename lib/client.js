window.__ModuleLoader__.load({
	id: "dsh-workos-tenant",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/visibility.js
		/** Clear the legacy browser-wide selection before any account's UI resumes. */
		function installSessionVisibility(ctx, request = globalThis.fetch) {
			const sessions = ctx.sessions;
			if (typeof sessions.clear === "function") sessions.clear();
			let disposed = false;
			request("/auth/resources", {
				credentials: "same-origin",
				cache: "no-store"
			}).then((response) => {
				if (!response.ok) throw new Error(`Tenant policy is unavailable (${response.status})`);
				if (!disposed) return sessions.refresh();
			}).catch((error) => {
				console.error("[dsh-workos-tenant] navigation initialization failed", error);
			});
			return () => {
				disposed = true;
			};
		}
		//#endregion
		//#region src/client/branding.jsx
		const LEGACY_BRAND_SELECTOR = "svg[viewBox=\"0 0 182 24\"]";
		const BRAND_NAME_SELECTOR = "svg[viewBox=\"26 0 156 24\"]";
		const BRAND_MARK_SELECTOR = "svg[viewBox=\"0 0 23.16 17.04\"]";
		const BADGE_TEXT_SELECTOR = "g[clip-path*=\"badge\"]";
		const WHALE_SELECTOR = "g[clip-path*=\"whale\"]";
		const SVG_NS = "http://www.w3.org/2000/svg";
		const MAX_IMAGE_EDGE = 256;
		const DEFAULT_BRANDING = {
			badge: "HARNESS",
			logo: null,
			wordmark: null
		};
		const CHANGE_EVENT = "dsh-workos-tenant:branding-change";
		const FAVICON_SELECTOR = "link[rel~=\"icon\"]";
		function compressImage(dataUrl) {
			return new Promise((resolve) => {
				const image = new Image();
				image.onload = () => {
					try {
						const sourceWidth = image.naturalWidth || image.width;
						const sourceHeight = image.naturalHeight || image.height;
						const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(sourceWidth, sourceHeight));
						const canvas = document.createElement("canvas");
						canvas.width = Math.max(1, Math.round(sourceWidth * scale));
						canvas.height = Math.max(1, Math.round(sourceHeight * scale));
						canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
						resolve(canvas.toDataURL("image/png"));
					} catch {
						resolve(dataUrl);
					}
				};
				image.onerror = () => resolve(dataUrl);
				image.src = dataUrl;
			});
		}
		function readImage(file) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => compressImage(String(reader.result)).then(resolve);
				reader.onerror = reject;
				reader.readAsDataURL(file);
			});
		}
		function ImageField({ kind, value, onChange, t }) {
			const isLogo = kind === "logo";
			const inputId = `dsh-workos-brand-${kind}`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-workos-brand__field",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-workos-brand__copy",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t(isLogo ? "brandLogo" : "brandWordmark") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(isLogo ? "brandLogoHint" : "brandWordmarkHint") })]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-workos-brand__controls",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-workos-brand__preview",
							children: value ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
								src: value,
								alt: ""
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("brandDefault") })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							className: "dsh-workos-brand__button",
							htmlFor: inputId,
							children: t("brandChooseImage")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							id: inputId,
							className: "dsh-workos-brand__file",
							type: "file",
							accept: "image/png,image/jpeg,image/webp,image/gif",
							onChange: (event) => {
								const file = event.target.files?.[0];
								if (file) readImage(file).then(onChange);
								event.target.value = "";
							}
						}),
						value && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsh-workos-brand__button dsh-workos-brand__button--danger",
							onClick: () => onChange(null),
							children: t("brandReset")
						})
					]
				})]
			});
		}
		function BrandingSettings({ t }) {
			const [branding, setBranding] = (0, react.useState)(DEFAULT_BRANDING);
			const [status, setStatus] = (0, react.useState)("loading");
			const [error, setError] = (0, react.useState)();
			(0, react.useEffect)(() => {
				let active = true;
				fetch("/auth/tenant-branding", {
					credentials: "same-origin",
					cache: "no-store"
				}).then(async (response) => {
					const value = await response.json().catch(() => ({}));
					if (!response.ok) throw new Error(value.detail || t("brandLoadFailed"));
					if (active) {
						setBranding(value.branding ?? DEFAULT_BRANDING);
						setStatus("ready");
					}
				}).catch((reason) => {
					if (!active) return;
					setError(reason.message);
					setStatus("error");
				});
				return () => {
					active = false;
				};
			}, [t]);
			const save = (event) => {
				event.preventDefault();
				setStatus("saving");
				setError(void 0);
				fetch("/auth/tenant-branding", {
					method: "PUT",
					credentials: "same-origin",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...branding,
						badge: branding.badge.trim() || DEFAULT_BRANDING.badge
					})
				}).then(async (response) => {
					const value = await response.json().catch(() => ({}));
					if (!response.ok) throw new Error(value.detail || value.error || t("brandSaveFailed"));
					setBranding(value.branding ?? DEFAULT_BRANDING);
					setStatus("saved");
					window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
				}).catch((reason) => {
					setError(reason.message);
					setStatus("error");
				});
			};
			if (status === "loading") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
				className: "dsh-workos-brand dsh-workos-settings__group",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dsh-workos-settings__status",
					children: t("brandLoading")
				})
			});
			if (status === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
				className: "dsh-workos-brand dsh-workos-settings__group",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dsh-workos-settings__error",
					children: error
				})
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				className: "dsh-workos-brand dsh-workos-settings__group",
				onSubmit: save,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: "dsh-workos-settings__title",
						children: t("branding")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-workos-brand__intro",
						children: t("brandingHint")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ImageField, {
						kind: "logo",
						value: branding.logo,
						onChange: (logo) => setBranding((current) => ({
							...current,
							logo
						})),
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ImageField, {
						kind: "wordmark",
						value: branding.wordmark,
						onChange: (wordmark) => setBranding((current) => ({
							...current,
							wordmark
						})),
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dsh-workos-settings__field dsh-workos-settings__field--wide",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-workos-settings__label",
								children: t("brandBadge")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "dsh-workos-settings__input",
								value: branding.badge,
								maxLength: 30,
								onChange: (event) => setBranding((current) => ({
									...current,
									badge: event.target.value
								}))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-workos-settings__hint",
								children: t("brandBadgeHint")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-workos-brand__actions",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "submit",
								className: "dsh-workos-brand__button dsh-workos-brand__button--primary",
								disabled: status === "saving",
								children: status === "saving" ? t("brandSaving") : t("brandSave")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh-workos-brand__button",
								onClick: () => setBranding(DEFAULT_BRANDING),
								children: t("brandResetAll")
							}),
							status === "saved" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-workos-settings__status",
								children: t("brandSaved")
							}),
							error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-workos-settings__error",
								children: error
							})
						]
					})
				]
			});
		}
		function addImage(svg, key, value, x, y, width, height, preserveAspectRatio = "xMidYMid meet") {
			if (!value) return;
			const image = document.createElementNS(SVG_NS, "image");
			image.dataset.dshWorkosBranding = key;
			image.setAttribute("x", String(x));
			image.setAttribute("y", String(y));
			image.setAttribute("width", String(width));
			image.setAttribute("height", String(height));
			image.setAttribute("preserveAspectRatio", preserveAspectRatio);
			image.setAttribute("pointer-events", "none");
			image.setAttribute("href", value);
			image.setAttributeNS("http://www.w3.org/1999/xlink", "href", value);
			svg.appendChild(image);
		}
		function clearSvg(svg) {
			if (!svg) return;
			svg.querySelectorAll("[data-dsh-workos-branding]").forEach((element) => element.remove());
			svg.querySelector(BADGE_TEXT_SELECTOR)?.style.removeProperty("display");
			svg.querySelector(WHALE_SELECTOR)?.style.removeProperty("display");
			for (const child of svg.children) if (child.tagName === "path") child.style.removeProperty("display");
		}
		function renderBadge(svg, value) {
			if (value.badge === DEFAULT_BRANDING.badge) return;
			svg.querySelector(BADGE_TEXT_SELECTOR)?.style.setProperty("display", "none");
			const badge = document.createElementNS(SVG_NS, "foreignObject");
			badge.dataset.dshWorkosBranding = "badge";
			badge.setAttribute("x", "132.348");
			badge.setAttribute("y", "5.5");
			badge.setAttribute("width", "46");
			badge.setAttribute("height", "14");
			const label = document.createElement("div");
			label.className = "dsh-workos-brand__badge";
			label.textContent = value.badge;
			badge.appendChild(label);
			svg.appendChild(badge);
		}
		function renderBrand(svg, value) {
			clearSvg(svg);
			if (value.wordmark) {
				for (const child of svg.children) if (child.tagName === "path") child.style.display = "none";
				addImage(svg, "wordmark", value.wordmark, 27, 7.66, 94, 13.84, "xMidYMid slice");
			}
			if (value.logo) {
				svg.querySelector(WHALE_SELECTOR)?.style.setProperty("display", "none");
				addImage(svg, "logo", value.logo, .14, 3.52, 23.16, 17.04, "xMidYMid slice");
			}
			renderBadge(svg, value);
		}
		function renderBrandName(svg, value) {
			clearSvg(svg);
			if (value.wordmark) {
				for (const child of svg.children) if (child.tagName === "path") child.style.display = "none";
				addImage(svg, "wordmark", value.wordmark, 27, 7.66, 94, 13.84, "xMidYMid slice");
			}
			renderBadge(svg, value);
		}
		function renderBrandMark(svg, value) {
			clearSvg(svg);
			if (!value.logo) return;
			for (const child of svg.children) if (child.tagName === "path") child.style.display = "none";
			addImage(svg, "logo", value.logo, .14, 0, 23.16, 17.04, "xMidYMid slice");
		}
		function findBrandTargets() {
			const legacy = document.querySelector(LEGACY_BRAND_SELECTOR);
			if (legacy) return {
				name: legacy,
				mark: void 0,
				legacy: true
			};
			const name = document.querySelector(BRAND_NAME_SELECTOR);
			if (!name) return {
				name: void 0,
				mark: void 0,
				legacy: false
			};
			return {
				name,
				mark: (name.parentElement?.parentElement)?.querySelector(BRAND_MARK_SELECTOR) ?? document.querySelector(BRAND_MARK_SELECTOR),
				legacy: false
			};
		}
		function applyDocumentBranding(value, originalFavicons) {
			document.title = value.badge;
			let favicon = document.head.querySelector("[data-dsh-workos-branding=\"favicon\"]");
			if (!value.logo) {
				favicon?.remove();
				for (const { element, href } of originalFavicons) {
					if (!element.isConnected) continue;
					if (href === null) element.removeAttribute("href");
					else element.setAttribute("href", href);
				}
				return;
			}
			if (!favicon) {
				favicon = document.createElement("link");
				favicon.dataset.dshWorkosBranding = "favicon";
				favicon.setAttribute("rel", "icon");
				favicon.setAttribute("type", "image/png");
				document.head.appendChild(favicon);
			}
			favicon.setAttribute("href", value.logo);
			for (const link of document.head.querySelectorAll(FAVICON_SELECTOR)) {
				if (link !== favicon) link.setAttribute("href", value.logo);
			}
		}
		function installBrandingUnsafe() {
			const originalTitle = document.title;
			const originalFavicons = [...document.head.querySelectorAll(FAVICON_SELECTOR)].map((element) => ({
				element,
				href: element.getAttribute("href")
			}));
			let currentTargets;
			let currentValue;
			let currentSignature;
			const ensure = () => {
				const value = currentValue ?? DEFAULT_BRANDING;
				applyDocumentBranding(value, originalFavicons);
				const targets = findBrandTargets();
				if (!targets.name) return;
				const signature = `${value.badge}|${value.logo || ""}|${value.wordmark || ""}`;
				const changed = targets.name !== currentTargets?.name || targets.mark !== currentTargets?.mark || signature !== currentSignature;
				const missing = value.badge !== DEFAULT_BRANDING.badge && !targets.name.querySelector("[data-dsh-workos-branding=\"badge\"]") || !targets.legacy && targets.mark && value.logo && !targets.mark.querySelector("[data-dsh-workos-branding=\"logo\"]");
				if (changed || missing) {
					if (currentTargets?.name && currentTargets.name !== targets.name) clearSvg(currentTargets.name);
					if (currentTargets?.mark && currentTargets.mark !== targets.mark) clearSvg(currentTargets.mark);
					if (targets.legacy) renderBrand(targets.name, value);
					else {
						renderBrandName(targets.name, value);
						if (targets.mark) renderBrandMark(targets.mark, value);
					}
					currentTargets = targets;
					currentSignature = signature;
				}
			};
			const load = () => {
				fetch("/auth/tenant-branding", {
					credentials: "same-origin",
					cache: "no-store"
				}).then((response) => response.ok ? response.json() : void 0).then((value) => {
					if (value?.branding) {
						currentValue = value.branding;
						ensure();
					}
				}).catch(() => {});
			};
			const style = document.createElement("style");
			style.dataset.plugin = "dsh-workos-tenant/branding";
			style.textContent = `
    .dsh-workos-brand__intro { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; margin: 0 0 14px; }
    .dsh-workos-brand__field { display: flex; gap: 16px; align-items: center; padding: 12px 0; border-top: 1px solid var(--dsw-alias-border-l2); }
    .dsh-workos-brand__copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; }
    .dsh-workos-brand__copy strong { font-size: 13px; font-weight: 500; }
    .dsh-workos-brand__copy span { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
    .dsh-workos-brand__controls { display: flex; align-items: center; gap: 8px; flex: none; }
    .dsh-workos-brand__preview { width: 86px; height: 42px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 6px; display: flex; align-items: center; justify-content: center; overflow: hidden; color: var(--dsw-alias-label-tertiary); font-size: 10px; }
    .dsh-workos-brand__preview img { width: 100%; height: 100%; object-fit: contain; }
    .dsh-workos-brand__file { display: none; }
    .dsh-workos-brand__button { appearance: none; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 7px 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer; }
    .dsh-workos-brand__button:hover { background: var(--dsw-alias-interactive-bg-hover); }
    .dsh-workos-brand__button--primary { background: var(--dsw-alias-state-business-primary); border-color: transparent; color: white; }
    .dsh-workos-brand__button--danger { color: var(--dsw-alias-label-error); }
    .dsh-workos-brand__actions { display: flex; align-items: center; gap: 10px; padding-top: 16px; }
    .dsh-workos-brand__badge { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; box-sizing: border-box; padding: 0 1px; color: var(--dsw-alias-label-primary-inverted, #fff); font-family: inherit; font-size: 10px; font-weight: 400; line-height: 14px; letter-spacing: .4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    @media (max-width: 680px) { .dsh-workos-brand__field { align-items: flex-start; flex-direction: column; } .dsh-workos-brand__controls { width: 100%; flex-wrap: wrap; } }
  `;
			document.head.appendChild(style);
			const timer = window.setInterval(ensure, 600);
			const onChange = () => {
				load();
			};
			window.addEventListener(CHANGE_EVENT, onChange);
			load();
			ensure();
			return () => {
				window.clearInterval(timer);
				window.removeEventListener(CHANGE_EVENT, onChange);
				clearSvg(currentTargets?.name);
				clearSvg(currentTargets?.mark);
				document.head.querySelector("[data-dsh-workos-branding=\"favicon\"]")?.remove();
			for (const { element, href } of originalFavicons) {
				if (!element.isConnected) document.head.appendChild(element);
				if (href === null) element.removeAttribute("href");
				else element.setAttribute("href", href);
			}
				style.remove();
				document.title = originalTitle;
			};
		}
		/**
		* Branding is an optional DOM enhancement. A host shell can activate the
		* client plugin before its document chrome is ready, so a DOM failure here
		* must not abort the whole client plugin tree.
		*/
		function installBranding() {
			if (typeof window === "undefined" || typeof document === "undefined") return;
			try {
				return installBrandingUnsafe();
			} catch (error) {
				console.error("[dsh-workos-tenant] branding enhancement unavailable", error);
			}
		}
		//#endregion
		//#region src/client/index.jsx
		const NS = "workos.account";
		const zh = {
			accountMenu: "账户菜单",
			loadingAccount: "正在加载账户…",
			signedOut: "未登录",
			localMode: "本地模式",
			accountUnavailable: "账户状态不可用",
			signIn: "登录",
			logout: "退出登录",
			signedInAs: "当前用户",
			organization: "组织",
			role: "角色",
			tenantTab: "WorkOS 租户",
			tenantTitle: "WorkOS 租户配置",
			tenantIntro: "管理登录、网络访问、工作区路径和租户状态存储。连接或存储变更将在重启 DSH 后生效。",
			branding: "品牌定制",
			brandingHint: "作为平台级设置保存到当前租户存储。图片会在浏览器中压缩后传输，所有已登录用户都会看到同一品牌。",
			brandLogo: "鲸鱼标志",
			brandLogoHint: "替换左上角的鲸鱼图形，建议使用带透明背景的方形图片。",
			brandWordmark: "DeepSeek 字标",
			brandWordmarkHint: "替换 DeepSeek 文字区域，建议使用横向透明图片。",
			brandBadge: "HARNESS 徽章文字",
			brandBadgeHint: "最多 30 个字符，同时同步浏览器标签页标题。",
			brandDefault: "使用默认图案",
			brandChooseImage: "选择本地图片",
			brandReset: "恢复默认",
			brandResetAll: "全部恢复默认",
			brandSave: "保存品牌设置",
			brandSaving: "正在保存…",
			brandSaved: "品牌设置已保存。",
			brandLoading: "正在加载品牌设置…",
			brandLoadFailed: "无法加载品牌设置。请确认租户存储已启用。",
			brandSaveFailed: "无法保存品牌设置。",
			network: "网络访问",
			allowNetworkAccess: "允许同一网络中的其他设备访问 DSH",
			allowNetworkAccessHint: "开启后 DSH 会监听所有网卡。保存后需要重启 DSH，并确认防火墙只允许可信网络。",
			workspaceScope: "工作区路径隔离",
			workspaceRoot: "工作区根目录",
			workspaceRootHint: "可留空保持现有路径。设置绝对路径后，每位用户只能使用“根目录/组织 ID/用户 ID”下的目录；保存后立即生效。",
			workosConnection: "WorkOS 连接",
			clientId: "Client ID",
			organizationId: "Organization ID",
			redirectUri: "回调地址",
			redirectUriHint: "默认用于本机登录。开启网络访问后会自动改为当前访问主机；请在 WorkOS 中登记每个完整回调地址及对应退出地址。production 环境请使用 HTTPS 域名。",
			apiKey: "API Key",
			cookieSecret: "Cookie Secret",
			sessionMaxAge: "登录有效期（秒）",
			secureCookies: "仅通过 HTTPS 发送登录 Cookie",
			storage: "租户状态存储",
			storageMode: "存储方式",
			local: "本地文件",
			d1: "Cloudflare D1",
			statePath: "本地状态文件",
			encryptionKey: "状态加密密钥",
			accountId: "Cloudflare Account ID",
			databaseId: "D1 Database ID",
			apiBaseUrl: "Cloudflare API 地址",
			apiToken: "Cloudflare API Token",
			secretConfigured: "已配置；留空保持不变",
			secretMissing: "尚未配置",
			save: "保存配置",
			saving: "正在保存…",
			saved: "配置已保存。请重启 DSH 以应用连接或存储变更。",
			loading: "正在加载配置…",
			loadFailed: "无法加载租户配置。",
			retry: "重试"
		};
		const en = {
			accountMenu: "Account menu",
			loadingAccount: "Loading account…",
			signedOut: "Signed out",
			localMode: "Local mode",
			accountUnavailable: "Account status unavailable",
			signIn: "Sign in",
			logout: "Sign out",
			signedInAs: "Signed in as",
			organization: "Organization",
			role: "Role",
			tenantTab: "WorkOS tenant",
			tenantTitle: "WorkOS tenant configuration",
			tenantIntro: "Manage sign-in, network access, workspace paths, and tenant-state storage. Connection and storage changes apply after restarting DSH.",
			branding: "Branding",
			brandingHint: "Stored as a platform setting in the selected tenant storage. Images are compressed in the browser before upload, and all signed-in users see the same brand.",
			brandLogo: "Whale logo",
			brandLogoHint: "Replace the whale mark in the top-left corner. A square transparent image works best.",
			brandWordmark: "DeepSeek wordmark",
			brandWordmarkHint: "Replace the DeepSeek wordmark. A wide transparent image works best.",
			brandBadge: "HARNESS badge text",
			brandBadgeHint: "Up to 30 characters; the browser tab title follows this value.",
			brandDefault: "Default artwork",
			brandChooseImage: "Choose local image",
			brandReset: "Restore default",
			brandResetAll: "Restore all defaults",
			brandSave: "Save branding",
			brandSaving: "Saving…",
			brandSaved: "Branding saved.",
			brandLoading: "Loading branding…",
			brandLoadFailed: "Could not load branding. Check that tenant storage is enabled.",
			brandSaveFailed: "Could not save branding.",
			network: "Network access",
			allowNetworkAccess: "Allow other devices on the network to access DSH",
			allowNetworkAccessHint: "DSH will listen on all network interfaces. Restart DSH after saving and restrict access with your firewall.",
			workspaceScope: "Workspace path isolation",
			workspaceRoot: "Workspace root",
			workspaceRootHint: "Leave blank to preserve existing paths. When set to an absolute path, each user is restricted to root/organization ID/user ID. Applies immediately.",
			workosConnection: "WorkOS connection",
			clientId: "Client ID",
			organizationId: "Organization ID",
			redirectUri: "Redirect URI",
			redirectUriHint: "Used as the local default. With network access enabled, the current host is used automatically; register every callback and matching sign-out URL in WorkOS. Use an HTTPS domain in production.",
			apiKey: "API key",
			cookieSecret: "Cookie secret",
			sessionMaxAge: "Session lifetime (seconds)",
			secureCookies: "Send the sign-in cookie over HTTPS only",
			storage: "Tenant-state storage",
			storageMode: "Storage mode",
			local: "Local file",
			d1: "Cloudflare D1",
			statePath: "Local state file",
			encryptionKey: "State encryption key",
			accountId: "Cloudflare Account ID",
			databaseId: "D1 Database ID",
			apiBaseUrl: "Cloudflare API URL",
			apiToken: "Cloudflare API token",
			secretConfigured: "Configured; leave blank to keep it",
			secretMissing: "Not configured",
			save: "Save configuration",
			saving: "Saving…",
			saved: "Configuration saved. Restart DSH to apply connection or storage changes.",
			loading: "Loading configuration…",
			loadFailed: "Could not load tenant configuration.",
			retry: "Retry"
		};
		const styles = `
.dsh-workos-account { min-width: 0; width: 100%; }
.dsh-workos-account__menu { display: flex; width: 100%; }
.dsh-workos-account__menu-list {
  min-width: 224px !important;
  padding: 8px !important;
}
.dsh-workos-account__menu-list [role="menuitem"] {
  min-height: 38px;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 20px;
}
.dsh-workos-account__menu-list > [role="presentation"] > [role="presentation"] {
  padding: 7px 10px;
  font-size: 12px;
  line-height: 18px;
}
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
.dsh-workos-settings { color: var(--dsw-alias-label-primary); max-width: 700px; }
.dsh-workos-settings__header { margin-bottom: 20px; }
.dsh-workos-settings__title { margin: 0 0 5px; font-size: 17px; line-height: 24px; letter-spacing: 0; }
.dsh-workos-settings__intro,
.dsh-workos-settings__hint,
.dsh-workos-settings__secret-state,
.dsh-workos-settings__status { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dsh-workos-settings__intro { margin: 0; }
.dsh-workos-settings__group { border-top: 1px solid var(--dsw-alias-border-l2); padding: 18px 0 20px; }
.dsh-workos-settings__group-title { margin: 0 0 14px; font-size: 14px; line-height: 20px; letter-spacing: 0; }
.dsh-workos-settings__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 16px; }
.dsh-workos-settings__field { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.dsh-workos-settings__field--wide { grid-column: 1 / -1; }
.dsh-workos-settings__label { font-size: 12px; font-weight: 500; line-height: 18px; }
.dsh-workos-settings__input,
.dsh-workos-settings__select {
  box-sizing: border-box; width: 100%; height: 34px; padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px; letter-spacing: 0;
}
.dsh-workos-settings__input:focus,
.dsh-workos-settings__select:focus { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }
.dsh-workos-settings__check { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 19px; }
.dsh-workos-settings__check input { margin: 3px 0 0; }
.dsh-workos-settings__actions { border-top: 1px solid var(--dsw-alias-border-l2); padding-top: 16px; display: flex; align-items: center; gap: 12px; }
.dsh-workos-settings__error { color: var(--dsw-alias-label-error); font-size: 12px; line-height: 18px; }
@media (max-width: 680px) {
  .dsh-workos-settings__grid { grid-template-columns: minmax(0, 1fr); }
  .dsh-workos-settings__field--wide { grid-column: auto; }
  html[data-dsh-workos-member] [role="dialog"]:has(> nav) > nav { display: none; }
  html[data-dsh-workos-member] [role="dialog"]:has(> nav) > div {
    width: 100%;
    min-width: 0;
    flex: 1 1 auto;
  }
}
html[data-dsh-workos-member] [role="dialog"]:has(> nav) > div > :first-child > :not(:last-child) {
  display: none;
}
`;
		let accountSnapshot;
		let accountRequest;
		let accountState = "loading";
		const accountListeners = /* @__PURE__ */ new Set();
		function notifyAccountListeners() {
			for (const listener of accountListeners) listener();
		}
		function setAccountState(value) {
			if (accountState === value) return;
			accountState = value;
			notifyAccountListeners();
		}
		function loadAccount({ force = false } = {}) {
			if (accountSnapshot) return Promise.resolve(accountSnapshot);
			if (force) accountRequest = void 0;
			accountRequest ??= fetch("/auth/me", {
				credentials: "same-origin",
				cache: "no-store"
			}).then(async (response) => {
				if (response.ok) return response.json();
				setAccountState(response.status === 404 ? "local" : response.status === 401 || response.status === 403 ? "signed-out" : "error");
			}).then((value) => {
				if (value?.user && value?.organization) {
					accountSnapshot = value;
					setAccountState("signed-in");
				}
				return accountSnapshot;
			}).catch((error) => {
				console.error("[dsh-workos-tenant] account lookup failed", error);
				setAccountState("error");
			}).finally(() => {
				accountRequest = void 0;
			});
			return accountRequest;
		}
		function displayAccount(account) {
			return {
				primary: account.user.name || account.user.email || account.user.id,
				organization: account.organization.name || account.organization.id
			};
		}
		function useAccount() {
			const [value, setValue] = (0, react.useState)(() => ({
				account: accountSnapshot,
				status: accountState
			}));
			(0, react.useEffect)(() => {
				let active = true;
				let attempts = 0;
				let retryTimer;
				const update = () => {
					loadAccount({ force: attempts > 0 }).then((value) => {
						if (!active) return;
						setValue({
							account: value,
							status: accountState
						});
						if (!value && attempts < 5) {
							attempts += 1;
							retryTimer = window.setTimeout(update, 1200);
						}
					});
				};
				const wake = () => {
					attempts = 0;
					update();
				};
				const onSnapshot = () => {
					if (active) setValue({
						account: accountSnapshot,
						status: accountState
					});
				};
				accountListeners.add(onSnapshot);
				window.addEventListener("focus", wake);
				document.addEventListener("visibilitychange", wake);
				update();
				return () => {
					active = false;
					accountListeners.delete(onSnapshot);
					window.removeEventListener("focus", wake);
					document.removeEventListener("visibilitychange", wake);
					if (retryTimer !== void 0) window.clearTimeout(retryTimer);
				};
			}, []);
			return value;
		}
		function isAdmin(account) {
			return account?.identity?.role === "owner" || account?.identity?.role === "admin";
		}
		function installSettingsVisibility(ctx) {
			const slots = ctx.slots;
			const entries = slots.entries.bind(slots);
			const entriesOfSlot = slots.entriesOfSlot.bind(slots);
			const getVersion = slots.getVersion.bind(slots);
			const subscribe = slots.subscribe.bind(slots);
			const guardedSlots = /* @__PURE__ */ new Set([
				"settings.section",
				"settings.action",
				"settings.onboarding"
			]);
			let visibilityRevision = 0;
			const filterEntries = (name, rows) => {
				if (!accountSnapshot || isAdmin(accountSnapshot)) return rows;
				if (name === "settings.section") return rows.filter((entry) => entry.options.id === "models");
				if (name === "settings.action") return [];
				if (name === "settings.onboarding") return rows.filter((entry) => entry.options.id === "deepseek-official");
				return rows;
			};
			const syncVisibility = () => {
				visibilityRevision += 1;
				if (accountSnapshot && !isAdmin(accountSnapshot)) document.documentElement.dataset.dshWorkosMember = "";
				else delete document.documentElement.dataset.dshWorkosMember;
			};
			accountListeners.add(syncVisibility);
			slots.entries = (name) => filterEntries(name, entries(name));
			slots.entriesOfSlot = (name) => filterEntries(name, entriesOfSlot(name));
			slots.getVersion = (name) => getVersion(name) + (guardedSlots.has(name) ? visibilityRevision : 0);
			slots.subscribe = (name, listener) => {
				const dispose = subscribe(name, listener);
				if (!guardedSlots.has(name)) return dispose;
				accountListeners.add(listener);
				return () => {
					accountListeners.delete(listener);
					dispose();
				};
			};
			syncVisibility();
			loadAccount();
			return () => {
				accountListeners.delete(syncVisibility);
				delete document.documentElement.dataset.dshWorkosMember;
				slots.entries = entries;
				slots.entriesOfSlot = entriesOfSlot;
				slots.getVersion = getVersion;
				slots.subscribe = subscribe;
			};
		}
		let remoteSettingsUnpinned = false;
		function unpinRemoteSettingsScopes() {
			if (remoteSettingsUnpinned) return;
			try {
				const Controller = require("@deepseek-ai/dsh-client-ui-settings")?.SettingsScopeController;
				if (typeof Controller?.prototype?.enqueue !== "function") return;
				Controller.prototype.enqueue = function(operation) {
					if (this.disposed) return Promise.resolve();
					const task = this.tail.then(async () => {
						if (this.disposed) return;
						await operation();
					});
					this.tail = task.catch(() => {});
					return task;
				};
				remoteSettingsUnpinned = true;
			} catch {}
		}
		function Field({ label, hint, wide, children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: `dsh-workos-settings__field${wide ? " dsh-workos-settings__field--wide" : ""}`,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-workos-settings__label",
						children: label
					}),
					children,
					hint && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-workos-settings__hint",
						children: hint
					})
				]
			});
		}
		function SecretField({ label, configured, value, onChange, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
				label,
				hint: configured ? t("secretConfigured") : t("secretMissing"),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					className: "dsh-workos-settings__input",
					type: "password",
					autoComplete: "new-password",
					value,
					onChange: (event) => {
						onChange(event.target.value);
					}
				})
			});
		}
		function TenantSettingsTab({ t }) {
			const [draft, setDraft] = (0, react.useState)();
			const [secrets, setSecrets] = (0, react.useState)({
				apiKey: "",
				cookieSecret: "",
				encryptionKey: "",
				apiToken: ""
			});
			const [status, setStatus] = (0, react.useState)("loading");
			const [error, setError] = (0, react.useState)();
			const load = () => {
				setStatus("loading");
				setError(void 0);
				fetch("/auth/tenant-settings", {
					credentials: "same-origin",
					cache: "no-store"
				}).then(async (response) => {
					const value = await response.json().catch(() => ({}));
					if (!response.ok) throw new Error(value.detail || value.error || t("loadFailed"));
					setDraft(value.config);
					setStatus("ready");
				}).catch((reason) => {
					setError(reason.message);
					setStatus("error");
				});
			};
			(0, react.useEffect)(load, []);
			const change = (path, value) => {
				setDraft((previous) => {
					const next = structuredClone(previous);
					let target = next;
					for (const segment of path.slice(0, -1)) target = target[segment];
					target[path.at(-1)] = value;
					return next;
				});
			};
			const save = (event) => {
				event.preventDefault();
				setStatus("saving");
				setError(void 0);
				const body = {
					policy: draft.policy,
					network: draft.network,
					workspace: draft.workspace,
					workos: {
						...draft.workos,
						apiKey: secrets.apiKey,
						cookieSecret: secrets.cookieSecret,
						apiKeyConfigured: void 0,
						cookieSecretConfigured: void 0
					},
					storage: {
						...draft.storage,
						encryptionKey: secrets.encryptionKey,
						encryptionKeyConfigured: void 0,
						d1: {
							...draft.storage.d1,
							apiToken: secrets.apiToken,
							apiTokenConfigured: void 0
						}
					}
				};
				fetch("/auth/tenant-settings", {
					method: "PUT",
					credentials: "same-origin",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body)
				}).then(async (response) => {
					const value = await response.json().catch(() => ({}));
					if (!response.ok) throw new Error(value.detail || value.error || t("loadFailed"));
					setDraft(value.config);
					setSecrets({
						apiKey: "",
						cookieSecret: "",
						encryptionKey: "",
						apiToken: ""
					});
					setStatus("saved");
				}).catch((reason) => {
					setError(reason.message);
					setStatus("error");
				});
			};
			if (!draft) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-workos-settings",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: status === "error" ? "dsh-workos-settings__error" : "dsh-workos-settings__status",
					children: error || t("loading")
				}), status === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					size: "sm",
					onClick: load,
					children: t("retry")
				})]
			});
			const d1 = draft.storage.mode === "d1";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				className: "dsh-workos-settings",
				onSubmit: save,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "dsh-workos-settings__header",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							className: "dsh-workos-settings__title",
							children: t("tenantTitle")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-workos-settings__intro",
							children: t("tenantIntro")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dsh-workos-settings__group",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
							className: "dsh-workos-settings__group-title",
							children: t("workspaceScope")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
							label: t("workspaceRoot"),
							hint: t("workspaceRootHint"),
							wide: true,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "dsh-workos-settings__input",
								value: draft.workspace?.root ?? "",
								placeholder: "/srv/dsh/workspaces",
								onChange: (event) => {
									change(["workspace", "root"], event.target.value);
								}
							})
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dsh-workos-settings__group",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
							className: "dsh-workos-settings__group-title",
							children: t("network")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: "dsh-workos-settings__check",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: Boolean(draft.network?.allowNetworkAccess),
								onChange: (event) => {
									change(["network", "allowNetworkAccess"], event.target.checked);
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [t("allowNetworkAccess"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-workos-settings__hint",
								children: t("allowNetworkAccessHint")
							})] })]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dsh-workos-settings__group",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
							className: "dsh-workos-settings__group-title",
							children: t("workosConnection")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-workos-settings__grid",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
									label: t("clientId"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "dsh-workos-settings__input",
										value: draft.workos.clientId,
										onChange: (event) => {
											change(["workos", "clientId"], event.target.value);
										}
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
									label: t("organizationId"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "dsh-workos-settings__input",
										value: draft.workos.organizationId,
										onChange: (event) => {
											change(["workos", "organizationId"], event.target.value);
										}
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
									label: t("redirectUri"),
									hint: t("redirectUriHint"),
									wide: true,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "dsh-workos-settings__input",
										type: "url",
										value: draft.workos.redirectUri,
										onChange: (event) => {
											change(["workos", "redirectUri"], event.target.value);
										}
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SecretField, {
									label: t("apiKey"),
									configured: draft.workos.apiKeyConfigured,
									value: secrets.apiKey,
									t,
									onChange: (value) => {
										setSecrets((current) => ({
											...current,
											apiKey: value
										}));
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SecretField, {
									label: t("cookieSecret"),
									configured: draft.workos.cookieSecretConfigured,
									value: secrets.cookieSecret,
									t,
									onChange: (value) => {
										setSecrets((current) => ({
											...current,
											cookieSecret: value
										}));
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
									label: t("sessionMaxAge"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "dsh-workos-settings__input",
										type: "number",
										min: "300",
										max: "31536000",
										value: draft.workos.sessionMaxAgeSeconds,
										onChange: (event) => {
											change(["workos", "sessionMaxAgeSeconds"], Number(event.target.value));
										}
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "dsh-workos-settings__check",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: draft.workos.secureCookies,
										onChange: (event) => {
											change(["workos", "secureCookies"], event.target.checked);
										}
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("secureCookies") })]
								})
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dsh-workos-settings__group",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
							className: "dsh-workos-settings__group-title",
							children: t("storage")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-workos-settings__grid",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
									label: t("storageMode"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
										className: "dsh-workos-settings__select",
										value: draft.storage.mode,
										onChange: (event) => {
											change(["storage", "mode"], event.target.value);
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "local",
											children: t("local")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "d1",
											children: t("d1")
										})]
									})
								}),
								!d1 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
									label: t("statePath"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "dsh-workos-settings__input",
										value: draft.storage.filePath,
										onChange: (event) => {
											change(["storage", "filePath"], event.target.value);
										}
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SecretField, {
									label: t("encryptionKey"),
									configured: draft.storage.encryptionKeyConfigured,
									value: secrets.encryptionKey,
									t,
									onChange: (value) => {
										setSecrets((current) => ({
											...current,
											encryptionKey: value
										}));
									}
								}),
								d1 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
										label: t("accountId"),
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: "dsh-workos-settings__input",
											value: draft.storage.d1.accountId,
											onChange: (event) => {
												change([
													"storage",
													"d1",
													"accountId"
												], event.target.value);
											}
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
										label: t("databaseId"),
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: "dsh-workos-settings__input",
											value: draft.storage.d1.databaseId,
											onChange: (event) => {
												change([
													"storage",
													"d1",
													"databaseId"
												], event.target.value);
											}
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
										label: t("apiBaseUrl"),
										wide: true,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: "dsh-workos-settings__input",
											type: "url",
											value: draft.storage.d1.apiBaseUrl,
											onChange: (event) => {
												change([
													"storage",
													"d1",
													"apiBaseUrl"
												], event.target.value);
											}
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SecretField, {
										label: t("apiToken"),
										configured: draft.storage.d1.apiTokenConfigured,
										value: secrets.apiToken,
										t,
										onChange: (value) => {
											setSecrets((current) => ({
												...current,
												apiToken: value
											}));
										}
									})
								] })
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-workos-settings__actions",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								type: "submit",
								variant: "primary",
								size: "sm",
								disabled: status === "saving",
								children: status === "saving" ? t("saving") : t("save")
							}),
							status === "saved" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-workos-settings__status",
								children: t("saved")
							}),
							error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-workos-settings__error",
								children: error
							})
						]
					})
				]
			});
		}
		function AccountAction({ wide, t }) {
			const { account, status } = useAccount();
			const [open, setOpen] = (0, react.useState)(false);
			if (!account) {
				const primary = status === "loading" ? t("loadingAccount") : status === "local" ? t("localMode") : status === "signed-out" ? t("signedOut") : t("accountUnavailable");
				const canSignIn = status === "signed-out";
				const button = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "dsh-workos-account__button dsh-workos-account__button--status",
					"aria-label": canSignIn ? t("signIn") : primary,
					disabled: !canSignIn,
					onClick: () => {
						if (canSignIn) window.location.assign("/auth/login");
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-workos-account__avatar",
						"aria-hidden": "true",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconUserOutlineRegular, { size: wide ? 14 : 18 })
					}), wide && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsh-workos-account__copy",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-workos-account__primary",
							children: primary
						}), canSignIn && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-workos-account__secondary",
							children: t("signIn")
						})]
					})]
				});
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: `dsh-workos-account${wide ? "" : " dsh-workos-account--rail"}`,
					"data-dsh-workos-account": "",
					children: button
				});
			}
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
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconUserOutlineRegular, { size: wide ? 14 : 18 })
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
					wide && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronUpOutlineRegular, { className: "dsh-workos-account__chevron" })
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: `dsh-workos-account${wide ? "" : " dsh-workos-account--rail"}`,
				"data-dsh-workos-account": "",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
				className: "dsh-workos-account__menu",
				listClassName: "dsh-workos-account__menu-list",
					open,
					side: "top",
					align: wide ? "end" : "start",
					portal: true,
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
							type: "label",
							id: "role",
							text: `${t("role")}: ${account.identity.role}`
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
		const inject = [
			"slots",
			"locale",
			"sessions"
		];
		function apply(ctx) {
			unpinRemoteSettingsScopes();
			ctx.effect(() => installSessionVisibility(ctx), "workos-account: session visibility");
			ctx.effect(installStyles, "workos-account: styles");
			ctx.effect(() => installSettingsVisibility(ctx), "workos-account: settings visibility");
			ctx.effect(installBranding, "workos-account: branding");
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
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "workos-tenant",
				order: 60,
				label: () => ctx.locale.bind(NS)("tenantTab"),
				locale: NS
			}, TenantSettingsTab));
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "workos-branding",
				order: 70,
				label: () => ctx.locale.bind(NS)("branding"),
				locale: NS
			}, () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BrandingSettings, { t: ctx.locale.bind(NS) })));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
