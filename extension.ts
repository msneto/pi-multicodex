import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { AccountManager } from "./account-manager";
import { registerCommands } from "./commands";
import { createMultiCodexController } from "./multicodex-controller";
import { buildMulticodexProviderConfig, PROVIDER_ID } from "./provider";

export default function multicodexExtension(pi: ExtensionAPI) {
	const accountManager = new AccountManager();
	const multicodexController = createMultiCodexController(accountManager);
	let lastContext: ExtensionContext | undefined;

	accountManager.setWarningHandler((message) => {
		if (lastContext) {
			lastContext.ui.notify(message, "warning");
		}
	});

	pi.registerProvider(
		PROVIDER_ID,
		buildMulticodexProviderConfig(accountManager),
	);

	registerCommands(pi, accountManager, multicodexController);

	pi.on("session_start", (_event: unknown, ctx: ExtensionContext) => {
		lastContext = ctx;
		accountManager.resetSessionWarnings();
		void multicodexController.startSession(ctx, (msg) => {
			ctx.ui.notify(msg, "warning");
		});
	});

	pi.on("turn_end", (_event: unknown, ctx: ExtensionContext) => {
		lastContext = ctx;
		void multicodexController.refreshFor(ctx);
	});

	pi.on("model_select", (_event: unknown, ctx: ExtensionContext) => {
		lastContext = ctx;
		multicodexController.scheduleModelSelectRefresh(ctx);
	});

	pi.on("session_shutdown", (_event: unknown, ctx: ExtensionContext) => {
		multicodexController.stopSession(ctx);
	});
}
