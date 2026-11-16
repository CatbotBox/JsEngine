import {describe, expect, test} from "../testing/harness";
import {MATH_RANDOM_SOURCE, Mulberry32Random, randomSourceFor} from "./randomSource";

const ZERO_SEED = 0;
const DEMO_SEED = 20261116;
const MULBERRY32_ZERO_SEED_START = [0.26642920868471265, 0.0003297457005828619];
const MULBERRY32_DEMO_SEED_START = [0.24904050142504275, 0.10314120398834348, 0.48695939942263067];
const SCRIPTED_VALUES = [0.25, 0.5];
const DRAWS = 1000;

function draw(source: {next(): number}, count: number): number[] {
    return Array.from({length: count}, () => source.next());
}

describe("Mulberry32Random", () => {
    test("matches the reference mulberry32 sequence for a seed", () => {
        expect(draw(new Mulberry32Random(ZERO_SEED), MULBERRY32_ZERO_SEED_START.length)).toEqual(MULBERRY32_ZERO_SEED_START);
        expect(draw(new Mulberry32Random(DEMO_SEED), MULBERRY32_DEMO_SEED_START.length)).toEqual(MULBERRY32_DEMO_SEED_START);
    });

    test("stays within [0, 1)", () => {
        const values = draw(new Mulberry32Random(DEMO_SEED), DRAWS);
        expect(values.every(value => value >= 0 && value < 1)).toBe(true);
    });
});

describe("randomSourceFor", () => {
    test("a seed gives a reproducible sequence", () => {
        expect(draw(randomSourceFor(DEMO_SEED), DRAWS)).toEqual(draw(randomSourceFor(DEMO_SEED), DRAWS));
    });

    test("no seed reads Math.random at each draw, so a replaced Math.random is used", () => {
        const realRandom = Math.random;
        const scripted = [...SCRIPTED_VALUES];
        Math.random = () => scripted.shift()!;
        try {
            const source = randomSourceFor(undefined);
            expect(source).toBe(MATH_RANDOM_SOURCE);
            expect(draw(source, SCRIPTED_VALUES.length)).toEqual(SCRIPTED_VALUES);
        } finally {
            Math.random = realRandom;
        }
    });
});
