import { describe, expect, it } from "vitest";
import {
	estimateUsagePace,
	getUsageHistorySamplesForAccount,
	type UsageHistoryData,
} from "./usage-history";

function makeHistory(samples: UsageHistoryData["samples"]): UsageHistoryData {
	return { version: 1, samples };
}

function deepFreezeHistory(history: UsageHistoryData): UsageHistoryData {
	for (const sample of history.samples) {
		if (sample.primary) Object.freeze(sample.primary);
		if (sample.secondary) Object.freeze(sample.secondary);
		Object.freeze(sample);
	}
	Object.freeze(history.samples);
	return Object.freeze(history);
}

describe("usage history indexing", () => {
	it("returns account samples in timestamp order", () => {
		const history = makeHistory([
			{
				ts: 3_000,
				email: "b@example.com",
				primary: { usedPercent: 40 },
			},
			{
				ts: 1_000,
				email: "a@example.com",
				primary: { usedPercent: 10 },
			},
			{
				ts: 2_000,
				email: "a@example.com",
				primary: { usedPercent: 20 },
			},
		]);

		expect(getUsageHistorySamplesForAccount(history, "a@example.com")).toEqual([
			{
				ts: 1_000,
				email: "a@example.com",
				primary: { usedPercent: 10 },
			},
			{
				ts: 2_000,
				email: "a@example.com",
				primary: { usedPercent: 20 },
			},
		]);
	});

	it("estimates pace from the indexed samples", () => {
		const history = makeHistory([
			{
				ts: 120_000,
				email: "b@example.com",
				primary: { usedPercent: 50, resetAt: 300_000 },
				secondary: { usedPercent: 60, resetAt: 600_000 },
			},
			{
				ts: 0,
				email: "a@example.com",
				primary: { usedPercent: 10, resetAt: 300_000 },
				secondary: { usedPercent: 15, resetAt: 600_000 },
			},
			{
				ts: 60_000,
				email: "a@example.com",
				primary: { usedPercent: 20, resetAt: 300_000 },
				secondary: { usedPercent: 25, resetAt: 600_000 },
			},
			{
				ts: 120_000,
				email: "a@example.com",
				primary: { usedPercent: 25, resetAt: 300_000 },
				secondary: { usedPercent: 30, resetAt: 600_000 },
			},
		]);

		const pace = estimateUsagePace(
			history,
			"a@example.com",
			"primary",
			180_000,
		);

		expect(pace?.currentUsedPercent).toBe(25);
		expect(pace?.currentRemainingPercent).toBe(75);
		expect(pace?.lookbacks).toHaveLength(4);
		expect(pace?.lookbacks[0].ratePerHour).toBeCloseTo(450, 6);
		expect(pace?.burnRatePerHour).toBeCloseTo(450, 6);
		expect(pace?.runwayHours).toBeCloseTo(0.1666666667, 6);
	});

	it("works with frozen history data", () => {
		const history = deepFreezeHistory(
			makeHistory([
				{
					ts: 0,
					email: "a@example.com",
					primary: { usedPercent: 10, resetAt: 100 },
					secondary: { usedPercent: 20, resetAt: 200 },
				},
				{
					ts: 60_000,
					email: "a@example.com",
					primary: { usedPercent: 15, resetAt: 100 },
					secondary: { usedPercent: 25, resetAt: 200 },
				},
			]),
		);

		expect(() =>
			estimateUsagePace(history, "a@example.com", "primary", 120_000),
		).not.toThrow();
	});
});
