import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	registerCommands: vi.fn(),
	controllerStartSession: vi.fn(),
	buildMulticodexProviderConfig: vi.fn(() => ({ mocked: true })),
	setWarningHandler: vi.fn(),
	resetSessionWarnings: vi.fn(),
	controllerRefreshFor: vi.fn(),
	controllerStopSession: vi.fn(),
	controllerScheduleModelSelectRefresh: vi.fn(),
	controllerAccountManager: {
		getAccounts: vi.fn(() => [{ email: "a@example.com" }]),
	},
}));

vi.mock("./account-manager", () => ({
	AccountManager: class MockAccountManager {
		setWarningHandler = mocks.setWarningHandler;
		resetSessionWarnings = mocks.resetSessionWarnings;
	},
}));

vi.mock("./commands", () => ({
	registerCommands: mocks.registerCommands,
}));

vi.mock("./multicodex-controller", () => ({
	createMultiCodexController: () => ({
		accountManager: mocks.controllerAccountManager,
		refreshFor: mocks.controllerRefreshFor,
		scheduleModelSelectRefresh: mocks.controllerScheduleModelSelectRefresh,
		startSession: mocks.controllerStartSession,
		stopSession: mocks.controllerStopSession,
	}),
}));

vi.mock("./provider", () => ({
	PROVIDER_ID: "openai-codex",
	buildMulticodexProviderConfig: mocks.buildMulticodexProviderConfig,
}));

import multicodexExtension from "./extension";

describe("multicodexExtension", () => {
	beforeEach(() => {
		mocks.registerCommands.mockClear();
		mocks.controllerStartSession.mockClear();
		mocks.buildMulticodexProviderConfig.mockClear();
		mocks.setWarningHandler.mockClear();
		mocks.resetSessionWarnings.mockClear();
		mocks.controllerRefreshFor.mockClear();
		mocks.controllerStopSession.mockClear();
		mocks.controllerScheduleModelSelectRefresh.mockClear();
	});

	it("registers provider, commands, and lifecycle hooks", () => {
		const handlers = new Map<string, (...args: unknown[]) => void>();
		const registerProvider = vi.fn();
		const on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
			handlers.set(event, handler);
		});

		multicodexExtension({
			registerProvider,
			on,
		} as never);

		expect(mocks.setWarningHandler).toHaveBeenCalledOnce();
		expect(mocks.buildMulticodexProviderConfig).toHaveBeenCalledOnce();
		expect(registerProvider).toHaveBeenCalledWith("openai-codex", {
			mocked: true,
		});
		expect(mocks.registerCommands).toHaveBeenCalledOnce();
		expect(on).toHaveBeenCalledTimes(5);
		expect(handlers.has("session_start")).toBe(true);
		expect(handlers.has("session_tree")).toBe(true);
		expect(handlers.has("turn_end")).toBe(true);
		expect(handlers.has("model_select")).toBe(true);
		expect(handlers.has("session_shutdown")).toBe(true);
	});

	it("routes session and status events to the helpers", () => {
		const handlers = new Map<string, (...args: unknown[]) => void>();
		const ctx = { ui: { notify: vi.fn() } };

		multicodexExtension({
			registerProvider: vi.fn(),
			on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
				handlers.set(event, handler);
			}),
		} as never);

		const sessionStart = handlers.get("session_start");
		const sessionTree = handlers.get("session_tree");
		const turnEnd = handlers.get("turn_end");
		const modelSelect = handlers.get("model_select");
		const sessionShutdown = handlers.get("session_shutdown");
		expect(sessionStart).toBeTypeOf("function");
		expect(sessionTree).toBeTypeOf("function");
		expect(turnEnd).toBeTypeOf("function");
		expect(modelSelect).toBeTypeOf("function");
		expect(sessionShutdown).toBeTypeOf("function");

		sessionStart?.({}, ctx as never);
		sessionTree?.({}, ctx as never);
		expect(mocks.resetSessionWarnings).toHaveBeenCalledTimes(2);
		expect(mocks.controllerStartSession).toHaveBeenCalledTimes(2);
		expect(mocks.controllerStartSession).toHaveBeenNthCalledWith(
			1,
			ctx,
			expect.any(Function),
		);
		expect(mocks.controllerStartSession).toHaveBeenNthCalledWith(
			2,
			ctx,
			expect.any(Function),
		);

		turnEnd?.({}, ctx as never);
		modelSelect?.({}, ctx as never);
		expect(mocks.controllerRefreshFor).toHaveBeenCalledTimes(1);
		expect(mocks.controllerScheduleModelSelectRefresh).toHaveBeenCalledWith(
			ctx,
		);

		sessionShutdown?.({}, ctx as never);
		expect(mocks.controllerStopSession).toHaveBeenCalledWith(ctx);
	});
});
