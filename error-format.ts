import { normalizeUnknownError } from "./streams";

export const MULTICODEX_ERROR_PREFIX = "[pi-multicodex]";

function hasMulticodexPrefix(message: string): boolean {
	return message.startsWith(MULTICODEX_ERROR_PREFIX);
}

export function formatMulticodexMessage(
	scope: string,
	message: string,
): string {
	if (hasMulticodexPrefix(message)) return message;
	return `${MULTICODEX_ERROR_PREFIX} ${scope}: ${message}`;
}

export function formatMulticodexError(scope: string, error: unknown): string {
	return formatMulticodexMessage(scope, normalizeUnknownError(error));
}
