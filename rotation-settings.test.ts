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
				preferWeeklyReset: true,
			}),
		).toEqual({
			...DEFAULT_ROTATION_SETTINGS,
			preferWeeklyReset: true,
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
			preferWeeklyReset: true,
		});

		expect(lines).toContain("prefer earliest weekly reset: on");
		expect(lines).toContain("pre-stream retry limit: 5");
	});
});
