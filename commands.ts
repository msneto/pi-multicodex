import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { type AutocompleteItem } from "@earendil-works/pi-tui";
import type { AccountManager } from "./account-manager";
import {
	runAccountsSubcommand,
	runReauthSubcommand,
	runRefreshSubcommand,
	runShowSubcommand,
} from "./account-flows";
import type { MultiCodexController } from "./multicodex-controller";

const HELP_TEXT =
	"Usage: /multicodex [accounts [identifier]|use [identifier]|show|refresh [identifier|all]|reauth [identifier]|footer|rotation|report|verify|path|reset [manual|quota|all]|help]";
const SUBCOMMANDS = [
	"accounts",
	"use",
	"show",
	"refresh",
	"reauth",
	"footer",
	"rotation",
	"report",
	"verify",
	"path",
	"reset",
	"help",
] as const;
const RESET_TARGETS = ["manual", "quota", "all"] as const;

type Subcommand = (typeof SUBCOMMANDS)[number];
type ResetTarget = (typeof RESET_TARGETS)[number];

function toAutocompleteItems(values: readonly string[]): AutocompleteItem[] {
	return values.map((value) => ({ value, label: value }));
}

function parseCommandArgs(args: string): {
	subcommand: string | undefined;
	rest: string;
} {
	const trimmed = args.trim();
	if (!trimmed) {
		return { subcommand: undefined, rest: "" };
	}
	const firstSpaceIndex = trimmed.indexOf(" ");
	if (firstSpaceIndex < 0) {
		return { subcommand: trimmed.toLowerCase(), rest: "" };
	}
	return {
		subcommand: trimmed.slice(0, firstSpaceIndex).toLowerCase(),
		rest: trimmed.slice(firstSpaceIndex + 1).trim(),
	};
}

function isSubcommand(value: string): value is Subcommand {
	return SUBCOMMANDS.some((subcommand) => subcommand === value);
}

function parseResetTarget(value: string): ResetTarget | undefined {
	if (value === "manual" || value === "quota" || value === "all") {
		return value;
	}
	return undefined;
}

function getSubcommandCompletions(prefix: string): AutocompleteItem[] | null {
	const matches = SUBCOMMANDS.filter((value) => value.startsWith(prefix));
	return matches.length > 0 ? toAutocompleteItems(matches) : null;
}

function getAccountCompletions(
	subcommand: "accounts" | "use" | "reauth",
	prefix: string,
	accountManager: AccountManager,
): AutocompleteItem[] | null {
	const matches = accountManager
		.getAccounts()
		.map((account) => account.email)
		.filter((value) => value.startsWith(prefix));
	if (matches.length === 0) return null;
	return matches.map((value) => ({
		value: `${subcommand} ${value}`,
		label: value,
	}));
}

function getRefreshCompletions(
	prefix: string,
	accountManager: AccountManager,
): AutocompleteItem[] | null {
	const values = [
		"all",
		...accountManager.getAccounts().map((account) => account.email),
	].filter((value, index, array) => array.indexOf(value) === index);
	const matches = values.filter((value) => value.startsWith(prefix));
	if (matches.length === 0) return null;
	return matches.map((value) => ({
		value: `refresh ${value}`,
		label: value,
	}));
}

function getResetCompletions(prefix: string): AutocompleteItem[] | null {
	const matches = RESET_TARGETS.filter((value) => value.startsWith(prefix));
	if (matches.length === 0) return null;
	return matches.map((value) => ({ value: `reset ${value}`, label: value }));
}

function getCommandCompletions(
	argumentPrefix: string,
	accountManager: AccountManager,
): AutocompleteItem[] | null {
	const trimmedStart = argumentPrefix.trimStart();
	if (!trimmedStart) {
		return toAutocompleteItems(SUBCOMMANDS);
	}

	const firstSpaceIndex = trimmedStart.indexOf(" ");
	if (firstSpaceIndex < 0) {
		return getSubcommandCompletions(trimmedStart.toLowerCase());
	}

	const subcommand = trimmedStart.slice(0, firstSpaceIndex).toLowerCase();
	const rest = trimmedStart.slice(firstSpaceIndex + 1).trimStart();

	if (subcommand === "accounts") {
		return getAccountCompletions("accounts", rest, accountManager);
	}
	if (subcommand === "use") {
		return getAccountCompletions("use", rest, accountManager);
	}
	if (subcommand === "reauth") {
		return getAccountCompletions("reauth", rest, accountManager);
	}
	if (subcommand === "refresh") {
		return getRefreshCompletions(rest, accountManager);
	}
	if (subcommand === "reset") {
		return getResetCompletions(rest);
	}

	return null;
}

async function chooseResetTarget(
	ctx: ExtensionCommandContext,
	argument: string,
): Promise<ResetTarget | undefined> {
	const explicitTarget = parseResetTarget(argument.toLowerCase());
	if (explicitTarget) {
		return explicitTarget;
	}

	if (argument) {
		ctx.ui.notify(
			"Unknown reset target. Use: /multicodex reset [manual|quota|all]",
			"warning",
		);
		return undefined;
	}

	if (!ctx.hasUI) {
		return "all";
	}

	const options = [
		"manual - clear manual account override",
		"quota - clear quota cooldown markers",
		"all - clear manual override and quota cooldown markers",
	];
	const selected = await ctx.ui.select("Reset MultiCodex State", options);
	if (!selected) return undefined;
	if (selected.startsWith("manual")) return "manual";
	if (selected.startsWith("quota")) return "quota";
	return "all";
}
async function runFooterSubcommand(
	ctx: ExtensionCommandContext,
	statusController: MultiCodexController,
): Promise<void> {
	await statusController.runFooterCommand(ctx);
}

