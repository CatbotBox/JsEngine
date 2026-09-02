import {describe, expect, test} from "../../testing/harness";
import {asFloat32Array, fromFloat32Array, Vec, Vec3} from "./vec";
import {AABB, AABB_STRIDE} from "../../datatypes/AABB";
import {LocalToWorld} from "../../translation/localToWorld";
import {Quaternions} from "../quaternions";
import {RenderBounds} from "../../rendering/renderBounds";

describe("Vec", () => {
    test("is Float32Array-backed regardless of how it was made", () => {
        // The old union type meant `Vec3` was a Float32Array from a component and
        // a plain array from Vec.add() — this is the invariant that replaced it.
        for (const v of [Vec.alloc3(), Vec.alloc3(1, 2, 3), Vec.of<3>([1, 2, 3]), Vec.clone(Vec.alloc3())]) {
            expect(asFloat32Array(v)).toBeInstanceOf(Float32Array);
            expect(Vec.size(v)).toBe(3);
        }
    });

    test("accessors round-trip", () => {
        const v = Vec.alloc4(1, 2, 3, 4);
        expect([Vec.x(v), Vec.y(v), Vec.z(v), Vec.w(v)]).toEqual([1, 2, 3, 4]);
        Vec.setX(v, 9);
        Vec.set(v, 3, 8);
        expect(Vec.get(v, 0)).toBe(9);
        expect(Vec.w(v)).toBe(8);
    });

    test("float32 precision is honest about itself", () => {
        // Vec is f32, not f64 — worth pinning so a future change to f64 is deliberate.
        const v = Vec.alloc3(0.1, 0, 0);
        expect(Vec.x(v)).toBeCloseTo(0.1, 6);
        expect(Vec.x(v)).not.toBe(0.1);
    });

    test("arithmetic writes into out and allocates nothing", () => {
        const a = Vec.alloc3(1, 2, 3);
        const b = Vec.alloc3(10, 20, 30);
        const out = Vec.alloc3();

        expect(Vec.addInto(out, a, b)).toBe(out); // returns the same object
        expect(Vec.toArray(out)).toEqual([11, 22, 33]);
        expect(Vec.toArray(a)).toEqual([1, 2, 3]); // inputs untouched

        Vec.subInto(out, b, a);
        expect(Vec.toArray(out)).toEqual([9, 18, 27]);
        Vec.mulInto(out, a, b);
        expect(Vec.toArray(out)).toEqual([10, 40, 90]);
        Vec.scaleInto(out, a, 2);
        expect(Vec.toArray(out)).toEqual([2, 4, 6]);
        Vec.minInto(out, a, b);
        expect(Vec.toArray(out)).toEqual([1, 2, 3]);
        Vec.maxInto(out, a, b);
        expect(Vec.toArray(out)).toEqual([10, 20, 30]);
    });

    test("out may alias an input", () => {
        const a = Vec.alloc3(1, 2, 3);
        Vec.addInto(a, a, a);
        expect(Vec.toArray(a)).toEqual([2, 4, 6]);

        // cross writes through locals, so aliasing must still be correct
        const x = Vec.alloc3(1, 0, 0);
        const y = Vec.alloc3(0, 1, 0);
        Vec.crossInto(x, x, y);
        expect(Vec.toArray(x)).toEqual([0, 0, 1]);
    });

    test("dot, length and normalize", () => {
        const a = Vec.alloc3(3, 4, 0);
        expect(Vec.dot(a, a)).toBe(25);
        expect(Vec.length(a)).toBe(5);
        expect(Vec.lengthSquared(a)).toBe(25);

        const n = Vec.normalizeInto(Vec.alloc3(), a);
        expect(Vec.length(n)).toBeCloseTo(1);
        // a zero vector normalizes to itself rather than NaN
        expect(Vec.toArray(Vec.normalizeInto(Vec.alloc3(), Vec.alloc3()))).toEqual([0, 0, 0]);
    });

    test("fromFloat32Array aliases rather than copies", () => {
        const raw = new Float32Array([1, 2, 3]);
        const v = fromFloat32Array<3>(raw);
        Vec.setX(v, 42);
        expect(raw[0]).toBe(42); // same storage
    });

    test("equals compares by value", () => {
        expect(Vec.equals(Vec.alloc3(1, 2, 3), Vec.alloc3(1, 2, 3))).toBe(true);
        expect(Vec.equals(Vec.alloc3(1, 2, 3), Vec.alloc3(1, 2, 4))).toBe(false);
    });
});

