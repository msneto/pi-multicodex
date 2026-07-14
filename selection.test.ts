import { describe, expect, it } from "vitest";
import { DEFAULT_ROTATION_SETTINGS } from "./rotation-settings";
import { pickBestAccount } from "./selection";
import type { Account } from "./storage";
import type { CodexUsageSnapshot } from "./usage";

function makeAccount(email: string): Account {
	return {
		email,
		accessToken: "access",
		refreshToken: "refresh",
		expiresAt: Date.now() + 3600_000,
	};
}

function makeUsage(
	primaryUsedPercent: number,
	primaryResetAt: number,
	secondaryUsedPercent: number,
	secondaryResetAt: number,
): CodexUsageSnapshot {
	return {
		primary: { usedPercent: primaryUsedPercent, resetAt: primaryResetAt },
		secondary: { usedPercent: secondaryUsedPercent, resetAt: secondaryResetAt },
		fetchedAt: Date.now(),
	};
}

describe("pickBestAccount", () => {
	it("prefers the lowest usage account", () => {
		const accounts = [makeAccount("a@example.com"), makeAccount("b@example.com")];
		const usageByEmail = new Map<string, CodexUsageSnapshot>([
			[
				"a@example.com",
				makeUsage(20, 2_000_000_000, 40, 2_000_000_000),
			],
			[
				"b@example.com",
				makeUsage(10, 1_000_000_000, 20, 1_000_000_000),
			],
		]);

		expect(pickBestAccount(accounts, usageByEmail)?.email).toBe("b@example.com");
	});

	it("breaks lowest-usage ties by earlier reset time", () => {
		const accounts = [makeAccount("a@example.com"), makeAccount("b@example.com")];
		const usageByEmail = new Map<string, CodexUsageSnapshot>([
			[
				"a@example.com",
				makeUsage(10, 2_000_000_000, 30, 2_000_000_000),
			],
			[
				"b@example.com",
				makeUsage(10, 1_000_000_000, 30, 1_000_000_000),
			],
		]);

		expect(pickBestAccount(accounts, usageByEmail)?.email).toBe("b@example.com");
	});

	it("prefers the best stable-weekly tier", () => {
		const accounts = [makeAccount("a@example.com"), makeAccount("b@example.com")];
		const usageByEmail = new Map<string, CodexUsageSnapshot>([
			[
				"a@example.com",
				makeUsage(25, 2_000_000_000, 10, 2_000_000_000),
			],
			[
				"b@example.com",
				makeUsage(75, 1_000_000_000, 10, 1_000_000_000),
			],
		]);

		expect(
			pickBestAccount(accounts, usageByEmail, {
				rotation: {
					...DEFAULT_ROTATION_SETTINGS,
					selectionStrategy: "stable-weekly",
					preferUntouched: false,
				},
			})?.email,
		).toBe("a@example.com");
	});
});
