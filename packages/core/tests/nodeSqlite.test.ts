import { afterEach, describe, expect, it, vi } from "vitest";

const originalEmitWarning = process.emitWarning.bind(process);
const originalVersions = process.versions;

function setEmitWarning(fn: typeof process.emitWarning): void {
	Object.defineProperty(process, "emitWarning", {
		configurable: true,
		writable: true,
		value: fn,
	});
}

describe("node sqlite helper", () => {
	afterEach(() => {
		setEmitWarning(originalEmitWarning);
		Object.defineProperty(process, "versions", {
			configurable: true,
			value: originalVersions,
		});
		vi.resetModules();
		vi.unmock("node:sqlite");
	});

	it("returns false for malformed node versions", async () => {
		const { supportsReadBigInts } = await import("../src/util/nodeSqlite.js");
		Object.defineProperty(process, "versions", {
			configurable: true,
			value: { ...originalVersions, node: "garbage" },
		});
		expect(supportsReadBigInts()).toBe(false);
	});

	it("caches imports and suppresses only sqlite experimental warnings", async () => {
		const emitted: unknown[][] = [];
		const emitSpy = vi.fn((...args: unknown[]) => {
			emitted.push(args);
		}) as unknown as typeof process.emitWarning;
		setEmitWarning(emitSpy);

		const moduleObject = { DatabaseSync: class DatabaseSync {} };
		vi.doMock("node:sqlite", () => {
			(process.emitWarning as unknown as (...args: unknown[]) => void)(
				"SQLite is an experimental feature",
				"ExperimentalWarning",
			);
			(process.emitWarning as unknown as (...args: unknown[]) => void)(
				"SQLite is an experimental feature",
				{ type: "ExperimentalWarning" },
			);
			const warning = new Error("SQLite is an experimental feature");
			warning.name = "ExperimentalWarning";
			(process.emitWarning as unknown as (...args: unknown[]) => void)(warning);
			(process.emitWarning as unknown as (...args: unknown[]) => void)("keep me", "Warning");
			return moduleObject;
		});

		const { importNodeSqlite } = await import("../src/util/nodeSqlite.js");
		const first = await importNodeSqlite();
		const second = await importNodeSqlite();
		expect(first).toBe(second);
		expect(first.DatabaseSync).toBe(moduleObject.DatabaseSync);
		expect(emitted).toEqual([["keep me", "Warning"]]);
		(Reflect.get(process, "emitWarning") as (...args: unknown[]) => void)(
			"after import",
			"Warning",
		);
		expect(emitted).toEqual([
			["keep me", "Warning"],
			["after import", "Warning"],
		]);
	});
});
