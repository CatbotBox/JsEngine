import {beforeEach, describe, expect, test} from "../testing/harness";
import {World} from "./world";
import {Component} from "./component";
import {trackComponent} from "./trackedComponent";
import {Entity, entityGenerationOf, entityIndexOf} from "./entity";
import {getEntityName} from "./ownership";
import {EntityManager} from "./entityManager";
import {EntityQuery} from "./entityQuery";
import {EntityArchetype} from "./entityArchetype";
import {Unchanged} from "./entityQueryStream";
import {BLOCK_SIZE} from "./entityArchetype";
import {ComponentType} from "./componentType";
import {getOwner} from "./ownership";
import {types} from "util";

const isProxy = types.isProxy;

/**
 * CHARACTERIZATION TESTS for the ECS core.
 *
 * These exist because core/ is ~2,200 lines carrying the whole engine and had no
 * tests at all. They pin *current observable behaviour* so the planned overhaul
 * can be verified rather than hoped at — including behaviour that is arguably
 * wrong. Anything questionable is marked QUIRK with what it does today; if a
 * refactor deliberately changes one, change the test in the same commit and say
 * why. A quirk test failing silently is the failure mode this suite prevents.
 */

class Position extends Component {
    constructor(public x = 0, public y = 0) {
        super();
    }
}

class Velocity extends Component {
    constructor(public dx = 0, public dy = 0) {
        super();
    }
}

class Tag extends Component {
}

/** Adds a companion component when attached — exercises Component.setup(). */
class WithSetup extends Component {
    override setup(entity: Entity, em: { addComponent(e: Entity, c: Component): unknown }) {
        em.addComponent(entity, new Tag());
    }
}

let world: World;
let em: EntityManager;

beforeEach(() => {
    world = new World();
    em = world.entityManager;
});

describe("EntityManager: lifecycle", () => {
    test("a created entity exists, is enabled, and owns no components", () => {
        const e = em.createEntity("a");
        expect(em.exists(e)).toBe(true);
        expect(em.isEnabled(e)).toBe(true);
        expect(em.hasComponent(e, Position)).toBe(false);
        expect(em.getComponent(e, Position)).toBeUndefined();
    });

    test("destroyEntity removes it from the world", () => {
        const e = em.createEntity();
        em.destroyEntity(e);
        expect(em.exists(e)).toBe(false);
    });

    test("addComponent moves the entity to a new archetype and keeps its data", () => {
        const e = em.createEntity();
        const before = world.archetypes.getOrCreate([]) as EntityArchetype;

        em.addComponent(e, new Position(3, 4));
        expect(em.hasComponent(e, Position)).toBe(true);
        expect(em.getComponent<Position>(e, Position)!.x).toBe(3);

        em.addComponent(e, new Velocity(1, 2));
        expect(em.hasComponent(e, Position)).toBe(true);   // survived the second move
        expect(em.hasComponent(e, Velocity)).toBe(true);
        expect(em.getComponent<Position>(e, Position)!.y).toBe(4);
        expect(before.entityCountUnfiltered).toBe(0);      // left the empty archetype
    });

    test("removeComponent drops just that component", () => {
        const e = em.createEntity();
        em.addComponent(e, new Position(1, 1));
        em.addComponent(e, new Velocity(9, 9));

        em.removeComponent(e, Velocity);
        expect(em.hasComponent(e, Velocity)).toBe(false);
        expect(em.hasComponent(e, Position)).toBe(true);
        expect(em.getComponent<Position>(e, Position)!.x).toBe(1);
    });

    test("removing a component the entity lacks is a no-op", () => {
        const e = em.createEntity();
        em.addComponent(e, new Position());
        em.removeComponent(e, Velocity);
        expect(em.hasComponent(e, Position)).toBe(true);
    });

    test("QUIRK: adding a duplicate component is ignored, not an error", () => {
        // addComponentInternal returns rather than throwing or replacing, and stays silent:
        // the log it used to emit was pure noise.
        const e = em.createEntity();
        em.addComponent(e, new Position(1, 1));
        em.addComponent(e, new Position(7, 7));
        expect(em.getComponent<Position>(e, Position)!.x).toBe(1); // first one wins
    });

    test("setComponent replaces the stored instance in place", () => {
        const e = em.createEntity();
        em.addComponent(e, new Position(1, 1));
        em.setComponent(e, new Position(5, 6));
        expect(em.getComponent<Position>(e, Position)!.x).toBe(5);
    });

    test("Component.setup runs on add and can attach further components", () => {
        const e = em.createEntity();
        em.addComponent(e, new WithSetup());
        expect(em.hasComponent(e, Tag)).toBe(true);
    });

    test("enable/disable round-trips", () => {
        const e = em.createEntity();
        em.addComponent(e, new Position());
        em.setEnabledState(e, false);
        expect(em.isEnabled(e)).toBe(false);
        em.setEnabledState(e, true);
        expect(em.isEnabled(e)).toBe(true);
    });
});

