import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

type DpapiResult = { ok: true; value: Buffer } | { ok: false; error: string };
type DpapiState = { calls: Buffer[]; next: DpapiResult };

const dpapiState = vi.hoisted<DpapiState>(() => ({
	calls: [],
	next: { ok: true, value: Buffer.from("decrypted") },
}));

vi.mock("../src/providers/chromeSqlite/windowsDpapi.js", () => ({
	dpapiUnprotect: async (value: Buffer) => {
		dpapiState.calls.push(Buffer.from(value));
		return dpapiState.next;
	},
}));

import { getWindowsChromiumMasterKey } from "../src/providers/chromium/windowsMasterKey.js";

function writeLocalState(dir: string, value: unknown): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, "Local State"), JSON.stringify(value), "utf8");
}

describe("windows master key helper", () => {
	beforeEach(() => {
		dpapiState.calls = [];
		dpapiState.next = { ok: true, value: Buffer.from("decrypted") };
	});

	it("returns an error when Local State is missing", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-master-key-"));
		await expect(getWindowsChromiumMasterKey(dir, "Chrome")).resolves.toEqual({
			ok: false,
			error: "Chrome Local State file not found.",
		});
	});

	it("returns parse errors for malformed Local State JSON", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-master-key-"));
		mkdirSync(dir, { recursive: true });
		writeFileSync(path.join(dir, "Local State"), "{", "utf8");

		const result = await getWindowsChromiumMasterKey(dir, "Chrome");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("Failed to parse Chrome Local State");
		}
	});

	it("returns an error when encrypted_key is missing", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-master-key-"));
		writeLocalState(dir, { os_crypt: {} });
		await expect(getWindowsChromiumMasterKey(dir, "Chrome")).resolves.toEqual({
			ok: false,
			error: "Chrome Local State missing os_crypt.encrypted_key.",
		});
	});

	it("returns an error when encrypted_key is missing the DPAPI prefix", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-master-key-"));
		writeLocalState(dir, {
			os_crypt: {
				encrypted_key: Buffer.from("not-dpapi", "utf8").toString("base64"),
			},
		});

		await expect(getWindowsChromiumMasterKey(dir, "Chrome")).resolves.toEqual({
			ok: false,
			error: "Chrome encrypted_key does not start with DPAPI prefix.",
		});
	});

	it("surfaces DPAPI failures", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-master-key-"));
		writeLocalState(dir, {
			os_crypt: {
				encrypted_key: Buffer.concat([Buffer.from("DPAPI"), Buffer.from("secret")]).toString(
					"base64",
				),
			},
		});
		dpapiState.next = { ok: false, error: "access denied" };

		await expect(getWindowsChromiumMasterKey(dir, "Chrome")).resolves.toEqual({
			ok: false,
			error: "DPAPI decrypt failed: access denied",
		});
		expect(dpapiState.calls).toEqual([Buffer.from("secret")]);
	});

	it("returns the unprotected key on success", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-master-key-"));
		writeLocalState(dir, {
			os_crypt: {
				encrypted_key: Buffer.concat([Buffer.from("DPAPI"), Buffer.from("secret")]).toString(
					"base64",
				),
			},
		});

		const result = await getWindowsChromiumMasterKey(dir, "Chrome");
		expect(result).toEqual({ ok: true, value: Buffer.from("decrypted") });
		expect(dpapiState.calls).toEqual([Buffer.from("secret")]);
	});
});
