import { promises as fs, constants as fsConstants } from "node:fs";
import path from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import {
	Container,
	type SettingItem,
	SettingsList,
	Text,
} from "@earendil-works/pi-tui";
import type { AccountManager } from "./account-manager";
import {
	getAgentSettingsPath,
	MULTICODEX_ROTATION_FILE,
	MULTICODEX_USAGE_HISTORY_FILE,
} from "./paths";
import { formatAccountReportLines } from "./report";
import type { RotationSettings } from "./rotation-settings";
import { loadRotationSettings } from "./rotation-settings";
import { createUsageStatusController, type FooterPreferences } from "./status";
import { STORAGE_FILE } from "./storage";

type WarningHandler = (message: string) => void;
export type ResetTarget = "manual" | "quota" | "all";

export interface VerifySummary {
	storageWritable: boolean;
	settingsWritable: boolean;
	historyWritable: boolean;
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
	setFooterPreferences(preferences: FooterPreferences): Promise<void>;
	setManualAccount(email: string): void;
	clearManualAccount(): void;
	openPreferencesPanel(ctx: ExtensionCommandContext): Promise<void>;
	refreshFor(ctx: ExtensionContext): Promise<void>;
	scheduleModelSelectRefresh(ctx: ExtensionContext): void;
	startAutoRefresh(): void;
	stopAutoRefresh(ctx?: ExtensionContext): void;
	getPreferences(): FooterPreferences;
	getRotationPreferences(): import("./rotation-settings").RotationSettings;
	loadRotationPreferences(): Promise<void>;
	setRotationPreferences(
		preferences: import("./rotation-settings").RotationSettings,
	): void;
	getConfigPaths(): {
		storage: string;
		settings: string;
		rotation: string;
		history: string;
	};
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
	runReportCommand(ctx: ExtensionCommandContext): Promise<void>;
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
	return `footer: separator=${preferences.separator} accountLabelMaxChars=${preferences.accountLabelMaxChars} usageMode=${preferences.usageMode} resetWindow=${preferences.resetWindow} showAccount=${preferences.showAccount ? "on" : "off"} showReset=${preferences.showReset ? "on" : "off"} order=${preferences.order}`;
}

function getBooleanLabel(value: boolean): string {
	return value ? "on" : "off";
}

function getCooldownLabel(
	value: RotationSettings["unknownResetCooldown"],
): string {
	return value;
}

function createRotationSettingItems(settings: RotationSettings): SettingItem[] {
	return [
		{
			id: "selectionStrategy",
			label: "Rotation strategy",
			description: "Choose lowest usage or stable weekly burn across the week",
			currentValue: settings.selectionStrategy,
			values: ["lowest-usage", "stable-weekly"],
		},
		{
			id: "preferUntouched",
			label: "Prefer untouched",
			description: "Keep untouched accounts ahead of used accounts",
			currentValue: getBooleanLabel(settings.preferUntouched),
			values: ["on", "off"],
		},
		{
			id: "unknownResetCooldown",
			label: "Unknown reset fallback",
			description: "Fallback cooldown when reset time cannot be derived",
			currentValue: getCooldownLabel(settings.unknownResetCooldown),
			values: ["15m", "1h", "6h"],
		},
		{
			id: "preStreamRetryLimit",
			label: "Pre-stream retries",
			description: "Retry count before quota failure surfaces",
			currentValue: String(settings.preStreamRetryLimit),
			values: Array.from({ length: 11 }, (_, index) => String(index)),
		},
	];
}