describe("AABB", () => {
    test("layout matches RenderBounds field order", () => {
        // This is what lets RenderBounds hand out its backing array directly
        // instead of reimplementing the interface.
        const rb = new RenderBounds();
        rb.xMin = 1;
        rb.yMin = 2;
        rb.zMin = 3;
        rb.xMax = 4;
        rb.yMax = 5;
        rb.zMax = 6;

        const b = rb.bounds;
        expect(AABB.asFloat32Array(b).length).toBe(AABB_STRIDE);
        expect([AABB.xMin(b), AABB.yMin(b), AABB.zMin(b)]).toEqual([1, 2, 3]);
        expect([AABB.xMax(b), AABB.yMax(b), AABB.zMax(b)]).toEqual([4, 5, 6]);

        // and it is a live view, not a snapshot
        rb.xMin = 99;
        expect(AABB.xMin(b)).toBe(99);
    });

    test("intersects and contains", () => {
        const a = AABB.of(0, 0, 0, 10, 10, 10);
        expect(AABB.intersects(a, AABB.of(5, 5, 5, 15, 15, 15))).toBe(true);
        expect(AABB.intersects(a, AABB.of(11, 0, 0, 12, 1, 1))).toBe(false);
        expect(AABB.intersects(a, AABB.of(10, 10, 10, 11, 11, 11))).toBe(true); // touching counts

        expect(AABB.contains(a, AABB.of(1, 1, 1, 2, 2, 2))).toBe(true);
        expect(AABB.contains(a, AABB.of(1, 1, 1, 11, 2, 2))).toBe(false);
        expect(AABB.contains(a, a)).toBe(true);
    });

    test("unionInto covers both and may alias", () => {
        const a = AABB.of(0, 0, 0, 1, 1, 1);
        const b = AABB.of(5, -5, 2, 6, -4, 3);
        const out = AABB.alloc();

        AABB.unionInto(out, a, b);
        expect(AABB.contains(out, a)).toBe(true);
        expect(AABB.contains(out, b)).toBe(true);
        expect([AABB.xMin(out), AABB.yMin(out), AABB.zMin(out)]).toEqual([0, -5, 0]);

        AABB.unionInto(a, a, b); // aliasing
        expect(AABB.equals(a, out)).toBe(true);
    });

    test("inflateInto scales about the centre with a half-extent floor", () => {
        const b = AABB.of(0, 0, 0, 10, 10, 10);
        const out = AABB.inflateInto(AABB.alloc(), b, 2);
        expect([AABB.xMin(out), AABB.xMax(out)]).toEqual([-5, 15]); // centre 5, half-extent 10

        // a degenerate box still gets the 0.5 floor rather than staying a point
        const point = AABB.of(1, 1, 1, 1, 1, 1);
        const inflated = AABB.inflateInto(AABB.alloc(), point, 1.1);
        expect(AABB.xMax(inflated) - AABB.xMin(inflated)).toBeCloseTo(1);
    });

    test("wrap aliases and rejects short arrays", () => {
        const raw = new Float32Array([1, 2, 3, 4, 5, 6]);
        const b = AABB.wrap(raw);
        raw[0] = 9;
        expect(AABB.xMin(b)).toBe(9);
        expect(() => AABB.wrap(new Float32Array(5))).toThrow(/at least 6/);
    });

    test("min/max are live subviews", () => {
        const b = AABB.of(1, 2, 3, 4, 5, 6);
        expect(Vec.toArray(AABB.min(b))).toEqual([1, 2, 3]);
        expect(Vec.toArray(AABB.max(b))).toEqual([4, 5, 6]);
        Vec.setX(AABB.min(b), 42);
        expect(AABB.xMin(b)).toBe(42);
    });
});

