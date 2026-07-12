import { afterEach, describe, expect, it, vi } from "vitest";
import type { OAuthCredentials } from "@earendil-works/pi-ai/oauth";
import type { AccountManager } from "./account-manager";
import { runAccountsSubcommand } from "./account-flows";
import type { MultiCodexController } from "./multicodex-controller";

function getAuthMocks() {
	const globalMocks = globalThis as typeof globalThis & {
		__piMulticodexAuthMocks?: {
			loginOpenAICodex: ReturnType<typeof vi.fn>;
			openLoginInBrowser: ReturnType<typeof vi.fn>;
		};
	};

	if (!globalMocks.__piMulticodexAuthMocks) {
		globalMocks.__piMulticodexAuthMocks = {
			loginOpenAICodex: vi.fn(),
			openLoginInBrowser: vi.fn(),
		};
	}

	return globalMocks.__piMulticodexAuthMocks;
}

vi.mock("@earendil-works/pi-ai/oauth", () => ({
	loginOpenAICodex: getAuthMocks().loginOpenAICodex,
}));

vi.mock("./browser", () => ({
	openLoginInBrowser: getAuthMocks().openLoginInBrowser,
}));

const authMocks = getAuthMocks();

function createStatusControllerMock() {
	return {
		refreshFor: vi.fn().mockResolvedValue(undefined),
		openPreferencesPanel: vi.fn().mockResolvedValue(undefined),
		loadPreferences: vi.fn().mockResolvedValue(undefined),
		runFooterCommand: vi.fn().mockResolvedValue(undefined),
		runRotationCommand: vi.fn().mockResolvedValue(undefined),
		runReportCommand: vi.fn().mockResolvedValue(undefined),
		runVerifyCommand: vi.fn().mockResolvedValue(undefined),
		runPathCommand: vi.fn().mockResolvedValue(undefined),
		runResetCommand: vi.fn().mockResolvedValue(undefined),
		getPreferences: vi.fn(() => ({
			usageMode: "left",
			resetWindow: "7d",
			showAccount: true,
			showReset: true,
			order: "account-first",
			separator: "/",
			accountLabelMaxChars: 14,
		})),
		getRotationSummaryLines: vi.fn(() => ["prefer untouched: on"]),
		setManualAccount: vi.fn(),
	} as unknown as MultiCodexController;
}

afterEach(() => {
	vi.clearAllMocks();
	vi.restoreAllMocks();
});

describe("runAccountsSubcommand", () => {
	it("redacts the raw login URL from notifications and logs", async () => {
		authMocks.loginOpenAICodex.mockImplementation(async ({ onAuth }) => {
			await onAuth({
				url: "https://example.com/login?state=secret-token",
			});
			return {
				access: "access-token",
				refresh: "refresh-token",
				expires: Date.now() + 3_600_000,
			} as OAuthCredentials;
		});

		const accountManager = {
			refreshUsageForAllAccounts: vi.fn().mockResolvedValue(undefined),
			getAccount: vi.fn(() => undefined),
			addOrUpdateAccount: vi.fn(() => ({ email: "new@example.com" })),
		} as unknown as AccountManager;
		const controller = createStatusControllerMock();
		const notify = vi.fn();
		const input = vi.fn();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

		await runAccountsSubcommand(
			{ registerCommand: vi.fn() } as never,
			{ hasUI: true, ui: { notify, input } } as never,
			accountManager,
			controller,
			"new@example.com",
		);

		expect(authMocks.openLoginInBrowser).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			"https://example.com/login?state=secret-token",
		);
		expect(notify).toHaveBeenCalledWith(
			"Please continue the login in your browser.",
			"info",
		);
		expect(notify).not.toHaveBeenCalledWith(
			expect.stringContaining("secret-token"),
			expect.anything(),
		);
		expect(logSpy).not.toHaveBeenCalled();
	});

	it("toggles manual disable from the accounts panel", async () => {
		const account = {
			email: "managed@example.com",
			manuallyDisabled: false,
		};
		const accountManager = {
			refreshUsageForAllAccounts: vi.fn().mockResolvedValue(undefined),
			getAccount: vi.fn(() => account),
			getAccounts: vi.fn(() => [account]),
			setAccountManuallyDisabled: vi.fn().mockResolvedValue(true),
		} as unknown as AccountManager;
		const controller = createStatusControllerMock();
		const notify = vi.fn();
		const input = vi.fn();
		const custom = vi
			.fn()
			.mockResolvedValueOnce({ action: "toggle-disabled", email: account.email })
			.mockResolvedValueOnce(undefined);

		await runAccountsSubcommand(
			{ registerCommand: vi.fn() } as never,
			{
				hasUI: true,
				ui: { notify, input, custom },
			} as never,
			accountManager,
			controller,
			"",
		);

		expect(accountManager.setAccountManuallyDisabled).toHaveBeenCalledWith(
			account.email,
			true,
		);
		expect(controller.refreshFor).toHaveBeenCalled();
		expect(notify).toHaveBeenCalledWith(`Disabled ${account.email}`, "info");
	});
});