function applyRotationSettingChange(
	settings: RotationSettings,
	id: string,
	newValue: string,
): RotationSettings {
	if (
		id === "selectionStrategy" &&
		(newValue === "lowest-usage" || newValue === "stable-weekly")
	) {
		return { ...settings, selectionStrategy: newValue };
	}
	if (id === "preferUntouched") {
		return { ...settings, preferUntouched: newValue === "on" };
	}
	if (
		id === "unknownResetCooldown" &&
		(newValue === "15m" || newValue === "1h" || newValue === "6h")
	) {
		return { ...settings, unknownResetCooldown: newValue };
	}
	if (id === "preStreamRetryLimit") {
		const parsed = Number(newValue);
		if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 10) {
			return { ...settings, preStreamRetryLimit: parsed };
		}
	}
	return settings;
}
export function createMultiCodexController(
	accountManager: AccountManager,
): MultiCodexController {
	const statusController = createUsageStatusController(accountManager);
	let controller: MultiCodexController;

	function getConfigPaths(): {
		storage: string;
		settings: string;
		rotation: string;
		history: string;
	} {
		return {
			storage: STORAGE_FILE,
			settings: SETTINGS_FILE,
			rotation: MULTICODEX_ROTATION_FILE,
			history: MULTICODEX_USAGE_HISTORY_FILE,
		};
	}

	function getRotationSummaryLines(): string[] {
		return accountManager.getRotationSummaryLines();
	}

	async function getVerifySummary(): Promise<VerifySummary> {
		const storageWritable = await isWritableDirectoryFor(STORAGE_FILE);
		const settingsWritable = await isWritableDirectoryFor(SETTINGS_FILE);
		const historyWritable = await isWritableDirectoryFor(
			MULTICODEX_USAGE_HISTORY_FILE,
		);
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
			historyWritable,
			ok:
				storageWritable &&
				settingsWritable &&
				historyWritable &&
				needsReauth === 0,
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

	async function loadRotationPreferences(): Promise<void> {
		accountManager.loadRotationPreferences(loadRotationSettings());
	}

	async function startSession(
		ctx: ExtensionContext,
		warningHandler?: WarningHandler,
	): Promise<void> {
		if (accountManager.getAccounts().length === 0) return;
		await restoreSessionState(warningHandler).catch(() => {});
		statusController.startAutoRefresh();
		await controller.loadPreferences(ctx);
		await controller.loadRotationPreferences();
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
			await controller.loadPreferences(ctx);
			ctx.ui.notify(formatFooterSummary(controller.getPreferences()), "info");
			return;
		}

		await statusController.openPreferencesPanel(ctx);
	}

	async function runRotationCommand(
		ctx: ExtensionCommandContext,
	): Promise<void> {
		await controller.loadRotationPreferences();
		let draft = controller.getRotationPreferences();
		const renderPreviewLabel = (): string =>
			`Preview: ${controller.getRotationSummaryLines().join(" • ")}`;

		if (!ctx.hasUI) {
			ctx.ui.notify(renderPreviewLabel(), "info");
			return;
		}

		await ctx.ui.custom((_tui, theme, _kb, done) => {
			const container = new Container();
			container.addChild(
				new Text(theme.fg("accent", theme.bold("MultiCodex Rotation")), 1, 0),
			);
			container.addChild(
				new Text(
					theme.fg(
						"dim",
						"Tune rotation heuristics, cooldown fallback, and pre-stream retries.",
					),
					1,
					0,
				),
			);
			const previewText = new Text(theme.fg("dim", renderPreviewLabel()), 1, 0);
			container.addChild(previewText);

			const settingsList = new SettingsList(
				createRotationSettingItems(draft),
				8,
				getSettingsListTheme(),
				(id: string, newValue: string) => {
					draft = applyRotationSettingChange(draft, id, newValue);
					controller.setRotationPreferences(draft);
					settingsList.updateValue(id, newValue);
					previewText.setText(theme.fg("dim", renderPreviewLabel()));
					container.invalidate();
				},
				() => done(undefined),
				{ enableSearch: true },
			);
			container.addChild(settingsList);

			return {
				render: (width: number) => container.render(width),
				invalidate: () => container.invalidate(),
				handleInput: (data: string) => settingsList.handleInput(data),
			};
		});
	}

	async function runReportCommand(ctx: ExtensionCommandContext): Promise<void> {
		await controller.loadRotationPreferences();
		await accountManager.refreshUsageForAllAccounts();
		const lines = formatAccountReportLines(accountManager);
		ctx.ui.notify(lines.join("\n"), "info");
	}

	async function runVerifyCommand(ctx: ExtensionCommandContext): Promise<void> {
		const summary = await controller.getVerifySummary();
		await controller.loadPreferences(ctx);
		await controller.loadRotationPreferences();
		const rotationSummary = controller.getRotationSummaryLines().join(" | ");

		if (!ctx.hasUI) {
			ctx.ui.notify(
				`verify: ${summary.ok ? "PASS" : "WARN"} storage=${summary.storageWritable ? "ok" : "fail"} settings=${summary.settingsWritable ? "ok" : "fail"} history=${summary.historyWritable ? "ok" : "fail"} accounts=${summary.accounts} active=${summary.activeAccount} piAuth=${summary.hasPiAuth ? "loaded" : "none"} needsReauth=${summary.needsReauth} rotation=${rotationSummary}`,
				summary.ok ? "info" : "warning",
			);
			return;
		}

		await ctx.ui.select(`MultiCodex Verify (${summary.ok ? "PASS" : "WARN"})`, [
			`storage directory writable: ${summary.storageWritable ? "yes" : "no"}`,
			`settings directory writable: ${summary.settingsWritable ? "yes" : "no"}`,
			`history directory writable: ${summary.historyWritable ? "yes" : "no"}`,
			`managed accounts: ${summary.accounts}`,
			`active account: ${summary.activeAccount}`,
			`pi auth (ephemeral): ${summary.hasPiAuth ? "loaded" : "none"}`,
			`accounts needing re-authentication: ${summary.needsReauth}`,
			`rotation: ${rotationSummary}`,
		]);
	}

	async function runPathCommand(ctx: ExtensionCommandContext): Promise<void> {
		const paths = controller.getConfigPaths();
		if (!ctx.hasUI) {
			ctx.ui.notify(
				`paths: storage=${paths.storage} settings=${paths.settings} rotation=${paths.rotation} history=${paths.history}`,
				"info",
			);
			return;
		}

		await ctx.ui.select("MultiCodex Paths", [
			`Managed account storage: ${paths.storage}`,
			`Extension settings: ${paths.settings}`,
			`Rotation settings: ${paths.rotation}`,
			`Usage history: ${paths.history}`,
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

		const summary = controller.resetState(target);
		ctx.ui.notify(
			`reset: target=${target} manualCleared=${summary.manualCleared ? "yes" : "no"} quotaCleared=${summary.quotaCleared}`,
			"info",
		);
		await statusController.refreshFor(ctx);
	}

	controller = {
		accountManager,
		loadPreferences: loadFooterPreferences,
		setFooterPreferences: (preferences: FooterPreferences) =>
			statusController.setPreferences(preferences),
		setManualAccount: (email: string) => accountManager.setManualAccount(email),
		clearManualAccount: () => accountManager.clearManualAccount(),
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
		getRotationPreferences: () => accountManager.getRotationPreferences(),
		loadRotationPreferences,
		setRotationPreferences: (preferences: RotationSettings) =>
			accountManager.setRotationPreferences(preferences),
		getConfigPaths,
		getRotationSummaryLines,
		getVerifySummary,
		resetState,
		runFooterCommand,
		runRotationCommand,
		runReportCommand,
		runVerifyCommand,
		runPathCommand,
		runResetCommand,
		refreshStatus: (ctx: ExtensionContext) => statusController.refreshFor(ctx),
		openFooterPanel: (ctx: ExtensionCommandContext) =>
			statusController.openPreferencesPanel(ctx),
	};

	return controller;
}
