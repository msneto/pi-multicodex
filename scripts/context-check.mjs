#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function fail(message) {
	failures.push(message);
}

function readText(relPath) {
	return readFileSync(path.join(repoRoot, relPath), "utf8");
}

function assertExists(relPath) {
	if (!existsSync(path.join(repoRoot, relPath))) {
		fail(`Missing required file: ${relPath}`);
	}
}

function stripFragment(target) {
	return target.split("#", 1)[0].split("?", 1)[0];
}

function checkLinkTargets(sourcePath) {
	const source = readText(sourcePath);
	const sourceDir = path.dirname(path.join(repoRoot, sourcePath));
	const linkPattern = /!?\[[^\]]+\]\(([^)]+)\)/g;
	let match;
	while ((match = linkPattern.exec(source)) !== null) {
		const rawTarget = match[1].trim();
		if (
			rawTarget.startsWith("http://") ||
			rawTarget.startsWith("https://") ||
			rawTarget.startsWith("mailto:") ||
			rawTarget.startsWith("#") ||
			rawTarget.includes("://")
		) {
			continue;
		}
		const targetPath = stripFragment(rawTarget);
		if (!targetPath) continue;
		const resolved = path.resolve(sourceDir, targetPath);
		if (!existsSync(resolved)) {
			fail(`Broken link in ${sourcePath}: ${rawTarget}`);
		}
	}
}

function checkContains(sourcePath, needles) {
	const source = readText(sourcePath);
	for (const needle of needles) {
		if (!source.includes(needle)) {
			fail(`Missing expected text in ${sourcePath}: ${needle}`);
		}
	}
}

const requiredFiles = [
	"AGENTS.md",
	"README.md",
	"ROADMAP.md",
	"docs/README.md",
	"docs/architecture.md",
	"docs/local-development.md",
	"docs/testing-reference.md",
	"docs/domains/rotation.md",
	"docs/context-engineering/README.md",
	"docs/context-engineering/20260714-133831.md",
	"skills/verification-workflow/SKILL.md",
	"skills/bugfix-workflow/SKILL.md",
	"skills/safe-refactor/SKILL.md",
	"skills/documentation-update/SKILL.md",
	"scripts/context-check.mjs",
];

for (const file of requiredFiles) assertExists(file);

checkContains("AGENTS.md", [
	"docs/README.md",
	"docs/architecture.md",
	"docs/local-development.md",
	"docs/testing-reference.md",
	"docs/references/project-learnings.md",
	"docs/decisions/",
	"docs/context-engineering/",
]);

checkContains("docs/README.md", [
	"architecture.md",
	"local-development.md",
	"testing-reference.md",
	"domains/rotation.md",
	"references/project-learnings.md",
	"decisions/",
	"context-engineering/README.md",
]);

checkContains("README.md", [
	"## How it works",
	"## Commands",
	"## Account manager",
	"## Usage footer",
	"## What it does under the hood",
	"rotation panel persists selection strategy (`lowest-usage`, `stable-weekly`, or `capacity-first`), the `guardRelaxation` toggle, untouched-account preference, unknown-reset fallback cooldown, and pre-stream retry count in `settings.json`",
	"`capacity-first` keeps a 5% per-window guard band unless guard relaxation is enabled.",
	"When stream metadata includes `multicodexRequestCostPercent`, MultiCodex feeds that estimate into `capacity-first` selection and caches it for `/multicodex report`; when it is missing, the report says the summary assumes 0%.",
	"`manuallyDisabled` state",
	"/multicodex",
]);

checkContains("ROADMAP.md", [
	"## Current product state",
	"/multicodex accounts",
	"/multicodex use",
	"/multicodex show",
	"/multicodex footer",
	"`manuallyDisabled` account flags",
	"the opt-in `capacity-first` mode, 5% per-window guard band, `guardRelaxation` toggle, and request-cost estimate threading",
]);

checkContains("docs/domains/rotation.md", [
	"## `capacity-first`",
	"`guardRelaxation` is a persisted rotation setting for `capacity-first` only.",
	"`manuallyDisabled`",
]);

checkContains("package.json", ["\"context-check\": \"node scripts/context-check.mjs\""]);

for (const file of [
	"AGENTS.md",
	"README.md",
	"ROADMAP.md",
	"docs/README.md",
	"docs/architecture.md",
	"docs/local-development.md",
	"docs/testing-reference.md",
	"docs/domains/rotation.md",
	"docs/context-engineering/README.md",
	"skills/verification-workflow/SKILL.md",
	"skills/bugfix-workflow/SKILL.md",
	"skills/safe-refactor/SKILL.md",
	"skills/documentation-update/SKILL.md",
]) {
	checkLinkTargets(file);
}

if (failures.length > 0) {
	for (const failure of failures) {
		console.error(failure);
	}
	process.exit(1);
}

console.log("context-check: ok");