describe("EntityArchetype: storage invariants", () => {
    test("entityCount counts enabled only; unfiltered counts all", () => {
        const es = Array.from({length: 5}, () => {
            const e = em.createEntity();
            em.addComponent(e, new Position());
            return e;
        });
        const arch = world.archetypes.getOrCreate([Position.type()]) as EntityArchetype;
        expect(arch.entityCount).toBe(5);
        expect(arch.entityCountUnfiltered).toBe(5);

        em.setEnabledState(es[1], false);
        em.setEnabledState(es[3], false);
        expect(arch.entityCount).toBe(3);            // enabled kept contiguous at the front
        expect(arch.entityCountUnfiltered).toBe(5);
    });

    test("removal keeps the store dense and other entities intact", () => {
        const es = Array.from({length: 4}, (_, i) => {
            const e = em.createEntity();
            em.addComponent(e, new Position(i, i));
            return e;
        });
        em.destroyEntity(es[1]);  // swap-removed from the middle

        const arch = world.archetypes.getOrCreate([Position.type()]) as EntityArchetype;
        expect(arch.entityCountUnfiltered).toBe(3);
        for (const keep of [es[0], es[2], es[3]]) {
            expect(em.exists(keep)).toBe(true);
            expect(em.getComponent<Position>(keep, Position)).toBeDefined();
        }
    });

    test("archetype identity does not depend on component order", () => {
        const a = world.archetypes.getOrCreate([Position.type(), Velocity.type()]);
        const b = world.archetypes.getOrCreate([Velocity.type(), Position.type()]);
        expect(a).toBe(b);
    });

    test("a constructor and its token resolve to the SAME archetype", () => {
        // The id provider keys off object identity, so these used to produce two
        // different archetypes with no error — passing a constructor silently built
        // a parallel empty one that never matched anything.
        const e = em.createEntity();
        em.addComponent(e, new Position(1, 2));

        const byToken = world.archetypes.getOrCreate([Position.type()]) as EntityArchetype;
        const byCtor = world.archetypes.getOrCreate([Position]) as EntityArchetype;
        expect(byCtor).toBe(byToken);
        expect(byCtor.entityCountUnfiltered).toBe(1);   // finds the real entity
    });
});

describe("EntityQuery", () => {
    test("matches archetypes containing all required components", () => {
        const withBoth = em.createEntity();
        em.addComponent(withBoth, new Position());
        em.addComponent(withBoth, new Velocity());

        const withOne = em.createEntity();
        em.addComponent(withOne, new Position());

        expect(new EntityQuery(world, [Position]).entityCount()).toBe(2);
        expect(new EntityQuery(world, [Position, Velocity]).entityCount()).toBe(1);
        expect(new EntityQuery(world, [Tag]).entityCount()).toBe(0);
    });

    test("picks up archetypes created after the query was built", () => {
        const q = new EntityQuery(world, [Position]);
        expect(q.entityCount()).toBe(0);

        const e = em.createEntity();
        em.addComponent(e, new Position());
        expect(q.entityCount()).toBe(1);   // refreshed lazily
    });

    test("excludes archetypes carrying a blacklisted component", () => {
        const plain = em.createEntity();
        em.addComponent(plain, new Position());
        const tagged = em.createEntity();
        em.addComponent(tagged, new Position());
        em.addComponent(tagged, new Tag());

        expect(new EntityQuery(world, [Position], [Tag]).entityCount()).toBe(1);
    });

    test("tryGetSingleton returns undefined unless exactly one matches", () => {
        const q = new EntityQuery(world, [Position]);
        expect(q.tryGetSingleton({p: Position})).toBeUndefined();

        const a = em.createEntity();
        em.addComponent(a, new Position(1, 1));
        expect(q.tryGetSingleton({p: Position})).toBeDefined();

        const b = em.createEntity();
        em.addComponent(b, new Position(2, 2));
        expect(q.tryGetSingleton({p: Position})).toBeUndefined();
    });

    test("getSingleton throws where tryGetSingleton returns undefined", () => {
        // Both share one finder; only the none/ambiguous handling differs.
        const q = new EntityQuery(world, [Position]);
        expect(() => q.getSingleton({p: Position})).toThrow();

        const a = em.createEntity();
        em.addComponent(a, new Position(1, 1));
        expect(q.getSingleton({p: Position}).p.x).toBe(1);

        const b = em.createEntity();
        em.addComponent(b, new Position(2, 2));
        expect(() => q.getSingleton({p: Position})).toThrow();
    });
});

