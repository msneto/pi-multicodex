import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountManager } from "./account-manager";
import { formatAccountReportLines } from "./report";
import { DEFAULT_ROTATION_SETTINGS } from "./rotation-settings";

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
		expect(lines).toContain(
			"about 2 full accounts worth of combined capacity across 2 accounts",
		);
		expect(lines).toContain("5h aggregate");
		expect(lines).toContain("7d aggregate");
	});
});
