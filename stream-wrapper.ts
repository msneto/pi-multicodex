import {
	type Api,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { AccountManager } from "./account-manager";
import { formatMulticodexError } from "./error-format";
import { isQuotaErrorMessage } from "./quota";
import {
	createErrorAssistantMessage,
	createLinkedAbortController,
	rewriteProviderOnEvent,
} from "./streams";

const DEFAULT_MAX_ROTATION_RETRIES = 5;

function normalizeRequestCostEstimatePercent(
	value: unknown,
): number | undefined {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < 0 ||
		value > 100
	) {
		return undefined;
	}
	return value;
}

type ApiProviderRef = {
	streamSimple: (
		model: Model<Api>,
		context: Context,
		options?: SimpleStreamOptions,
	) => AssistantMessageEventStream;
};

export function createStreamWrapper(
	accountManager: AccountManager,
	baseProvider: ApiProviderRef,
) {
	return (
		model: Model<Api>,
		context: Context,
		options?: SimpleStreamOptions,
	): AssistantMessageEventStream => {
		const stream = createAssistantMessageEventStream();

		(async () => {
			try {
				await accountManager.waitUntilReady();
				const maxRotationRetries =
					accountManager.getRotationPreferences().preStreamRetryLimit ??
					DEFAULT_MAX_ROTATION_RETRIES;
				const excludedEmails = new Set<string>();
				const requestCostEstimatePercent = normalizeRequestCostEstimatePercent(
					options?.metadata?.multicodexRequestCostPercent,
				);
				for (let attempt = 0; attempt <= maxRotationRetries; attempt++) {
					const now = Date.now();
					const manual = accountManager.getAvailableManualAccount({
						excludeEmails: excludedEmails,
						now,
					});
					const usingManual = Boolean(manual);
					let account = manual;
					if (!account) {
						if (accountManager.hasManualAccount()) {
							accountManager.clearManualAccount();
						}
						account = await accountManager.activateBestAccount({
							excludeEmails: excludedEmails,
							signal: options?.signal,
							requestCostEstimatePercent,
						});
					}
					if (!account) {
						throw new Error(
							"No available Multicodex accounts. Please use /multicodex use <identifier>.",
						);
					}

					let token: string;
					try {
						token = await accountManager.ensureValidToken(account);
					} catch (error) {
						accountManager.notifyRotationSkipForAuthFailure(account, error);
						if (usingManual) {
							accountManager.clearManualAccount();
						}
						excludedEmails.add(account.email);
						if (attempt < maxRotationRetries) {
							continue;
						}
						throw error;
					}
					const abortController = createLinkedAbortController(options?.signal);

					const internalModel: Model<"openai-codex-responses"> = {
						...(model as Model<"openai-codex-responses">),
						provider: "openai-codex",
						api: "openai-codex-responses",
					};

					const inner = baseProvider.streamSimple(
						{
							...internalModel,
							headers: {
								...internalModel.headers,
								"X-Multicodex-Account": account.email,
							},
						},
						context,
						{
							...options,
							apiKey: token,
							signal: abortController.signal,
						},
					);

					let forwardedAny = false;
					let retry = false;

					for await (const event of inner) {
						if (event.type === "error") {
							const msg = event.error.errorMessage || "";
							const isQuota = isQuotaErrorMessage(msg);

							if (isQuota && !forwardedAny && attempt < maxRotationRetries) {
								await accountManager.handleQuotaExceeded(account, {
									signal: options?.signal,
								});
								if (usingManual) {
									accountManager.clearManualAccount();
								}
								excludedEmails.add(account.email);
								abortController.abort();
								retry = true;
								break;
							}

							stream.push(rewriteProviderOnEvent(event, model.provider));
							stream.end();
							return;
						}

						forwardedAny = true;
						stream.push(rewriteProviderOnEvent(event, model.provider));

						if (event.type === "done") {
							stream.end();
							return;
						}
					}

					if (retry) {
						continue;
					}

					stream.end();
					return;
				}
			} catch (error) {
				const errorEvent: AssistantMessageEvent = {
					type: "error",
					reason: "error",
					error: createErrorAssistantMessage(
						model,
						formatMulticodexError(`stream/${model.api}`, error),
					),
				};
				stream.push(rewriteProviderOnEvent(errorEvent, model.provider));
				stream.end();
			}
		})();

		return stream;
	};
}
