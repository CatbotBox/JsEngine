import type * as NodeTestModule from "node:test";
import type * as StrictAssertModule from "node:assert/strict";

export type TestBody = () => void | Promise<void>;

const DEFAULT_CLOSE_TO_DIGITS = 2;

export interface Matchers<T> {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeCloseTo(expected: number, digits?: number): void;
    toBeGreaterThan(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeDefined(): void;
    toBeUndefined(): void;
    toBeInstanceOf(ctor: abstract new (...args: never[]) => unknown): void;
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
    const nodeTest: typeof NodeTestModule = require("node:test");
    const assert: typeof StrictAssertModule = require("node:assert/strict");

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

        public toBeCloseTo(expected: number, digits: number = DEFAULT_CLOSE_TO_DIGITS): void {
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
                this.check(didThrow, "to throw");
                return;
            }

            const message = thrown instanceof Error ? thrown.message : String(thrown);
            let matched = true;
            if (typeof expected === "string") matched = message.includes(expected);
            else if (expected instanceof RegExp) matched = expected.test(message);
            else if (typeof expected === "function") matched = thrown instanceof (expected as Function);

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
