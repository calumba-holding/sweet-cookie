import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type ResolvedCookiesDb = {
	dbPath: string;
	profile?: string;
	storeId?: string;
};

export const ALL_CHROMIUM_PROFILES = Symbol("sweet-cookie.ALL_CHROMIUM_PROFILES");
export type ChromiumProfileSelector = string | typeof ALL_CHROMIUM_PROFILES;

type ResolveCookiesOptions = {
	profile?: ChromiumProfileSelector;
	roots: string[];
	cookieStoreOrder?: "legacy-first" | "network-first";
	onWarning?: (warning: string) => void;
};

export function looksLikePath(value: string): boolean {
	return value.includes("/") || value.includes("\\");
}

export function expandPath(input: string): string {
	if (input.startsWith("~/")) {
		return path.join(homedir(), input.slice(2));
	}
	return path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
}

export function safeStat(
	candidate: string,
): { isFile: () => boolean; isDirectory: () => boolean } | null {
	try {
		return statSync(candidate);
	} catch {
		return null;
	}
}

export function resolveCookiesDbFromProfileOrRoots(options: ResolveCookiesOptions): string | null {
	return resolveCookiesDbsFromProfileOrRoots(options)[0]?.dbPath ?? null;
}

export function resolveCookiesDbsFromProfileOrRoots(
	options: ResolveCookiesOptions,
): ResolvedCookiesDb[] {
	const candidates: string[] = [];

	if (typeof options.profile === "string" && looksLikePath(options.profile)) {
		const expanded = expandPath(options.profile);
		const stat = safeStat(expanded);
		if (stat?.isFile()) {
			return [
				withOptionalProfile(expanded, profileNameFromDbPath(expanded), storeIdFromDbPath(expanded)),
			];
		}
		candidates.push(path.join(expanded, "Cookies"));
		candidates.push(path.join(expanded, "Network", "Cookies"));
		for (const candidate of candidates) {
			if (existsSync(candidate)) {
				return [withOptionalProfile(candidate, path.basename(expanded), expanded)];
			}
		}
		return [];
	}

	const requestedProfile = typeof options.profile === "string" ? options.profile.trim() : undefined;
	if (!requestedProfile && options.profile !== ALL_CHROMIUM_PROFILES) {
		for (const root of options.roots) {
			if (!existsSync(root)) {
				continue;
			}
			const dbPath = resolveCookiesDbInProfileDir(
				path.join(root, "Default"),
				options.cookieStoreOrder,
			);
			if (dbPath) {
				return [{ dbPath, profile: "Default" }];
			}
		}
		return [];
	}

	const resolved: ResolvedCookiesDb[] = [];
	const includeStoreId = options.roots.length > 1;
	for (const root of options.roots) {
		if (!existsSync(root)) {
			continue;
		}
		const profileDirs = requestedProfile
			? resolveProfileDirNames(root, requestedProfile, options.onWarning)
			: discoverProfileDirNames(root, options.onWarning);
		for (const profileDir of profileDirs) {
			const dbPath = resolveCookiesDbInProfileDir(
				path.join(root, profileDir),
				options.cookieStoreOrder,
			);
			if (dbPath) {
				const item: ResolvedCookiesDb = { dbPath, profile: profileDir };
				if (includeStoreId) {
					item.storeId = root;
				}
				resolved.push(item);
			}
		}
	}

	return dedupeResolvedDbs(resolved);
}

function resolveProfileDirNames(
	root: string,
	profile: string,
	onWarning?: (warning: string) => void,
): string[] {
	const names = [profile];
	const aliases = readChromiumProfileAliases(root, onWarning);
	for (const [profileDir, displayName] of aliases) {
		if (displayName === profile && !names.includes(profileDir)) {
			names.push(profileDir);
		}
	}
	return names;
}

function discoverProfileDirNames(root: string, onWarning?: (warning: string) => void): string[] {
	const seenWarnings = new Set<string>();
	const reportWarning = (warning: string) => {
		if (!seenWarnings.has(warning)) {
			seenWarnings.add(warning);
			onWarning?.(warning);
		}
	};
	const names: string[] = [];
	for (const profileDir of readChromiumProfileAliases(root, reportWarning).keys()) {
		if (!names.includes(profileDir)) {
			names.push(profileDir);
		}
	}
	for (const entry of safeReaddir(root, reportWarning)) {
		const profileDir = path.join(root, entry);
		if (resolveCookiesDbInProfileDir(profileDir) && !names.includes(entry)) {
			names.push(entry);
		}
	}
	return names;
}

function readChromiumProfileAliases(
	root: string,
	onWarning?: (warning: string) => void,
): Map<string, string> {
	try {
		const localState = JSON.parse(readFileSync(path.join(root, "Local State"), "utf8")) as unknown;
		const infoCache =
			typeof localState === "object" && localState !== null
				? (localState as { profile?: { info_cache?: unknown } }).profile?.info_cache
				: undefined;
		if (typeof infoCache !== "object" || infoCache === null) {
			return new Map();
		}
		const aliases = new Map<string, string>();
		for (const [profileDir, value] of Object.entries(infoCache)) {
			if (typeof value !== "object" || value === null) {
				continue;
			}
			const name = (value as { name?: unknown }).name;
			if (typeof name === "string" && name.trim()) {
				aliases.set(profileDir, name);
			}
		}
		return aliases;
	} catch (error) {
		reportPermissionError(error, root, onWarning);
		return new Map();
	}
}

function resolveCookiesDbInProfileDir(
	profileDir: string,
	order: "legacy-first" | "network-first" = "legacy-first",
): string | null {
	const legacy = path.join(profileDir, "Cookies");
	const network = path.join(profileDir, "Network", "Cookies");
	const candidates = order === "network-first" ? [network, legacy] : [legacy, network];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

function safeReaddir(dir: string, onWarning?: (warning: string) => void): string[] {
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
	} catch (error) {
		reportPermissionError(error, dir, onWarning);
		return [];
	}
}

function reportPermissionError(
	error: unknown,
	pathValue: string,
	onWarning?: (warning: string) => void,
): void {
	const code =
		typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
	if (code === "EPERM" || code === "EACCES") {
		onWarning?.(`Permission denied reading Chromium profile data at ${pathValue}.`);
	}
}

export function profileNameFromDbPath(dbPath: string): string | undefined {
	const parent = path.basename(path.dirname(dbPath));
	if (parent === "Network") {
		return path.basename(path.dirname(path.dirname(dbPath)));
	}
	return parent || undefined;
}

export function storeIdFromDbPath(dbPath: string): string {
	const parent = path.basename(path.dirname(dbPath));
	return parent === "Network" ? path.dirname(path.dirname(dbPath)) : path.dirname(dbPath);
}

function dedupeResolvedDbs(resolved: ResolvedCookiesDb[]): ResolvedCookiesDb[] {
	const seen = new Set<string>();
	const deduped: ResolvedCookiesDb[] = [];
	for (const item of resolved) {
		if (seen.has(item.dbPath)) {
			continue;
		}
		seen.add(item.dbPath);
		deduped.push(item);
	}
	return deduped;
}

function withOptionalProfile(
	dbPath: string,
	profile: string | undefined,
	storeId?: string,
): ResolvedCookiesDb {
	const resolved: ResolvedCookiesDb = { dbPath };
	if (profile !== undefined) {
		resolved.profile = profile;
	}
	if (storeId !== undefined) {
		resolved.storeId = storeId;
	}
	return resolved;
}
