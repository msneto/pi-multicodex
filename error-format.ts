import { normalizeUnknownError } from "pi-provider-utils/streams";

export const MULTICODEX_ERROR_PREFIX = "[multicodex]";

export function formatMulticodexMessage(
	scope: string,
	message: string,
): string {
	return `${MULTICODEX_ERROR_PREFIX} ${scope}: ${message}`;
}

export function formatMulticodexError(scope: string, error: unknown): string {
	return formatMulticodexMessage(scope, normalizeUnknownError(error));
}
