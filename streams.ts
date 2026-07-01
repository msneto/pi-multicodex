import type { Api, Model } from "@earendil-works/pi-ai";

export function normalizeUnknownError(error: unknown): string {
	if (error instanceof Error) {
		return error.message || error.name || "Unknown error";
	}
	if (typeof error === "string") {
		return error;
	}
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}

export function createLinkedAbortController(signal?: AbortSignal): AbortController {
	const controller = new AbortController();
	if (!signal) {
		return controller;
	}
	if (signal.aborted) {
		controller.abort(signal.reason);
		return controller;
	}

	const onAbort = () => {
		controller.abort(signal.reason);
	};
	signal.addEventListener("abort", onAbort, { once: true });
	controller.signal.addEventListener(
		"abort",
		() => {
			signal.removeEventListener("abort", onAbort);
		},
		{ once: true },
	);
	return controller;
}

export function createTimeoutController(
	signal?: AbortSignal,
	timeoutMs = 10_000,
): { controller: AbortController; clear: () => void } {
	const controller = createLinkedAbortController(signal);
	const timeout = setTimeout(() => {
		controller.abort(new Error(`Timed out after ${timeoutMs}ms`));
	}, timeoutMs);

	const clear = () => {
		clearTimeout(timeout);
	};
	controller.signal.addEventListener("abort", clear, { once: true });
	if (signal?.aborted) {
		clear();
	}
	return { controller, clear };
}

export function createErrorAssistantMessage(
	model: Model<Api>,
	message: string,
): { errorMessage: string; provider?: string; api?: string } {
	return {
		errorMessage: message,
		provider: model.provider,
		api: model.api,
	};
}

export function rewriteProviderOnEvent<T extends { provider?: string }>(
	event: T,
	provider: string,
): T {
	if (!event || typeof event !== "object") {
		return event;
	}
	return {
		...event,
		provider,
	} as T;
}
