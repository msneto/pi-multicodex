import { describe, expect, it, vi } from "vitest";

const events: string[] = [];
let settings = {
	"pi-multicodex": {
		usageMode: "left",
		resetWindow: "7d",
		showAccount: true,
		showReset: true,
		order: "account-first",
	},
};

vi.mock("pi-provider-utils/agent-paths", () => ({
	getAgentSettingsPath: () => "/tmp/settings.json",
	readJsonObjectFileAsync: vi.fn(async () => {
		events.push("read");
		return settings;
	}),
	writeJsonObjectFileAsync: vi.fn(
		async (path: string, nextSettings: typeof settings) => {
			events.push(`write:${path}:${nextSettings["pi-multicodex"].usageMode}`);
			settings = nextSettings;
		},
	),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
	getSettingsListTheme: () => ({
		fg: (_token: string, text: string) => text,
		bold: (text: string) => text,
	}),
}));

vi.mock("@earendil-works/pi-tui", () => {
	class Container {
		addChild() {}
		invalidate() {}
		render() {
			return "";
		}
	}

	class Text {
		text: string;
		constructor(text: string) {
			this.text = text;
		}
		setText(text: string) {
			this.text = text;
		}
	}

	class SettingsList {
		private readonly onChange: (id: string, value: string) => void;
		constructor(
			_items: unknown,
			_index: number,
			_theme: unknown,
			onChange: (id: string, value: string) => void,
			_onDone: () => void,
			_options: unknown,
		) {
			this.onChange = onChange;
		}
		updateValue() {}
		handleInput(value: string) {
			if (value === "first") {
				this.onChange("usageMode", "used");
			} else {
				this.onChange("resetWindow", "both");
			}
		}
	}

	return { Container, Text, SettingsList };
});

import { createUsageStatusController } from "./status";

function createContext() {
	const theme = {
		fg: (_token: string, text: string) => text,
		bold: (text: string) => text,
	};
	return {
		hasUI: true,
		model: { provider: "openai-codex" },
		ui: {
			setStatus: vi.fn(),
			notify: vi.fn(),
			theme,
			custom: async (
				cb: (...args: unknown[]) => {
					handleInput: (value: string) => void;
					invalidate: () => void;
					render: (width: number) => string;
				},
			) => {
				let doneCalled = false;
				const done = () => {
					doneCalled = true;
					events.push("done");
				};
				const ui = cb(
					undefined as never,
					theme as never,
					undefined as never,
					done,
				);
				events.push("panel-start");
				ui.handleInput("first");
				await new Promise((resolve) => setTimeout(resolve, 0));
				ui.handleInput("second");
				await new Promise((resolve) => setTimeout(resolve, 0));
				events.push(doneCalled ? "done-called" : "not-done-yet");
				done();
				return undefined;
			},
		},
	} as never;
}

describe("footer settings persistence", () => {
	it("starts save on each edit before panel closes", async () => {
		events.length = 0;
		settings = {
			"pi-multicodex": {
				usageMode: "left",
				resetWindow: "7d",
				showAccount: true,
				showReset: true,
				order: "account-first",
			},
		};
		const controller = createUsageStatusController({
			onStateChange: () => () => undefined,
			getActiveAccount: () => ({ email: "a@example.com" }),
			getCachedUsage: () => undefined,
			refreshUsageForAccount: vi.fn().mockResolvedValue(undefined),
		} as never);

		await controller.openPreferencesPanel(createContext());

		const panelStart = events.indexOf("panel-start");
		const firstDone = events.indexOf("done");
		expect(panelStart).toBeGreaterThan(-1);
		expect(firstDone).toBeGreaterThan(panelStart);
		expect(
			events.slice(panelStart, firstDone).filter((event) => event === "read"),
		).toHaveLength(4);
		expect(settings["pi-multicodex"].usageMode).toBe("used");
	});
});
