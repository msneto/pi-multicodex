import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountManager } from "./account-manager";
import * as rotationModule from "./rotation-settings";
import * as statusModule from "./status";

function createStatusControllerMock() {
	return {
		loadPreferences: vi.fn().mockResolvedValue(undefined),
		setPreferences: vi.fn().mockResolvedValue(undefined),
		openPreferencesPanel: vi.fn().mockResolvedValue(undefined),
		refreshFor: vi.fn().mockResolvedValue(undefined),
		scheduleModelSelectRefresh: vi.fn(),
		startAutoRefresh: vi.fn(),
		stopAutoRefresh: vi.fn(),
		getPreferences: vi.fn(() => ({
			usageMode: "left",
			resetWindow: "7d",
			showAccount: true,
			showReset: true,
			order: "account-first",
			separator: "/",
			accountLabelMaxChars: 14,
		})),
	};
}

function createAccountManagerMock(accountCount = 1) {
	return {
		getAccounts: vi.fn(() =>
			Array.from({ length: accountCount }, (_, index) => ({
				email: `a${index}@example.com`,
			})),
		),
		loadRotationPreferences: vi.fn(),
		getRotationPreferences: vi.fn(() => ({ mocked: true })),
		setRotationPreferences: vi.fn(),
		beginInitialization: vi.fn(),
		loadPiAuth: vi.fn().mockResolvedValue(undefined),
		refreshUsageForAllAccounts: vi.fn().mockResolvedValue(undefined),
		getAccountsNeedingReauth: vi.fn(() => []),
		getAvailableManualAccount: vi.fn(() => undefined),
		hasManualAccount: vi.fn(() => false),
		clearManualAccount: vi.fn(),
		activateBestAccount: vi.fn().mockResolvedValue(undefined),
		markReady: vi.fn(),
		getActiveAccount: vi.fn(() => ({ email: "a0@example.com" })),
		getConfigPaths: vi.fn(),
		getRotationSummaryLines: vi.fn(() => ["prefer untouched: on"]),
		getCachedUsage: vi.fn(),
		isPiAuthAccount: vi.fn(() => false),
		clearAllQuotaExhaustion: vi.fn(() => 0),
		getManualAccount: vi.fn(() => undefined),
		resetSessionWarnings: vi.fn(),
		setWarningHandler: vi.fn(),
	} as unknown as AccountManager;
}

describe("createMultiCodexController", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("delegates footer preference writes to status controller", async () => {
		const statusController = createStatusControllerMock();
		vi.spyOn(statusModule, "createUsageStatusController").mockReturnValue(
			statusController as never,
		);
		vi.spyOn(rotationModule, "loadRotationSettings").mockReturnValue({
			mocked: true,
		} as never);

		const { createMultiCodexController } = await import("./multicodex-controller");
		const accountManager = createAccountManagerMock();
		const controller = createMultiCodexController(accountManager);

		await controller.setFooterPreferences({
			usageMode: "used",
			resetWindow: "5h",
			showAccount: false,
			showReset: false,
			order: "usage-first",
			separator: "|",
			accountLabelMaxChars: 16,
		});

		expect(statusController.setPreferences).toHaveBeenCalledWith({
			usageMode: "used",
			resetWindow: "5h",
			showAccount: false,
			showReset: false,
			order: "usage-first",
			separator: "|",
			accountLabelMaxChars: 16,
		});
		expect(controller.getPreferences()).toEqual({
			usageMode: "left",
			resetWindow: "7d",
			showAccount: true,
			showReset: true,
			order: "account-first",
			separator: "/",
			accountLabelMaxChars: 14,
		});
	});

	it("loads shared config before session refresh", async () => {
		const statusController = createStatusControllerMock();
		vi.spyOn(statusModule, "createUsageStatusController").mockReturnValue(
			statusController as never,
		);
		const loadRotationSettingsSpy = vi
			.spyOn(rotationModule, "loadRotationSettings")
			.mockReturnValue({ mocked: true } as never);

		const { createMultiCodexController } = await import("./multicodex-controller");
		const accountManager = createAccountManagerMock();
		const controller = createMultiCodexController(accountManager);
		const ctx = { ui: { notify: vi.fn(), setStatus: vi.fn() } } as never;

		await controller.startSession(ctx);

		expect(loadRotationSettingsSpy).toHaveBeenCalledOnce();
		expect(accountManager.loadRotationPreferences).toHaveBeenCalledWith({
			mocked: true,
		});
		expect(accountManager.refreshUsageForAllAccounts).not.toHaveBeenCalled();
		expect(statusController.loadPreferences).toHaveBeenCalledWith(ctx);
		expect(statusController.refreshFor).toHaveBeenCalledWith(ctx);
	});

	it("waits for manual-state restoration before refreshing", async () => {
		let resolveActivate: (() => void) | undefined;
		const statusController = createStatusControllerMock();
		vi.spyOn(statusModule, "createUsageStatusController").mockReturnValue(
			statusController as never,
		);
		vi.spyOn(rotationModule, "loadRotationSettings").mockReturnValue({
			mocked: true,
		} as never);

		const accountManager = createAccountManagerMock();
		accountManager.getAvailableManualAccount = vi.fn(() => undefined);
		accountManager.hasManualAccount = vi.fn(() => true);
		accountManager.clearManualAccount = vi.fn();
		accountManager.activateBestAccount = vi.fn(
			() =>
				new Promise<undefined>((resolve) => {
					resolveActivate = () => resolve(undefined);
				}),
		);

		const { createMultiCodexController } = await import("./multicodex-controller");
		const controller = createMultiCodexController(accountManager);
		const ctx = { ui: { notify: vi.fn(), setStatus: vi.fn() } } as never;

		const startSessionPromise = controller.startSession(ctx);

		expect(accountManager.beginInitialization).toHaveBeenCalledOnce();
		expect(accountManager.loadPiAuth).toHaveBeenCalledOnce();
		await Promise.resolve();
		await Promise.resolve();
		expect(accountManager.clearManualAccount).toHaveBeenCalledOnce();
		expect(statusController.startAutoRefresh).not.toHaveBeenCalled();
		expect(statusController.loadPreferences).not.toHaveBeenCalled();
		expect(statusController.refreshFor).not.toHaveBeenCalled();

		resolveActivate?.();
		await startSessionPromise;

		expect(statusController.startAutoRefresh).toHaveBeenCalledOnce();
		expect(statusController.loadPreferences).toHaveBeenCalledWith(ctx);
		expect(statusController.refreshFor).toHaveBeenCalledWith(ctx);
	});
});
