import type { AccountManager } from "./account-manager";
import { isAccountAvailable, pickBestAccount } from "./selection";
import type { Account } from "./storage";
import {
	type CodexUsageSnapshot,
	getMaxUsedPercent,
	getWeeklyResetAt,
	isUsageUntouched,
} from "./usage";

function clampPercent(value: number): number {
	return Math.min(100, Math.max(0, value));
}

function formatCountdown(resetAt?: number): string {
	if (typeof resetAt !== "number" || Number.isNaN(resetAt)) return "unknown";
	const totalSeconds = Math.max(0, Math.round((resetAt - Date.now()) / 1000));
	const days = Math.floor(totalSeconds / 86_400);
	const hours = Math.floor((totalSeconds % 86_400) / 3_600);
	const minutes = Math.floor((totalSeconds % 3_600) / 60);
	const seconds = totalSeconds % 60;
	if (days > 0) return `${days}d${hours}h`;
	if (hours > 0) return `${hours}h${minutes}m`;
	if (minutes > 0) return `${minutes}m`;
	return `${seconds}s`;
}

function formatPercent(value?: number): string {
	if (typeof value !== "number" || Number.isNaN(value)) return "--";
	return `${Math.round(clampPercent(value))}%`;
}

function formatRemainingPercent(usedPercent?: number): string {
	if (typeof usedPercent !== "number" || Number.isNaN(usedPercent)) {
		return "--";
	}
	return `${Math.round(clampPercent(100 - usedPercent))}% left`;
}

function formatUsageLine(window?: {
	usedPercent?: number;
	resetAt?: number;
}): string {
	return `${formatRemainingPercent(window?.usedPercent)} (used ${formatPercent(window?.usedPercent)}, reset ${formatCountdown(window?.resetAt)})`;
}

function getReportTags(
	accountManager: AccountManager,
	account: Account,
	now: number,
): string[] {
	const usage = accountManager.getCachedUsage(account.email);
	return [
		accountManager.getActiveAccount()?.email === account.email
			? "active"
			: null,
		accountManager.getManualAccount()?.email === account.email
			? "manual"
			: null,
		accountManager.isPiAuthAccount(account) ? "pi auth" : null,
		account.needsReauth ? "needs reauth" : null,
		account.quotaExhaustedUntil && account.quotaExhaustedUntil > now
			? "quota"
			: null,
		isUsageUntouched(usage) ? "untouched" : null,
	].filter((value): value is string => Boolean(value));
}

function summarizeWindow(
	accountManager: AccountManager,
	accounts: Account[],
	window: "primary" | "secondary",
	now: number,
): {
	availableCount: number;
	knownCount: number;
	unknownCount: number;
	remainingTotal: number;
	soonestResetAt: number | undefined;
} {
	const available = accounts.filter(
		(account) => isAccountAvailable(account, now) && !account.needsReauth,
	);
	let knownCount = 0;
	let unknownCount = 0;
	let remainingTotal = 0;
	let soonestResetAt: number | undefined;

	for (const account of available) {
		const usage = accountManager.getCachedUsage(account.email);
		const usageWindow =
			window === "primary" ? usage?.primary : usage?.secondary;
		if (typeof usageWindow?.usedPercent === "number") {
			remainingTotal += Math.max(0, 100 - usageWindow.usedPercent);
			knownCount += 1;
		} else {
			unknownCount += 1;
		}
		if (typeof usageWindow?.resetAt === "number") {
			soonestResetAt =
				soonestResetAt === undefined
					? usageWindow.resetAt
					: Math.min(soonestResetAt, usageWindow.resetAt);
		}
	}

	return {
		availableCount: available.length,
		knownCount,
		unknownCount,
		remainingTotal,
		soonestResetAt,
	};
}

