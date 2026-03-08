declare module "bun:test" {
	export const expect: (typeof import("vitest"))["expect"];
	export function test(name: string, fn: () => void | Promise<void>): void;
	export function describe(name: string, fn: () => void): void;
}