describe("LocalToWorld after the Vec rework", () => {
    test("TRS round-trips through decomposition", () => {
        const l2w = new LocalToWorld();
        const p = Vec.alloc3(3, -4, 5);
        const q = Quaternions.eulerToQuat(Vec.alloc3(30, 45, 60), "ZYX", {deg: true});
        const s = Vec.alloc3(2, 2, 2);

        l2w.setTRS(p, q, s);

        expect(Vec.toArray(l2w.position)).toEqual([3, -4, 5]);
        const scale = l2w.scale;
        expect(Vec.x(scale)).toBeCloseTo(2, 4);
        expect(Vec.y(scale)).toBeCloseTo(2, 4);
        expect(Vec.z(scale)).toBeCloseTo(2, 4);

        // Quaternion sign is arbitrary, so compare orientation via the rebuilt matrix.
        const rebuilt = LocalToWorld.fromTRS(Vec.alloc<16>(16), l2w.position, l2w.rotation, l2w.scale);
        const a = asFloat32Array(rebuilt), b = asFloat32Array(l2w.matrix);
        for (let i = 0; i < 16; i++) expect(a[i]).toBeCloseTo(b[i], 3);
    });

    test("position is a live view into the matrix", () => {
        const l2w = new LocalToWorld();
        Vec.setX(l2w.position, 7);
        expect(asFloat32Array(l2w.matrix)[12]).toBe(7);
    });

    test("scaleInto and rotationInto allocate nothing and match the getters", () => {
        const l2w = new LocalToWorld();
        l2w.setTRS(Vec.alloc3(1, 2, 3), Vec.alloc4(0, 0, 0, 1), Vec.alloc3(1, 2, 3));

        const s = Vec.alloc3();
        expect(l2w.decomposeScaleInto(s)).toBe(s);
        expect(Vec.toArray(s)).toEqual(Vec.toArray(l2w.scale));

        const r = Vec.alloc4();
        expect(l2w.rotationInto(r)).toBe(r);
        expect(Vec.toArray(r)).toEqual(Vec.toArray(l2w.rotation));
    });

    test("identity and mul", () => {
        const i = LocalToWorld.identity();
        const m = LocalToWorld.fromTRS(Vec.alloc<16>(16), Vec.alloc3(1, 2, 3), Vec.alloc4(0, 0, 0, 1), Vec.alloc3(1, 1, 1));
        const out = LocalToWorld.mul(i, m, Vec.alloc<16>(16));
        expect(Vec.toArray(out)).toEqual(Vec.toArray(m)); // I * M === M
    });

    test("transformPoint honours an out parameter", () => {
        const m = LocalToWorld.fromTRS(Vec.alloc<16>(16), Vec.alloc3(10, 0, 0), Vec.alloc4(0, 0, 0, 1), Vec.alloc3(1, 1, 1));
        const out: Vec3 = Vec.alloc3();
        expect(LocalToWorld.transformPoint(m, Vec.alloc3(1, 2, 3), out)).toBe(out);
        expect(Vec.toArray(out)).toEqual([11, 2, 3]);
    });

    test("invertAffine undoes the transform", () => {
        const m = LocalToWorld.fromTRS(Vec.alloc<16>(16), Vec.alloc3(5, -2, 1), Vec.alloc4(0, 0, 0, 1), Vec.alloc3(2, 2, 2));
        const inv = LocalToWorld.invertAffine(m);
        const round = LocalToWorld.transformPoint(inv, LocalToWorld.transformPoint(m, Vec.alloc3(1, 1, 1)));
        expect(Vec.x(round)).toBeCloseTo(1, 4);
        expect(Vec.y(round)).toBeCloseTo(1, 4);
        expect(Vec.z(round)).toBeCloseTo(1, 4);
    });
});

describe("Quaternions", () => {
    test("eulerToQuat produces a unit quaternion", () => {
        const q = Quaternions.eulerToQuat(Vec.alloc3(15, 30, 45), "ZYX", {deg: true});
        expect(Vec.length(q)).toBeCloseTo(1, 5);
    });

    test("identity euler gives identity rotation", () => {
        const q = Quaternions.eulerToQuat(Vec.alloc3(0, 0, 0));
        expect(Vec.w(q)).toBeCloseTo(1, 6);
        expect(Vec.x(q)).toBeCloseTo(0, 6);
    });

    test("qMulInto allocates nothing and composes", () => {
        const a = Quaternions.eulerToQuat(Vec.alloc3(0, 0, 90), "ZYX", {deg: true});
        const out = Vec.alloc4();
        expect(Quaternions.qMulInto(out, a, a)).toBe(out);
        // 90° + 90° about Z === 180°, i.e. w ≈ 0
        expect(Vec.w(out)).toBeCloseTo(0, 5);
    });

    test("the shared scratch does not corrupt repeated calls", () => {
        // eulerToQuat reuses module-level scratch; back-to-back calls must agree
        // with independently computed values.
        const first = Vec.clone(Quaternions.eulerToQuat(Vec.alloc3(10, 20, 30), "ZYX", {deg: true}));
        Quaternions.eulerToQuat(Vec.alloc3(90, 0, 45), "XYZ", {deg: true});
        const again = Quaternions.eulerToQuat(Vec.alloc3(10, 20, 30), "ZYX", {deg: true});
        expect(Vec.toArray(again)).toEqual(Vec.toArray(first));
    });
});
