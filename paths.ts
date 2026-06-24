import {
	getAgentPath,
	getAgentSettingsPath,
} from "pi-provider-utils/agent-paths";

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
