import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
	errorCode: "EPERM",
	readdirSync: vi.fn(() => {
		throw Object.assign(new Error("permission denied"), { code: fsMocks.errorCode });
	}),
	readFileSync: vi.fn(() => {
		throw Object.assign(new Error("permission denied"), { code: fsMocks.errorCode });
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
	beforeEach(() => {
		fsMocks.errorCode = "EPERM";
	});

	it.each(["EPERM", "EACCES"])("reports %s during all-profile discovery", (errorCode) => {
		fsMocks.errorCode = errorCode;
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

	it("does not turn unrelated filesystem failures into permission warnings", () => {
		fsMocks.errorCode = "ENOENT";
		const warnings: string[] = [];

		resolveCookiesDbsFromProfileOrRoots({
			profile: ALL_CHROMIUM_PROFILES,
			roots: ["/missing/chrome"],
			onWarning: (warning) => warnings.push(warning),
		});

		expect(warnings).toEqual([]);
	});
});
