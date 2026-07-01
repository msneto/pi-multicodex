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

type LowestUsageCandidate = {
	account: Account;
	usedPercent: number;
	resetAt: number;
	index: number;
};

type StableWeeklyCandidate = {
	account: Account;
	tier: number;
	score: number;
	usedPercent: number;
	resetAt: number;
	hoursLeft: number;
	index: number;
};

function isBetterLowestUsage(
	candidate: LowestUsageCandidate,
	best: LowestUsageCandidate | undefined,
): boolean {
	if (!best) return true;
	if (candidate.usedPercent !== best.usedPercent) {
		return candidate.usedPercent < best.usedPercent;
	}
	if (candidate.resetAt !== best.resetAt) {
		return candidate.resetAt < best.resetAt;
	}
	return candidate.index < best.index;
}

function isBetterStableWeekly(
	candidate: StableWeeklyCandidate,
	best: StableWeeklyCandidate | undefined,
): boolean {
	if (!best) return true;
	if (candidate.tier !== best.tier) return candidate.tier < best.tier;
	if (candidate.score !== best.score) return candidate.score > best.score;
	if (candidate.resetAt !== best.resetAt)
		return candidate.resetAt < best.resetAt;
	if (candidate.usedPercent !== best.usedPercent) {
		return candidate.usedPercent < best.usedPercent;
	}
	return candidate.index < best.index;
}

function sampleReservoir<T>(current: T | undefined, item: T, seen: number): T {
	return Math.random() < 1 / seen ? item : (current ?? item);
}

export function getStableWeeklyTier(
	usage: CodexUsageSnapshot | undefined,
): number {
	const usedPercent = usage?.primary?.usedPercent;
	if (typeof usedPercent !== "number" || Number.isNaN(usedPercent)) {
		return 3;
	}

	const remainingPercent = Math.max(0, 100 - usedPercent);
	if (remainingPercent > 30) return 0;
	if (remainingPercent > 10) return 1;
	if (remainingPercent > 0) return 2;
	return 3;
}

export function hasWeeklyQuota(usage: CodexUsageSnapshot | undefined): boolean {
	const usedPercent = usage?.secondary?.usedPercent;
	return typeof usedPercent === "number" && usedPercent < 100;
}

function createLowestUsageCandidate(
	account: Account,
	usage: CodexUsageSnapshot | undefined,
	index: number,
): LowestUsageCandidate {
	return {
		account,
		usedPercent: getMaxUsedPercent(usage) ?? 100,
		resetAt: getWeeklyResetAt(usage) ?? Number.MAX_SAFE_INTEGER,
		index,
	};
}

function createStableWeeklyCandidate(
	account: Account,
	usage: CodexUsageSnapshot | undefined,
	index: number,
	now: number,
): StableWeeklyCandidate {
	const usedPercent = usage?.secondary?.usedPercent ?? 100;
	const resetAt = usage?.secondary?.resetAt ?? Number.MAX_SAFE_INTEGER;
	const remainingFraction = Math.max(0, 1 - usedPercent / 100);
	const hoursLeft = Math.max((resetAt - now) / 3_600_000, 0.01);
	return {
		account,
		tier: getStableWeeklyTier(usage),
		score: remainingFraction - hoursLeft / 168,
		usedPercent,
		resetAt,
		hoursLeft,
		index,
	};
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
	let availableCount = 0;
	let availableRandom: Account | undefined;
	let withUsageCount = 0;
	let withUsageRandom: Account | undefined;
	let untouchedCount = 0;
	let untouchedRandom: Account | undefined;
	let bestLowestWithUsage: LowestUsageCandidate | undefined;
	let bestLowestUntouched: LowestUsageCandidate | undefined;
	let bestStableWithUsage: StableWeeklyCandidate | undefined;
	let bestStableUntouched: StableWeeklyCandidate | undefined;

	for (let index = 0; index < accounts.length; index += 1) {
		const account = accounts[index];
		if (
			!isAccountAvailable(account, now) ||
			options?.excludeEmails?.has(account.email)
		) {
			continue;
		}

		availableCount += 1;
		availableRandom = sampleReservoir(availableRandom, account, availableCount);

		const usage = usageByEmail.get(account.email);
		if (!usage) continue;

		withUsageCount += 1;
		withUsageRandom = sampleReservoir(withUsageRandom, account, withUsageCount);

		const lowestCandidate = createLowestUsageCandidate(account, usage, index);
		if (isBetterLowestUsage(lowestCandidate, bestLowestWithUsage)) {
			bestLowestWithUsage = lowestCandidate;
		}

		let stableCandidate: StableWeeklyCandidate | undefined;
		if (
			rotation.selectionStrategy === "stable-weekly" &&
			hasWeeklyQuota(usage)
		) {
			stableCandidate = createStableWeeklyCandidate(account, usage, index, now);
			if (isBetterStableWeekly(stableCandidate, bestStableWithUsage)) {
				bestStableWithUsage = stableCandidate;
			}
		}

		const untouched = isUsageUntouched(usage);
		if (!untouched) continue;

		untouchedCount += 1;
		untouchedRandom = sampleReservoir(untouchedRandom, account, untouchedCount);
		if (isBetterLowestUsage(lowestCandidate, bestLowestUntouched)) {
			bestLowestUntouched = lowestCandidate;
		}

		if (
			stableCandidate &&
			isBetterStableWeekly(stableCandidate, bestStableUntouched)
		) {
			bestStableUntouched = stableCandidate;
		}
	}

	if (availableCount === 0) return undefined;
	if (withUsageCount === 0) return availableRandom;

	const useUntouched = rotation.preferUntouched && untouchedCount > 0;
	if (rotation.selectionStrategy === "stable-weekly") {
		const best = useUntouched ? bestStableUntouched : bestStableWithUsage;
		if (best) return best.account;
		return useUntouched ? untouchedRandom : withUsageRandom;
	}

	const best = useUntouched ? bestLowestUntouched : bestLowestWithUsage;
	return best?.account ?? (useUntouched ? untouchedRandom : withUsageRandom);
}
