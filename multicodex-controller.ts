import { promises as fs, constants as fsConstants } from "node:fs";
import path from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentSettingsPath } from "pi-provider-utils/agent-paths";
import type { AccountManager } from "./account-manager";
import { createUsageStatusController, type FooterPreferences } from "./status";
import { STORAGE_FILE } from "./storage";

type WarningHandler = (message: string) => void;
export type ResetTarget = "manual" | "quota" | "all";

export interface VerifySummary {
	storageWritable: boolean;
	settingsWritable: boolean;
	accounts: number;
	activeAccount: string;
	hasPiAuth: boolean;
	needsReauth: number;
	ok: boolean;
}

export interface ResetSummary {
	manualCleared: boolean;
	quotaCleared: number;
}

export interface MultiCodexController {
	readonly accountManager: AccountManager;
	loadPreferences(ctx?: ExtensionContext): Promise<void>;
	openPreferencesPanel(ctx: ExtensionCommandContext): Promise<void>;
	refreshFor(ctx: ExtensionContext): Promise<void>;
	scheduleModelSelectRefresh(ctx: ExtensionContext): void;
	startAutoRefresh(): void;
	stopAutoRefresh(ctx?: ExtensionContext): void;
	getPreferences(): FooterPreferences;
	getConfigPaths(): { storage: string; settings: string };
	getRotationSummaryLines(): string[];
	getVerifySummary(): Promise<VerifySummary>;
	resetState(target: ResetTarget): ResetSummary;
	runAccountsCommand(
		pi: ExtensionAPI,
		ctx: ExtensionCommandContext,
		rest: string,
	): Promise<void>;
	runShowCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void>;
	runRefreshCommand(
		pi: ExtensionAPI,
		ctx: ExtensionCommandContext,
		rest: string,
	): Promise<void>;
	runReauthCommand(
		pi: ExtensionAPI,
		ctx: ExtensionCommandContext,
		rest: string,
	): Promise<void>;
	runFooterCommand(ctx: ExtensionCommandContext): Promise<void>;
	runRotationCommand(ctx: ExtensionCommandContext): Promise<void>;
	runVerifyCommand(ctx: ExtensionCommandContext): Promise<void>;
	runPathCommand(ctx: ExtensionCommandContext): Promise<void>;
	runResetCommand(
		ctx: ExtensionCommandContext,
		target: ResetTarget,
	): Promise<void>;
	refreshStatus(ctx: ExtensionContext): Promise<void>;
	openFooterPanel(ctx: ExtensionCommandContext): Promise<void>;
	startSession(
		ctx: ExtensionContext,
		warningHandler?: WarningHandler,
	): Promise<void>;
	stopSession(ctx?: ExtensionContext): void;
}

const SETTINGS_FILE = getAgentSettingsPath();

async function isWritableDirectoryFor(filePath: string): Promise<boolean> {
	try {
		const directory = path.dirname(filePath);
		await fs.mkdir(directory, { recursive: true });
		await fs.access(directory, fsConstants.R_OK | fsConstants.W_OK);
		return true;
	} catch {
		return false;
	}
}

function formatFooterSummary(preferences: FooterPreferences): string {
	return `footer: usageMode=${preferences.usageMode} resetWindow=${preferences.resetWindow} showAccount=${preferences.showAccount ? "on" : "off"} showReset=${preferences.showReset ? "on" : "off"} order=${preferences.order}`;
}

