import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { MultiCodexController } from "./multicodex-controller";

type WarningHandler = (message: string) => void;

function startSessionIfNeeded(
	controller: MultiCodexController,
	ctx: ExtensionContext,
	warningHandler?: WarningHandler,
): void {
	if (controller.accountManager.getAccounts().length === 0) return;
	void Promise.resolve(controller.startSession(ctx, warningHandler)).catch(
		() => {},
	);
}

export function handleSessionStart(
	controller: MultiCodexController,
	ctx: ExtensionContext,
	warningHandler?: WarningHandler,
): void {
	startSessionIfNeeded(controller, ctx, warningHandler);
}

export function handleNewSessionSwitch(
	controller: MultiCodexController,
	ctx: ExtensionContext,
	warningHandler?: WarningHandler,
): void {
	startSessionIfNeeded(controller, ctx, warningHandler);
}

export function handleSessionTree(
	controller: MultiCodexController,
	ctx: ExtensionContext,
	warningHandler?: WarningHandler,
): void {
	startSessionIfNeeded(controller, ctx, warningHandler);
}
