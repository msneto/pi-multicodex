import { describe, expect, it } from "vitest";
import { DEFAULT_ROTATION_SETTINGS, type Account, pickBestAccount } from "./index";

const NOW = 1_700_000_000_000;

function makeAccount(email: string, overrides?: Partial<Account>): Account {
	return {
		email,
		accessToken: "token",
		refreshToken: "refresh",
		expiresAt: NOW + 3_600_000,
		...overrides,
	};
}

function makeUsage(
	primaryUsedPercent: number,
	secondaryUsedPercent: number,
	fetchedAt: number,
) {
	return {
		primary: { usedPercent: primaryUsedPercent, resetAt: NOW + 60_000 },
		secondary: { usedPercent: secondaryUsedPercent, resetAt: NOW + 120_000 },
		fetchedAt,
	};
}

function selectCapacityFirst(
	accounts: Account[],
	usage: Map<string, ReturnType<typeof makeUsage>>,
	requestCostEstimatePercent: number,
) {
	return pickBestAccount(accounts, usage, {
		now: NOW,
		rotation: {
			...DEFAULT_ROTATION_SETTINGS,
			selectionStrategy: "capacity-first",
			preferUntouched: false,
		},
		requestCostEstimatePercent,
	});
}

describe("capacity-first scenarios", () => {
	it("preserves the larger pocket for later large requests", () => {
		const accounts = [makeAccount("light"), makeAccount("reserved")];
		const usage = new Map([
			["light", makeUsage(0, 0, NOW)],
			["reserved", makeUsage(40, 40, NOW)],
		]);

		const smallRequest = selectCapacityFirst(accounts, usage, 10);
		expect(smallRequest?.email).toBe("reserved");

		const lowestUsage = pickBestAccount(accounts, usage, {
			now: NOW,
			rotation: DEFAULT_ROTATION_SETTINGS,
			requestCostEstimatePercent: 10,
		});
		expect(lowestUsage?.email).toBe("light");

		const largeRequest = selectCapacityFirst(accounts, usage, 60);
		expect(largeRequest?.email).toBe("light");
	});

	it("prefers fresh usage when fits tie", () => {
		const accounts = [makeAccount("stale"), makeAccount("fresh")];
		const usage = new Map([
			["stale", makeUsage(30, 30, NOW - 6 * 60 * 1000)],
			["fresh", makeUsage(30, 30, NOW - 60 * 1000)],
		]);

		const selected = selectCapacityFirst(accounts, usage, 10);
		expect(selected?.email).toBe("fresh");
	});

	it("keeps untouched as a bonus", () => {
		const accounts = [makeAccount("untouched"), makeAccount("tighter")];
		const usage = new Map([
			["untouched", makeUsage(0, 0, NOW)],
			["tighter", makeUsage(20, 20, NOW)],
		]);

		const selected = selectCapacityFirst(accounts, usage, 10);
		expect(selected?.email).toBe("tighter");
	});

	it("returns no account when capacity-first has no usage and guard relaxation is off", () => {
		const accounts = [makeAccount("a@example.com"), makeAccount("b@example.com")];
		const usage = new Map<string, ReturnType<typeof makeUsage>>();

		const selected = selectCapacityFirst(accounts, usage, 10);
		expect(selected).toBeUndefined();
	});

	it("falls back to the first account when capacity-first has no usage and guard relaxation is on", () => {
		const accounts = [makeAccount("a@example.com"), makeAccount("b@example.com")];
		const usage = new Map<string, ReturnType<typeof makeUsage>>();

		const selected = pickBestAccount(accounts, usage, {
			now: NOW,
			rotation: {
				...DEFAULT_ROTATION_SETTINGS,
				selectionStrategy: "capacity-first",
				guardRelaxation: true,
				preferUntouched: false,
			},
			requestCostEstimatePercent: 10,
		});

		expect(selected?.email).toBe("a@example.com");
	});
});
