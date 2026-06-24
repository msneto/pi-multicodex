import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getAgentSettingsPath } from "pi-provider-utils/agent-paths";
import { z } from "zod";

const SETTINGS_KEY = "pi-multicodex";
const SETTINGS_FILE = getAgentSettingsPath();

const SelectionStrategySchema = z.enum(["lowest-usage", "stable-weekly"]);
const RotationCooldownSchema = z.enum(["15m", "1h", "6h"]);
const RotationSettingsSchema = z
	.object({
		selectionStrategy: SelectionStrategySchema,
		preferUntouched: z.boolean(),
		unknownResetCooldown: RotationCooldownSchema,
		preStreamRetryLimit: z.number().int().min(0).max(10),
	})
	.meta({
		id: "RotationSettings",
		description: "MultiCodex rotation settings",
	});

export type SelectionStrategy = z.infer<typeof SelectionStrategySchema>;
export type RotationCooldown = z.infer<typeof RotationCooldownSchema>;
export type RotationSettings = z.infer<typeof RotationSettingsSchema>;

export const DEFAULT_ROTATION_SETTINGS: RotationSettings = {
	selectionStrategy: "lowest-usage",
	preferUntouched: true,
	unknownResetCooldown: "1h",
	preStreamRetryLimit: 5,
};

const ROTATION_COOLDOWN_MS: Record<RotationCooldown, number> = {
	"15m": 15 * 60 * 1000,
	"1h": 60 * 60 * 1000,
	"6h": 6 * 60 * 60 * 1000,
};

function asObject(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function normalizeRotationCooldown(value: unknown): RotationCooldown {
	return value === "15m" || value === "1h" || value === "6h"
		? value
		: DEFAULT_ROTATION_SETTINGS.unknownResetCooldown;
}

function normalizeSelectionStrategy(
	value: unknown,
	legacyPreferWeeklyReset: unknown,
): SelectionStrategy {
	if (value === "lowest-usage" || value === "stable-weekly") {
		return value;
	}

	if (typeof legacyPreferWeeklyReset === "boolean") {
		return legacyPreferWeeklyReset ? "stable-weekly" : "lowest-usage";
	}

	return DEFAULT_ROTATION_SETTINGS.selectionStrategy;
}

export function normalizeRotationSettings(value: unknown): RotationSettings {
	const record = asObject(value);
	return {
		selectionStrategy: normalizeSelectionStrategy(
			record?.selectionStrategy,
			record?.preferWeeklyReset,
		),
		preferUntouched:
			typeof record?.preferUntouched === "boolean"
				? record.preferUntouched
				: DEFAULT_ROTATION_SETTINGS.preferUntouched,
		unknownResetCooldown: normalizeRotationCooldown(
			record?.unknownResetCooldown,
		),
		preStreamRetryLimit:
			typeof record?.preStreamRetryLimit === "number" &&
			Number.isInteger(record.preStreamRetryLimit) &&
			record.preStreamRetryLimit >= 0 &&
			record.preStreamRetryLimit <= 10
				? record.preStreamRetryLimit
				: DEFAULT_ROTATION_SETTINGS.preStreamRetryLimit,
	};
}

function readSettingsFile(): Record<string, unknown> {
	if (!existsSync(SETTINGS_FILE)) return {};
	try {
		const raw = JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as unknown;
		return asObject(raw) ?? {};
	} catch {
		return {};
	}
}

function writeSettingsFile(settings: Record<string, unknown>): void {
	const directory = path.dirname(SETTINGS_FILE);
	if (!existsSync(directory)) {
		mkdirSync(directory, { recursive: true });
	}
	writeFileSync(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`);
}

function getRotationRecord(
	settings: Record<string, unknown>,
): Record<string, unknown> {
	const existing = asObject(settings[SETTINGS_KEY]);
	if (existing?.rotation && typeof existing.rotation === "object") {
		return asObject(existing.rotation) ?? {};
	}
	if (
		existing &&
		("selectionStrategy" in existing ||
			"preferUntouched" in existing ||
			"preferWeeklyReset" in existing ||
			"unknownResetCooldown" in existing ||
			"preStreamRetryLimit" in existing)
	) {
		return existing;
	}
	return {};
}

export function loadRotationSettings(): RotationSettings {
	const settings = readSettingsFile();
	const rotation = getRotationRecord(settings);
	const normalized = normalizeRotationSettings(rotation);
	const data = RotationSettingsSchema.safeParse(normalized);
	return data.success ? data.data : DEFAULT_ROTATION_SETTINGS;
}

export function persistRotationSettings(settingsValue: RotationSettings): void {
	const settings = readSettingsFile();
	const entry = asObject(settings[SETTINGS_KEY]) ?? {};
	settings[SETTINGS_KEY] = {
		...entry,
		rotation: settingsValue,
	};
	writeSettingsFile(settings);
}

export function rotationCooldownToMs(value: RotationCooldown): number {
	return ROTATION_COOLDOWN_MS[value];
}

export function formatRotationSummaryLines(
	settings: RotationSettings,
): string[] {
	return [
		`rotation strategy: ${settings.selectionStrategy}`,
		`prefer untouched: ${settings.preferUntouched ? "on" : "off"}`,
		`unknown-reset fallback: ${settings.unknownResetCooldown}`,
		`pre-stream retry limit: ${settings.preStreamRetryLimit}`,
	];
}
