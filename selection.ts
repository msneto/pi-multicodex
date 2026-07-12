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

const USAGE_STALE_TTL_MS = 5 * 60 * 1000;
const CAPACITY_FIRST_GUARD_BAND_PERCENT = 5;

export function isAccountAvailable(account: Account, now: number): boolean {
	if (account.needsReauth) return false;
	if (account.manuallyDisabled) return false;
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

export type CapacityFitClass =
	| "guarded-fit"
	| "raw-fit"
	| "risky-fit"
	| "unknown-fit";

type CapacityFirstCandidate = CapacityFirstAnalysis & {
	account: Account;
	index: number;
	staleRank: number;
	untouchedRank: number;
};

export interface CapacityFirstAnalysis {
	fitClass: CapacityFitClass;
	classRank: number;
	fitDistance: number;
	knownCount: number;
	asymmetry: number;
	stale: boolean;
	untouched: boolean;
	requestCostEstimatePercent: number;
	guardBandPercent: number;
	primaryRemaining?: number;
	secondaryRemaining?: number;
	primaryAfterRequest?: number;
	secondaryAfterRequest?: number;
	primaryGuardRemaining?: number;
	secondaryGuardRemaining?: number;
	bottleneckAfterRequest: number;
	bottleneckAfterGuard: number;
}

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

function isBetterCapacityFirstCandidate(
	candidate: CapacityFirstCandidate,
	best: CapacityFirstCandidate | undefined,
): boolean {
	if (!best) return true;
	if (candidate.classRank !== best.classRank) {
		return candidate.classRank < best.classRank;
	}
	if (candidate.knownCount !== best.knownCount) {
		return candidate.knownCount > best.knownCount;
	}
	if (candidate.fitDistance !== best.fitDistance) {
		return candidate.fitDistance < best.fitDistance;
	}
	if (candidate.asymmetry !== best.asymmetry) {
		return candidate.asymmetry < best.asymmetry;
	}
	if (candidate.staleRank !== best.staleRank) {
		return candidate.staleRank < best.staleRank;
	}
	if (candidate.untouchedRank !== best.untouchedRank) {
		return candidate.untouchedRank < best.untouchedRank;
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

function normalizeRequestCostEstimatePercent(
	value: unknown,
): number | undefined {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < 0 ||
		value > 100
	) {
		return undefined;
	}
	return value;
}

function getRemainingPercent(usedPercent?: number): number | undefined {
	if (typeof usedPercent !== "number" || Number.isNaN(usedPercent)) {
		return undefined;
	}
	return Math.max(0, 100 - usedPercent);
}

function getUsageAgeMs(
	usage: CodexUsageSnapshot | undefined,
	now: number,
): number | undefined {
	if (!usage) return undefined;
	return Math.max(0, now - usage.fetchedAt);
}

function isStaleUsage(
	usage: CodexUsageSnapshot | undefined,
	now: number,
): boolean {
	const age = getUsageAgeMs(usage, now);
	return typeof age === "number" && age >= USAGE_STALE_TTL_MS;
}

export function analyzeCapacityFirstAccount(
	usage: CodexUsageSnapshot | undefined,
	now: number,
	requestCostEstimatePercent: number | undefined,
): CapacityFirstAnalysis {
	const requestCost = requestCostEstimatePercent ?? 0;
	const primaryRemaining = getRemainingPercent(usage?.primary?.usedPercent);
	const secondaryRemaining = getRemainingPercent(usage?.secondary?.usedPercent);
	const knownRems = [primaryRemaining, secondaryRemaining].filter(
		(value): value is number => typeof value === "number",
	);
	const knownCount = knownRems.length;
	const afterRequest = knownRems.map((remaining) => remaining - requestCost);
	const afterGuard = afterRequest.map(
		(remaining) => remaining - CAPACITY_FIRST_GUARD_BAND_PERCENT,
	);
	const bottleneckAfterRequest =
		afterRequest.length > 0 ? Math.min(...afterRequest) : Number.POSITIVE_INFINITY;
	const bottleneckAfterGuard =
		afterGuard.length > 0 ? Math.min(...afterGuard) : Number.POSITIVE_INFINITY;
	let fitClass: CapacityFitClass = "unknown-fit";
	if (knownCount === 2) {
		const primaryAfterRequest = (primaryRemaining ?? 0) - requestCost;
		const secondaryAfterRequest = (secondaryRemaining ?? 0) - requestCost;
		const primaryAfterGuard = primaryAfterRequest - CAPACITY_FIRST_GUARD_BAND_PERCENT;
		const secondaryAfterGuard = secondaryAfterRequest - CAPACITY_FIRST_GUARD_BAND_PERCENT;
		if (primaryAfterGuard >= 0 && secondaryAfterGuard >= 0) {
			fitClass = "guarded-fit";
		} else if (primaryAfterRequest >= 0 && secondaryAfterRequest >= 0) {
			fitClass = "raw-fit";
		} else {
			fitClass = "risky-fit";
		}
	}
	const classRank =
		fitClass === "guarded-fit"
			? 0
			: fitClass === "raw-fit"
				? 1
				: fitClass === "risky-fit"
					? 2
					: 3;
	const asymmetry =
		knownCount === 2 && primaryRemaining !== undefined && secondaryRemaining !== undefined
			? Math.abs(primaryRemaining - secondaryRemaining)
			: Number.POSITIVE_INFINITY;
	const fitDistance = Number.isFinite(bottleneckAfterGuard)
		? Math.abs(bottleneckAfterGuard)
		: Number.MAX_SAFE_INTEGER;
	return {
		fitClass,
		classRank,
		fitDistance,
		knownCount,
		asymmetry,
		stale: isStaleUsage(usage, now),
		untouched: Boolean(usage && isUsageUntouched(usage)),
		requestCostEstimatePercent: requestCost,
		guardBandPercent: CAPACITY_FIRST_GUARD_BAND_PERCENT,
		primaryRemaining: primaryRemaining,
		secondaryRemaining: secondaryRemaining,
		primaryAfterRequest: primaryRemaining === undefined ? undefined : primaryRemaining - requestCost,
		secondaryAfterRequest: secondaryRemaining === undefined ? undefined : secondaryRemaining - requestCost,
		primaryGuardRemaining:
			primaryRemaining === undefined
				? undefined
				: primaryRemaining - requestCost - CAPACITY_FIRST_GUARD_BAND_PERCENT,
		secondaryGuardRemaining:
			secondaryRemaining === undefined
				? undefined
				: secondaryRemaining - requestCost - CAPACITY_FIRST_GUARD_BAND_PERCENT,
		bottleneckAfterRequest,
		bottleneckAfterGuard,
	};
}

function createCapacityFirstCandidate(
	account: Account,
	usage: CodexUsageSnapshot | undefined,
	index: number,
	now: number,
	requestCostEstimatePercent: number | undefined,
): CapacityFirstCandidate {
	const analysis = analyzeCapacityFirstAccount(
		usage,
		now,
		requestCostEstimatePercent,
	);
	return {
		account,
		...analysis,
		staleRank: analysis.stale ? 1 : 0,
		untouchedRank: analysis.untouched ? 0 : 1,
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
		requestCostEstimatePercent?: number;
	},
): Account | undefined {
	const now = options?.now ?? Date.now();
	const rotation = options?.rotation ?? DEFAULT_ROTATION_SETTINGS;
	const requestCostEstimatePercent = normalizeRequestCostEstimatePercent(
		options?.requestCostEstimatePercent,
	);
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
	let bestCapacityFirstGuarded: CapacityFirstCandidate | undefined;
	let bestCapacityFirstFallback: CapacityFirstCandidate | undefined;

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

	if (rotation.selectionStrategy === "capacity-first") {
		for (let index = 0; index < accounts.length; index += 1) {
			const account = accounts[index];
			if (
				!isAccountAvailable(account, now) ||
				options?.excludeEmails?.has(account.email)
			) {
				continue;
			}
			const usage = usageByEmail.get(account.email);
			const candidate = createCapacityFirstCandidate(
				account,
				usage,
				index,
				now,
				requestCostEstimatePercent,
			);
			if (candidate.classRank === 0) {
				if (
					isBetterCapacityFirstCandidate(
						candidate,
						bestCapacityFirstGuarded,
					)
				) {
					bestCapacityFirstGuarded = candidate;
				}
				continue;
			}
			if (!rotation.guardRelaxation) continue;
			if (
				isBetterCapacityFirstCandidate(
					candidate,
					bestCapacityFirstFallback,
				)
			) {
				bestCapacityFirstFallback = candidate;
			}
		}

		if (bestCapacityFirstGuarded) {
			return bestCapacityFirstGuarded.account;
		}
		if (rotation.guardRelaxation) {
			return bestCapacityFirstFallback?.account;
		}
		return undefined;
	}

	const useUntouched = rotation.preferUntouched && untouchedCount > 0;
	if (rotation.selectionStrategy === "stable-weekly") {
		const best = useUntouched ? bestStableUntouched : bestStableWithUsage;
		if (best) return best.account;
		return useUntouched ? untouchedRandom : withUsageRandom;
	}

	const best = useUntouched ? bestLowestUntouched : bestLowestWithUsage;
	return best?.account ?? (useUntouched ? untouchedRandom : withUsageRandom);
}