export function createMultiCodexController(
	accountManager: AccountManager,
): MultiCodexController {
	const statusController = createUsageStatusController(accountManager);
	let controller: MultiCodexController;

	function getConfigPaths(): { storage: string; settings: string } {
		return { storage: STORAGE_FILE, settings: SETTINGS_FILE };
	}

	function getRotationSummaryLines(): string[] {
		return [
			"Current policy: manual account first, then untouched accounts, then earliest weekly reset, then random fallback.",
			"If token validation fails before a request starts, MultiCodex skips that account and retries another one.",
			"If a request hits quota or rate limit before any output streams, MultiCodex marks the account on cooldown and retries.",
			"If pi auth is active, it participates in rotation as an ephemeral account without being persisted.",
		];
	}

	async function getVerifySummary(): Promise<VerifySummary> {
		const storageWritable = await isWritableDirectoryFor(STORAGE_FILE);
		const settingsWritable = await isWritableDirectoryFor(SETTINGS_FILE);
		const hasPiAuth = accountManager
			.getAccounts()
			.some((account) => accountManager.isPiAuthAccount(account));
		const accounts = accountManager.getAccounts().length;
		const activeAccount = accountManager.getActiveAccount()?.email ?? "none";
		const needsReauth = accountManager.getAccountsNeedingReauth().length;
		return {
			storageWritable,
			settingsWritable,
			accounts,
			activeAccount,
			hasPiAuth,
			needsReauth,
			ok: storageWritable && settingsWritable && needsReauth === 0,
		};
	}

	function resetState(target: ResetTarget): ResetSummary {
		const hadManual = accountManager.hasManualAccount();
		if (target === "manual" || target === "all") {
			accountManager.clearManualAccount();
		}
		const quotaCleared =
			target === "quota" || target === "all"
				? accountManager.clearAllQuotaExhaustion()
				: 0;
		return {
			manualCleared: hadManual && !accountManager.hasManualAccount(),
			quotaCleared,
		};
	}

	async function restoreSessionState(
		warningHandler?: WarningHandler,
	): Promise<void> {
		accountManager.beginInitialization();
		try {
			await accountManager.loadPiAuth();
			await accountManager.refreshUsageForAllAccounts({ force: true });

			const needsReauth = accountManager.getAccountsNeedingReauth();
			if (needsReauth.length > 0) {
				const hints = needsReauth.map((a) => {
					const cmd = accountManager.isPiAuthAccount(a)
						? "/login openai-codex"
						: `/multicodex use ${a.email}`;
					return `${a.email} (${cmd})`;
				});
				warningHandler?.(
					`Multicodex: ${needsReauth.length} account(s) need re-authentication: ${hints.join(", ")}`,
				);
			}

			const manual = accountManager.getAvailableManualAccount();
			if (manual) return;
			if (accountManager.hasManualAccount()) {
				accountManager.clearManualAccount();
			}
			await accountManager.activateBestAccount();
		} finally {
			accountManager.markReady();
		}
	}

	async function loadFooterPreferences(
		ctx?: ExtensionContext | ExtensionCommandContext,
	): Promise<void> {
		await statusController.loadPreferences(ctx as ExtensionContext | undefined);
	}

	async function startSession(
		ctx: ExtensionContext,
		warningHandler?: WarningHandler,
	): Promise<void> {
		if (accountManager.getAccounts().length === 0) return;
		statusController.startAutoRefresh();
		void restoreSessionState(warningHandler).catch(() => {});
		await loadFooterPreferences(ctx);
		await statusController.refreshFor(ctx);
	}

	function stopSession(ctx?: ExtensionContext): void {
		statusController.stopAutoRefresh(ctx);
	}

	async function runAccountsCommand(
		pi: ExtensionAPI,
		ctx: ExtensionCommandContext,
		rest: string,
	): Promise<void> {
		const { runAccountsSubcommand } = await import("./commands");
		await runAccountsSubcommand(pi, ctx, accountManager, controller, rest);
	}
	async function runShowCommand(
		pi: ExtensionAPI,
		ctx: ExtensionCommandContext,
	): Promise<void> {
		const { runShowSubcommand } = await import("./commands");
		await runShowSubcommand(pi, ctx, accountManager, controller);
	}

	async function runRefreshCommand(
		pi: ExtensionAPI,
		ctx: ExtensionCommandContext,
		rest: string,
	): Promise<void> {
		const { runRefreshSubcommand } = await import("./commands");
		await runRefreshSubcommand(pi, ctx, accountManager, controller, rest);
	}

	async function runReauthCommand(
		pi: ExtensionAPI,
		ctx: ExtensionCommandContext,
		rest: string,
	): Promise<void> {
		const { runReauthSubcommand } = await import("./commands");
		await runReauthSubcommand(pi, ctx, accountManager, controller, rest);
	}

	async function runFooterCommand(ctx: ExtensionCommandContext): Promise<void> {
		if (!ctx.hasUI) {
			await loadFooterPreferences(ctx);
			ctx.ui.notify(
				formatFooterSummary(statusController.getPreferences()),
				"info",
			);
			return;
		}

		await statusController.openPreferencesPanel(ctx);
	}

	async function runRotationCommand(
		ctx: ExtensionCommandContext,
	): Promise<void> {
		const lines = [
			"Current policy: manual account first, then untouched accounts, then earliest weekly reset, then random fallback.",
			"If token validation fails before a request starts, MultiCodex skips that account and retries another one.",
			"If a request hits quota or rate limit before any output streams, MultiCodex marks the account on cooldown and retries.",
			"If pi auth is active, it participates in rotation as an ephemeral account without being persisted.",
		];

		if (!ctx.hasUI) {
			ctx.ui.notify(lines.join(" "), "info");
			return;
		}

		await ctx.ui.select("MultiCodex Rotation", lines);
	}

	async function runVerifyCommand(ctx: ExtensionCommandContext): Promise<void> {
		const summary = await getVerifySummary();
		await loadFooterPreferences(ctx);

		if (!ctx.hasUI) {
			ctx.ui.notify(
				`verify: ${summary.ok ? "PASS" : "WARN"} storage=${summary.storageWritable ? "ok" : "fail"} settings=${summary.settingsWritable ? "ok" : "fail"} accounts=${summary.accounts} active=${summary.activeAccount} piAuth=${summary.hasPiAuth ? "loaded" : "none"} needsReauth=${summary.needsReauth}`,
				summary.ok ? "info" : "warning",
			);
			return;
		}

		await ctx.ui.select(`MultiCodex Verify (${summary.ok ? "PASS" : "WARN"})`, [
			`storage directory writable: ${summary.storageWritable ? "yes" : "no"}`,
			`settings directory writable: ${summary.settingsWritable ? "yes" : "no"}`,
			`managed accounts: ${summary.accounts}`,
			`active account: ${summary.activeAccount}`,
			`pi auth (ephemeral): ${summary.hasPiAuth ? "loaded" : "none"}`,
			`accounts needing re-authentication: ${summary.needsReauth}`,
		]);
	}

	async function runPathCommand(ctx: ExtensionCommandContext): Promise<void> {
		const paths = getConfigPaths();
		if (!ctx.hasUI) {
			ctx.ui.notify(
				`paths: storage=${paths.storage} settings=${paths.settings}`,
				"info",
			);
			return;
		}

		await ctx.ui.select("MultiCodex Paths", [
			`Managed account storage: ${paths.storage}`,
			`Extension settings: ${paths.settings}`,
		]);
	}

	async function runResetCommand(
		ctx: ExtensionCommandContext,
		target: ResetTarget,
	): Promise<void> {
		if (target === "all" && ctx.hasUI) {
			const confirmed = await ctx.ui.confirm(
				"Reset MultiCodex state",
				"Clear manual account override and all quota cooldown markers?",
			);
			if (!confirmed) return;
		}

		const summary = resetState(target);
		ctx.ui.notify(
			`reset: target=${target} manualCleared=${summary.manualCleared ? "yes" : "no"} quotaCleared=${summary.quotaCleared}`,
			"info",
		);
		await statusController.refreshFor(ctx);
	}

	controller = {
		accountManager,
		loadPreferences: (ctx?: ExtensionContext) =>
			statusController.loadPreferences(ctx),
		openPreferencesPanel: (ctx: ExtensionCommandContext) =>
			statusController.openPreferencesPanel(ctx),
		refreshFor: (ctx: ExtensionContext) => statusController.refreshFor(ctx),
		startSession,
		stopSession,
		runAccountsCommand,
		runShowCommand,
		runRefreshCommand,
		runReauthCommand,
		scheduleModelSelectRefresh: (ctx: ExtensionContext) =>
			statusController.scheduleModelSelectRefresh(ctx),
		startAutoRefresh: () => statusController.startAutoRefresh(),
		stopAutoRefresh: (ctx?: ExtensionContext) =>
			statusController.stopAutoRefresh(ctx),
		getPreferences: () => statusController.getPreferences(),
		getConfigPaths,
		getRotationSummaryLines,
		getVerifySummary,
		resetState,
		runFooterCommand,
		runRotationCommand,
		runVerifyCommand,
		runPathCommand,
		runResetCommand,
		refreshStatus: (ctx: ExtensionContext) => statusController.refreshFor(ctx),
		openFooterPanel: (ctx: ExtensionCommandContext) =>
			statusController.openPreferencesPanel(ctx),
	};

	return controller;
}
