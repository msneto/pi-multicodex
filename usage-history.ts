import * as fs from "node:fs";
import * as path from "node:path";
import { MULTICODEX_USAGE_HISTORY_FILE } from "./paths";

const CURRENT_VERSION = 1;
const MAX_SAMPLE_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_SAMPLES_PER_EMAIL = 300;
const LOOKBACKS_MS = [5 * 60 * 1000, 10 * 60 * 1000, 30 * 60 * 1000, 60 * 60 * 1000] as const;

let cachedHistory: UsageHistoryData | undefined;

export interface UsageWindow {
	usedPercent?: number;
	resetAt?: number;
}

export interface UsageHistorySample {
	ts: number;
	email: string;
	primary?: UsageWindow;
	secondary?: UsageWindow;
}

export interface UsageHistoryData {
	version: number;
	samples: UsageHistorySample[];
}

export type UsageWindowKey = "primary" | "secondary";

export interface PaceLookback {
	lookbackMs: number;
	ratePerHour?: number;
}

export interface PaceEstimate {
	window: UsageWindowKey;
	email: string;
	currentUsedPercent?: number;
	currentRemainingPercent?: number;
	lookbacks: PaceLookback[];
	burnRatePerHour?: number;
	runwayHours?: number;
}

function asObject(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function normalizeWindow(value: unknown): UsageWindow | undefined {
	const record = asObject(value);
	if (!record) return undefined;
	const window: UsageWindow = {};
	if (isFiniteNumber(record.usedPercent)) window.usedPercent = record.usedPercent;
	if (isFiniteNumber(record.resetAt)) window.resetAt = record.resetAt;
	return Object.keys(window).length > 0 ? window : undefined;
}

function normalizeSample(value: unknown): UsageHistorySample | undefined {
	const record = asObject(value);
	if (!record) return undefined;
	if (!isFiniteNumber(record.ts) || typeof record.email !== "string" || !record.email.trim()) {
		return undefined;
	}
	const sample: UsageHistorySample = {
		ts: record.ts,
		email: record.email.trim(),
	};
	const primary = normalizeWindow(record.primary);
	const secondary = normalizeWindow(record.secondary);
	if (primary) sample.primary = primary;
	if (secondary) sample.secondary = secondary;
	return sample;
}

function normalizeHistory(value: unknown): UsageHistoryData {
	const record = asObject(value);
	if (!record) return { version: CURRENT_VERSION, samples: [] };
	const samples = Array.isArray(record.samples)
		? record.samples.flatMap((sample) => {
			const normalized = normalizeSample(sample);
			return normalized ? [normalized] : [];
		})
		: [];
	return { version: CURRENT_VERSION, samples };
}

function ensureDirectory(filePath: string): void {
	const directory = path.dirname(filePath);
	if (!fs.existsSync(directory)) {
		fs.mkdirSync(directory, { recursive: true });
	}
}

function saveHistory(data: UsageHistoryData): void {
	cachedHistory = data;
	try {
		ensureDirectory(MULTICODEX_USAGE_HISTORY_FILE);
		fs.writeFileSync(MULTICODEX_USAGE_HISTORY_FILE, `${JSON.stringify(data, null, 2)}\n`);
	} catch (error) {
		console.error("Failed to save multicodex usage history:", error);
	}
}

function readHistoryFile(): UsageHistoryData {
	if (cachedHistory) {
		return cachedHistory;
	}
	if (!fs.existsSync(MULTICODEX_USAGE_HISTORY_FILE)) {
		cachedHistory = { version: CURRENT_VERSION, samples: [] };
		return cachedHistory;
	}
	try {
		const raw = JSON.parse(fs.readFileSync(MULTICODEX_USAGE_HISTORY_FILE, "utf8")) as unknown;
		cachedHistory = normalizeHistory(raw);
		return cachedHistory;
	} catch {
		cachedHistory = { version: CURRENT_VERSION, samples: [] };
		return cachedHistory;
	}
}

function pruneSamples(samples: UsageHistorySample[], now: number): UsageHistorySample[] {
	const minTs = now - MAX_SAMPLE_AGE_MS;
	const byEmail = new Map<string, UsageHistorySample[]>();
	for (const sample of samples) {
		if (sample.ts < minTs) continue;
		const list = byEmail.get(sample.email) ?? [];
		list.push(sample);
		byEmail.set(sample.email, list);
	}

	const pruned: UsageHistorySample[] = [];
	for (const list of byEmail.values()) {
		list.sort((a, b) => a.ts - b.ts);
		const trimmed = list.length > MAX_SAMPLES_PER_EMAIL ? list.slice(list.length - MAX_SAMPLES_PER_EMAIL) : list;
		pruned.push(...trimmed);
	}

	return pruned.sort((a, b) => a.ts - b.ts || a.email.localeCompare(b.email));
}

function getWindowUsedPercent(sample: UsageHistorySample, window: UsageWindowKey): number | undefined {
	const usedPercent = sample[window]?.usedPercent;
	return typeof usedPercent === "number" && Number.isFinite(usedPercent)
		? Math.min(100, Math.max(0, usedPercent))
		: undefined;
}

function getWindowSamples(
	samples: UsageHistorySample[],
	email: string,
	window: UsageWindowKey,
): Array<{ ts: number; usedPercent: number }> {
	return samples
		.filter((sample) => sample.email === email)
		.map((sample) => ({ ts: sample.ts, usedPercent: getWindowUsedPercent(sample, window) }))
		.filter((sample): sample is { ts: number; usedPercent: number } => typeof sample.usedPercent === "number")
		.sort((a, b) => a.ts - b.ts);
}

function estimateLookbackRate(
	samples: Array<{ ts: number; usedPercent: number }>,
	lookbackMs: number,
	now: number,
): number | undefined {
	const cutoff = now - lookbackMs;
	const windowSamples = samples.filter((sample) => sample.ts >= cutoff);
	if (windowSamples.length < 2) return undefined;
	const first = windowSamples[0];
	const last = windowSamples[windowSamples.length - 1];
	const elapsedHours = (last.ts - first.ts) / 3_600_000;
	if (elapsedHours <= 0) return undefined;
	const delta = last.usedPercent - first.usedPercent;
	if (!Number.isFinite(delta) || delta <= 0) return 0;
	return delta / elapsedHours;
}

function formatLookbackRate(ratePerHour?: number): string {
	if (ratePerHour === undefined) return "unknown";
	return `${ratePerHour.toFixed(1)}%/h`;
}

function formatRunwayHours(runwayHours?: number): string {
	if (runwayHours === undefined) return "unknown";
	if (!Number.isFinite(runwayHours)) return "steady";
	if (runwayHours <= 0) return "now";
	if (runwayHours < 1) return `${Math.max(1, Math.round(runwayHours * 60))}m`;
	if (runwayHours < 48) return `${runwayHours.toFixed(1)}h`;
	return `${Math.round(runwayHours / 24)}d`;
}

export function loadUsageHistory(): UsageHistoryData {
	return readHistoryFile();
}

export function appendUsageHistorySample(sample: UsageHistorySample): UsageHistoryData {
	const data = readHistoryFile();
	data.samples.push(sample);
	const pruned = { ...data, samples: pruneSamples(data.samples, sample.ts) };
	saveHistory(pruned);
	return pruned;
}

export function getUsageHistorySamplesForAccount(data: UsageHistoryData, email: string): UsageHistorySample[] {
	return data.samples.filter((sample) => sample.email === email).sort((a, b) => a.ts - b.ts);
}

export function estimateUsagePace(
	data: UsageHistoryData,
	email: string,
	window: UsageWindowKey,
	now = Date.now(),
): PaceEstimate | undefined {
	const windowSamples = getWindowSamples(data.samples, email, window);
	if (windowSamples.length === 0) return undefined;

	const lookbacks = LOOKBACKS_MS.map((lookbackMs) => ({
		lookbackMs,
		ratePerHour: estimateLookbackRate(windowSamples, lookbackMs, now),
	}));
	const burnRatePerHour = Math.max(
		0,
		...lookbacks.flatMap((entry) => (typeof entry.ratePerHour === "number" ? [entry.ratePerHour] : [])),
	);
	const latest = windowSamples[windowSamples.length - 1];
	const currentUsedPercent = latest?.usedPercent;
	const currentRemainingPercent =
		typeof currentUsedPercent === "number" ? Math.max(0, 100 - currentUsedPercent) : undefined;
	const runwayHours =
		typeof currentRemainingPercent === "number" && burnRatePerHour > 0
			? currentRemainingPercent / burnRatePerHour
			: burnRatePerHour === 0 && typeof currentRemainingPercent === "number"
				? Number.POSITIVE_INFINITY
				: undefined;

	return {
		window,
		email,
		currentUsedPercent,
		currentRemainingPercent,
		lookbacks,
		burnRatePerHour,
		runwayHours,
	};
}

export function formatLookbackPaceLine(label: string, pace: PaceEstimate | undefined): string {
	if (!pace) return `${label}: unknown`;
	const lookbacks = pace.lookbacks
		.map((entry) => `${Math.round(entry.lookbackMs / 60000)}m ${formatLookbackRate(entry.ratePerHour)}`)
		.join(", ");
	return `${label}: ${lookbacks}; burn now ${formatLookbackRate(pace.burnRatePerHour)}; runway ${formatRunwayHours(pace.runwayHours)}`;
}