describe("EntityQueryStream", () => {
    const spawn = (n: number) => Array.from({length: n}, (_, i) => {
        const e = em.createEntity();
        em.addComponent(e, new Position(i, i * 2));
        em.addComponent(e, new Velocity(i, 0));
        return e;
    });

    test("forEach yields one row per entity with the requested components", () => {
        spawn(3);
        const seen: number[] = [];
        new EntityQuery(world, [Position, Velocity])
            .stream({read: {p: Position, v: Velocity}})
            .forEach(({p, v}) => {
                expect(v).toBeDefined();
                seen.push(p.x);
            });
        expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2]);
    });

    test("includeEntity adds the entity to each row", () => {
        spawn(2);
        const entities: Entity[] = [];
        new EntityQuery(world, [Position])
            .stream({read: {p: Position}}, {includeEntity: true})
            .forEach(({entity}) => entities.push(entity));
        expect(entities.length).toBe(2);
        expect(entities.every(e => em.exists(e))).toBe(true);
    });

    test("a component in `read` that an archetype lacks EXCLUDES that archetype", () => {
        // This is the sharp edge. LocalToWorldSystem's query requires only
        // [LocalPosition, LocalToWorld] but listed LocalRotation/LocalScale under
        // `read` — so every entity without a rotation was silently dropped, their
        // LocalToWorld never updated, and the whole scene rendered at the origin.
        spawn(3);                                   // Position + Velocity
        const plain = em.createEntity();            // Position only
        em.addComponent(plain, new Position(99, 99));

        const q = new EntityQuery(world, [Position]);
        expect(q.entityCount()).toBe(4);

        let rows = 0;
        q.stream({read: {p: Position, v: Velocity}}).forEach(() => rows++);
        expect(rows).toBe(3);                       // the Position-only entity is skipped
    });

    test("the same component under `optional` INCLUDES it, as undefined", () => {
        spawn(3);
        const plain = em.createEntity();
        em.addComponent(plain, new Position(99, 99));

        const seen: (number | undefined)[] = [];
        new EntityQuery(world, [Position])
            .stream({read: {p: Position}, optional: {v: Velocity}})
            .forEach(({p, v}) => seen.push(v === undefined ? undefined : p.x));

        expect(seen.length).toBe(4);                // nothing skipped
        expect(seen.filter(s => s === undefined).length).toBe(1);
    });

    test("consume reuses one row object; forEach hands out fresh ones", () => {
        spawn(3);
        const q = new EntityQuery(world, [Position]);

        const consumed: object[] = [];
        q.stream({read: {p: Position}}).consume(row => consumed.push(row));
        expect(new Set(consumed).size).toBe(1);     // same object every iteration

        const each: object[] = [];
        q.stream({read: {p: Position}}).forEach(row => each.push(row));
        expect(new Set(each).size).toBe(3);         // distinct objects
    });

    test("count matches the query's entity count", () => {
        spawn(4);
        expect(new EntityQuery(world, [Position]).stream({read: {p: Position}}).count()).toBe(4);
    });

    test("disabled entities are excluded unless includeDisabled", () => {
        const es = spawn(3);
        em.setEnabledState(es[0], false);

        const q = new EntityQuery(world, [Position]);
        expect(q.stream({read: {p: Position}}).count()).toBe(2);
        expect(q.stream({read: {p: Position}}, {includeDisabled: true}).count()).toBe(3);
    });

    test("writing through a streamed row marks the column updated", () => {
        // Declaring a component under `write` stamps its column once per archetype, so any
        // write through the row bumps lastUpdatedTime. This is what filterLastUpdated keys off.
        spawn(2);
        const arch = world.archetypes.getOrCreate([Position.type(), Velocity.type()]) as EntityArchetype;
        const before = arch.getColumn(Position.type())!.lastUpdatedTime;

        new EntityQuery(world, [Position, Velocity])
            .stream({write: {p: Position}})
            .forEach(({p}) => {
                p.x = p.x + 1;
            });

        expect(arch.getColumn(Position.type())!.lastUpdatedTime).toBeGreaterThan(before);
    });

    test("filterLastUpdated skips archetypes with no change since the given time", () => {
        spawn(2);
        const q = new EntityQuery(world, [Position]);

        // touch nothing, then filter on "now" — nothing should come back
        const future = performance.now() + 1000;
        let rows = 0;
        q.stream({read: {p: Position}}, {filterLastUpdated: future}).forEach(() => rows++);
        expect(rows).toBe(0);

        // filtering on 0 lets everything through
        rows = 0;
        q.stream({read: {p: Position}}, {filterLastUpdated: 0}).forEach(() => rows++);
        expect(rows).toBe(2);
    });

    test("structuralFilter 'additions' skips removals but not additions or edits", () => {
        // Change tracking is per-archetype but cost is per-entity, so one removal
        // used to force a full rebuild: at 40k entities LocalToWorldSystem went
        // 0.09ms -> 4.92ms for a single retiring entity, every frame, in four
        // systems at once. Swap-remove keeps survivors' columns paired, so a
        // removal genuinely leaves derived data valid.
        spawn(4);
        const q = new EntityQuery(world, [Position]);
        const rowsSince = (t: number) => {
            let n = 0;
            q.stream({read: {p: Position}}, {filterLastUpdated: t, structuralFilter: "additions"}).forEach(() => n++);
            return n;
        };

        const victims = spawn(2);
        const mark = performance.now();
        expect(rowsSince(mark)).toBe(0);                 // nothing changed -> skipped

        em.destroyEntity(victims[0]);
        expect(rowsSince(mark)).toBe(0);                 // a removal alone must NOT wake it

        const added = em.createEntity();
        em.addComponent(added, new Position(1, 1));
        em.addComponent(added, new Velocity());
        expect(rowsSince(mark)).toBeGreaterThan(0);      // an addition must
    });

    test("a data edit still wakes a filtered stream", () => {
        spawn(3);
        const q = new EntityQuery(world, [Position]);
        const mark = performance.now();
        let n = 0;
        q.stream({read: {p: Position}}, {filterLastUpdated: mark}).forEach(() => n++);
        expect(n).toBe(0);

        // write through a declared-write stream, which stamps the column
        q.stream({write: {p: Position}}).forEach(({p}) => {
            p.x = p.x + 1;
        });

        n = 0;
        q.stream({read: {p: Position}}, {filterLastUpdated: mark}).forEach(() => n++);
        expect(n).toBe(3);
    });

    test("returning Unchanged from every row skips the write stamp", () => {
        spawn(3);
        const q = new EntityQuery(world, [Position]);
        const mark = performance.now();

        // declares a write but tells the stream it wrote nothing
        q.stream({write: {p: Position}}).forEach(() => Unchanged);

        let n = 0;
        q.stream({read: {p: Position}}, {filterLastUpdated: mark}).forEach(() => n++);
        expect(n).toBe(0);
    });

    test("one row not returning false still stamps the whole column", () => {
        spawn(3);
        const q = new EntityQuery(world, [Position]);
        const mark = performance.now();

        // granularity is the column, so a single real write wakes every entity
        let i = 0;
        q.stream({write: {p: Position}}).forEach(({p}) => {
            if (i++ !== 1) return Unchanged;
            p.x = p.x + 1;
        });

        let n = 0;
        q.stream({read: {p: Position}}, {filterLastUpdated: mark}).forEach(() => n++);
        expect(n).toBe(3);
    });

    test("a callback returning nothing counts as a write", () => {
        // the opt-out must be opt-in: `undefined` has to keep stamping, or every
        // existing system silently stops propagating changes
        spawn(3);
        const q = new EntityQuery(world, [Position]);
        const mark = performance.now();

        q.stream({write: {p: Position}}).forEach(() => { /* no return */ });

        let n = 0;
        q.stream({read: {p: Position}}, {filterLastUpdated: mark}).forEach(() => n++);
        expect(n).toBe(3);
    });

    test("one arrival wakes only its block, not the whole archetype", () => {
        // The reason block timestamps exist. Profiling at 129,008 entities across 6
        // archetypes showed a still scene at 41ms/frame and the same scene under churn
        // at ~196ms, entirely because a few hundred arrivals re-dirtied archetypes of
        // ~21,500. Appends land at the tail, so only the last block should wake.
        spawn(300);
        const q = new EntityQuery(world, [Position]);
        const mark = performance.now();

        const added = em.createEntity();
        em.addComponent(added, new Position(9, 9));
        em.addComponent(added, new Velocity());

        let n = 0;
        q.stream({read: {p: Position}}, {
            filterLastUpdated: mark,
            structuralFilter: "additions",
        }).forEach(() => n++);

        expect(n).toBeGreaterThan(0);        // the new entity must be processed
        expect(n).toBeLessThan(BLOCK_SIZE);  // but not 301 of them
    });

    test("a write to one block does not wake the others", () => {
        spawn(300);
        const q = new EntityQuery(world, [Position]);
        const mark = performance.now();

        // touch only the first few entities; the rest decline the write
        let i = 0;
        q.stream({write: {p: Position}}).forEach(({p}) => {
            if (i++ >= 5) return Unchanged;
            p.x = p.x + 1;
        });

        let n = 0;
        q.stream({read: {p: Position}}, {filterLastUpdated: mark}).forEach(() => n++);
        expect(n).toBe(BLOCK_SIZE);          // block 0 only
    });

    test("a removal still forces a full pass for structural 'any' consumers", () => {
        // Swap-remove moves a survivor's data down into a lower index without stamping
        // the block it landed in, so block skipping must be disabled for this mode --
        // Console2DRenderPassSystem keys an index by entity and depends on it.
        const es = spawn(300);
        const q = new EntityQuery(world, [Position]);
        const mark = performance.now();

        em.destroyEntity(es[0]);

        let n = 0;
        q.stream({read: {p: Position}}, {filterLastUpdated: mark}).forEach(() => n++);
        expect(n).toBe(299);
    });

    test("a stream may be iterated more than once; each pass re-preps", () => {
        // Worth pinning because the name suggests otherwise: forEach re-prepares the
        // plan on entry, so a second pass yields the same rows rather than nothing.
        spawn(2);
        const s = new EntityQuery(world, [Position]).stream({read: {p: Position}});
        let first = 0, second = 0;
        s.forEach(() => first++);
        s.forEach(() => second++);
        expect(first).toBe(2);
        expect(second).toBe(2);
    });
});

