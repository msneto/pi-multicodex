import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const env = Object.fromEntries(
	Object.entries(process.env).filter(
		([key]) =>
			!key.startsWith("npm_") &&
			!key.startsWith("NPM_") &&
			key !== "NODE_OPTIONS",
	),
);

const result = spawnSync(
	"./node_modules/.bin/oxlint",
	[...args, ".", "--deny-warnings", "--no-error-on-unmatched-pattern"],
	{ stdio: "inherit", env },
);

process.exit(result.status ?? 1);
