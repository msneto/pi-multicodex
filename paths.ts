import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");

export function getAgentPath(relativePath: string): string {
	return path.join(AGENT_DIR, relativePath);
}

export function getAgentSettingsPath(): string {
	return getAgentPath("settings.json");
}

export function getAgentAuthPath(): string {
	return getAgentPath("auth.json");
}

export async function readJsonObjectFileAsync(
	filePath: string,
): Promise<Record<string, unknown> | undefined> {
	try {
		const raw = await fs.readFile(filePath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return undefined;
		}
		return parsed as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

export async function writeJsonObjectFileAsync(
	filePath: string,
	value: Record<string, unknown>,
): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export const MULTICODEX_DIR = getAgentPath("multicodex");
export const MULTICODEX_ACCOUNTS_FILE = getAgentPath(
	"multicodex/accounts.json",
);
export const MULTICODEX_ROTATION_FILE = getAgentPath(
	"multicodex/rotation.json",
);
export const MULTICODEX_USAGE_HISTORY_FILE = getAgentPath(
	"multicodex/usage-history.json",
);
export const MULTICODEX_REPORT_CACHE_FILE = getAgentPath(
	"multicodex/report-cache.json",
);

export const LEGACY_STORAGE_FILE = getAgentPath("codex-accounts.json");
export const LEGACY_SETTINGS_FILE = getAgentSettingsPath();