function formatWindowSummary(
	label: string,
	summary: ReturnType<typeof summarizeWindow>,
): string {
	const reset =
		summary.soonestResetAt !== undefined
			? `; next reset ${formatCountdown(summary.soonestResetAt)}`
			: "";
	const unknown =
		summary.unknownCount > 0 ? `, ${summary.unknownCount} unknown` : "";
	const equivalentAccounts = Math.round(summary.remainingTotal) / 100;
	const equivalentLabel = Number.isInteger(equivalentAccounts)
		? String(equivalentAccounts)
		: equivalentAccounts.toFixed(1);
	const accountLabel = summary.availableCount === 1 ? "account" : "accounts";
	return `${label}: about ${equivalentLabel} full ${accountLabel} worth of combined capacity across ${summary.availableCount} ${accountLabel} (${summary.knownCount} known${unknown})${reset}`;
}

function buildUsageIndex(
	accountManager: AccountManager,
	accounts: Account[],
): Map<string, CodexUsageSnapshot> {
	const usageByEmail = new Map<string, CodexUsageSnapshot>();
	for (const account of accounts) {
		const usage = accountManager.getCachedUsage(account.email);
		if (usage) usageByEmail.set(account.email, usage);
	}
	return usageByEmail;
}

function sortLowestUsageAccounts(
	accounts: Account[],
	usageByEmail: Map<string, CodexUsageSnapshot>,
): Array<{
	account: Account;
	index: number;
	maxUsedPercent: number;
	weeklyResetAt: number;
}> {
	return accounts
		.map((account, index) => ({
			account,
			index,
			maxUsedPercent: getMaxUsedPercent(usageByEmail.get(account.email)) ?? 100,
			weeklyResetAt:
				getWeeklyResetAt(usageByEmail.get(account.email)) ??
				Number.MAX_SAFE_INTEGER,
		}))
		.sort((a, b) => {
			const usageDiff = a.maxUsedPercent - b.maxUsedPercent;
			if (usageDiff !== 0) return usageDiff;
			const resetDiff = a.weeklyResetAt - b.weeklyResetAt;
			if (resetDiff !== 0) return resetDiff;
			return a.index - b.index;
		});
}

function scoreStableWeekly(
	usage: CodexUsageSnapshot | undefined,
	now: number,
): { score: number; usedPercent: number; resetAt: number; hoursLeft: number } {
	const usedPercent = usage?.secondary?.usedPercent ?? 100;
	const resetAt = usage?.secondary?.resetAt ?? Number.MAX_SAFE_INTEGER;
	const remainingFraction = Math.max(0, 1 - usedPercent / 100);
	const hoursLeft = Math.max((resetAt - now) / 3_600_000, 0.01);
	const score = remainingFraction - hoursLeft / 168;
	return { score, usedPercent, resetAt, hoursLeft };
}

