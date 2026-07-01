import * as fs from "node:fs";
import * as path from "node:path";
import { LEGACY_STORAGE_FILE, MULTICODEX_ACCOUNTS_FILE } from "./paths";

const CURRENT_VERSION = 1;
const SCHEMA_URL =
	"https://raw.githubusercontent.com/victor-software-house/pi-multicodex/main/schemas/codex-accounts.schema.json";

export interface Account {
	email: string;
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
	accountId?: string;
	lastUsed?: number;
	quotaExhaustedUntil?: number;
	needsReauth?: boolean;
}

export interface StorageData {
	version: number;
	accounts: Account[];
	activeEmail?: string;
}

const LEGACY_FIELDS = ["importSource", "importMode", "importFingerprint"] as const;

function asObject(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function isString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function stripLegacyFields(raw: Record<string, unknown>): boolean {
	let stripped = false;
	for (const key of LEGACY_FIELDS) {
		if (key in raw) {
			delete raw[key];
			stripped = true;
		}
	}
	return stripped;
}

function normalizeAccount(value: unknown): Account | undefined {
	const record = asObject(value);
	if (!record) return undefined;
	const email = record.email;
	const accessToken = record.accessToken;
	const refreshToken = record.refreshToken;
	const expiresAt = record.expiresAt;
	if (!isString(email) || !isString(accessToken) || !isString(refreshToken) || !isNumber(expiresAt)) {
		return undefined;
	}
	const account: Account = {
		email,
		accessToken,
		refreshToken,
		expiresAt,
	};
	if (isString(record.accountId)) account.accountId = record.accountId;
	if (isNumber(record.lastUsed)) account.lastUsed = record.lastUsed;
	if (isNumber(record.quotaExhaustedUntil)) account.quotaExhaustedUntil = record.quotaExhaustedUntil;
	if (typeof record.needsReauth === "boolean") account.needsReauth = record.needsReauth;
	return account;
}

function migrateRawStorage(raw: unknown): StorageData {
	const current: StorageData = { version: CURRENT_VERSION, accounts: [], activeEmail: undefined };
	const record = asObject(raw);
	if (!record) return current;

	const rawAccounts = Array.isArray(record.accounts) ? record.accounts : [];
	for (const entry of rawAccounts) {
		if (entry && typeof entry === "object" && !Array.isArray(entry)) {
			stripLegacyFields(entry as Record<string, unknown>);
		}
	}

	const accounts = rawAccounts.flatMap((entry) => {
		const parsed = normalizeAccount(entry);
		return parsed ? [parsed] : [];
	});
	const activeEmail = isString(record.activeEmail) ? record.activeEmail : undefined;
	return { version: CURRENT_VERSION, accounts, activeEmail };
}

function needsLegacyStrip(raw: Record<string, unknown>): boolean {
	const accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
	for (const entry of accounts) {
		if (entry && typeof entry === "object" && !Array.isArray(entry)) {
			for (const key of LEGACY_FIELDS) {
				if (key in (entry as Record<string, unknown>)) return true;
			}
		}
	}
	return false;
}

function readStorageFile(filePath: string): StorageData | undefined {
	if (!fs.existsSync(filePath)) return undefined;
	try {
		const text = fs.readFileSync(filePath, "utf-8");
		const raw = JSON.parse(text) as Record<string, unknown>;
		const needsMigration =
			!("version" in raw) || raw.version !== CURRENT_VERSION || needsLegacyStrip(raw);
		const data = migrateRawStorage(raw);
		if (needsMigration && filePath === MULTICODEX_ACCOUNTS_FILE) {
			saveStorage(data);
		}
		return data;
	} catch (error) {
		console.error("Failed to load multicodex accounts:", error);
		return undefined;
	}
}

export const STORAGE_FILE = MULTICODEX_ACCOUNTS_FILE;

export function loadStorage(): StorageData {
	const current = readStorageFile(STORAGE_FILE);
	if (current) return current;

	const legacy = readStorageFile(LEGACY_STORAGE_FILE);
	if (legacy) {
		saveStorage(legacy);
		return legacy;
	}

	return { version: CURRENT_VERSION, accounts: [], activeEmail: undefined };
}

export function saveStorage(data: StorageData): void {
	try {
		const dir = path.dirname(STORAGE_FILE);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		const output = {
			$schema: SCHEMA_URL,
			version: CURRENT_VERSION,
			accounts: data.accounts,
			activeEmail: data.activeEmail,
		};
		fs.writeFileSync(STORAGE_FILE, JSON.stringify(output, null, 2));
	} catch (error) {
		console.error("Failed to save multicodex accounts:", error);
	}
}
