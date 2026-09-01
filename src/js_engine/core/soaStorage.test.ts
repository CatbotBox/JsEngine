import {beforeEach, describe, expect, test} from "../testing/harness";
import {World} from "./world";
import {Component} from "./component";
import {ComponentType} from "./componentType";
import {EntityManager} from "./entityManager";
import {EntityQuery} from "./entityQuery";
import {Unchanged} from "./entityQueryStream";
import {LocalPosition} from "../translation/localPosition";
import {LocalToWorld} from "../translation/localToWorld";
import {Vec} from "../math/types/vec";

/**
 * Pins the SoA column storage invariants (Phase 2 of docs/soa-migration-plan.md).
 *
 * The dangerous behaviours here are the rebinding ones: an instance's typed-array
 * fields are views into the archetype column, and every operation that moves a
 * row (swap-remove of a *sibling*, column growth, archetype moves) must re-point
 * outstanding handles. A regression shows up as a handle silently reading another
 * entity's data — exactly what these tests fail on.
 */

class ObjectBacked extends Component {
    constructor(public n = 0) {
        super();
    }
}

let world: World;
let em: EntityManager;

beforeEach(() => {
    world = new World();
    em = world.entityManager;
});

describe("SoA column storage", () => {
    test("column-backed types declare their width on the token", () => {
        expect(ComponentType.of(LocalPosition).f32Width).toBe(3);
        expect(ComponentType.of(LocalToWorld).f32Width).toBe(16);
        expect(ComponentType.of(ObjectBacked).f32Width).toBe(0);
    });

    test("instance values land in the archetype's f32 column", () => {
        const e = em.createEntity();
        const pos = em.addComponent(e, new LocalPosition(1, 2, 3)) as LocalPosition;
        const arch = [...new EntityQuery(world, [LocalPosition]).archetypes][0];
        const col = arch.getColumn(ComponentType.of(LocalPosition))!;
        const i = arch.getIndexOfEntity(e)!;
        expect(col.f32Width).toBe(3);
        expect(col.f32Data![i * 3]).toBe(1);
        expect(col.f32Data![i * 3 + 1]).toBe(2);
        expect(col.f32Data![i * 3 + 2]).toBe(3);
        // and mutation through the instance writes the column
        (pos as LocalPosition & { x: number }).x = 9;
        expect(col.f32Data![i * 3]).toBe(9);
    });

    test("a handle survives a sibling's swap-remove", () => {
        const a = em.createEntity();
        const b = em.createEntity();
        const c = em.createEntity();
        em.addComponent(a, new LocalPosition(1, 0, 0));
        em.addComponent(b, new LocalPosition(2, 0, 0));
        em.addComponent(c, new LocalPosition(3, 0, 0));
        const posC = em.getComponent<LocalPosition>(c, LocalPosition)!;

        // destroying a swap-moves c's row; the handle must follow it
        em.destroyEntity(a);
        expect(posC.x).toBe(3);
        posC.y = 7;
        expect(em.getComponent<LocalPosition>(c, LocalPosition)!.y).toBe(7);
    });

    test("a handle survives column growth (initial capacity is 8 rows)", () => {
        const first = em.createEntity();
        em.addComponent(first, new LocalPosition(42, 0, 0));
        const handle = em.getComponent<LocalPosition>(first, LocalPosition)!;
        for (let i = 0; i < 40; i++) {
            const e = em.createEntity();
            em.addComponent(e, new LocalPosition(i, i, i));
        }
        expect(handle.x).toBe(42);
        handle.z = 5;
        expect(em.getComponent<LocalPosition>(first, LocalPosition)!.z).toBe(5);
    });

    test("values and handles survive an archetype move", () => {
        const e = em.createEntity();
        em.addComponent(e, new LocalPosition(4, 5, 6));
        const pos = em.getComponent<LocalPosition>(e, LocalPosition)!;
        em.addComponent(e, new ObjectBacked(1)); // moves e to a new archetype
        expect(pos.x).toBe(4);
        expect(pos.y).toBe(5);
        pos.x = 11;
        expect(em.getComponent<LocalPosition>(e, LocalPosition)!.x).toBe(11);
        // (no identity assertion: getComponent has always wrapped each call in a
        // fresh tracking Proxy, so two calls never compared equal — the contract
        // is that every proxy reaches the same underlying storage, tested above)
    });

    test("a destroyed entity's instance detaches and mutating it is harmless", () => {
        const dead = em.createEntity();
        em.addComponent(dead, new LocalPosition(1, 1, 1));
        const handle = em.getComponent<LocalPosition>(dead, LocalPosition)!;
        em.destroyEntity(dead);

        const alive = em.createEntity();
        em.addComponent(alive, new LocalPosition(8, 8, 8));

        handle.x = 999; // orphan write must not scribble on the recycled slot
        expect(em.getComponent<LocalPosition>(alive, LocalPosition)!.x).toBe(8);
        expect(handle.x).toBe(999); // the orphan itself keeps working
    });

    test("enable/disable swaps rebind both moved instances", () => {
        const es = [] as ReturnType<typeof em.createEntity>[];
        for (let i = 0; i < 4; i++) {
            const e = em.createEntity();
            em.addComponent(e, new LocalPosition(i, 0, 0));
            es.push(e);
        }
        const handles = es.map(e => em.getComponent<LocalPosition>(e, LocalPosition)!);
        em.setEnabledState(es[0], false);
        em.setEnabledState(es[0], true);
        for (let i = 0; i < 4; i++) expect(handles[i].x).toBe(i);
    });

    test("LocalToWorld matrix stays a live view through moves", () => {
        const e = em.createEntity();
        em.addComponent(e, new LocalToWorld());
        const l2w = em.getComponent<LocalToWorld>(e, LocalToWorld)!;
        const before = l2w.matrix;
        Vec.setX(l2w.position, 12);
        em.addComponent(e, new ObjectBacked()); // archetype move
        // the matrix getter re-reads the (re-bound) view; the translation survives
        expect(Vec.x(l2w.position)).toBe(12);
        void before;
    });
});

