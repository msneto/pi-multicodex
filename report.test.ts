import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountManager } from "./account-manager";
import { formatAccountReportLines } from "./report";
import { DEFAULT_ROTATION_SETTINGS } from "./rotation-settings";
import * as usageHistory from "./usage-history";

const NOW = 1_700_000_000_000;

afterEach(() => {
	vi.restoreAllMocks();
});

function createAccountManagerMock(options: {
	activeEmail?: string;
	manualEmail?: string;
	rotation?: typeof DEFAULT_ROTATION_SETTINGS;
	usage?: Record<
		string,
		{
			primary?: { usedPercent?: number; resetAt?: number };
			secondary?: { usedPercent?: number; resetAt?: number };
		}
	>;
}) {
	const accounts = [{ email: "a@example.com" }, { email: "b@example.com" }];
	return {
		getAccounts: () => accounts,
		getActiveAccount: () =>
			options.activeEmail ? { email: options.activeEmail } : undefined,
		getManualAccount: () =>
			options.manualEmail ? { email: options.manualEmail } : undefined,
		isPiAuthAccount: () => false,
		getRotationPreferences: () => options.rotation ?? DEFAULT_ROTATION_SETTINGS,
		getCachedUsage: (email: string) => options.usage?.[email],
	} as unknown as AccountManager;
}

