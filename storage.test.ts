import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
	mkdirSync: vi.fn(),
}));

vi.mock("node:fs", () => fsMocks);

import { STORAGE_FILE, loadStorage, saveStorage, type StorageData } from "./storage";

describe("saveStorage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("rethrows write failures after logging them", () => {
		fsMocks.existsSync.mockReturnValue(true);
		fsMocks.writeFileSync.mockImplementation(() => {
			throw new Error("disk full");
		});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
			return undefined;
		});

		const data: StorageData = {
			version: 1,
			accounts: [],
		};

		expect(() => saveStorage(data)).toThrow("disk full");
		expect(consoleError).toHaveBeenCalledTimes(1);
	});

	it("keeps migrated storage available when persistence fails", () => {
		fsMocks.existsSync.mockImplementation((target) => target === STORAGE_FILE);
		fsMocks.readFileSync.mockImplementation((target) => {
			if (target !== STORAGE_FILE) {
				throw new Error(`unexpected read: ${String(target)}`);
			}
			return JSON.stringify({
				version: 0,
				accounts: [
					{
						email: "migrate@example.com",
						accessToken: "access",
						refreshToken: "refresh",
						expiresAt: 123,
					},
				],
			});
		});
		fsMocks.writeFileSync.mockImplementation(() => {
			throw new Error("disk full");
		});
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		const data = loadStorage();

		expect(data.accounts).toHaveLength(1);
		expect(data.accounts[0]?.email).toBe("migrate@example.com");
	});
});
