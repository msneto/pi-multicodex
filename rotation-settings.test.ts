import { describe, expect, it } from "vitest";
import {
	DEFAULT_ROTATION_SETTINGS,
	formatRotationSummaryLines,
	normalizeRotationSettings,
	rotationCooldownToMs,
} from "./rotation-settings";

describe("rotation settings", () => {
	it("fills defaults from partial input", () => {
		expect(
			normalizeRotationSettings({
				selectionStrategy: "capacity-first",
			}),
		).toEqual({
			...DEFAULT_ROTATION_SETTINGS,
			selectionStrategy: "capacity-first",
		});
	});

	it("defaults guard relaxation to off", () => {
		expect(normalizeRotationSettings({})).toMatchObject({
			guardRelaxation: false,
		});
	});

	it("maps legacy weekly reset flag to stable weekly strategy", () => {
		expect(
			normalizeRotationSettings({
				preferWeeklyReset: true,
			}),
		).toEqual({
			...DEFAULT_ROTATION_SETTINGS,
			selectionStrategy: "stable-weekly",
		});
	});

	it("maps fallback labels to milliseconds", () => {
		expect(rotationCooldownToMs("15m")).toBe(15 * 60 * 1000);
		expect(rotationCooldownToMs("1h")).toBe(60 * 60 * 1000);
		expect(rotationCooldownToMs("6h")).toBe(6 * 60 * 60 * 1000);
	});

	it("renders compact summary lines", () => {
		const lines = formatRotationSummaryLines({
			...DEFAULT_ROTATION_SETTINGS,
			selectionStrategy: "stable-weekly",
		});

		expect(lines).toContain("rotation strategy: stable-weekly");
		expect(lines).toContain("guard relaxation: off");
		expect(lines).toContain("pre-stream retry limit: 5");
	});
});
