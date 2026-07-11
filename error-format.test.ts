import { describe, expect, it } from "vitest";
import {
	formatMulticodexError,
	formatMulticodexMessage,
	MULTICODEX_ERROR_PREFIX,
} from "./error-format";

describe("error formatting", () => {
	it("prefixes raw errors with the extension name", () => {
		expect(
			formatMulticodexError("usage fetch", new Error("fetch failed")),
		).toBe(`${MULTICODEX_ERROR_PREFIX} usage fetch: fetch failed`);
	});

	it("does not double-prefix already formatted messages", () => {
		const message = `${MULTICODEX_ERROR_PREFIX} token refresh: fetch failed`;
		expect(formatMulticodexMessage("usage fetch", message)).toBe(message);
	});
});
