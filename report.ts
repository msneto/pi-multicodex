import type { AccountManager } from "./account-manager";
import {
	getStableWeeklyTier,
	hasWeeklyQuota,
	isAccountAvailable,
	pickBestAccount,
} from "./selection";
import type { Account } from "./storage";
import {
	type CodexUsageSnapshot,
	getMaxUsedPercent,
	getWeeklyResetAt,
	isUsageUntouched,
} from "./usage";
import {
	createUsageHistoryLookup,
	estimateUsagePaceFromLookup,
	formatLookbackPaceLine,
	loadUsageHistory,
	type UsageHistoryLookup,
} from "./usage-history";

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

function formatBlockedAccountsLine(
	accounts: Account[],
	usageByEmail: Map<string, CodexUsageSnapshot>,
): string | undefined {
	const blockedAccounts: string[] = [];
	for (const account of accounts) {
		const usage = usageByEmail.get(account.email);
		if (!usage) continue;
		const windows: string[] = [];
		if (
			typeof usage.primary?.usedPercent === "number" &&
			usage.primary.usedPercent >= 100
		) {
			windows.push("5h 0%");
		}
		if (
			typeof usage.secondary?.usedPercent === "number" &&
			usage.secondary.usedPercent >= 100
		) {
			windows.push("7d 0%");
		}
		if (windows.length > 0) {
			blockedAccounts.push(`${account.email} (${windows.join(", ")})`);
		}
	}
	if (blockedAccounts.length === 0) return undefined;
	return `blocked: ${blockedAccounts.join("; ")}`;
}

function formatCapacityWindowLine(
	label: string,
	summary: ReturnType<typeof summarizeWindow>,
): string {
	const reset =
		summary.soonestResetAt !== undefined
			? `, reset ${formatCountdown(summary.soonestResetAt)}`
			: "";
	if (summary.knownCount === 0 && summary.unknownCount > 0) {
		return `${label}: unknown${reset}`;
	}
	const equivalentAccounts = Math.round(summary.remainingTotal) / 100;
	const equivalentLabel = Number.isInteger(equivalentAccounts)
		? String(equivalentAccounts)
		: equivalentAccounts.toFixed(1);
	const accountLabel = equivalentAccounts === 1 ? "account" : "accounts";
	return `${label}: ~${equivalentLabel} ${accountLabel}${reset}`;
}
function getReportTags(
	accountManager: AccountManager,
	account: Account,
	now: number,
	activeEmail: string | undefined,
	manualEmail: string | undefined,
	usageByEmail: Map<string, CodexUsageSnapshot>,
): string[] {
	const usage = usageByEmail.get(account.email);
	const tags = [
		activeEmail === account.email ? "active" : null,
		manualEmail === account.email ? "manual" : null,
		accountManager.isPiAuthAccount(account) ? "pi auth" : null,
		account.needsReauth ? "needs reauth" : null,
		account.quotaExhaustedUntil && account.quotaExhaustedUntil > now
			? "quota"
			: null,
		isUsageUntouched(usage) ? "untouched" : null,
	];
	const filtered: string[] = [];
	for (const tag of tags) {
		if (tag) filtered.push(tag);
	}
	return filtered;
}

