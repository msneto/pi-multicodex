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

function withIndex<T>(items: T[]): Array<{ item: T; index: number }> {
	return items.map((item, index) => ({ item, index }));
}

function pickLowestUsageAccount(
	accounts: Account[],
	usageByEmail: Map<string, CodexUsageSnapshot>,
): Account | undefined {
	const candidates = withIndex(accounts)
		.map(({ item: account, index }) => {
			const usage = usageByEmail.get(account.email);
			return {
				account,
				usedPercent: getMaxUsedPercent(usage) ?? 100,
				resetAt: getWeeklyResetAt(usage) ?? Number.MAX_SAFE_INTEGER,
				index,
			};
		})
		.sort((a, b) => {
			const usageDiff = a.usedPercent - b.usedPercent;
			if (usageDiff !== 0) return usageDiff;
			const resetDiff = a.resetAt - b.resetAt;
			if (resetDiff !== 0) return resetDiff;
			return a.index - b.index;
		});

	return candidates[0]?.account;
}

function pickStableWeeklyAccount(
	accounts: Account[],
	usageByEmail: Map<string, CodexUsageSnapshot>,
	now: number,
): Account | undefined {
	const candidates = withIndex(accounts)
		.map(({ item: account, index }) => {
			const usage = usageByEmail.get(account.email);
			const usedPercent = usage?.secondary?.usedPercent ?? 100;
			const resetAt = usage?.secondary?.resetAt ?? Number.MAX_SAFE_INTEGER;
			const remainingFraction = Math.max(0, 1 - usedPercent / 100);
			const hoursLeft = Math.max((resetAt - now) / 36e5, 0.01);
			return {
				account,
				score: remainingFraction - hoursLeft / 168,
				resetAt,
				usedPercent,
				index,
			};
		})
		.sort((a, b) => {
			const scoreDiff = b.score - a.score;
			if (scoreDiff !== 0) return scoreDiff;
			const resetDiff = a.resetAt - b.resetAt;
			if (resetDiff !== 0) return resetDiff;
			const usageDiff = a.usedPercent - b.usedPercent;
			if (usageDiff !== 0) return usageDiff;
			return a.index - b.index;
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

	if (rotation.selectionStrategy === "stable-weekly") {
		return (
			pickStableWeeklyAccount(candidates, usageByEmail, now) ??
			pickRandomAccount(candidates)
		);
	}

	return (
		pickLowestUsageAccount(candidates, usageByEmail) ??
		pickRandomAccount(candidates)
	);
}
