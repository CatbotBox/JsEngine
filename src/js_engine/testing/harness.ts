/**
 * Runtime-agnostic test harness.
 *
 * The suites in this repo were written against `bun:test`, which node cannot
 * resolve. Importing from here instead keeps a single source of truth for both
 * runtimes:
 *
 *   bun test                                     -> delegates to `bun:test`
 *   node --test -r ts-node/register/transpile-only  -> `node:test` + the small
 *                                                      jest-style `expect`
 *                                                      implemented below
 *
 * Only the matchers the suites actually use are implemented. Adding one is
 * cheap — write it here rather than reaching for `bun:test` directly, or the
 * node path silently loses coverage.
 */

export type TestBody = () => void | Promise<void>;

export interface Matchers<T> {
    /** Object.is identity, like jest/bun `toBe`. */
    toBe(expected: unknown): void;
    /** Structural (deep) equality. */
    toEqual(expected: unknown): void;
    toBeCloseTo(expected: number, digits?: number): void;
    toBeGreaterThan(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeDefined(): void;
    toBeUndefined(): void;
    toBeInstanceOf(ctor: abstract new (...args: never[]) => unknown): void;
    /** Only meaningful when the value under test is a function. */
    toThrow(expected?: string | RegExp | (abstract new (...args: never[]) => unknown)): void;
    readonly not: Matchers<T>;
}

export interface Harness {
    describe(name: string, body: () => void): void;
    test(name: string, body: TestBody): void;
    it(name: string, body: TestBody): void;
    expect<T>(actual: T): Matchers<T>;
    beforeEach(body: TestBody): void;
    afterEach(body: TestBody): void;
    beforeAll(body: TestBody): void;
    afterAll(body: TestBody): void;
}

const isBun = typeof (globalThis as {Bun?: unknown}).Bun !== "undefined";

function nodeHarness(): Harness {
    // Explicit annotations (rather than `as`) because `assert.fail` is a
    // never-returning call target — TS2775 rejects it off an inferred binding.
    const nodeTest: typeof import("node:test") = require("node:test");
    const assert: typeof import("node:assert/strict") = require("node:assert/strict");

    const deepEqual = (a: unknown, b: unknown): boolean => {
        try {
            assert.deepStrictEqual(a, b);
            return true;
        } catch {
            return false;
        }
    };

    const show = (v: unknown): string => {
        try {
            return typeof v === "string" ? JSON.stringify(v) : String(JSON.stringify(v) ?? String(v));
        } catch {
            return String(v);
        }
    };

    class NodeMatchers<T> implements Matchers<T> {
        public constructor(private readonly actual: T, private readonly negated: boolean = false) {
        }

        public get not(): Matchers<T> {
            return new NodeMatchers(this.actual, !this.negated);
        }

        private check(passed: boolean, describeIt: string): void {
            if (passed !== this.negated) return;
            const not = this.negated ? "not " : "";
            assert.fail(`expected ${show(this.actual)} ${not}${describeIt}`);
        }

        public toBe(expected: unknown): void {
            this.check(Object.is(this.actual, expected), `to be ${show(expected)}`);
        }

        public toEqual(expected: unknown): void {
            this.check(deepEqual(this.actual, expected), `to equal ${show(expected)}`);
        }

        public toBeCloseTo(expected: number, digits: number = 2): void {
            const diff = Math.abs((this.actual as unknown as number) - expected);
            this.check(diff < Math.pow(10, -digits) / 2, `to be close to ${expected} (${digits} digits)`);
        }

        public toBeGreaterThan(expected: number): void {
            this.check((this.actual as unknown as number) > expected, `to be greater than ${expected}`);
        }

        public toBeLessThan(expected: number): void {
            this.check((this.actual as unknown as number) < expected, `to be less than ${expected}`);
        }

        public toBeDefined(): void {
            this.check(this.actual !== undefined, "to be defined");
        }

        public toBeUndefined(): void {
            this.check(this.actual === undefined, "to be undefined");
        }

        public toBeInstanceOf(ctor: abstract new (...args: never[]) => unknown): void {
            this.check(this.actual instanceof ctor, `to be an instance of ${ctor.name}`);
        }

        public toThrow(expected?: string | RegExp | (abstract new (...args: never[]) => unknown)): void {
            let thrown: unknown;
            let didThrow = false;
            try {
                (this.actual as unknown as () => unknown)();
            } catch (e) {
                didThrow = true;
                thrown = e;
            }

            if (!didThrow) {
                this.check(false, "to throw");
                return;
            }

            const message = thrown instanceof Error ? thrown.message : String(thrown);
            let matched = true;
            if (typeof expected === "string") matched = message.includes(expected);
            else if (expected instanceof RegExp) matched = expected.test(message);
            else if (typeof expected === "function") matched = thrown instanceof (expected as Function);

            // `.not.toThrow(matcher)` means "did not throw a matching error", so the
            // negation applies to the match, not to the fact that something threw.
            this.check(matched, `to throw ${expected === undefined ? "" : show(String(expected))}`.trim());
        }
    }

    return {
        describe: nodeTest.describe,
        test: nodeTest.test,
        it: nodeTest.it,
        expect: <T>(actual: T): Matchers<T> => new NodeMatchers(actual),
        beforeEach: nodeTest.beforeEach,
        afterEach: nodeTest.afterEach,
        beforeAll: nodeTest.before,
        afterAll: nodeTest.after,
    };
}

const harness: Harness = isBun
    ? (require("bun:test") as unknown as Harness)
    : nodeHarness();

export const describe = harness.describe;
export const test = harness.test;
export const it = harness.it;
export const expect = harness.expect;
export const beforeEach = harness.beforeEach;
export const afterEach = harness.afterEach;
export const beforeAll = harness.beforeAll;
export const afterAll = harness.afterAll;