function summarizeWindow(
	accounts: Account[],
	usageByEmail: Map<string, CodexUsageSnapshot>,
	window: "primary" | "secondary",
	now: number,
): {
	usableCount: number;
	knownCount: number;
	blockedCount: number;
	unknownCount: number;
	remainingTotal: number;
	soonestResetAt: number | undefined;
} {
	const available = accounts.filter(
		(account) => isAccountAvailable(account, now) && !account.needsReauth,
	);
	let knownCount = 0;
	let blockedCount = 0;
	let unknownCount = 0;
	let remainingTotal = 0;
	let soonestResetAt: number | undefined;

	for (const account of available) {
		const usage = usageByEmail.get(account.email);
		const primaryUsed = usage?.primary?.usedPercent;
		const secondaryUsed = usage?.secondary?.usedPercent;
		const windowUsage =
			window === "primary" ? usage?.primary : usage?.secondary;
		const isBlocked =
			(typeof primaryUsed === "number" && primaryUsed >= 100) ||
			(typeof secondaryUsed === "number" && secondaryUsed >= 100);
		if (isBlocked) {
			blockedCount += 1;
			continue;
		}
		if (typeof windowUsage?.usedPercent === "number") {
			remainingTotal += Math.max(0, 100 - windowUsage.usedPercent);
			knownCount += 1;
		} else {
			unknownCount += 1;
		}
		if (typeof windowUsage?.resetAt === "number") {
			soonestResetAt =
				soonestResetAt === undefined
					? windowUsage.resetAt
					: Math.min(soonestResetAt, windowUsage.resetAt);
		}
	}

	return {
		usableCount: available.length - blockedCount,
		knownCount,
		blockedCount,
		unknownCount,
		remainingTotal,
		soonestResetAt,
	};
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

function formatQuotaSnapshotSection(
	accounts: Account[],
	activeEmail: string | undefined,
	usageByEmail: Map<string, CodexUsageSnapshot>,
): string[] {
	const lines = ["quota snapshot:"];
	for (const account of accounts) {
		const usage = usageByEmail.get(account.email);
		const activeTag = activeEmail === account.email ? " [active]" : "";
		lines.push(`  - ${account.email}${activeTag}`);
		if (!usage) {
			lines.push("    - no cached usage");
			continue;
		}
		lines.push(`    - 5h: ${formatUsageLine(usage.primary)}`);
		lines.push(`    - 7d: ${formatUsageLine(usage.secondary)}`);
	}
	return lines;
}

function formatUsagePaceSection(
	accounts: Account[],
	lookup: UsageHistoryLookup,
	now: number,
	activeEmail: string | undefined,
): string[] {
	const lines = ["usage pace:"];
	for (const account of accounts) {
		const activeTag = activeEmail === account.email ? " [active]" : "";
		lines.push(`  - ${account.email}${activeTag}`);
		lines.push("    - 5h pace");
		lines.push(
			`      - ${formatLookbackPaceLine(
				"5h",
				estimateUsagePaceFromLookup(lookup, account.email, "primary", now),
			)}`,
		);
		lines.push("    - 7d pace");
		lines.push(
			`      - ${formatLookbackPaceLine(
				"7d",
				estimateUsagePaceFromLookup(lookup, account.email, "secondary", now),
			)}`,
		);
	}
	return lines;
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
): {
	tier: number;
	score: number;
	usedPercent: number;
	resetAt: number;
	hoursLeft: number;
} {
	const tier = getStableWeeklyTier(usage);
	const usedPercent = usage?.secondary?.usedPercent ?? 100;
	const resetAt = usage?.secondary?.resetAt ?? Number.MAX_SAFE_INTEGER;
	const remainingFraction = Math.max(0, 1 - usedPercent / 100);
	const hoursLeft = Math.max((resetAt - now) / 3_600_000, 0.01);
	const score = remainingFraction - hoursLeft / 168;
	return { tier, score, usedPercent, resetAt, hoursLeft };
}

function formatStableWeeklyTierLabel(tier: number): string {
	if (tier === 0) return "5h healthy (>30% left)";
	if (tier === 1) return "5h warm (10-30% left)";
	if (tier === 2) return "5h hot (0-10% left)";
	return "5h empty (0% left)";
}

function sortStableWeeklyAccounts(
	accounts: Account[],
	usageByEmail: Map<string, CodexUsageSnapshot>,
	now: number,
): Array<{
	account: Account;
	index: number;
	tier: number;
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
			const tierDiff = a.tier - b.tier;
			if (tierDiff !== 0) return tierDiff;
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
	activeEmail: string | undefined,
	manualEmail: string | undefined,
	usageByEmail: Map<string, CodexUsageSnapshot>,
): string {
	const tags = getReportTags(
		accountManager,
		account,
		now,
		activeEmail,
		manualEmail,
		usageByEmail,
	);
	return `  - ${account.email}${tags.length > 0 ? ` [${tags.join(", ")}]` : ""}`;
}

function formatAccountReasonLine(reason: string): string {
	return `    - ${reason}`;
}

function formatRankingDecisionSection(
	accountManager: AccountManager,
	accounts: Account[],
	usageByEmail: Map<string, CodexUsageSnapshot>,
	now: number,
	activeAccount: Account | undefined,
	manualAccount: Account | undefined,
): string[] {
	const rotation = accountManager.getRotationPreferences();
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
	const stableRankable = rankable.filter((account) =>
		hasWeeklyQuota(usageByEmail.get(account.email)),
	);
	const rankableEmailSet = new Set(rankable.map((account) => account.email));
	const stableRankableEmailSet = new Set(
		stableRankable.map((account) => account.email),
	);
	const stableWeeklyRandomFallback =
		rotation.selectionStrategy === "stable-weekly" && stableRankable.length === 0;
	const randomFallbackBecauseNoUsage = availableWithUsage.length === 0;
	const mode = !activeAccount
		? "none"
		: manualAccount?.email === activeAccount.email
			? "manual"
			: accountManager.isPiAuthAccount(activeAccount)
				? "pi-auth"
				: stableWeeklyRandomFallback || randomFallbackBecauseNoUsage
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
			stableWeeklyRandomFallback && !randomFallbackBecauseNoUsage
				? "  - reason: stable-weekly had no weekly-quota candidates, so rotation fell back to random"
				: "  - reason: no cached usage for available accounts, so rotation could not rank them",
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
			? sortStableWeeklyAccounts(stableRankable, usageByEmail, now)
			: [];
	const stableWinner = stableRanking[0];

	for (const account of accounts) {
		const usage = usageByEmail.get(account.email);
		const eligible = isAccountAvailable(account, now) && !account.needsReauth;
		const isActive = activeAccount?.email === account.email;
		const isSelected = selectedEmail === account.email;
		const inRankable = rankableEmailSet.has(account.email);
		const inStableRankable = stableRankableEmailSet.has(account.email);

		lines.push(
			formatAccountHeader(
				accountManager,
				account,
				now,
				activeAccount?.email,
				manualAccount?.email,
				usageByEmail,
			),
		);

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

		if (!inStableRankable) {
			lines.push(
				formatAccountReasonLine(
					usage?.secondary?.usedPercent !== undefined &&
						usage.secondary.usedPercent >= 100
						? "lost: no weekly quota left, 5h ignored"
						: rotation.preferUntouched &&
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
		lines.push(
			formatAccountReasonLine(
				`5h tier: ${formatStableWeeklyTierLabel(entry.tier)}`,
			),
		);
		lines.push(
			formatAccountReasonLine(`weekly score: ${entry.score.toFixed(3)}`),
		);
		lines.push(
			formatAccountReasonLine(
				`weekly reset: ${formatCountdown(entry.resetAt)} (${entry.hoursLeft.toFixed(1)}h left)`,
			),
		);
		if (isSelected) {
			lines.push(
				formatAccountReasonLine(
					"why: best 5h tier, then best weekly score among rankable accounts",
				),
			);
		} else if (stableWinner) {
			if (entry.tier !== stableWinner.tier) {
				lines.push(formatAccountReasonLine(`lost: worse 5h tier than winner`));
			} else {
				const scoreGap = stableWinner.score - entry.score;
				lines.push(
					formatAccountReasonLine(
						`lost: same 5h tier, weekly score is ${scoreGap.toFixed(3)} below winner`,
					),
				);
			}
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

	const usageByEmail = buildUsageIndex(accountManager, accounts);
	const activeAccount = accountManager.getActiveAccount();
	const manualAccount = accountManager.getManualAccount();
	const historyLookup = createUsageHistoryLookup(loadUsageHistory());

	const primarySummary = summarizeWindow(
		accounts,
		usageByEmail,
		"primary",
		now,
	);
	const secondarySummary = summarizeWindow(
		accounts,
		usageByEmail,
		"secondary",
		now,
	);

	const blockedLine = formatBlockedAccountsLine(accounts, usageByEmail);
	return [
		...formatQuotaSnapshotSection(accounts, activeAccount?.email, usageByEmail),
		"\u200B",
		...formatUsagePaceSection(
			accounts,
			historyLookup,
			now,
			activeAccount?.email,
		),
		"\u200B",
		...formatRankingDecisionSection(
			accountManager,
			accounts,
			usageByEmail,
			now,
			activeAccount,
			manualAccount,
		),

		"\u200B",
		"capacity estimate:",
		...(blockedLine ? [`  - ${blockedLine}`] : []),
		`  - ${formatCapacityWindowLine("5h", primarySummary)}`,
		`  - ${formatCapacityWindowLine("7d", secondarySummary)}`,
	];
}
