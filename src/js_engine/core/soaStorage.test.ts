import {beforeEach, describe, expect, test} from "../testing/harness";
import {World} from "./world";
import {Component} from "./component";
import {ComponentType} from "./componentType";
import {EntityManager} from "./entityManager";
import {EntityQuery} from "./entityQuery";
import {Unchanged} from "./entityQueryStream";
import {LocalPosition} from "../translation/localPosition";
import {LocalScale} from "../translation/localScale";
import {LocalToWorld} from "../translation/localToWorld";
import {asFloat32Array, Vec} from "../math/types/vec";
import {BLOCK_SIZE, EntityArchetype} from "./entityArchetype";
import {Entity} from "./entity";
import {getOwner} from "./ownership";
import type {ComponentCtor} from "./componentType";

/**
 * Pins the SoA column storage invariants.
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

/** Counts store-driven detaches, which is what tells "re-bound" apart from "detached, then re-bound". */
class CountedPosition extends LocalPosition {
    static detaches = 0;

    detachF32(): void {
        CountedPosition.detaches++;
        super.detachF32();
    }
}

let world: World;
let em: EntityManager;

beforeEach(() => {
    world = new World();
    em = world.entityManager;
    CountedPosition.detaches = 0;
});

function ownerOf(e: Entity): EntityArchetype {
    return getOwner(world, e) as EntityArchetype;
}

/** `values` is a live view of `e`'s row in its current archetype's column for `ctor`. */
function expectViewsOwnRow(e: Entity, ctor: ComponentCtor<Component>, values: Float32Array) {
    const arch = ownerOf(e);
    const col = arch.getColumn(ComponentType.of(ctor))!;
    expect(values.buffer).toBe(col.f32Data!.buffer);
    expect(values.byteOffset).toBe(arch.getIndexOfEntity(e)! * col.f32Width * Float32Array.BYTES_PER_ELEMENT);
}

/** A timestamp strictly after every stamp made so far. */
function freshMark(): number {
    const t = performance.now();
    while (performance.now() === t) { /* spin past the clock's resolution */ }
    return performance.now();
}

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

