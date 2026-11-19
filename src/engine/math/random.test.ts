import {describe, expect, test} from "../testing/harness";
import {Mulberry32Random} from "./randomSource";
import {Random} from "./random";

const DEMO_SEED = 20261116;
const OTHER_SEED = 7;
const DRAWS = 100;
const SCRIPTED_VALUES = [0, 0.25, 0.5, 0.999];
const RANGE_MIN = -2;
const RANGE_MAX = 6;
const LENGTH = 4;

function draw(source: {next(): number}, count: number): number[] {
    return Array.from({length: count}, () => source.next());
}

function withScriptedMathRandom<T>(values: readonly number[], run: () => T): T {
    const realRandom = Math.random;
    const scripted = [...values];
    Math.random = () => scripted.shift()!;
    try {
        return run();
    } finally {
        Math.random = realRandom;
    }
}

describe("Random", () => {
    test("a seed draws the mulberry32 sequence for that seed", () => {
        expect(draw(new Random(DEMO_SEED), DRAWS)).toEqual(draw(new Mulberry32Random(DEMO_SEED), DRAWS));
    });

    test("no seed reads Math.random at each draw", () => {
        expect(withScriptedMathRandom(SCRIPTED_VALUES, () => draw(new Random(), SCRIPTED_VALUES.length))).toEqual(SCRIPTED_VALUES);
    });

    test("between scales a draw into [min, max) and indexBelow floors it into [0, length)", () => {
        const betweens = withScriptedMathRandom(SCRIPTED_VALUES, () => {
            const random = new Random();
            return SCRIPTED_VALUES.map(() => random.between(RANGE_MIN, RANGE_MAX));
        });
        expect(betweens).toEqual(SCRIPTED_VALUES.map(value => RANGE_MIN + (RANGE_MAX - RANGE_MIN) * value));
        const indices = withScriptedMathRandom(SCRIPTED_VALUES, () => {
            const random = new Random();
            return SCRIPTED_VALUES.map(() => random.indexBelow(LENGTH));
        });
        expect(indices).toEqual([0, 1, 2, 3]);
    });

    test("reseedIfChanged restarts the sequence only when the seed changes", () => {
        const random = new Random(DEMO_SEED);
        const reference = new Mulberry32Random(DEMO_SEED);
        expect(random.next()).toBe(reference.next());
        random.reseedIfChanged(DEMO_SEED);
        expect(random.next()).toBe(reference.next());
        random.reseedIfChanged(OTHER_SEED);
        expect(draw(random, DRAWS)).toEqual(draw(new Mulberry32Random(OTHER_SEED), DRAWS));
    });
});
