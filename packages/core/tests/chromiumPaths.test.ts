import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveChromiumCookiesDbLinux } from "../src/providers/chromium/linuxPaths.js";
import {
	expandPath,
	looksLikePath,
	resolveCookiesDbFromProfileOrRoots,
	safeStat,
} from "../src/providers/chromium/paths.js";
import { resolveChromiumPathsWindows } from "../src/providers/chromium/windowsPaths.js";

describe("chromium path helpers", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("handles generic path helpers", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-paths-"));
		const file = path.join(dir, "Cookies");
		writeFileSync(file, "", "utf8");

		expect(looksLikePath("Default")).toBe(false);
		expect(looksLikePath("Profile 1/Cookies")).toBe(true);
		expect(expandPath("~/Library")).toBe(path.join(homedir(), "Library"));
		expect(expandPath(file)).toBe(file);
		expect(safeStat(file)?.isFile()).toBe(true);
		expect(safeStat(path.join(dir, "missing"))).toBeNull();
	});

	it("resolves cookies DBs from explicit files, profile directories, and roots", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-roots-"));
		const explicitFile = path.join(dir, "explicit", "Cookies");
		mkdirSync(path.dirname(explicitFile), { recursive: true });
		writeFileSync(explicitFile, "", "utf8");

		expect(
			resolveCookiesDbFromProfileOrRoots({
				profile: explicitFile,
				roots: [path.join(dir, "unused")],
			}),
		).toBe(explicitFile);

		const profileDir = path.join(dir, "profile-dir");
		mkdirSync(path.join(profileDir, "Network"), { recursive: true });
		writeFileSync(path.join(profileDir, "Network", "Cookies"), "", "utf8");
		expect(resolveCookiesDbFromProfileOrRoots({ profile: profileDir, roots: [] })).toBe(
			path.join(profileDir, "Network", "Cookies"),
		);

		const root = path.join(dir, "root");
		mkdirSync(path.join(root, "Profile 2"), { recursive: true });
		writeFileSync(path.join(root, "Profile 2", "Cookies"), "", "utf8");
		expect(resolveCookiesDbFromProfileOrRoots({ profile: "Profile 2", roots: [root] })).toBe(
			path.join(root, "Profile 2", "Cookies"),
		);
	});

	it("resolves linux Chromium DBs from XDG config roots and explicit paths", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-linux-paths-"));
		vi.stubEnv("HOME", dir);
		vi.stubEnv("XDG_CONFIG_HOME", path.join(dir, "xdg"));

		const defaultDb = path.join(dir, "xdg", "BraveSoftware", "Brave-Browser", "Default", "Cookies");
		mkdirSync(path.dirname(defaultDb), { recursive: true });
		writeFileSync(defaultDb, "", "utf8");

		expect(
			resolveChromiumCookiesDbLinux({
				configDirName: path.join("BraveSoftware", "Brave-Browser"),
			}),
		).toBe(defaultDb);

		const profileDir = path.join(dir, "custom-profile");
		mkdirSync(path.join(profileDir, "Network"), { recursive: true });
		writeFileSync(path.join(profileDir, "Network", "Cookies"), "", "utf8");
		expect(
			resolveChromiumCookiesDbLinux({
				configDirName: "ignored",
				profile: profileDir,
			}),
		).toBe(path.join(profileDir, "Network", "Cookies"));
	});

	it("resolves Windows Chromium DBs and Local State fallbacks", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-windows-paths-"));
		vi.stubEnv("LOCALAPPDATA", dir);

		const root = path.join(dir, "Google", "Chrome", "User Data");
		const dbPath = path.join(root, "Default", "Network", "Cookies");
		mkdirSync(path.dirname(dbPath), { recursive: true });
		writeFileSync(dbPath, "", "utf8");
		writeFileSync(path.join(root, "Local State"), "{}", "utf8");

		expect(
			resolveChromiumPathsWindows({
				localAppDataVendorPath: path.join("Google", "Chrome", "User Data"),
			}),
		).toEqual({ dbPath, userDataDir: root });

		const explicitProfileDir = path.join(dir, "EdgeProfile");
		mkdirSync(explicitProfileDir, { recursive: true });
		writeFileSync(path.join(explicitProfileDir, "Local State"), "{}", "utf8");
		expect(
			resolveChromiumPathsWindows({
				localAppDataVendorPath: path.join("Microsoft", "Edge", "User Data"),
				profile: explicitProfileDir,
			}),
		).toEqual({ dbPath: null, userDataDir: explicitProfileDir });

		expect(
			resolveChromiumPathsWindows({
				localAppDataVendorPath: path.join("Missing", "Chrome", "User Data"),
			}),
		).toEqual({ dbPath: null, userDataDir: path.join(dir, "Missing", "Chrome", "User Data") });
	});
});