describe("consumeSpans (column query path)", () => {
    test("hands raw columns and honours widths", () => {
        for (let i = 0; i < 10; i++) {
            const e = em.createEntity();
            em.addComponent(e, new LocalPosition(i, 0, 0));
        }
        const q = new EntityQuery(world, [LocalPosition]);
        let seen = 0;
        q.stream({write: {pos: LocalPosition}}).consumeSpans(({start, end, cols}) => {
            const p = cols.pos!;
            for (let i = start; i < end; i++) {
                expect(p[i * 3]).toBe(i);
                p[i * 3 + 1] = i * 2;
                seen++;
            }
        });
        expect(seen).toBe(10);
        // writes through the column are visible through the instances
        q.stream({read: {pos: LocalPosition}}).consume(({pos}) => {
            expect(pos.y).toBe(pos.x * 2);
        });
    });

    test("declared writes stamp blocks; Unchanged opts out per span", () => {
        for (let i = 0; i < 5; i++) {
            const e = em.createEntity();
            em.addComponent(e, new LocalPosition(i, 0, 0));
        }
        const q = new EntityQuery(world, [LocalPosition]);
        const before = performance.now();

        q.stream({write: {pos: LocalPosition}}).consumeSpans(() => Unchanged);
        let visited = 0;
        q.stream({read: {pos: LocalPosition}}, {filterLastUpdated: before, structuralFilter: "additions"})
            .consumeSpans(({start, end}) => void (visited += end - start));
        expect(visited).toBe(0); // Unchanged left the column unstamped

        q.stream({write: {pos: LocalPosition}}).consumeSpans(({start, end, cols}) => {
            const p = cols.pos!;
            for (let i = start; i < end; i++) p[i * 3] += 1;
        });
        visited = 0;
        q.stream({read: {pos: LocalPosition}}, {filterLastUpdated: before, structuralFilter: "additions"})
            .consumeSpans(({start, end}) => void (visited += end - start));
        expect(visited).toBe(5); // the stamp woke the block
    });

    test("object-backed components come through stores, entities line up", () => {
        const made: number[] = [];
        for (let i = 0; i < 3; i++) {
            const e = em.createEntity();
            em.addComponent(e, new LocalPosition(i, 0, 0));
            em.addComponent(e, new ObjectBacked(i * 10));
            made.push(e as unknown as number);
        }
        const q = new EntityQuery(world, [LocalPosition, ObjectBacked]);
        q.stream({read: {pos: LocalPosition}, optional: {tag: ObjectBacked}}).consumeSpans(({start, end, cols, stores, entities}) => {
            expect(cols.tag).toBe(undefined); // object-backed: no f32 column
            const p = cols.pos!;
            for (let i = start; i < end; i++) {
                const tag = stores.tag!.get(i) as ObjectBacked;
                expect(tag.n).toBe(p[i * 3] * 10);
                expect(made.includes(entities[i] as unknown as number)).toBe(true);
            }
        });
    });
});