describe("trackComponent", () => {
    test("property sets notify, reads do not", () => {
        let notified = 0;
        const p = trackComponent(new Position(1, 2), () => notified++);

        expect(p.x).toBe(1);
        expect(notified).toBe(0);

        p.x = 10;
        expect(notified).toBe(1);
        expect(p.x).toBe(10);
    });

    test("QUIRK: assigning the same value does not notify", () => {
        let notified = 0;
        const p = trackComponent(new Position(5, 5), () => notified++);
        p.x = 5;
        expect(notified).toBe(0);
    });

    test("mutation via a method IS tracked when the field is a normal property", () => {
        // CLAUDE.md states "only property setters are tracked, any component that
        // mutates internal state via a method must call notifyChanged() itself". That is
        // wrong for ordinary (TS-`private`) fields: calling the method through the
        // proxy makes `this` the proxy, so the internal assignment hits the set trap.
        class Counter extends Component {
            private _n = 0;

            bump() {
                this._n++;
            }

            get n() {
                return this._n;
            }
        }

        let notified = 0;
        const c = trackComponent(new Counter(), () => notified++);
        c.bump();
        expect(c.n).toBe(1);
        expect(notified).toBe(1);
    });

    test("QUIRK: tracking is incompatible with #private fields — it throws", () => {
        // Worse than "invisible": ECMAScript private fields are keyed to the target
        // object, and the proxy is not that object, so any access through the proxy
        // throws. A component using #private cannot be tracked at all — it fails at
        // runtime, not at compile time. Use TS `private` (a normal property) instead.
        class HardPrivate extends Component {
            #n = 0;

            bump() {
                this.#n++;
            }

            get n() {
                return this.#n;
            }
        }

        const c = trackComponent(new HardPrivate(), () => void 0);
        expect(() => c.bump()).toThrow(/private field/);
        expect(() => c.n).toThrow(/private field/);
    });
});

