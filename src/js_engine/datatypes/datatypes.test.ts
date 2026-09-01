import {describe, expect, test} from "../testing/harness";
import {RingQueue} from "./ringQueue";
import {AverageStat} from "./averageStat";
import {VecArray} from "../math/types/vecArray";

describe("AverageStat", () => {
    /**
     * Regression: getAvg() used to divide by the window *capacity* rather than the number of
     * samples held, because AverageStat.sampleSize returned RingQueue's `length` ctor field
     * (the capacity) instead of `count`. A partially filled window therefore read low - which
     * is what the demos' FPS counter showed on startup.
     */
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

        stat.add(4); // evicts the 1
        expect(stat.sampleSize).toBe(3);
        expect(stat.getAvg()).toBe(3);
    });

    test("requireFilledBuffer declines to answer until the window fills", () => {
        const stat = new AverageStat(3);
        stat.add(1);
        expect(stat.getAvg(true)).toBe(undefined);
        stat.add(2);
        stat.add(3);
        expect(stat.getAvg(true)).toBe(2);
    });
});

describe("RingQueue", () => {
    /** Regression: add() only grew the capacity and dropped the item on the floor. */
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
    /**
     * Regression: the factor check read `test.factor !== factor`, so passing a factor made the
     * guard return true precisely when the factor did NOT match.
     */
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
