import { loginOpenAICodex } from "@earendil-works/pi-ai/oauth";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { DynamicBorder, rawKeyHint } from "@earendil-works/pi-coding-agent";
import {
	Container,
	Spacer,
	getKeybindings,
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { AccountManager } from "./account-manager";
import { openLoginInBrowser } from "./browser";
import { formatMulticodexError } from "./error-format";
import type { MultiCodexController } from "./multicodex-controller";
import type { Account } from "./storage";
import { formatResetAt, isUsageUntouched } from "./usage";

const NO_ACCOUNTS_MESSAGE =
	"No managed accounts found. Open /multicodex accounts to add one.";

type AccountPanelResult =
	| { action: "select"; email: string }
	| { action: "refresh"; email: string }
	| { action: "reauth"; email: string }
	| { action: "toggle-disabled"; email: string }
	| { action: "remove"; email: string }
	| { action: "add" }
	| undefined;

function isPlaceholderAccount(account: Account): boolean {
	return (
		!account.accessToken || !account.refreshToken || account.expiresAt <= 0
	);
}

function getAccountTags(
	accountManager: AccountManager,
	account: Account,
): string[] {
	const usage = accountManager.getCachedUsage(account.email);
	const active = accountManager.getActiveAccount();
	const manual = accountManager.getManualAccount();
	const quotaHit =
		account.quotaExhaustedUntil && account.quotaExhaustedUntil > Date.now();
	return [
		active?.email === account.email ? "active" : null,
		manual?.email === account.email ? "manual" : null,
		accountManager.isPiAuthAccount(account) ? "pi auth" : null,
		account.needsReauth ? "needs reauth" : null,
		account.manuallyDisabled ? "disabled" : null,
		isPlaceholderAccount(account) ? "placeholder" : null,
		quotaHit ? "quota" : null,
		isUsageUntouched(usage) ? "untouched" : null,
	].filter((value): value is string => Boolean(value));
}

function formatUsageSummary(
	accountManager: AccountManager,
	account: Account,
): string {
	const usage = accountManager.getCachedUsage(account.email);
	const primaryUsed = usage?.primary?.usedPercent;
	const secondaryUsed = usage?.secondary?.usedPercent;
	const primaryReset = usage?.primary?.resetAt;
	const secondaryReset = usage?.secondary?.resetAt;
	const primaryLabel =
		primaryUsed === undefined ? "unknown" : `${Math.round(primaryUsed)}%`;
	const secondaryLabel =
		secondaryUsed === undefined ? "unknown" : `${Math.round(secondaryUsed)}%`;
	return `5h ${primaryLabel} reset:${formatResetAt(primaryReset)} | weekly ${secondaryLabel} reset:${formatResetAt(secondaryReset)}`;
}

function formatAccountStatusLine(
	accountManager: AccountManager,
	email: string,
): string {
	const account = accountManager.getAccount(email);
	if (!account) return email;
	const tags = getAccountTags(accountManager, account).join(", ");
	const suffix = tags ? ` (${tags})` : "";
	return `${account.email}${suffix} - ${formatUsageSummary(accountManager, account)}`;
}

async function loginAndActivateAccount(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	statusController: MultiCodexController,
	identifier: string,
): Promise<string | undefined> {
	try {
		ctx.ui.notify(
			`Starting login for ${identifier}... Check your browser.`,
			"info",
		);

		const creds = await loginOpenAICodex({
			onAuth: ({ url }) => {
				void openLoginInBrowser(pi, ctx, url);
				ctx.ui.notify("Please continue the login in your browser.", "info");
			},
			onPrompt: async ({ message }) => (await ctx.ui.input(message)) || "",
		});

		const account = accountManager.addOrUpdateAccount(identifier, creds);
		statusController.setManualAccount(account.email);
		ctx.ui.notify(`Now using ${account.email}`, "info");
		return account.email;
	} catch (error) {
		ctx.ui.notify(formatMulticodexError("login", error), "error");
		return undefined;
	}
}

async function useOrLoginAccount(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	statusController: MultiCodexController,
	identifier: string,
): Promise<void> {
	const existing = accountManager.getAccount(identifier);
	if (existing) {
		try {
			await accountManager.ensureValidToken(existing);
			statusController.setManualAccount(existing.email);
			ctx.ui.notify(`Now using ${existing.email}`, "info");
			return;
		} catch {
			ctx.ui.notify(
				`Stored auth for ${existing.email} is no longer valid. Starting login again.`,
				"warning",
			);
		}
	}

	await loginAndActivateAccount(
		pi,
		ctx,
		accountManager,
		statusController,
		identifier,
	);
}

async function refreshSingleAccount(
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	email: string,
): Promise<void> {
	const account = accountManager.getAccount(email);
	if (!account) {
		ctx.ui.notify(`Unknown account: ${email}`, "warning");
		return;
	}

	try {
		await accountManager.ensureValidToken(account);
	} catch (error) {
		ctx.ui.notify(formatMulticodexError(`refresh ${email}`, error), "warning");
		return;
	}

	const usage = await accountManager.refreshUsageForAccount(account, {
		force: true,
	});
	if (!usage) {
		ctx.ui.notify(
			formatMulticodexError(
				`refresh ${email}`,
				new Error("usage refresh failed"),
			),
			"warning",
		);
		return;
	}

	ctx.ui.notify(
		`refreshed ${formatAccountStatusLine(accountManager, email)}`,
		"info",
	);
}

async function refreshAllAccounts(
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
): Promise<void> {
	const accounts = accountManager.getAccounts();
	if (accounts.length === 0) {
		ctx.ui.notify(NO_ACCOUNTS_MESSAGE, "warning");
		return;
	}

	const results = await Promise.all(
		accounts.map((account) =>
			accountManager.refreshUsageForAccount(account, { force: true }),
		),
	);
	const refreshed = results.filter((usage) => Boolean(usage)).length;
	const failed = results.length - refreshed;
	const needsReauth = accountManager.getAccountsNeedingReauth().length;
	const summary =
		failed > 0
			? `refreshed ${refreshed}/${accounts.length} account(s); failed=${failed}; reauth needed=${needsReauth}`
			: `refreshed ${refreshed} account(s); reauth needed=${needsReauth}`;
	ctx.ui.notify(summary, failed > 0 ? "warning" : "info");
}

async function reauthenticateAccount(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	statusController: MultiCodexController,
	email: string,
): Promise<void> {
	const account = accountManager.getAccount(email);
	if (!account) {
		ctx.ui.notify(`Unknown account: ${email}`, "warning");
		return;
	}
	await loginAndActivateAccount(
		pi,
		ctx,
		accountManager,
		statusController,
		account.email,
	);
}

async function promptForNewAccountIdentifier(
	ctx: ExtensionCommandContext,
): Promise<string | undefined> {
	const identifier = (await ctx.ui.input("Account identifier"))?.trim();
	if (!identifier) {
		ctx.ui.notify("Account creation cancelled.", "warning");
		return undefined;
	}
	return identifier;
}

async function openAccountManagementPanel(
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
): Promise<AccountPanelResult> {
	const accounts = accountManager.getAccounts();

	return ctx.ui.custom<AccountPanelResult>((tui, theme, _kb, done) => {
		const kb = getKeybindings();
		let selectedIndex = 0;
		const maxVisible = 12;

		function getSelectedAccount(): Account | undefined {
			return accounts[selectedIndex];
		}

		function findNextIndex(from: number, direction: number): number {
			if (accounts.length === 0) return 0;
			return Math.max(0, Math.min(accounts.length - 1, from + direction));
		}

		function renderTag(text: string): string {
			if (text === "active") {
				return theme.fg("accent", `[${text}]`);
			}
			if (text === "manual") {
				return theme.fg("warning", `[${text}]`);
			}
			if (text === "needs reauth") {
				return theme.fg("error", `[${text}]`);
			}
			if (text === "disabled") {
				return theme.fg("warning", `[${text}]`);
			}
			if (text === "placeholder") {
				return theme.fg("warning", `[${text}]`);
			}
			if (text === "quota") {
				return theme.fg("warning", `[${text}]`);
			}
			if (text === "pi auth" || text === "pi auth only") {
				return theme.fg("success", `[${text}]`);
			}
			return theme.fg("muted", `[${text}]`);
		}

		function renderRow(
			account: Account,
			selected: boolean,
			width: number,
		): string[] {
			const cursor = selected ? theme.fg("accent", ">") : theme.fg("dim", " ");
			const name = selected ? theme.bold(account.email) : account.email;
			const tags = getAccountTags(accountManager, account)
				.map((tag) => renderTag(tag))
				.join(" ");
			const primary = truncateToWidth(
				`${cursor} ${name}${tags ? ` ${tags}` : ""}`,
				width,
				"",
			);
			const summaryColor = account.needsReauth
				? "warning"
				: account.manuallyDisabled
					? "warning"
					: isPlaceholderAccount(account)
						? "muted"
						: "dim";
			const secondary = theme.fg(
				summaryColor,
				formatUsageSummary(accountManager, account),
			);
			return [primary, truncateToWidth(`  ${secondary}`, width, "")];
		}

		const header = {
			invalidate() {},
			render(width: number): string[] {
				const title = theme.bold("MultiCodex Accounts");
				const sep = theme.fg("muted", " · ");
				const hints = [
					rawKeyHint("enter", "use"),
					rawKeyHint("u", "refresh"),
					rawKeyHint("r", "reauth"),
					rawKeyHint("d", "toggle disable"),
					rawKeyHint("n", "add"),
					rawKeyHint("backspace", "remove"),
					rawKeyHint("esc", "close"),
				].join(sep);
				const spacing = Math.max(
					1,
					width - visibleWidth(title) - visibleWidth(hints),
				);
				const reauthCount = accountManager.getAccountsNeedingReauth().length;
				const disabledCount = accounts.filter((account) => account.manuallyDisabled).length;
				const placeholderCount = accounts.filter((account) =>
					isPlaceholderAccount(account),
				).length;
				const status = [
					`${accounts.length} account${accounts.length === 1 ? "" : "s"}`,
					disabledCount > 0 ? `${disabledCount} disabled` : undefined,
					reauthCount > 0 ? `${reauthCount} need reauth` : undefined,
					placeholderCount > 0
						? `${placeholderCount} placeholder${placeholderCount === 1 ? "" : "s"}`
						: undefined,
				]
					.filter(Boolean)
					.join(" · ");
				return [
					truncateToWidth(`${title}${" ".repeat(spacing)}${hints}`, width, ""),
					theme.fg("muted", status),
				];
			},
		};

		const list = {
			invalidate() {},
			render(width: number): string[] {
				const lines: string[] = [];
				if (accounts.length === 0) {
					return [theme.fg("muted", "  No managed accounts")];
				}

				const visibleRows = Math.max(1, Math.floor(maxVisible / 2));
				const startIndex = Math.max(
					0,
					Math.min(
						selectedIndex - Math.floor(visibleRows / 2),
						Math.max(0, accounts.length - visibleRows),
					),
				);
				const endIndex = Math.min(accounts.length, startIndex + visibleRows);

				for (let index = startIndex; index < endIndex; index++) {
					const account = accounts[index];
					if (!account) continue;
					lines.push(...renderRow(account, index === selectedIndex, width));
					if (index < endIndex - 1) {
						lines.push("");
					}
				}

				const selected = getSelectedAccount();
				if (selected) {
					lines.push("");
					const detail = isPlaceholderAccount(selected)
						? `selected: ${selected.email} · restored placeholder, re-auth required`
						: `selected: ${selected.email}`;
					lines.push(truncateToWidth(theme.fg("dim", detail), width, ""));
				}

				const current = selectedIndex + 1;
				lines.push(
					theme.fg(
						"dim",
						`  ${current}/${accounts.length} visible account rows`,
					),
				);
				return lines;
			},
		};

		const container = new Container();
		container.addChild(new Spacer(1));
		container.addChild(new DynamicBorder());
		container.addChild(new Spacer(1));
		container.addChild(header);
		container.addChild(new Spacer(1));
		container.addChild(list);
		container.addChild(new Spacer(1));
		container.addChild(new DynamicBorder());

		return {
			render(width: number) {
				return container.render(width);
			},
			invalidate() {
				container.invalidate();
			},
			handleInput(data: string) {
				if (kb.matches(data, "tui.select.up")) {
					selectedIndex = findNextIndex(selectedIndex, -1);
					tui.requestRender();
					return;
				}
				if (kb.matches(data, "tui.select.down")) {
					selectedIndex = findNextIndex(selectedIndex, 1);
					tui.requestRender();
					return;
				}
				if (kb.matches(data, "tui.select.pageUp")) {
					selectedIndex = findNextIndex(selectedIndex, -5);
					tui.requestRender();
					return;
				}
				if (kb.matches(data, "tui.select.pageDown")) {
					selectedIndex = findNextIndex(selectedIndex, 5);
					tui.requestRender();
					return;
				}
				if (
					kb.matches(data, "tui.select.cancel") ||
					matchesKey(data, "ctrl+c")
				) {
					done(undefined);
					return;
				}
				if (
					data === "\r" ||
					data === "\n" ||
					kb.matches(data, "tui.select.confirm")
				) {
					const selected = getSelectedAccount();
					if (selected) {
						done({ action: "select", email: selected.email });
					}
					return;
				}
				if (data.toLowerCase() === "n") {
					done({ action: "add" });
					return;
				}
				if (data.toLowerCase() === "u") {
					const selected = getSelectedAccount();
					if (selected) {
						done({ action: "refresh", email: selected.email });
					}
					return;
				}
				if (data.toLowerCase() === "r") {
					const selected = getSelectedAccount();
					if (selected) {
						done({ action: "reauth", email: selected.email });
					}
					return;
				}
				if (data.toLowerCase() === "d") {
					const selected = getSelectedAccount();
					if (selected) {
						done({ action: "toggle-disabled", email: selected.email });
					}
					return;
				}
				if (matchesKey(data, "backspace")) {
					const selected = getSelectedAccount();
					if (selected) {
						done({ action: "remove", email: selected.email });
					}
				}
			},
		};
	});
}

async function openAccountManagementFlow(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	statusController: MultiCodexController,
): Promise<void> {
	while (true) {
		const accounts = accountManager.getAccounts();
		if (accounts.length === 0) {
			const identifier = await promptForNewAccountIdentifier(ctx);
			if (!identifier) return;
			await loginAndActivateAccount(
				pi,
				ctx,
				accountManager,
				statusController,
				identifier,
			);
			await statusController.refreshFor(ctx);
			continue;
		}

		const result = await openAccountManagementPanel(ctx, accountManager);
		if (!result) return;

		if (result.action === "add") {
			const identifier = await promptForNewAccountIdentifier(ctx);
			if (!identifier) continue;
			await loginAndActivateAccount(
				pi,
				ctx,
				accountManager,
				statusController,
				identifier,
			);
			await statusController.refreshFor(ctx);
			continue;
		}

		if (result.action === "select") {
			await useOrLoginAccount(
				pi,
				ctx,
				accountManager,
				statusController,
				result.email,
			);
			await statusController.refreshFor(ctx);
			return;
		}

		if (result.action === "refresh") {
			await refreshSingleAccount(ctx, accountManager, result.email);
			await statusController.refreshFor(ctx);
			continue;
		}

		if (result.action === "reauth") {
			await reauthenticateAccount(
				pi,
				ctx,
				accountManager,
				statusController,
				result.email,
			);
			await statusController.refreshFor(ctx);
			continue;
		}

		if (result.action === "toggle-disabled") {
			const account = accountManager.getAccount(result.email);
			if (!account) continue;
			const nextState = !account.manuallyDisabled;
			const changed = await accountManager.setAccountManuallyDisabled(
				result.email,
				nextState,
			);
			if (!changed) continue;
			ctx.ui.notify(
				`${nextState ? "Disabled" : "Enabled"} ${result.email}`,
				"info",
			);
			await statusController.refreshFor(ctx);
			continue;
		}

		const accountToRemove = accountManager.getAccount(result.email);
		if (!accountToRemove) continue;

		const active = accountManager.getActiveAccount();
		const isActive = active?.email === result.email;
		const message = isActive
			? `Remove ${result.email}? This account is currently active and MultiCodex will switch to another account.`
			: `Remove ${result.email}?`;
		const confirmed = await ctx.ui.confirm("Remove account", message);
		if (!confirmed) continue;

		const removed = accountManager.removeAccount(result.email);
		if (!removed) continue;

		ctx.ui.notify(`Removed ${result.email}`, "info");
		await statusController.refreshFor(ctx);
	}
}

export async function runAccountsSubcommand(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	statusController: MultiCodexController,
	rest: string,
): Promise<void> {
	await accountManager.refreshUsageForAllAccounts();

	if (rest) {
		await useOrLoginAccount(pi, ctx, accountManager, statusController, rest);
		await statusController.refreshFor(ctx);
		return;
	}

	const accounts = accountManager.getAccounts();
	if (accounts.length === 0) {
		if (!ctx.hasUI) {
			ctx.ui.notify(NO_ACCOUNTS_MESSAGE, "warning");
			return;
		}
		await openAccountManagementFlow(pi, ctx, accountManager, statusController);
		return;
	}

	if (!ctx.hasUI) {
		const rotationLine = `rotation: ${statusController.getRotationSummaryLines().join(", ")}`;
		const lines = accounts.map((account) =>
			formatAccountStatusLine(accountManager, account.email),
		);
		ctx.ui.notify([rotationLine, ...lines].join("\n"), "info");
		return;
	}

	await openAccountManagementFlow(pi, ctx, accountManager, statusController);
}

export async function runShowSubcommand(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	statusController: MultiCodexController,
): Promise<void> {
	await runAccountsSubcommand(pi, ctx, accountManager, statusController, "");
}

export async function runRefreshSubcommand(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	statusController: MultiCodexController,
	rest: string,
): Promise<void> {
	if (!rest || rest === "all") {
		if (!ctx.hasUI || rest === "all") {
			await refreshAllAccounts(ctx, accountManager);
			await statusController.refreshFor(ctx);
			return;
		}
		await openAccountManagementFlow(pi, ctx, accountManager, statusController);
		return;
	}
	await refreshSingleAccount(ctx, accountManager, rest);
	await statusController.refreshFor(ctx);
}

export async function runReauthSubcommand(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	statusController: MultiCodexController,
	rest: string,
): Promise<void> {
	if (rest) {
		await reauthenticateAccount(
			pi,
			ctx,
			accountManager,
			statusController,
			rest,
		);
		await statusController.refreshFor(ctx);
		return;
	}
	if (!ctx.hasUI) {
		const active = accountManager.getActiveAccount();
		if (!active) {
			ctx.ui.notify(NO_ACCOUNTS_MESSAGE, "warning");
			return;
		}
		await reauthenticateAccount(
			pi,
			ctx,
			accountManager,
			statusController,
			active.email,
		);
		return;
	}
	await openAccountManagementFlow(pi, ctx, accountManager, statusController);
}
