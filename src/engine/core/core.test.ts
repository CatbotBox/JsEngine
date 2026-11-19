import {beforeEach, describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {World} from "./world";
import {Component} from "./component";
import {trackComponent} from "./trackedComponent";
import {Entity, entityGenerationOf, entityIndexOf} from "./entity";
import {getEntityName} from "./ownership";
import {EntityManager} from "./entityManager";
import {EntityQuery} from "./entityQuery";
import {EntityArchetype} from "./entityArchetype";
import {Unchanged} from "./entityQueryStream";
import {BLOCK_SIZE, NO_SOURCE_COLUMN} from "./entityArchetype";
import type {OccupancyWatcher} from "./entityArchetype";
import type {ComponentCtor} from "./component";
import {ComponentType} from "./componentType";
import {getOwner} from "./ownership";
import {EntityCommandBufferSystem} from "./entityCommandBufferSystem";
import {Resource} from "./resource";
import type {ResourceListener} from "./resourceManager";
import {System} from "./system";
import type {SystemCtor} from "./system";
import {SystemGroup} from "./systemGroup";
import {types} from "util";

const isProxy = types.isProxy;
const STAMPS_AHEAD = 1000;
const ENABLED = true;
const DISABLED = false;

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

class AddsTagInSetup extends Component {
    override setup(entity: Entity, em: { addComponent(e: Entity, c: Component): unknown }) {
        em.addComponent(entity, new Tag());
    }
}

let world: World;
let em: EntityManager;

beforeEach(() => {
    world = new World({platform: new MemoryPlatform()});
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
        expect(em.hasComponent(e, Position)).toBe(true);
        expect(em.hasComponent(e, Velocity)).toBe(true);
        expect(em.getComponent<Position>(e, Position)!.y).toBe(4);
        expect(before.entityCountIncludingDisabled).toBe(0);
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
        const e = em.createEntity();
        em.addComponent(e, new Position(1, 1));
        em.addComponent(e, new Position(7, 7));
        expect(em.getComponent<Position>(e, Position)!.x).toBe(1);
    });

    test("setComponent replaces the stored instance in place", () => {
        const e = em.createEntity();
        em.addComponent(e, new Position(1, 1));
        em.setComponent(e, new Position(5, 6));
        expect(em.getComponent<Position>(e, Position)!.x).toBe(5);
    });

    test("Component.setup runs on add and can attach further components", () => {
        const e = em.createEntity();
        em.addComponent(e, new AddsTagInSetup());
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
    test("enabledEntityCount counts enabled only; entityCountIncludingDisabled counts all", () => {
        const es = Array.from({length: 5}, () => {
            const e = em.createEntity();
            em.addComponent(e, new Position());
            return e;
        });
        const arch = world.archetypes.getOrCreate([Position.type()]) as EntityArchetype;
        expect(arch.enabledEntityCount).toBe(5);
        expect(arch.entityCountIncludingDisabled).toBe(5);

        em.setEnabledState(es[1], false);
        em.setEnabledState(es[3], false);
        expect(arch.enabledEntityCount).toBe(3);
        expect(arch.entityCountIncludingDisabled).toBe(5);
    });

    test("removal keeps the store dense and other entities intact", () => {
        const es = Array.from({length: 4}, (_, i) => {
            const e = em.createEntity();
            em.addComponent(e, new Position(i, i));
            return e;
        });
        em.destroyEntity(es[1]);

        const arch = world.archetypes.getOrCreate([Position.type()]) as EntityArchetype;
        expect(arch.entityCountIncludingDisabled).toBe(3);
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
        const e = em.createEntity();
        em.addComponent(e, new Position(1, 2));

        const byToken = world.archetypes.getOrCreate([Position.type()]) as EntityArchetype;
        const byCtor = world.archetypes.getOrCreate([Position]) as EntityArchetype;
        expect(byCtor).toBe(byToken);
        expect(byCtor.entityCountIncludingDisabled).toBe(1);
    });
});

describe("EntityQuery", () => {
    test("matches archetypes containing all required components", () => {
        const withBoth = em.createEntity();
        em.addComponent(withBoth, new Position());
        em.addComponent(withBoth, new Velocity());

        const withOne = em.createEntity();
        em.addComponent(withOne, new Position());

        expect(new EntityQuery(world, [Position]).enabledEntityCount()).toBe(2);
        expect(new EntityQuery(world, [Position, Velocity]).enabledEntityCount()).toBe(1);
        expect(new EntityQuery(world, [Tag]).enabledEntityCount()).toBe(0);
    });

    test("picks up archetypes created after the query was built", () => {
        const q = new EntityQuery(world, [Position]);
        expect(q.enabledEntityCount()).toBe(0);

        const e = em.createEntity();
        em.addComponent(e, new Position());
        expect(q.enabledEntityCount()).toBe(1);
    });

    test("excludes archetypes carrying a blacklisted component", () => {
        const plain = em.createEntity();
        em.addComponent(plain, new Position());
        const tagged = em.createEntity();
        em.addComponent(tagged, new Position());
        em.addComponent(tagged, new Tag());

        expect(new EntityQuery(world, [Position], [Tag]).enabledEntityCount()).toBe(1);
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
        spawn(3);
        const plain = em.createEntity();
        em.addComponent(plain, new Position(99, 99));

        const q = new EntityQuery(world, [Position]);
        expect(q.enabledEntityCount()).toBe(4);

        let rows = 0;
        q.stream({read: {p: Position, v: Velocity}}).forEach(() => rows++);
        expect(rows).toBe(3);
    });

    test("the same component under `optional` INCLUDES it, as undefined", () => {
        spawn(3);
        const plain = em.createEntity();
        em.addComponent(plain, new Position(99, 99));

        const seen: (number | undefined)[] = [];
        new EntityQuery(world, [Position])
            .stream({read: {p: Position}, optional: {v: Velocity}})
            .forEach(({p, v}) => seen.push(v === undefined ? undefined : p.x));

        expect(seen.length).toBe(4);
        expect(seen.filter(s => s === undefined).length).toBe(1);
    });

    test("consume reuses one row object; forEach hands out fresh ones", () => {
        spawn(3);
        const q = new EntityQuery(world, [Position]);

        const consumed: object[] = [];
        q.stream({read: {p: Position}}).consume(row => consumed.push(row));
        expect(new Set(consumed).size).toBe(1);

        const each: object[] = [];
        q.stream({read: {p: Position}}).forEach(row => each.push(row));
        expect(new Set(each).size).toBe(3);
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
        spawn(2);
        const arch = world.archetypes.getOrCreate([Position.type(), Velocity.type()]) as EntityArchetype;
        const before = arch.getColumn(Position.type())!.lastChangeStamp;
        world.changeStamps.advance();

        new EntityQuery(world, [Position, Velocity])
            .stream({write: {p: Position}})
            .forEach(({p}) => {
                p.x = p.x + 1;
            });

        expect(arch.getColumn(Position.type())!.lastChangeStamp).toBeGreaterThan(before);
    });

    test("changes take the world's current stamp and a mark advances it", () => {
        const [e] = spawn(1);
        const column = getOwner(world, e)!.getColumn(Position.type())!;
        expect(column.lastChangeStamp).toBe(world.changeStamps.current);

        const mark = world.changeStamps.advance();
        expect(column.lastChangeStamp).toBeLessThan(mark);
        em.setComponent(e, new Position(5, 5));
        expect(column.lastChangeStamp).toBe(mark);
    });

    test("filterLastUpdated skips archetypes with no change since the given stamp", () => {
        spawn(2);
        const q = new EntityQuery(world, [Position]);

        const future = world.changeStamps.advance() + STAMPS_AHEAD;
        let rows = 0;
        q.stream({read: {p: Position}}, {filterLastUpdated: future}).forEach(() => rows++);
        expect(rows).toBe(0);

        rows = 0;
        q.stream({read: {p: Position}}, {filterLastUpdated: 0}).forEach(() => rows++);
        expect(rows).toBe(2);
    });

    test("structuralFilter 'additions' skips removals but not additions or edits", () => {
        spawn(4);
        const q = new EntityQuery(world, [Position]);
        const rowsSince = (t: number) => {
            let n = 0;
            q.stream({read: {p: Position}}, {filterLastUpdated: t, structuralFilter: "additions"}).forEach(() => n++);
            return n;
        };

        const victims = spawn(2);
        const mark = world.changeStamps.advance();
        expect(rowsSince(mark)).toBe(0);

        em.destroyEntity(victims[0]);
        expect(rowsSince(mark)).toBe(0);

        const added = em.createEntity();
        em.addComponent(added, new Position(1, 1));
        em.addComponent(added, new Velocity());
        expect(rowsSince(mark)).toBeGreaterThan(0);
    });

    test("a data edit still wakes a filtered stream", () => {
        spawn(3);
        const q = new EntityQuery(world, [Position]);
        const mark = world.changeStamps.advance();
        let n = 0;
        q.stream({read: {p: Position}}, {filterLastUpdated: mark}).forEach(() => n++);
        expect(n).toBe(0);

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
        const mark = world.changeStamps.advance();

        q.stream({write: {p: Position}}).forEach(() => Unchanged);

        let n = 0;
        q.stream({read: {p: Position}}, {filterLastUpdated: mark}).forEach(() => n++);
        expect(n).toBe(0);
    });

    test("one row not returning false still stamps the whole column", () => {
        spawn(3);
        const q = new EntityQuery(world, [Position]);
        const mark = world.changeStamps.advance();

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
        spawn(3);
        const q = new EntityQuery(world, [Position]);
        const mark = world.changeStamps.advance();

        q.stream({write: {p: Position}}).forEach(() => {});

        let n = 0;
        q.stream({read: {p: Position}}, {filterLastUpdated: mark}).forEach(() => n++);
        expect(n).toBe(3);
    });

    test("one arrival wakes only its block, not the whole archetype", () => {
        spawn(300);
        const q = new EntityQuery(world, [Position]);
        const mark = world.changeStamps.advance();

        const added = em.createEntity();
        em.addComponent(added, new Position(9, 9));
        em.addComponent(added, new Velocity());

        let n = 0;
        q.stream({read: {p: Position}}, {
            filterLastUpdated: mark,
            structuralFilter: "additions",
        }).forEach(() => n++);

        expect(n).toBeGreaterThan(0);
        expect(n).toBeLessThan(BLOCK_SIZE);
    });

    test("a write to one block does not wake the others", () => {
        spawn(300);
        const q = new EntityQuery(world, [Position]);
        const mark = world.changeStamps.advance();

        let i = 0;
        q.stream({write: {p: Position}}).forEach(({p}) => {
            if (i++ >= 5) return Unchanged;
            p.x = p.x + 1;
        });

        let n = 0;
        q.stream({read: {p: Position}}, {filterLastUpdated: mark}).forEach(() => n++);
        expect(n).toBe(BLOCK_SIZE);
    });

    test("a removal still forces a full pass for structural 'any' consumers", () => {
        const es = spawn(300);
        const q = new EntityQuery(world, [Position]);
        const mark = world.changeStamps.advance();

        em.destroyEntity(es[0]);

        let n = 0;
        q.stream({read: {p: Position}}, {filterLastUpdated: mark}).forEach(() => n++);
        expect(n).toBe(299);
    });

    test("a stream may be iterated more than once; each pass re-preps", () => {
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

class Counter extends Component {
    public readonly counted: number[] = [];

    public count(value: number): void {
        this.counted.push(value);
        this.notifyChanged();
    }
}

describe("tracked handles survive structural changes", () => {
    test("a handle taken before an archetype move still marks its column", () => {
        const e = em.createEntity();
        em.addComponent(e, new Position(1, 2));
        const handle = em.getComponent<Position>(e, Position)!;

        em.addComponent(e, new Velocity(3, 4));

        const arch = getOwner(world, e)!;
        const column = arch.getColumn(ComponentType.of(Position))!;
        const before = column.lastChangeStamp;
        world.changeStamps.advance();

        handle.x = 99;

        expect(column.lastChangeStamp > before).toBe(true);
        expect(em.getComponent<Position>(e, Position)!.x).toBe(99);
    });

    test("notifyChanged through a tracked handle marks its column", () => {
        const e = em.createEntity();
        em.addComponent(e, new Counter());
        const handle = em.getComponent<Counter>(e, Counter)!;
        const column = getOwner(world, e)!.getColumn(ComponentType.of(Counter))!;
        const before = column.lastChangeStamp;
        world.changeStamps.advance();

        handle.count(1);

        expect(column.lastChangeStamp > before).toBe(true);
        expect(handle.counted).toEqual([1]);
    });

    test("components carried through a command-buffer move are not left wrapped", () => {
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
    test("structural changes are deferred until playback", () => {
        const cbSystem = world.getOrCreateSystem(EntityCommandBufferSystem);
        const cb = cbSystem.getEntityCommandBuffer();

        const e = cb.createEntity("deferred");
        cb.addComponent(e, new Position(1, 2));

        expect(new EntityQuery(world, [Position]).enabledEntityCount()).toBe(0);

        cbSystem.update();
        expect(new EntityQuery(world, [Position]).enabledEntityCount()).toBe(1);
        expect(em.getComponent<Position>(e, Position)!.x).toBe(1);
    });

    test("commands for an entity destroyed before playback are dropped", () => {
        const cbSystem = world.getOrCreateSystem(EntityCommandBufferSystem);
        const cb = cbSystem.getEntityCommandBuffer();
        const gone = em.createEntity("gone", [new Position()]);
        const kept = em.createEntity("kept", [new Position()]);
        em.setEnabledState(kept, DISABLED);
        cb.setEnabledState(gone, ENABLED);
        cb.addComponent(gone, new Tag());
        cb.setEnabledState(kept, ENABLED);
        em.destroyEntity(gone);

        cbSystem.update();
        expect(em.exists(gone)).toBe(false);
        expect(em.isEnabled(kept)).toBe(true);
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

        const fresh = em.createEntity("second");
        em.addComponent(fresh, new Position(2, 2));

        expect(entityIndexOf(fresh)).toBe(entityIndexOf(stale));
        expect(fresh === stale).toBe(false);
        expect(entityGenerationOf(fresh)).toBe(entityGenerationOf(stale) + 1);

        expect(em.exists(stale)).toBe(false);
        expect(em.getComponent(stale, Position)).toBe(undefined);
        expect(em.getComponent<Position>(fresh, Position)!.x).toBe(2);
    });

    test("destroying via a stale handle is a no-op for the new occupant", () => {
        const stale = em.createEntity();
        em.destroyEntity(stale);
        const fresh = em.createEntity();
        em.destroyEntity(stale);
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
        expect(q.enabledEntityCount()).toBe(0);
    });
});

class Greeting extends Resource {
    constructor(public readonly text: string) {
        super();
    }
}

class Farewell extends Resource {
}

class PresenceRecorder implements ResourceListener {
    public readonly changes: boolean[] = [];

    public onPresenceChanged(present: boolean): void {
        this.changes.push(present);
    }
}

describe("ResourceManager", () => {
    test("insert stores a constructed resource under its class and replaces an earlier one", () => {
        expect(world.resources.tryGet(Greeting)).toBeUndefined();
        const hello = world.resources.insert(new Greeting("hello"));
        expect(world.resources.get(Greeting)).toBe(hello);
        expect(world.resources.getOrCreate(Greeting).text).toBe("hello");
        const bye = new Greeting("bye");
        world.resources.insert(bye);
        expect(world.resources.get(Greeting)).toBe(bye);
    });

    test("remove drops a resource, and removing an absent type does nothing", () => {
        const resources = world.resources;
        resources.remove(Greeting);
        resources.insert(new Greeting("hello"));
        resources.remove(Greeting);
        expect(resources.tryGet(Greeting)).toBeUndefined();
        expect(() => resources.get(Greeting)).toThrow(/Greeting/);
    });

    test("listeners hear only their own type's inserts and removes, not replacements", () => {
        const resources = world.resources;
        const greetings = new PresenceRecorder();
        const others = new PresenceRecorder();
        resources.addListener(Greeting, greetings);
        resources.addListener(Farewell, others);

        resources.insert(new Greeting("hello"));
        resources.insert(new Greeting("again"));
        resources.remove(Greeting);
        resources.remove(Greeting);
        resources.getOrCreate(Farewell);
        resources.getOrCreate(Farewell);
        resources.insert(new Farewell());

        expect(greetings.changes).toEqual([true, false]);
        expect(others.changes).toEqual([true]);
    });

    test("a type nobody watches holds no listener list, and removing the last listener drops it", () => {
        const resources = world.resources;
        const recorder = new PresenceRecorder();
        expect(resources.listenerCount(Greeting)).toBe(0);
        resources.addListener(Greeting, recorder);
        resources.addListener(Greeting, recorder);
        expect(resources.listenerCount(Greeting)).toBe(2);
        resources.removeListener(Greeting, recorder);
        expect(resources.listenerCount(Greeting)).toBe(0);
        resources.insert(new Greeting("unheard"));
        expect(recorder.changes).toEqual([]);
    });
});

describe("World", () => {
    test("systems yields every system the world holds", () => {
        const commandBufferSystem = world.getOrCreateSystem(EntityCommandBufferSystem);
        const systems = [...world.systems()];
        expect(systems.length).toBe(world.systemCount);
        expect(systems.length).toBeGreaterThan(1);
        expect(systems.includes(commandBufferSystem)).toBe(true);
        expect(systems.includes(world.rootSystemGroup!)).toBe(true);
    });
});

type LifecycleCounts = Map<string, {disabled: number, destroyed: number}>;

function countLifecycle(counts: LifecycleCounts, name: string, event: "disabled" | "destroyed"): void {
    const entry = counts.get(name) ?? {disabled: 0, destroyed: 0};
    entry[event]++;
    counts.set(name, entry);
}

function recordingGroup(counts: LifecycleCounts, name: string): SystemCtor<SystemGroup> {
    return class extends SystemGroup {
        override onDisable(): void {
            countLifecycle(counts, name, "disabled");
            super.onDisable();
        }

        protected override onDestroy(): void {
            countLifecycle(counts, name, "destroyed");
        }
    };
}

function recordingSystemIn(group: SystemCtor<SystemGroup> | undefined, counts: LifecycleCounts, name: string): SystemCtor<System> {
    return class extends System {
        override systemGroup() {
            return group;
        }

        onUpdate() {
        }

        override onDisable(): void {
            countLifecycle(counts, name, "disabled");
        }

        protected override onDestroy(): void {
            countLifecycle(counts, name, "destroyed");
        }
    };
}

const CHILDREN_PER_GROUP = 5;
const ONCE = {disabled: 1, destroyed: 1};

function childNames(prefix: string): string[] {
    return Array.from({length: CHILDREN_PER_GROUP}, (_, i) => prefix + i);
}

describe("SystemGroup lifecycle", () => {
    test("destroying a group destroys every child and disables each one once", () => {
        const counts: LifecycleCounts = new Map();
        const groupCtor = recordingGroup(counts, "group");
        const childCtors = childNames("child").map(name => recordingSystemIn(groupCtor, counts, name));
        for (const ctor of childCtors) world.getOrCreateSystem(ctor);
        const group = world.tryGetSystem(groupCtor)!;
        expect(group.systems.length).toBe(CHILDREN_PER_GROUP);

        group.destroy();

        expect(group.systems.length).toBe(0);
        for (const ctor of childCtors) expect(world.hasSystem(ctor)).toBe(false);
        expect(world.hasSystem(groupCtor)).toBe(false);
        for (const name of [...childNames("child"), "group"]) expect(counts.get(name)).toEqual(ONCE);
    });

    test("world.stop destroys every system in every group once and leaves the world without systems", () => {
        const counts: LifecycleCounts = new Map();
        const groupCtor = recordingGroup(counts, "group");
        for (const name of childNames("nested")) world.getOrCreateSystem(recordingSystemIn(groupCtor, counts, name));
        for (const name of childNames("root")) world.getOrCreateSystem(recordingSystemIn(undefined, counts, name));

        world.stop();

        for (const name of [...childNames("nested"), ...childNames("root"), "group"]) expect(counts.get(name)).toEqual(ONCE);
        expect(world.systemCount).toBe(0);
    });

    test("children of a disabled group are not disabled a second time when the world stops", () => {
        const counts: LifecycleCounts = new Map();
        const groupCtor = recordingGroup(counts, "group");
        for (const name of childNames("child")) world.getOrCreateSystem(recordingSystemIn(groupCtor, counts, name));
        world.tryGetSystem(groupCtor)!.enabled = false;

        world.stop();

        for (const name of [...childNames("child"), "group"]) expect(counts.get(name)).toEqual(ONCE);
    });

    test("disabling a group does not disable a child that is already off", () => {
        const counts: LifecycleCounts = new Map();
        const groupCtor = recordingGroup(counts, "group");
        const childCtor = recordingSystemIn(groupCtor, counts, "child");
        world.getOrCreateSystem(childCtor).enabled = false;

        world.tryGetSystem(groupCtor)!.enabled = false;

        expect(counts.get("child")!.disabled).toBe(1);
    });

    test("a child toggled inside a disabled group gets no callbacks until the group is enabled", () => {
        const enables: string[] = [];
        const groupCtor = class extends SystemGroup {
        };
        const childCtor = class extends System {
            override systemGroup() {
                return groupCtor;
            }

            onUpdate() {
            }

            override onEnable(): void {
                enables.push("enabled");
            }

            override onDisable(): void {
                enables.push("disabled");
            }
        };
        const child = world.getOrCreateSystem(childCtor);
        const group = world.tryGetSystem(groupCtor)!;
        group.enabled = false;
        enables.length = 0;

        child.enabled = false;
        child.enabled = true;
        expect(enables).toEqual([]);

        group.enabled = true;
        expect(enables).toEqual(["enabled"]);
    });
});

const STEP_MS = 16;
const LATER_PRIORITY = 1;

class Watched extends Component {
}

function archetypeProbe(askedTypes: ComponentType[]): EntityArchetype {
    const columnIndexOf = (token: ComponentType) => {
        askedTypes.push(token);
        return NO_SOURCE_COLUMN;
    };
    return {columnIndexOf} as unknown as EntityArchetype;
}

describe("EntityQuery disposal", () => {
    test("the archetype map's listener counts return to their start after systems owning bound queries come and go", () => {
        const archetypes = world.archetypes;
        const createListenersAtStart = archetypes.onCreateArchetype.listenerCount;
        const pruneListenersAtStart = archetypes.onPruneArchetype.listenerCount;
        const ownerCtor = class extends System {
            private readonly positions = this.createEntityQuery([Position]);

            protected override onCreate(): void {
                this.positions.hasEntity();
                this.requireAnyForUpdate([Velocity]);
                this.requireAllForUpdate(this.createEntityQuery([Tag]));
            }

            onUpdate() {
            }
        };
        const ownedQueryCount = 3;

        em.createEntity("v", [new Velocity()]);
        world.createSystem(ownerCtor);
        world.step(STEP_MS);
        expect(archetypes.onCreateArchetype.listenerCount).toBe(createListenersAtStart + ownedQueryCount);
        expect(archetypes.onPruneArchetype.listenerCount).toBe(pruneListenersAtStart + ownedQueryCount);

        world.removeSystem(ownerCtor);
        expect(archetypes.onCreateArchetype.listenerCount).toBe(createListenersAtStart);
        expect(archetypes.onPruneArchetype.listenerCount).toBe(pruneListenersAtStart);
    });

    test("a destroyed system's query ignores archetypes created afterwards", () => {
        const watchedType = ComponentType.of(Watched);
        const ownerCtor = class extends System {
            private readonly watched = this.createEntityQuery([Watched]);

            protected override onCreate(): void {
                this.watched.hasEntity();
            }

            onUpdate() {
            }
        };
        const askedTypes: ComponentType[] = [];
        world.createSystem(ownerCtor);
        world.archetypes.onCreateArchetype.invoke(archetypeProbe(askedTypes));
        expect(askedTypes.includes(watchedType)).toBe(true);

        askedTypes.length = 0;
        world.removeSystem(ownerCtor);
        world.archetypes.onCreateArchetype.invoke(archetypeProbe(askedTypes));
        world.archetypes.getOrCreate([Watched, Position]);
        expect(askedTypes.includes(watchedType)).toBe(false);
    });

    test("using a disposed query throws an error naming its included and excluded types; dispose is idempotent", () => {
        em.createEntity("p", [new Position()]);
        const listenersAtStart = world.archetypes.onCreateArchetype.listenerCount;
        const bound = new EntityQuery(world, [Position, Velocity], [Tag]);
        bound.hasEntity();
        const unbound = new EntityQuery(world, [Velocity], [Position]);

        bound.dispose();
        bound.dispose();
        unbound.dispose();

        expect(world.archetypes.onCreateArchetype.listenerCount).toBe(listenersAtStart);
        expect(() => bound.hasEntity()).toThrow(/include \[Position, Velocity\], exclude \[Tag\]/);
        expect(() => bound.stream({read: {p: Position}}).count()).toThrow(/Position, Velocity/);
        expect(() => [...bound]).toThrow(/Position, Velocity/);
        expect(() => unbound.enabledEntityCount()).toThrow(/include \[Velocity\], exclude \[Position\]/);
    });
});

describe("World.stop during an update", () => {
    test("a root-group system that stops the world lets world.step finish without running later systems", () => {
        let laterUpdates = 0;
        const stopperCtor = class extends System {
            onUpdate() {
                this.world.stop();
            }
        };
        const laterCtor = class extends System {
            private readonly positions = this.createEntityQuery([Position]);

            override priority(): number {
                return LATER_PRIORITY;
            }

            protected override onCreate(): void {
                this.requireAnyForUpdate(this.positions);
            }

            onUpdate() {
                laterUpdates++;
                this.positions.hasEntity();
            }
        };
        world.createSystem(stopperCtor);
        world.createSystem(laterCtor);
        em.createEntity("p", [new Position()]);

        world.step(STEP_MS);

        expect(laterUpdates).toBe(0);
        expect(world.systemCount).toBe(0);
    });

    test("a group reading its own query after a child stopped the world finishes the step, then disposes the query", () => {
        const createListenersAtStart = world.archetypes.onCreateArchetype.listenerCount;
        let positionsAfterChildren: number | undefined;
        let siblingUpdates = 0;
        const groupCtor = class extends SystemGroup {
            public readonly positions = this.createEntityQuery([Position]);

            override onUpdate(): void {
                super.onUpdate();
                positionsAfterChildren = this.positions.enabledEntityCount();
            }
        };
        const stopperCtor = class extends System {
            override systemGroup() {
                return groupCtor;
            }

            onUpdate() {
                this.world.stop();
            }
        };
        const siblingCtor = class extends System {
            override systemGroup() {
                return groupCtor;
            }

            override priority(): number {
                return LATER_PRIORITY;
            }

            protected override onCreate(): void {
                this.requireAllForUpdate([Position]);
            }

            onUpdate() {
                siblingUpdates++;
            }
        };
        world.createSystem(stopperCtor);
        world.createSystem(siblingCtor);
        const group = world.tryGetSystem(groupCtor)!;
        em.createEntity("p", [new Position()]);

        world.step(STEP_MS);

        expect(positionsAfterChildren).toBe(1);
        expect(siblingUpdates).toBe(0);
        expect(() => group.positions.hasEntity()).toThrow(/Position/);
        expect(world.archetypes.onCreateArchetype.listenerCount).toBe(createListenersAtStart);
    });
});

const MANY_ENTITIES = 10_000;

class OccupancyRecorder implements OccupancyWatcher {
    public readonly changes: boolean[] = [];

    public onOccupancyChanged(occupied: boolean): void {
        this.changes.push(occupied);
    }
}

class TrackedAgainstWalk {
    public readonly tracked: EntityQuery<readonly ComponentCtor<Component>[], readonly ComponentCtor<Component>[]>;
    public readonly walked: EntityQuery<readonly ComponentCtor<Component>[], readonly ComponentCtor<Component>[]>;

    public constructor(include: readonly ComponentCtor<Component>[], exclude: readonly ComponentCtor<Component>[] = []) {
        this.tracked = new EntityQuery(world, include, exclude);
        this.tracked.track();
        this.walked = new EntityQuery(world, include, exclude);
    }

    public expectHasEntity(expected: boolean): void {
        expect(this.walked.hasEntity()).toBe(expected);
        expect(this.tracked.hasEntity()).toBe(expected);
    }
}

describe("EntityQuery tracking", () => {
    test("a tracked query agrees with a walk across component adds and removes into archetypes made after tracking", () => {
        const positions = new TrackedAgainstWalk([Position], [Tag]);
        positions.expectHasEntity(false);
        const e = em.createEntity("e");
        positions.expectHasEntity(false);

        em.addComponent(e, new Position());
        positions.expectHasEntity(true);
        em.addComponent(e, new Velocity());
        positions.expectHasEntity(true);
        em.addComponent(e, new Tag());
        positions.expectHasEntity(false);
        em.removeComponent(e, Tag);
        positions.expectHasEntity(true);
        em.removeComponent(e, Position);
        positions.expectHasEntity(false);
        expect(world.archetypes.getOrCreate([Position, Velocity]).occupancyWatcherCount).toBe(1);
    });

    test("a tracked query agrees with a walk across enabling and disabling single entities and whole archetypes", () => {
        const positions = new TrackedAgainstWalk([Position]);
        const a = em.createEntity("a", [new Position()]);
        const b = em.createEntity("b", [new Position(), new Velocity()]);
        positions.expectHasEntity(true);

        em.setEnabledState(a, DISABLED);
        positions.expectHasEntity(true);
        em.setEnabledState(b, DISABLED);
        positions.expectHasEntity(false);
        em.setEnabledState(b, ENABLED);
        positions.expectHasEntity(true);
        em.setEnabledStateForQuery(positions.walked as never, DISABLED);
        positions.expectHasEntity(false);
        em.setEnabledStateForQuery(positions.walked as never, ENABLED);
        positions.expectHasEntity(true);
    });

    test("a tracked query agrees with a walk when the last entity is destroyed and when its archetypes are emptied at once", () => {
        const positions = new TrackedAgainstWalk([Position]);
        const a = em.createEntity("a", [new Position()]);
        const b = em.createEntity("b", [new Position()]);
        em.destroyEntity(a);
        positions.expectHasEntity(true);
        em.destroyEntity(b);
        positions.expectHasEntity(false);

        em.createEntity("c", [new Position()]);
        em.createEntity("d", [new Position(), new Velocity()]);
        em.setEnabledState(em.createEntity("e", [new Position()]), DISABLED);
        positions.expectHasEntity(true);
        em.destroyQuery(positions.walked as never);
        positions.expectHasEntity(false);
    });

    test("a tracked query agrees with a walk across command buffer playback and batch creation", () => {
        const positions = new TrackedAgainstWalk([Position], [Tag]);
        const cbSystem = world.getOrCreateSystem(EntityCommandBufferSystem);
        const cb = cbSystem.getEntityCommandBuffer();
        const recorded = cb.createEntity("recorded", [new Position(), new Velocity()]);
        positions.expectHasEntity(false);
        cbSystem.update();
        positions.expectHasEntity(true);

        cb.addComponent(recorded, new Tag());
        cbSystem.update();
        positions.expectHasEntity(false);

        const disabledOnArrival = cb.createEntity("disabledOnArrival", [new Position()]);
        cb.setEnabledState(disabledOnArrival, DISABLED);
        cbSystem.update();
        positions.expectHasEntity(false);

        const batched = em.createEntity("batched", [new Position(), new Velocity()]);
        positions.expectHasEntity(true);
        em.addComponents(batched, [new Tag(), new Watched()]);
        positions.expectHasEntity(false);

        cb.removeComponent(batched, Tag);
        cbSystem.update();
        positions.expectHasEntity(true);
        cb.destroyEntity(batched);
        cbSystem.update();
        positions.expectHasEntity(false);
    });

    test("pruning an empty matching archetype drops its watcher and keeps the count right", () => {
        const positions = new TrackedAgainstWalk([Position]);
        const kept = em.createEntity("kept", [new Position()]);
        const leaving = em.createEntity("leaving", [new Position(), new Velocity()]);
        const emptied = getOwner(world, leaving)!;
        em.destroyEntity(leaving);
        expect(emptied.occupancyWatcherCount).toBe(1);

        expect(world.archetypes.prune()).toBeGreaterThan(0);
        expect(emptied.occupancyWatcherCount).toBe(0);
        positions.expectHasEntity(true);
        em.destroyEntity(kept);
        positions.expectHasEntity(false);

        em.createEntity("again", [new Position(), new Velocity()]);
        positions.expectHasEntity(true);
    });

    test("calling track twice registers one watcher per archetype", () => {
        const e = em.createEntity("e", [new Position()]);
        const query = new EntityQuery(world, [Position]);
        query.track();
        query.track();

        expect(getOwner(world, e)!.occupancyWatcherCount).toBe(1);
        em.destroyEntity(e);
        expect(query.hasEntity()).toBe(false);
    });

    test("dispose removes the query's archetype watchers and drops its own watchers", () => {
        const e = em.createEntity("e", [new Position()]);
        const archetype = getOwner(world, e)!;
        const query = new EntityQuery(world, [Position]);
        const recorder = new OccupancyRecorder();
        query.addOccupancyWatcher(recorder);
        expect(archetype.occupancyWatcherCount).toBe(1);

        query.dispose();
        em.setEnabledState(e, DISABLED);

        expect(archetype.occupancyWatcherCount).toBe(0);
        expect(recorder.changes).toEqual([]);
        expect(() => query.hasEntity()).toThrow(/Position/);
    });

    test("query and archetype watchers hear exactly the zero crossings while many entities move one by one", () => {
        const query = new EntityQuery(world, [Position], [Tag]);
        const queryRecorder = new OccupancyRecorder();
        query.addOccupancyWatcher(queryRecorder);
        const entities = Array.from({length: MANY_ENTITIES}, (_, i) => em.createEntity(undefined, [new Position(i)]));
        const plain = getOwner(world, entities[0])!;
        const plainRecorder = new OccupancyRecorder();
        plain.addOccupancyWatcher(plainRecorder);
        expect(queryRecorder.changes).toEqual([true]);

        for (const e of entities) em.addComponent(e, new Velocity());
        for (const e of entities) em.removeComponent(e, Velocity);
        expect(queryRecorder.changes).toEqual([true]);
        expect(plainRecorder.changes).toEqual([false, true]);

        for (const e of entities) em.addComponent(e, new Tag());
        for (const e of entities) em.removeComponent(e, Tag);
        expect(queryRecorder.changes).toEqual([true, false, true]);

        for (const e of entities) em.setEnabledState(e, DISABLED);
        em.setEnabledStateForQuery(query as never, ENABLED);
        expect(queryRecorder.changes).toEqual([true, false, true, false, true]);
        expect(plainRecorder.changes).toEqual([false, true, false, true, false, true]);

        query.removeOccupancyWatcher(queryRecorder);
        for (const e of entities) em.destroyEntity(e);
        expect(queryRecorder.changes).toEqual([true, false, true, false, true]);
        expect(query.hasEntity()).toBe(false);
    });

    test("a system's requirement queries are tracked from onCreate and gate its update", () => {
        let updates = 0;
        const requirerCtor = class extends System {
            private readonly positions = this.createEntityQuery([Position]);

            protected override onCreate(): void {
                this.requireAnyForUpdate(this.positions);
                this.requireAllForUpdate([Velocity]);
            }

            onUpdate() {
                updates++;
            }
        };
        world.createSystem(requirerCtor);
        const both = world.archetypes.getOrCreate([Position, Velocity]);
        expect(both.occupancyWatcherCount).toBe(2);

        world.step(STEP_MS);
        const e = em.createEntity("e", [new Position()]);
        world.step(STEP_MS);
        expect(updates).toBe(0);
        em.addComponent(e, new Velocity());
        world.step(STEP_MS);
        expect(updates).toBe(1);
        em.setEnabledState(e, DISABLED);
        world.step(STEP_MS);
        expect(updates).toBe(1);

        world.removeSystem(requirerCtor);
        expect(both.occupancyWatcherCount).toBe(0);
    });
});