describe("tracked handles survive structural changes", () => {
    test("a handle taken before an archetype move still marks its column", () => {
        // Regression: the proxy used to capture the archetype and column index it
        // was fetched from, so the first structural change left it stamping the
        // archetype the entity had already left — silently, for the life of the
        // handle. Component.setup() adds companions routinely, so "fetch a handle,
        // then move" is the normal case.
        const e = em.createEntity();
        em.addComponent(e, new Position(1, 2));
        const handle = em.getComponent<Position>(e, Position)!;

        em.addComponent(e, new Velocity(3, 4));   // moves the entity to a new archetype

        const arch = getOwner(world, e)!;
        const column = arch.getColumn(ComponentType.of(Position))!;
        const before = column.lastUpdatedTime;

        handle.x = 99;

        expect(column.lastUpdatedTime > before).toBe(true);
        expect(em.getComponent<Position>(e, Position)!.x).toBe(99);
    });

    test("components carried through a command-buffer move are not left wrapped", async () => {
        // The buffer used to carry a *tracked* snapshot across the move, which put
        // the Proxy itself into the destination column — and wrapped it again on
        // every subsequent move, so reads got steadily slower and the stamp went to
        // the wrong archetype.
        const {EntityCommandBufferSystem} = await import("./entityCommandBufferSystem");
        const cbSystem = world.getOrCreateSystem(EntityCommandBufferSystem);

        const e = em.createEntity();
        em.addComponent(e, new Position(1, 2));

        cbSystem.getEntityCommandBuffer().addComponent(e, new Velocity(3, 4));
        cbSystem.update();
        cbSystem.getEntityCommandBuffer().addComponent(e, new Tag());
        cbSystem.update();

        const arch = getOwner(world, e)!;
        const stored = arch.getColumn(ComponentType.of(Position))!.get(0) as Position;
        expect(isProxy(stored)).toBe(false);
        expect(stored.x).toBe(1);
        expect(stored.y).toBe(2);
    });
});

