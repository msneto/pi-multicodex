import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as accountManagerModule from "./account-manager";
import * as commandsModule from "./commands";
import * as controllerModule from "./multicodex-controller";
import * as providerModule from "./provider";

function createControllerMock() {
	return {
		accountManager: {
			getAccounts: vi.fn(() => [{ email: "a@example.com" }]),
		},
		refreshFor: vi.fn(),
		scheduleModelSelectRefresh: vi.fn(),
		startSession: vi.fn(),
		stopSession: vi.fn(),
	};
}

describe("multicodexExtension", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("registers provider, commands, and lifecycle hooks", async () => {
		const setWarningHandlerSpy = vi.spyOn(
			accountManagerModule.AccountManager.prototype,
			"setWarningHandler",
		);
		const resetSessionWarningsSpy = vi.spyOn(
			accountManagerModule.AccountManager.prototype,
			"resetSessionWarnings",
		);
		const registerCommandsSpy = vi
			.spyOn(commandsModule, "registerCommands")
			.mockImplementation(() => undefined);
		const controller = createControllerMock();
		const createControllerSpy = vi
			.spyOn(controllerModule, "createMultiCodexController")
			.mockReturnValue(controller as never);
		const buildProviderSpy = vi
			.spyOn(providerModule, "buildMulticodexProviderConfig")
			.mockReturnValue({ mocked: true } as never);

		const { default: multicodexExtension } = await import("./extension");
		const handlers = new Map<string, (...args: unknown[]) => void>();
		const registerProvider = vi.fn();
		const on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
			handlers.set(event, handler);
		});

		multicodexExtension({
			registerProvider,
			on,
		} as never);

		expect(setWarningHandlerSpy).toHaveBeenCalledOnce();
		expect(createControllerSpy).toHaveBeenCalledOnce();
		expect(buildProviderSpy).toHaveBeenCalledOnce();
		expect(registerProvider).toHaveBeenCalledWith("openai-codex", {
			mocked: true,
		});
		expect(registerCommandsSpy).toHaveBeenCalledOnce();
		expect(on).toHaveBeenCalledTimes(5);
		expect(handlers.has("session_start")).toBe(true);
		expect(handlers.has("session_tree")).toBe(true);
		expect(handlers.has("turn_end")).toBe(true);
		expect(handlers.has("model_select")).toBe(true);
		expect(handlers.has("session_shutdown")).toBe(true);
		void resetSessionWarningsSpy;
	});

	it("routes session and status events to the helpers", async () => {
		vi.spyOn(
			accountManagerModule.AccountManager.prototype,
			"setWarningHandler",
		);
		vi.spyOn(
			accountManagerModule.AccountManager.prototype,
			"resetSessionWarnings",
		);
		vi.spyOn(commandsModule, "registerCommands").mockImplementation(
			() => undefined,
		);
		const controller = createControllerMock();
		const createControllerSpy = vi
			.spyOn(controllerModule, "createMultiCodexController")
			.mockReturnValue(controller as never);
		vi.spyOn(providerModule, "buildMulticodexProviderConfig").mockReturnValue({
			mocked: true,
		} as never);

		const { default: multicodexExtension } = await import("./extension");
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
		expect(controller.startSession).toHaveBeenCalledTimes(2);
		expect(controller.startSession).toHaveBeenNthCalledWith(
			1,
			ctx,
			expect.any(Function),
		);
		expect(controller.startSession).toHaveBeenNthCalledWith(
			2,
			ctx,
			expect.any(Function),
		);

		turnEnd?.({}, ctx as never);
		modelSelect?.({}, ctx as never);
		expect(controller.refreshFor).toHaveBeenCalledTimes(1);
		expect(controller.scheduleModelSelectRefresh).toHaveBeenCalledWith(ctx);

		sessionShutdown?.({}, ctx as never);
		expect(controller.stopSession).toHaveBeenCalledWith(ctx);
		void createControllerSpy;
	});
});
