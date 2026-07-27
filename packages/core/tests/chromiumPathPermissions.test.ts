import { describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
	readdirSync: vi.fn(() => {
		throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
	}),
	readFileSync: vi.fn(() => {
		throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
	}),
}));

vi.mock("node:fs", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:fs")>()),
	existsSync: () => true,
	readdirSync: fsMocks.readdirSync,
	readFileSync: fsMocks.readFileSync,
}));

import {
	ALL_CHROMIUM_PROFILES,
	resolveCookiesDbsFromProfileOrRoots,
} from "../src/providers/chromium/paths.js";

describe("Chromium path permissions", () => {
	it("reports permission errors during all-profile discovery", () => {
		const warnings: string[] = [];
		const root = "/protected/chrome";

		const databases = resolveCookiesDbsFromProfileOrRoots({
			profile: ALL_CHROMIUM_PROFILES,
			roots: [root],
			onWarning: (warning) => warnings.push(warning),
		});

		expect(databases).toEqual([]);
		expect(warnings).toEqual([`Permission denied reading Chromium profile data at ${root}.`]);
	});
});
