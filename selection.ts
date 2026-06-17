import {
	DEFAULT_ROTATION_SETTINGS,
	type RotationSettings,
} from "./rotation-settings";
import type { Account } from "./storage";
import {
	type CodexUsageSnapshot,
	getMaxUsedPercent,
	getWeeklyResetAt,
	isUsageUntouched,
} from "./usage";

export function isAccountAvailable(account: Account, now: number): boolean {
	if (account.needsReauth) return false;
	return !account.quotaExhaustedUntil || account.quotaExhaustedUntil <= now;
}

function pickRandomAccount(accounts: Account[]): Account | undefined {
	if (accounts.length === 0) return undefined;
	return accounts[Math.floor(Math.random() * accounts.length)];
}

function pickLowestUsageAccount(
	accounts: Account[],
	usageByEmail: Map<string, CodexUsageSnapshot>,
): Account | undefined {
	const candidates = accounts
		.map((account) => {
			const usage = usageByEmail.get(account.email);
			return {
				account,
				usedPercent: getMaxUsedPercent(usage) ?? 100,
				resetAt: getWeeklyResetAt(usage) ?? Number.MAX_SAFE_INTEGER,
			};
		})
		.sort((a, b) => {
			// Primary: lowest usage first
			const usageDiff = a.usedPercent - b.usedPercent;
			if (usageDiff !== 0) return usageDiff;
			// Tiebreaker: earliest weekly reset first
			return a.resetAt - b.resetAt;
		});

	return candidates[0]?.account;
}

function pickEarliestResetAccount(
	accounts: Account[],
	usageByEmail: Map<string, CodexUsageSnapshot>,
): Account | undefined {
	const candidates = accounts
		.map((account) => {
			const usage = usageByEmail.get(account.email);
			return {
				account,
				usedPercent: getMaxUsedPercent(usage) ?? 100,
				resetAt: getWeeklyResetAt(usage) ?? Number.MAX_SAFE_INTEGER,
			};
		})
		.sort((a, b) => {
			const resetDiff = a.resetAt - b.resetAt;
			if (resetDiff !== 0) return resetDiff;
			const usageDiff = a.usedPercent - b.usedPercent;
			if (usageDiff !== 0) return usageDiff;
			return 0;
		});

	return candidates[0]?.account;
}

export function pickBestAccount(
	accounts: Account[],
	usageByEmail: Map<string, CodexUsageSnapshot>,
	options?: {
		excludeEmails?: Set<string>;
		now?: number;
		rotation?: RotationSettings;
	},
): Account | undefined {
	const now = options?.now ?? Date.now();
	const rotation = options?.rotation ?? DEFAULT_ROTATION_SETTINGS;
	const available = accounts.filter(
		(account) =>
			isAccountAvailable(account, now) &&
			!options?.excludeEmails?.has(account.email),
	);
	if (available.length === 0) return undefined;

	const withUsage = available.filter((account) =>
		usageByEmail.has(account.email),
	);
	if (withUsage.length === 0) {
		return pickRandomAccount(available);
	}

	let candidates = withUsage;
	if (rotation.preferUntouched) {
		const untouched = candidates.filter((account) =>
			isUsageUntouched(usageByEmail.get(account.email)),
		);
		if (untouched.length > 0) {
			candidates = untouched;
		}
	}

	if (rotation.preferWeeklyReset) {
		return (
			pickEarliestResetAccount(candidates, usageByEmail) ??
			pickRandomAccount(candidates)
		);
	}

	return (
		pickLowestUsageAccount(candidates, usageByEmail) ??
		pickRandomAccount(candidates)
	);
}
