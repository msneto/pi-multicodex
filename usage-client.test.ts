import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCodexUsage } from "./usage-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.restoreAllMocks();
});

describe("fetchCodexUsage", () => {
	it("wraps fetch failures with multicodex context", async () => {
		globalThis.fetch = vi.fn(async () => {
			throw new TypeError("fetch failed");
		}) as typeof fetch;

		await expect(
			fetchCodexUsage("token", undefined, {
				scope: "usage fetch alice@example.com",
			}),
		).rejects.toThrow(
			"[pi-multicodex] usage fetch alice@example.com: fetch failed",
		);
	});

	it("wraps non-200 responses with multicodex context", async () => {
		globalThis.fetch = vi.fn(async () => ({
			ok: false,
			status: 500,
			json: async () => ({ message: "server error" }),
		})) as typeof fetch;

		await expect(
			fetchCodexUsage("token", "acc-1", {
				scope: "usage fetch alice@example.com",
			}),
		).rejects.toThrow(
			"[pi-multicodex] usage fetch alice@example.com: Usage request failed: 500",
		);
	});
});
