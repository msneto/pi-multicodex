import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { LEGACY_STORAGE_FILE } from "./paths";
import { STORAGE_FILE } from "./storage";

const originalStorageFile = fs.existsSync(STORAGE_FILE)
	? fs.readFileSync(STORAGE_FILE)
	: undefined;
const originalLegacyFile = fs.existsSync(LEGACY_STORAGE_FILE)
	? fs.readFileSync(LEGACY_STORAGE_FILE)
	: undefined;

function restoreFile(filePath: string, contents: Buffer | undefined): void {
	fs.rmSync(filePath, { recursive: true, force: true });
	if (contents) {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, contents);
	}
}

function runStorageProbe(): {
	saveError?: string;
	accounts: Array<{ email: string; manuallyDisabled?: boolean }>;
} {
	const script = `
		import fs from "node:fs";
		import path from "node:path";
		const storagePath = ${JSON.stringify(STORAGE_FILE)};
		const legacyPath = ${JSON.stringify(LEGACY_STORAGE_FILE)};
		const { loadStorage, saveStorage } = await import("./storage.ts");
		const originalStorage = fs.existsSync(storagePath) ? fs.readFileSync(storagePath) : null;
		const originalLegacy = fs.existsSync(legacyPath) ? fs.readFileSync(legacyPath) : null;
		const originalConsoleError = console.error;
		console.error = () => {};
		try {
			fs.rmSync(storagePath, { recursive: true, force: true });
			fs.mkdirSync(storagePath, { recursive: true });
			let saveError;
			try {
				saveStorage({ version: 1, accounts: [] });
			} catch (error) {
				saveError = error instanceof Error ? error.message : String(error);
			}
			fs.rmSync(storagePath, { recursive: true, force: true });
			fs.mkdirSync(storagePath, { recursive: true });
			fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
			fs.writeFileSync(
				legacyPath,
				JSON.stringify({
					version: 0,
					accounts: [
						{
							email: "migrate@example.com",
							accessToken: "access",
							refreshToken: "refresh",
							expiresAt: 123,
							manuallyDisabled: true,
						},
					],
				}),
				"utf8",
			);
			const data = loadStorage();
			console.log(JSON.stringify({ saveError, accounts: data.accounts }));
		} finally {
			console.error = originalConsoleError;
			fs.rmSync(storagePath, { recursive: true, force: true });
			if (originalStorage) {
				fs.mkdirSync(path.dirname(storagePath), { recursive: true });
				fs.writeFileSync(storagePath, originalStorage);
			}
			fs.rmSync(legacyPath, { recursive: true, force: true });
			if (originalLegacy) {
				fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
				fs.writeFileSync(legacyPath, originalLegacy);
			}
		}
	`;
	const stdout = execFileSync("bun", ["--eval", script], {
		cwd: path.resolve(process.cwd()),
		encoding: "utf8",
	});
	return JSON.parse(stdout.trim()) as {
		saveError?: string;
		accounts: Array<{ email: string; manuallyDisabled?: boolean }>;
	};
}

afterEach(() => {
	restoreFile(STORAGE_FILE, originalStorageFile);
	restoreFile(LEGACY_STORAGE_FILE, originalLegacyFile);
});

describe("storage", () => {
	it("reports directory collisions and keeps migrated storage available", () => {
		const result = runStorageProbe();
		expect(result.saveError).toContain("expected storage file but found directory");
		expect(result.accounts).toHaveLength(1);
		expect(result.accounts[0]?.email).toBe("migrate@example.com");
		expect(result.accounts[0]?.manuallyDisabled).toBe(true);
	});
});
