import {describe, expect, test} from "../testing/harness";
import {RingQueue} from "./ringQueue";
import {AverageStat} from "./averageStat";
import {VecArray} from "../math/types/vecArray";

const REQUIRE_FILLED_BUFFER = true;

describe("AverageStat", () => {
    test("averages over the samples held, not the window capacity", () => {
        const stat = new AverageStat(10);
        stat.add(30);
        stat.add(60);

        expect(stat.sampleSize).toBe(2);
        expect(stat.getAvg()).toBe(45);
    });

    test("still averages correctly once the window is full and wrapping", () => {
        const stat = new AverageStat(3);
        for (const v of [1, 2, 3]) stat.add(v);
        expect(stat.getAvg()).toBe(2);

        stat.add(4);
        expect(stat.sampleSize).toBe(3);
        expect(stat.getAvg()).toBe(3);
    });

    test("requireFilledBuffer declines to answer until the window fills", () => {
        const stat = new AverageStat(3);
        stat.add(1);
        expect(stat.getAvg(REQUIRE_FILLED_BUFFER)).toBe(undefined);
        stat.add(2);
        stat.add(3);
        expect(stat.getAvg(REQUIRE_FILLED_BUFFER)).toBe(2);
    });
});

describe("RingQueue", () => {
    test("add stores the item", () => {
        const q = new RingQueue<number>(4);
        q.add(7);

        expect(q.count).toBe(1);
        expect(q.peek()).toBe(7);
    });

    test("add grows past the initial capacity instead of overwriting", () => {
        const q = new RingQueue<number>(2);
        q.add(1);
        q.add(2);
        q.add(3);

        expect(q.count).toBe(3);
        expect(q.dequeue()).toBe(1);
        expect(q.dequeue()).toBe(2);
        expect(q.dequeue()).toBe(3);
    });

    test("addAndOverride evicts the oldest once full and returns it", () => {
        const q = new RingQueue<number>(2);
        expect(q.addAndOverride(1)).toBe(undefined);
        expect(q.addAndOverride(2)).toBe(undefined);
        expect(q.isFull).toBe(true);
        expect(q.addAndOverride(3)).toBe(1);
        expect(q.count).toBe(2);
    });
});

describe("VecArray.isVecArray", () => {
    test("accepts a matching factor and rejects a mismatching one", () => {
        const vecs = new VecArray(2, 3);

        expect(VecArray.isVecArray(vecs, 3)).toBe(true);
        expect(VecArray.isVecArray(vecs, 2)).toBe(false);
    });

    test("with no factor given, checks only the shape", () => {
        expect(VecArray.isVecArray(new VecArray(1, 3))).toBe(true);
        expect(VecArray.isVecArray({})).toBe(false);
    });
});