describe("EntityCommandBuffer", () => {
    test("structural changes are deferred until playback", async () => {
        const {EntityCommandBufferSystem} = await import("./entityCommandBufferSystem");
        const cbSystem = world.getOrCreateSystem(EntityCommandBufferSystem);
        const cb = cbSystem.getEntityCommandBuffer();

        const e = cb.createEntity("deferred");
        cb.addComponent(e, new Position(1, 2));

        // nothing has happened yet
        expect(new EntityQuery(world, [Position]).entityCount()).toBe(0);

        cbSystem.update();
        expect(new EntityQuery(world, [Position]).entityCount()).toBe(1);
        expect(em.getComponent<Position>(e, Position)!.x).toBe(1);
    });
});

describe("Entity handles: generation counters", () => {
    test("a destroyed entity's handle goes stale and is rejected", () => {
        const e = em.createEntity("victim");
        em.addComponent(e, new Position(7, 8));
        expect(em.exists(e)).toBe(true);

        em.destroyEntity(e);
        expect(em.exists(e)).toBe(false);
        expect(em.getComponent(e, Position)).toBe(undefined);
    });

    test("a recycled slot does not resurrect the stale handle", () => {
        const stale = em.createEntity("first");
        em.addComponent(stale, new Position(1, 1));
        em.destroyEntity(stale);

        // recycles the same index slot with a bumped generation
        const fresh = em.createEntity("second");
        em.addComponent(fresh, new Position(2, 2));

        expect(entityIndexOf(fresh)).toBe(entityIndexOf(stale)); // same slot...
        expect(fresh === stale).toBe(false);                     // ...different handle
        expect(entityGenerationOf(fresh)).toBe(entityGenerationOf(stale) + 1);

        // the stale handle must not read the new occupant's data
        expect(em.exists(stale)).toBe(false);
        expect(em.getComponent(stale, Position)).toBe(undefined);
        expect(em.getComponent<Position>(fresh, Position)!.x).toBe(2);
    });

    test("destroying via a stale handle is a no-op for the new occupant", () => {
        const stale = em.createEntity();
        em.destroyEntity(stale);
        const fresh = em.createEntity();
        em.destroyEntity(stale); // double free through the old handle
        expect(em.exists(fresh)).toBe(true);
    });

    test("debug names live in the registry and die with the entity", () => {
        const e = em.createEntity("named");
        expect(getEntityName(e)).toBe("named");
        em.destroyEntity(e);
        expect(getEntityName(e)).toBe(undefined);
    });

    test("destroyQuery retires every matching handle", () => {
        const a = em.createEntity();
        const b = em.createEntity();
        em.addComponent(a, new Position());
        em.addComponent(b, new Position());
        const q = new EntityQuery(world, [Position]);
        em.destroyQuery(q as never);
        expect(em.exists(a)).toBe(false);
        expect(em.exists(b)).toBe(false);
        expect(q.entityCount()).toBe(0);
    });
});