describe("formatAccountReportLines", () => {
	it("explains every account when manual override wins", () => {
		vi.spyOn(Date, "now").mockReturnValue(NOW);
		const accountManager = createAccountManagerMock({
			activeEmail: "a@example.com",
			manualEmail: "a@example.com",
			usage: {
				"a@example.com": {
					primary: { usedPercent: 20, resetAt: NOW + 60_000 },
					secondary: { usedPercent: 30, resetAt: NOW + 120_000 },
				},
				"b@example.com": {
					primary: { usedPercent: 40, resetAt: NOW + 60_000 },
					secondary: { usedPercent: 50, resetAt: NOW + 120_000 },
				},
			},
		});

		const lines = formatAccountReportLines(accountManager).join("\n");

		expect(lines).toContain("decision:");
		expect(lines).toContain("active: a@example.com (manual override)");
		expect(lines).toContain("reason: manual pin wins over rotation");
		expect(lines).toContain("why each account won or lost:");
		expect(lines).toContain("  - a@example.com [active, manual]");
		expect(lines).toContain("why: manual pin keeps this account active");
		expect(lines).toContain("  - b@example.com");
		expect(lines).toContain(
			"lost: manual pin overrides rotation for another account",
		);
	});

	it("explains every account when no usage forces random fallback", () => {
		vi.spyOn(Date, "now").mockReturnValue(NOW);
		const accountManager = createAccountManagerMock({
			activeEmail: "a@example.com",
			usage: {},
		});

		const lines = formatAccountReportLines(accountManager).join("\n");

		expect(lines).toContain("active: a@example.com (random fallback)");
		expect(lines).toContain(
			"reason: no cached usage for available accounts, so rotation could not rank them",
		);
		expect(lines).toContain("  - a@example.com [active]");
		expect(lines).toContain("eligible, but no cached usage");
		expect(lines).toContain(
			"random fallback can pick it, but no usage score exists",
		);
		expect(lines).toContain("  - b@example.com");
	});

	it("explains stable-weekly random fallback when weekly quota is exhausted", () => {
		vi.spyOn(Date, "now").mockReturnValue(NOW);
		const accountManager = createAccountManagerMock({
			activeEmail: "a@example.com",
			rotation: {
				...DEFAULT_ROTATION_SETTINGS,
				selectionStrategy: "stable-weekly",
			},
			usage: {
				"a@example.com": {
					primary: { usedPercent: 10, resetAt: NOW + 60_000 },
					secondary: { usedPercent: 100, resetAt: NOW + 120_000 },
				},
				"b@example.com": {
					primary: { usedPercent: 20, resetAt: NOW + 60_000 },
					secondary: { usedPercent: 100, resetAt: NOW + 120_000 },
				},
			},
		});

		const lines = formatAccountReportLines(accountManager).join("\n");

		expect(lines).toContain("active: a@example.com (random fallback)");
		expect(lines).toContain(
			"reason: stable-weekly had no weekly-quota candidates, so rotation fell back to random",
		);
		expect(lines).toContain("  - a@example.com [active]");
		expect(lines).toContain(
			"why: random fallback picked this eligible account",
		);
	});

	it("explains every account when lowest-usage picks active", () => {
		vi.spyOn(Date, "now").mockReturnValue(NOW);
		const accountManager = createAccountManagerMock({
			activeEmail: "a@example.com",
			usage: {
				"a@example.com": {
					primary: { usedPercent: 20, resetAt: NOW + 60_000 },
					secondary: { usedPercent: 30, resetAt: NOW + 120_000 },
				},
				"b@example.com": {
					primary: { usedPercent: 40, resetAt: NOW + 60_000 },
					secondary: { usedPercent: 50, resetAt: NOW + 120_000 },
				},
			},
		});

		const lines = formatAccountReportLines(accountManager).join("\n");

		expect(lines).toContain("rule: lowest-usage + untouched preference");
		expect(lines).toContain("  - a@example.com [active]");
		expect(lines).toContain("max used: 30%");
		expect(lines).toContain("why: lowest max usage among rankable accounts");
		expect(lines).toContain("  - b@example.com");
		expect(lines).toContain("lost: max used is 20% higher than winner");
	});

	it("shows usage pace tree per account", () => {
		vi.spyOn(Date, "now").mockReturnValue(NOW);
		vi.spyOn(usageHistory, "loadUsageHistory").mockReturnValue({
			version: 1,
			samples: [
				{
					ts: NOW - 60 * 60 * 1000,
					email: "a@example.com",
					primary: { usedPercent: 10 },
					secondary: { usedPercent: 20 },
				},
				{
					ts: NOW - 30 * 60 * 1000,
					email: "a@example.com",
					primary: { usedPercent: 20 },
					secondary: { usedPercent: 30 },
				},
				{
					ts: NOW - 10 * 60 * 1000,
					email: "a@example.com",
					primary: { usedPercent: 35 },
					secondary: { usedPercent: 40 },
				},
				{
					ts: NOW - 5 * 60 * 1000,
					email: "a@example.com",
					primary: { usedPercent: 50 },
					secondary: { usedPercent: 60 },
				},
			],
		});

		const accountManager = createAccountManagerMock({
			activeEmail: "a@example.com",
		});

		const lines = formatAccountReportLines(accountManager).join("\n");

		expect(lines).toContain("usage pace:");
		expect(lines).toContain("  - a@example.com [active]");
		expect(lines).toContain("    - 5h pace");
		expect(lines).toContain("      - 5h: ");
		expect(lines).toContain("    - 7d pace");
		expect(lines).toContain("      - 7d: ");
	});

	it("describes capacity as full-account equivalents", () => {
		vi.spyOn(Date, "now").mockReturnValue(NOW);
		const accountManager = createAccountManagerMock({
			usage: {
				"a@example.com": {
					primary: { usedPercent: 0, resetAt: NOW + 60_000 },
					secondary: { usedPercent: 0, resetAt: NOW + 120_000 },
				},
				"b@example.com": {
					primary: { usedPercent: 0, resetAt: NOW + 60_000 },
					secondary: { usedPercent: 0, resetAt: NOW + 120_000 },
				},
			},
		});

		const lines = formatAccountReportLines(accountManager).join("\n");

		expect(lines).toContain("capacity estimate:");
		expect(lines).toContain("  - 5h: ~2 accounts, reset 1m");
		expect(lines).toContain("  - 7d: ~2 accounts, reset 2m");
	});

	it("shows unknown capacity without usage snapshots", () => {
		vi.spyOn(Date, "now").mockReturnValue(NOW);
		const accountManager = createAccountManagerMock({
			usage: {},
		});

		const lines = formatAccountReportLines(accountManager).join("\n");

		expect(lines).toContain("capacity estimate:");
		expect(lines).toContain("  - 5h: unknown");
		expect(lines).toContain("  - 7d: unknown");
	});

	it("shows hierarchical quota snapshot", () => {
		vi.spyOn(Date, "now").mockReturnValue(NOW);
		const accountManager = createAccountManagerMock({
			activeEmail: "a@example.com",
			usage: {
				"a@example.com": {
					primary: { usedPercent: 1, resetAt: NOW + 60_000 },
					secondary: { usedPercent: 100, resetAt: NOW + 120_000 },
				},
				"b@example.com": {
					primary: { usedPercent: 40, resetAt: NOW + 60_000 },
					secondary: { usedPercent: 50, resetAt: NOW + 120_000 },
				},
			},
		});

		const lines = formatAccountReportLines(accountManager).join("\n");

		expect(lines).toContain("quota snapshot:");
		expect(lines).toContain("blocked: a@example.com (7d 0%)");
		expect(lines).toContain("  - a@example.com [active]");
		expect(lines).toContain("    - 5h: 99% left (used 1%, reset 1m)");
		expect(lines).toContain("    - 7d: 0% left (used 100%, reset 2m)");
		expect(lines).toContain("  - b@example.com");
	});

	it("does not repeat quota in why section", () => {
		vi.spyOn(Date, "now").mockReturnValue(NOW);
		const accountManager = createAccountManagerMock({
			activeEmail: "a@example.com",
			usage: {
				"a@example.com": {
					primary: { usedPercent: 20, resetAt: NOW + 60_000 },
					secondary: { usedPercent: 30, resetAt: NOW + 120_000 },
				},
				"b@example.com": {
					primary: { usedPercent: 40, resetAt: NOW + 60_000 },
					secondary: { usedPercent: 50, resetAt: NOW + 120_000 },
				},
			},
		});

		const lines = formatAccountReportLines(accountManager);
		const whyIndex = lines.indexOf("why each account won or lost:");
		const capacityIndex = lines.indexOf("capacity estimate:");
		expect(whyIndex).toBeGreaterThan(-1);
		expect(capacityIndex).toBeGreaterThan(whyIndex);
		const whyLines = lines.slice(whyIndex + 1, capacityIndex).join("\n");
		expect(whyLines).not.toContain("5h:");
		expect(whyLines).not.toContain("7d:");
	});
});