describe("column-mapped moves (moveRowTo)", () => {
    test("a held F32 instance views the target column after add and remove moves, never detached", () => {
        const e = em.createEntity();
        const pos = new CountedPosition(1, 2, 3);
        em.addComponent(e, pos);
        em.addComponent(e, new ObjectBacked(5));
        expectViewsOwnRow(e, CountedPosition, asFloat32Array(pos.xyz));

        const arch = ownerOf(e);
        const col = arch.getColumn(CountedPosition.type())!;
        const row = arch.getIndexOfEntity(e)!;
        pos.x = 7;
        expect(col.f32Data![row * 3]).toBe(7);
        col.f32Data![row * 3 + 1] = 8;
        expect(pos.y).toBe(8);

        em.removeComponent(e, ObjectBacked);
        expectViewsOwnRow(e, CountedPosition, asFloat32Array(pos.xyz));
        pos.z = 9;
        let seen = 0;
        new EntityQuery(world, [CountedPosition]).stream({read: {p: CountedPosition}}).consumeSpans(({start, end, cols, entities}) => {
            for (let i = start; i < end; i++) {
                if (entities[i] !== e) continue;
                expect([cols.p![i * 3], cols.p![i * 3 + 1], cols.p![i * 3 + 2]]).toEqual([7, 8, 9]);
                seen++;
            }
        });
        expect(seen).toBe(1);
        expect(CountedPosition.detaches).toBe(0);
    });

    test("the moved row's gap is filled without disturbing its neighbours", () => {
        const es: Entity[] = [];
        const positions: LocalPosition[] = [];
        const tags: ObjectBacked[] = [];
        for (let i = 0; i < 5; i++) {
            const e = em.createEntity();
            positions.push(em.addComponent(e, new LocalPosition(i, i * 10, 0)) as LocalPosition);
            tags.push(em.addComponent(e, new ObjectBacked(i)) as ObjectBacked);
            es.push(e);
        }
        const source = ownerOf(es[0]);
        const scale = new LocalScale(2, 3, 4);
        em.addComponent(es[2], scale);
        em.removeComponent(es[1], ObjectBacked);
        expect(source.entityCountUnfiltered).toBe(3);

        expectViewsOwnRow(es[2], LocalScale, asFloat32Array(scale.xyz));
        expect([scale.x, scale.y, scale.z]).toEqual([2, 3, 4]);
        for (let i = 0; i < 5; i++) {
            const arch = ownerOf(es[i]);
            const row = arch.getIndexOfEntity(es[i])!;
            expectViewsOwnRow(es[i], LocalPosition, asFloat32Array(positions[i].xyz));
            expect([positions[i].x, positions[i].y]).toEqual([i, i * 10]);
            positions[i].z = i + 0.5;
            expect(arch.getColumn(LocalPosition.type())!.f32Data![row * 3 + 2]).toBe(i + 0.5);
            const tagColumn = arch.getColumn(ObjectBacked.type());
            if (i === 1) expect(tagColumn).toBeUndefined();
            else expect(tagColumn!.get(row)).toBe(tags[i]);
        }
    });

    test("enabled and disabled entities keep their state across moves in both directions", () => {
        const es: Entity[] = [];
        for (let i = 0; i < 7; i++) {
            const e = em.createEntity();
            em.addComponent(e, new LocalPosition(i, 0, 0));
            es.push(e);
        }
        em.addComponent(es[5], new ObjectBacked());
        em.addComponent(es[6], new ObjectBacked());
        const disabled = new Set([es[3], es[4], es[6]]);
        for (const e of disabled) em.setEnabledState(e, false);
        const source = ownerOf(es[0]);
        const target = ownerOf(es[5]);
        const lastEnabledOf = (arch: EntityArchetype) => arch.getEntityAtIndex(arch.entityCount - 1);
        const firstDisabledOf = (arch: EntityArchetype) => arch.getEntityAtIndex(arch.entityCount);

        const expectIntact = () => {
            for (let i = 0; i < es.length; i++) {
                expect(em.isEnabled(es[i])).toBe(!disabled.has(es[i]));
                expect(em.getComponent<LocalPosition>(es[i], LocalPosition)!.x).toBe(i);
            }
            for (const arch of [source, target]) {
                let enabled = 0;
                for (let row = 0; row < arch.entityCountUnfiltered; row++) {
                    if (!disabled.has(arch.getEntityAtIndex(row))) enabled++;
                }
                expect(arch.entityCount).toBe(enabled);
            }
        };

        // enabled row with disabled rows behind it, into a target holding a disabled row
        em.addComponent(es[0], new ObjectBacked());
        expectIntact();
        em.addComponent(lastEnabledOf(source), new ObjectBacked());
        expectIntact();
        // disabled row with a disabled row behind it, while enabled rows exist on both sides
        em.addComponent(firstDisabledOf(source), new ObjectBacked());
        expectIntact();

        em.removeComponent(es[0], ObjectBacked);
        expectIntact();
        em.removeComponent(firstDisabledOf(target), ObjectBacked);
        expectIntact();
        em.removeComponent(lastEnabledOf(target), ObjectBacked);
        expectIntact();
        expect(source.entityCountUnfiltered + target.entityCountUnfiltered).toBe(7);
    });

    test("destroying an enabled row keeps disabled rows disabled", () => {
        const es: Entity[] = [];
        for (let i = 0; i < 4; i++) {
            const e = em.createEntity();
            em.addComponent(e, new LocalPosition(i, 0, 0));
            es.push(e);
        }
        em.setEnabledState(es[3], false);
        em.destroyEntity(es[0]);
        expect([es[1], es[2], es[3]].map(e => em.isEnabled(e))).toEqual([true, true, false]);
        for (let i = 1; i < 4; i++) expect(em.getComponent<LocalPosition>(es[i], LocalPosition)!.x).toBe(i);
    });

    test("a moved entity wakes an additions stream in the target, not the source", () => {
        const stayers: Entity[] = [];
        for (let i = 0; i < 300; i++) {
            const e = em.createEntity();
            em.addComponent(e, new LocalPosition(i, 0, 0));
            stayers.push(e);
        }
        for (let i = 0; i < 300; i++) {
            const e = em.createEntity();
            em.addComponent(e, new LocalPosition(i, 0, 0));
            em.addComponent(e, new ObjectBacked(i));
        }
        const visitedSince = (mark: number, include: ComponentCtor<Component>[], exclude: ComponentCtor<Component>[] = []) => {
            const visited: Entity[] = [];
            new EntityQuery(world, include, exclude)
                .stream({read: {p: LocalPosition}}, {filterLastUpdated: mark, structuralFilter: "additions"})
                .consumeSpans(({start, end, entities}) => {
                    for (let i = start; i < end; i++) visited.push(entities[i]);
                });
            return visited;
        };
        const moved = stayers[150];

        let mark = freshMark();
        em.addComponent(moved, new ObjectBacked());
        let woken = visitedSince(mark, [LocalPosition, ObjectBacked]);
        expect(woken.includes(moved)).toBe(true);
        expect(woken.length).toBeLessThan(BLOCK_SIZE);
        expect(visitedSince(mark, [LocalPosition], [ObjectBacked]).length).toBe(0);

        mark = freshMark();
        em.removeComponent(moved, ObjectBacked);
        woken = visitedSince(mark, [LocalPosition], [ObjectBacked]);
        expect(woken.includes(moved)).toBe(true);
        expect(woken.length).toBeLessThan(BLOCK_SIZE);
        expect(visitedSince(mark, [LocalPosition, ObjectBacked]).length).toBe(0);
    });

    test("target column growth during moves keeps every moved instance bound", () => {
        const es: Entity[] = [];
        const positions: CountedPosition[] = [];
        for (let i = 0; i < 40; i++) {
            const e = em.createEntity();
            positions.push(em.addComponent(e, new CountedPosition(i, -i, 0)) as CountedPosition);
            es.push(e);
        }
        const expectAllBound = () => {
            for (let i = 0; i < es.length; i++) {
                expectViewsOwnRow(es[i], CountedPosition, asFloat32Array(positions[i].xyz));
                expect([positions[i].x, positions[i].y]).toEqual([i, -i]);
            }
        };

        em.addComponent(es[0], new ObjectBacked());
        const targetColumn = ownerOf(es[0]).getColumn(CountedPosition.type())!;
        const firstBuffer = targetColumn.f32Data;
        for (let i = 1; i < es.length; i++) em.addComponent(es[i], new ObjectBacked());
        expect(targetColumn.f32Data === firstBuffer).toBe(false); // grew 8 -> 64 rows on the way
        expectAllBound();

        for (const e of es) em.removeComponent(e, ObjectBacked);
        expectAllBound();
        expect(CountedPosition.detaches).toBe(0);
    });

    test("a component removed by removeComponent detaches with its values, like a destroyed entity's", () => {
        const e = em.createEntity();
        const scale = new LocalScale(2, 3, 4);
        em.addComponent(e, scale);
        const pos = new CountedPosition(4, 5, 6);
        em.addComponent(e, pos);
        const neighbour = em.createEntity();
        em.addComponent(neighbour, new LocalScale());
        em.addComponent(neighbour, new CountedPosition(7, 8, 9));

        em.removeComponent(e, CountedPosition); // the neighbour's row fills e's old one

        expect(CountedPosition.detaches).toBe(1);
        expect([pos.x, pos.y, pos.z]).toEqual([4, 5, 6]);
        pos.x = 999; // an orphan write must not reach the neighbour now in that row
        expect(em.getComponent<CountedPosition>(neighbour, CountedPosition)!.x).toBe(7);
        expectViewsOwnRow(e, LocalScale, asFloat32Array(scale.xyz));
        expect([scale.x, scale.y, scale.z]).toEqual([2, 3, 4]);

        em.addComponent(e, pos); // a detached instance re-adds like a fresh one
        expectViewsOwnRow(e, CountedPosition, asFloat32Array(pos.xyz));
        expect(em.getComponent<CountedPosition>(e, CountedPosition)!.x).toBe(999);
    });
});