function sortStableWeeklyAccounts(
	accounts: Account[],
	usageByEmail: Map<string, CodexUsageSnapshot>,
	now: number,
): Array<{
	account: Account;
	index: number;
	score: number;
	usedPercent: number;
	resetAt: number;
	hoursLeft: number;
}> {
	return accounts
		.map((account, index) => {
			const metrics = scoreStableWeekly(usageByEmail.get(account.email), now);
			return { account, index, ...metrics };
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
}

function formatAccountHeader(
	accountManager: AccountManager,
	account: Account,
	now: number,
): string {
	const tags = getReportTags(accountManager, account, now);
	return `  - ${account.email}${tags.length > 0 ? ` [${tags.join(", ")}]` : ""}`;
}

function formatAccountReasonLine(reason: string): string {
	return `    - ${reason}`;
}

function formatRankingDecisionSection(
	accountManager: AccountManager,
	accounts: Account[],
	now: number,
): string[] {
	const rotation = accountManager.getRotationPreferences();
	const activeAccount = accountManager.getActiveAccount();
	const manualAccount = accountManager.getManualAccount();
	const usageByEmail = buildUsageIndex(accountManager, accounts);
	const available = accounts.filter(
		(account) => isAccountAvailable(account, now) && !account.needsReauth,
	);
	const availableWithUsage = available.filter((account) =>
		usageByEmail.has(account.email),
	);
	const selected = pickBestAccount(available, usageByEmail, { now, rotation });
	const selectedEmail = selected?.email;
	const untouchedRankable = availableWithUsage.filter((account) =>
		isUsageUntouched(usageByEmail.get(account.email)),
	);
	const rankable =
		rotation.preferUntouched && untouchedRankable.length > 0
			? untouchedRankable
			: availableWithUsage;
	const rankableEmailSet = new Set(rankable.map((account) => account.email));
	const mode = !activeAccount
		? "none"
		: manualAccount?.email === activeAccount.email
			? "manual"
			: accountManager.isPiAuthAccount(activeAccount)
				? "pi-auth"
				: availableWithUsage.length === 0
					? "random"
					: rotation.selectionStrategy;

	const lines: string[] = ["decision:"];
	if (!activeAccount) {
		lines.push("  - active: none");
		lines.push("  - reason: no active account set yet");
	} else if (mode === "manual") {
		lines.push(`  - active: ${activeAccount.email} (manual override)`);
		lines.push("  - reason: manual pin wins over rotation");
	} else if (mode === "pi-auth") {
		lines.push(`  - active: ${activeAccount.email} (ephemeral pi auth)`);
		lines.push(
			"  - reason: imported pi auth stays active until managed account replaces it",
		);
	} else if (mode === "random") {
		lines.push(`  - active: ${activeAccount.email} (random fallback)`);
		lines.push(
			"  - reason: no cached usage for available accounts, so rotation could not rank them",
		);
	} else {
		lines.push(`  - active: ${activeAccount.email}`);
		if (selectedEmail) {
			lines.push(`  - current best: ${selectedEmail}`);
		}
		lines.push(
			`  - rule: ${rotation.selectionStrategy}${rotation.preferUntouched ? " + untouched preference" : ""}`,
		);
	}

	if (rotation.preferUntouched) {
		if (availableWithUsage.length === 0) {
			lines.push("  - untouched filter: no usage-backed candidates");
		} else if (untouchedRankable.length > 0) {
			lines.push(
				`  - untouched filter: ${availableWithUsage.length} usage-backed -> ${rankable.length} rankable`,
			);
		} else {
			lines.push(
				`  - untouched filter: no untouched candidates, so rotation fell back to all ${availableWithUsage.length} usage-backed candidate(s)`,
			);
		}
	}

	lines.push("");
	lines.push("why each account won or lost:");

	const lowestRanking =
		mode === "lowest-usage"
			? sortLowestUsageAccounts(rankable, usageByEmail)
			: [];
	const lowestWinner = lowestRanking[0];
	const stableRanking =
		mode === "stable-weekly"
			? sortStableWeeklyAccounts(rankable, usageByEmail, now)
			: [];
	const stableWinner = stableRanking[0];

	for (const account of accounts) {
		const usage = usageByEmail.get(account.email);
		const eligible = isAccountAvailable(account, now) && !account.needsReauth;
		const isActive = activeAccount?.email === account.email;
		const isSelected = selectedEmail === account.email;
		const inRankable = rankableEmailSet.has(account.email);

		lines.push(formatAccountHeader(accountManager, account, now));

		if (!eligible) {
			lines.push(formatAccountReasonLine("skipped: not eligible right now"));
			continue;
		}

		if (!usage) {
			lines.push(formatAccountReasonLine("eligible, but no cached usage"));
			if (mode === "random") {
				lines.push(
					formatAccountReasonLine(
						"random fallback can pick it, but no usage score exists",
					),
				);
			} else {
				lines.push(
					formatAccountReasonLine(
						"rotation would only rank it after usage arrives",
					),
				);
			}
			continue;
		}

		lines.push(
			formatAccountReasonLine(`5h: ${formatUsageLine(usage.primary)}`),
		);
		lines.push(
			formatAccountReasonLine(`7d: ${formatUsageLine(usage.secondary)}`),
		);

		if (mode === "manual") {
			lines.push(
				formatAccountReasonLine(
					isActive
						? "why: manual pin keeps this account active"
						: "lost: manual pin overrides rotation for another account",
				),
			);
			continue;
		}

		if (mode === "pi-auth") {
			lines.push(
				formatAccountReasonLine(
					isActive
						? "why: ephemeral pi auth is currently active"
						: "lost: imported pi auth keeps session on active account",
				),
			);
			continue;
		}

		if (mode === "random") {
			lines.push(
				formatAccountReasonLine(
					isActive
						? "why: random fallback picked this eligible account"
						: "lost: random fallback picked another eligible account",
				),
			);
			continue;
		}

		if (mode === "lowest-usage") {
			if (!inRankable) {
				lines.push(
					formatAccountReasonLine(
						rotation.preferUntouched &&
							untouchedRankable.length > 0 &&
							usage &&
							!isUsageUntouched(usage)
							? "lost: touched account, untouched account won"
							: "lost: filtered out before lowest-usage ranking",
					),
				);
				continue;
			}
			const entry = lowestRanking.find(
				(item) => item.account.email === account.email,
			);
			if (!entry) {
				lines.push(
					formatAccountReasonLine(
						"lost: filtered out before lowest-usage ranking",
					),
				);
				continue;
			}
			lines.push(
				formatAccountReasonLine(
					`max used: ${formatPercent(entry.maxUsedPercent)}`,
				),
			);
			lines.push(
				formatAccountReasonLine(
					`weekly reset: ${formatCountdown(entry.weeklyResetAt)}`,
				),
			);
			if (isSelected) {
				lines.push(
					formatAccountReasonLine(
						"why: lowest max usage among rankable accounts",
					),
				);
			} else if (lowestWinner) {
				const usageGap = entry.maxUsedPercent - lowestWinner.maxUsedPercent;
				if (usageGap !== 0) {
					lines.push(
						formatAccountReasonLine(
							`lost: max used is ${formatPercent(usageGap)} higher than winner`,
						),
					);
				} else if (entry.weeklyResetAt !== lowestWinner.weeklyResetAt) {
					lines.push(
						formatAccountReasonLine(
							"lost: same usage, but later weekly reset than winner",
						),
					);
				} else {
					lines.push(
						formatAccountReasonLine(
							"lost: same usage/reset, later in original order",
						),
					);
				}
			}
			continue;
		}

		if (!inRankable) {
			lines.push(
				formatAccountReasonLine(
					rotation.preferUntouched &&
						untouchedRankable.length > 0 &&
						usage &&
						!isUsageUntouched(usage)
						? "lost: touched account, untouched account won"
						: "lost: filtered out before stable-weekly ranking",
				),
			);
			continue;
		}
		const entry = stableRanking.find(
			(item) => item.account.email === account.email,
		);
		if (!entry) {
			lines.push(
				formatAccountReasonLine(
					"lost: filtered out before stable-weekly ranking",
				),
			);
			continue;
		}
		lines.push(formatAccountReasonLine(`score: ${entry.score.toFixed(3)}`));
		lines.push(
			formatAccountReasonLine(
				`reset: ${formatCountdown(entry.resetAt)} (${entry.hoursLeft.toFixed(1)}h left)`,
			),
		);
		if (isSelected) {
			lines.push(
				formatAccountReasonLine(
					"why: highest weekly-burn score among rankable accounts",
				),
			);
		} else if (stableWinner) {
			const scoreGap = stableWinner.score - entry.score;
			lines.push(
				formatAccountReasonLine(
					`lost: score is ${scoreGap.toFixed(3)} below winner`,
				),
			);
		}
	}

	return lines;
}

export function formatAccountReportLines(
	accountManager: AccountManager,
): string[] {
	const now = Date.now();
	const accounts = accountManager.getAccounts();
	if (accounts.length === 0) {
		return ["no managed accounts found"];
	}

	const primarySummary = summarizeWindow(
		accountManager,
		accounts,
		"primary",
		now,
	);
	const secondarySummary = summarizeWindow(
		accountManager,
		accounts,
		"secondary",
		now,
	);

	return [
		...formatRankingDecisionSection(accountManager, accounts, now),

		"\u200B",
		"capacity estimate:",
		`  - ${formatWindowSummary("5h aggregate", primarySummary)}`,
		`  - ${formatWindowSummary("7d aggregate", secondarySummary)}`,
	];
}
