import { describe, expect, it, vi } from "vitest";
import { handleNewSessionSwitch, handleSessionStart } from "./hooks";

describe("handleSessionStart", () => {
	it("does nothing when no accounts exist", () => {
		const startSession = vi.fn();

		handleSessionStart(
			{
				accountManager: {
					getAccounts: () => [],
				} as never,
				startSession,
			} as never,
			{} as never,
		);

		expect(startSession).not.toHaveBeenCalled();
	});

	it("starts session when accounts exist", () => {
		const startSession = vi.fn();
		const ctx = {};

		handleSessionStart(
			{
				accountManager: {
					getAccounts: () => [{ email: "a@example.com" }],
				} as never,
				startSession,
			} as never,
			ctx as never,
		);

		expect(startSession).toHaveBeenCalledWith(ctx, undefined);
	});
});

describe("handleNewSessionSwitch", () => {
	it("starts session for new switch", () => {
		const startSession = vi.fn();
		const ctx = {};

		handleNewSessionSwitch(
			{
				accountManager: {
					getAccounts: () => [{ email: "a@example.com" }],
				} as never,
				startSession,
			} as never,
			ctx as never,
		);

		expect(startSession).toHaveBeenCalledWith(ctx, undefined);
	});
});