async function runRotationSubcommand(
	ctx: ExtensionCommandContext,
	statusController: MultiCodexController,
): Promise<void> {
	await statusController.runRotationCommand(ctx);
}

async function runReportSubcommand(
	ctx: ExtensionCommandContext,
	statusController: MultiCodexController,
): Promise<void> {
	await statusController.runReportCommand(ctx);
}

async function runVerifySubcommand(
	ctx: ExtensionCommandContext,
	statusController: MultiCodexController,
): Promise<void> {
	await statusController.runVerifyCommand(ctx);
}

async function runPathSubcommand(
	ctx: ExtensionCommandContext,
	statusController: MultiCodexController,
): Promise<void> {
	await statusController.runPathCommand(ctx);
}

async function runResetSubcommand(
	ctx: ExtensionCommandContext,
	statusController: MultiCodexController,
	rest: string,
): Promise<void> {
	const target = await chooseResetTarget(ctx, rest);
	if (!target) return;
	await statusController.runResetCommand(ctx, target);
}

function runHelpSubcommand(ctx: ExtensionCommandContext): void {
	ctx.ui.notify(HELP_TEXT, "info");
}

async function runSubcommand(
	subcommand: Subcommand,
	rest: string,
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	statusController: MultiCodexController,
): Promise<void> {
	if (subcommand === "accounts" || subcommand === "use") {
		await runAccountsSubcommand(pi, ctx, accountManager, statusController, rest);
		return;
	}
	if (subcommand === "show") {
		await runShowSubcommand(pi, ctx, accountManager, statusController);
		return;
	}
	if (subcommand === "refresh") {
		await runRefreshSubcommand(pi, ctx, accountManager, statusController, rest);
		return;
	}
	if (subcommand === "reauth") {
		await runReauthSubcommand(pi, ctx, accountManager, statusController, rest);
		return;
	}
	if (subcommand === "footer") {
		await runFooterSubcommand(ctx, statusController);
		return;
	}
	if (subcommand === "rotation") {
		await runRotationSubcommand(ctx, statusController);
		return;
	}
	if (subcommand === "report") {
		await runReportSubcommand(ctx, statusController);
		return;
	}
	if (subcommand === "verify") {
		await runVerifySubcommand(ctx, statusController);
		return;
	}
	if (subcommand === "path") {
		await runPathSubcommand(ctx, statusController);
		return;
	}
	if (subcommand === "reset") {
		await runResetSubcommand(ctx, statusController, rest);
		return;
	}

	runHelpSubcommand(ctx);
}

async function openMainPanel(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	statusController: MultiCodexController,
): Promise<void> {
	const actions = [
		"accounts: inspect, select, refresh, re-authenticate, add, or remove managed account",
		"refresh: force a health and usage refresh",
		"reauth: re-authenticate an account",
		"footer: footer settings panel",
		"rotation: current rotation behavior",
		"report: active account and quota report",
		"verify: runtime health checks",
		"path: storage and settings locations",
		"reset: clear manual or quota state",
		"help: command usage",
	];

	const selected = await ctx.ui.select("MultiCodex", actions);
	if (!selected) return;

	const subcommandText = selected.split(":")[0]?.trim() ?? "";
	if (!isSubcommand(subcommandText)) {
		ctx.ui.notify(`Unknown subcommand: ${subcommandText}`, "warning");
		return;
	}
	await runSubcommand(
		subcommandText,
		"",
		pi,
		ctx,
		accountManager,
		statusController,
	);
}

export function registerCommands(
	pi: ExtensionAPI,
	accountManager: AccountManager,
	statusController: MultiCodexController,
): void {
	pi.registerCommand("multicodex", {
		description:
			"Manage MultiCodex accounts, reports, health, rotation, and footer settings",
		getArgumentCompletions: (argumentPrefix: string) =>
			getCommandCompletions(argumentPrefix, accountManager),
		handler: async (
			args: string,
			ctx: ExtensionCommandContext,
		): Promise<void> => {
			const parsed = parseCommandArgs(args);
			if (!parsed.subcommand) {
				if (!ctx.hasUI) {
					ctx.ui.notify(
						"/multicodex requires a subcommand in non-interactive mode. Use /multicodex help.",
						"warning",
					);
					return;
				}
				await openMainPanel(pi, ctx, accountManager, statusController);
				return;
			}

			if (!isSubcommand(parsed.subcommand)) {
				ctx.ui.notify(`Unknown subcommand: ${parsed.subcommand}`, "warning");
				runHelpSubcommand(ctx);
				return;
			}

			await runSubcommand(
				parsed.subcommand,
				parsed.rest,
				pi,
				ctx,
				accountManager,
				statusController,
			);
		},
	});
}
