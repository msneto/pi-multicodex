import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { MultiCodexController } from "./multicodex-controller";

type WarningHandler = (message: string) => void;

export function handleSessionStart(
	controller: MultiCodexController,
	ctx: ExtensionContext,
	warningHandler?: WarningHandler,
): void {
	void controller.startSession(ctx, warningHandler).catch(() => {});
}

export function handleNewSessionSwitch(
	controller: MultiCodexController,
	ctx: ExtensionContext,
	warningHandler?: WarningHandler,
): void {
	void controller.startSession(ctx, warningHandler).catch(() => {});
}
