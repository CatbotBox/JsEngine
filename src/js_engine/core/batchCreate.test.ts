import {beforeEach, describe, expect, test} from "../testing/harness";
import {World} from "./world";
import {Component} from "./component";
import {ComponentType} from "./componentType";
import {EntityManager} from "./entityManager";
import {EntityArchetype} from "./entityArchetype";
import {EntityCommandBuffer} from "./entityCommandBuffer";
import {EntityQuery} from "./entityQuery";
import {EntityWriteOptions} from "./entityWriteOptions";
import {Entity} from "./entity";
import {getEntityName, getOwner} from "./ownership";
import {Parent, ParentTransform} from "../translation/parent";
import {Children} from "../translation/children";
import {LocalPosition} from "../translation/localPosition";

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

let setupLog: string[] = [];

class LoggedA extends Component {
    constructor(public label = "A") {
        super();
    }

    setup(entity: Entity, entityManager: EntityWriteOptions) {
        setupLog.push(this.label);
    }
}

class LoggedB extends Component {
    setup(entity: Entity, entityManager: EntityWriteOptions) {
        setupLog.push("B");
    }
}

let world: World;
let em: EntityManager;
let created: EntityArchetype[];

beforeEach(() => {
    world = new World();
    em = world.entityManager;
    created = [];
    setupLog = [];
    world.archetypes.onCreateArchetype.add(a => created.push(a));
});

function ownerOf(e: Entity): EntityArchetype {
    return getOwner(world, e) as EntityArchetype;
}

function countIn(...ctors: (new (...args: never[]) => Component)[]): number {
    return world.archetypes.getOrCreate(ctors as never).entityCountUnfiltered;
}

describe("EntityCommandBuffer playback semantics", () => {
    test("a created entity gets its recorded components, name and enabled state", () => {
        const ecb = new EntityCommandBuffer();
        const e = ecb.createEntity("spawned");
        ecb.addComponent(e, new Position(1, 2));
        ecb.addComponent(e, new Velocity(3, 4));

        ecb.playback(em);

        expect(em.exists(e)).toBe(true);
        expect(getEntityName(e)).toBe("spawned");
        expect(em.isEnabled(e)).toBe(true);
        expect(em.getComponent<Position>(e, Position)!.x).toBe(1);
        expect(em.getComponent<Velocity>(e, Velocity)!.dy).toBe(4);
        expect(ownerOf(e)).toBe(world.archetypes.getOrCreate([Position, Velocity]));
    });

    test("a created entity with no commands lands in the component-less archetype", () => {
        const ecb = new EntityCommandBuffer();
        const e = ecb.createEntity();

        ecb.playback(em);

        expect(ownerOf(e)).toBe(world.archetypes.getOrCreate([]));
        expect(em.isEnabled(e)).toBe(true);
    });

    test("an entity created and destroyed in the same buffer never survives playback", () => {
        const ecb = new EntityCommandBuffer();
        const e = ecb.createEntity("doomed");
        ecb.addComponent(e, new Position());
        ecb.destroyEntity(e);

        ecb.playback(em);

        expect(em.exists(e)).toBe(false);
        expect(getEntityName(e)).toBeUndefined();
        expect(countIn(Position)).toBe(0);
        expect(world.entityCount).toBe(0);
    });

    test("a component added then removed in the same buffer is absent", () => {
        const ecb = new EntityCommandBuffer();
        const e = ecb.createEntity();
        ecb.addComponent(e, new Position());
        ecb.addComponent(e, new Velocity());
        ecb.removeComponent(e, Position);

        ecb.playback(em);

        expect(em.hasComponent(e, Position)).toBe(false);
        expect(ownerOf(e)).toBe(world.archetypes.getOrCreate([Velocity]));
    });

    test("a created entity disabled in the same buffer arrives disabled", () => {
        const ecb = new EntityCommandBuffer();
        const e = ecb.createEntity();
        ecb.addComponent(e, new Position(5));
        ecb.setEnabledState(e, false);

        ecb.playback(em);

        expect(em.isEnabled(e)).toBe(false);
        expect(em.getComponent<Position>(e, Position)!.x).toBe(5);
        expect(world.archetypes.getOrCreate([Position]).entityCount).toBe(0);
        expect(countIn(Position)).toBe(1);
    });

    test("setComponent on a created entity adds the component", () => {
        const ecb = new EntityCommandBuffer();
        const e = ecb.createEntity();
        ecb.addComponent(e, new Position());
        ecb.setComponent(e, new Velocity(7));

        ecb.playback(em);

        expect(em.getComponent<Velocity>(e, Velocity)!.dx).toBe(7);
        expect(ownerOf(e)).toBe(world.archetypes.getOrCreate([Position, Velocity]));
    });

    test("a tracked handle from the buffer stamps the entity's column after playback", () => {
        const ecb = new EntityCommandBuffer();
        const e = ecb.createEntity();
        const handle = ecb.addTrackedComponent(e, new Position(1));
        ecb.addComponent(e, new Tag());
        ecb.playback(em);

        const column = ownerOf(e).getColumn(ComponentType.of(Position))!;
        const before = column.lastUpdatedTime;
        const t = performance.now();
        while (performance.now() === t) { /* spin past the clock's resolution */ }
        handle.x = 42;

        expect(column.lastUpdatedTime > before).toBe(true);
        expect(em.getComponent<Position>(e, Position)!.x).toBe(42);
    });

    test("setup() runs at record time, once, and its companions play back", () => {
        const parent = em.createEntity();
        em.addComponent(parent, new Position());
        const ecb = new EntityCommandBuffer();
        const child = ecb.createEntity();
        ecb.addComponent(child, new LoggedA());
        ecb.addComponent(child, new Parent(parent));
        expect(setupLog).toEqual(["A"]);

        ecb.playback(em);

        expect(setupLog).toEqual(["A"]);
        expect(em.hasComponent(child, ParentTransform)).toBe(true);
        expect(em.hasComponent(parent, Children)).toBe(true);
    });

    test("an add to an existing entity that already has the type keeps the existing instance", () => {
        const e = em.createEntity();
        const original = new Position(1);
        em.addComponent(e, original);
        const ecb = new EntityCommandBuffer();
        ecb.addComponent(e, new Position(2));
        ecb.addComponent(e, new Velocity());

        ecb.playback(em);

        expect(ownerOf(e).getColumn(ComponentType.of(Position))!.get(ownerOf(e).getIndexOfEntity(e)!)).toBe(original);
        expect(em.hasComponent(e, Velocity)).toBe(true);
    });

    test("an existing entity keeps its enabled state across a buffered move", () => {
        const e = em.createEntity();
        em.addComponent(e, new Position());
        em.setEnabledState(e, false);
        const ecb = new EntityCommandBuffer();
        ecb.addComponent(e, new Velocity());

        ecb.playback(em);

        expect(em.isEnabled(e)).toBe(false);
        expect(ownerOf(e)).toBe(world.archetypes.getOrCreate([Position, Velocity]));
    });

    test("playback empties the buffer", () => {
        const ecb = new EntityCommandBuffer();
        ecb.addComponent(ecb.createEntity(), new Position());
        expect(ecb.isEmpty).toBe(false);
        ecb.playback(em);
        expect(ecb.isEmpty).toBe(true);
        expect(new EntityQuery(world, [Position]).entityCount()).toBe(1);
    });
});

/** Counts placements into `arch` (addEntity on this instance only). */
function countPlacements(arch: EntityArchetype): () => number {
    let placements = 0;
    const addEntity = arch.addEntity.bind(arch);
    arch.addEntity = (...args: Parameters<EntityArchetype["addEntity"]>) => {
        placements++;
        addEntity(...args);
    };
    return () => placements;
}

describe("EntityManager.createEntity with components", () => {
    test("lands in the final archetype, creating exactly that one archetype", () => {
        const e = em.createEntity("batch", [new Position(1, 2), new Velocity(3, 4), new Tag()]);

        expect(created.length).toBe(1);
        expect(created[0]).toBe(ownerOf(e));
        expect(ownerOf(e)).toBe(world.archetypes.getOrCreate([Position, Velocity, Tag]));
        expect(getEntityName(e)).toBe("batch");
        expect(em.isEnabled(e)).toBe(true);
        expect(em.getComponent<Position>(e, Position)!.y).toBe(2);
        expect(em.getComponent<Velocity>(e, Velocity)!.dx).toBe(3);
    });

    test("never passes through the component-less archetype", () => {
        const empty = world.archetypes.getOrCreate([]);
        const placements = countPlacements(empty);

        em.createEntity(undefined, [new Position(), new Velocity()]);

        expect(placements()).toBe(0);
        expect(empty.entityCountUnfiltered).toBe(0);
    });

    test("without components it lands in the component-less archetype as before", () => {
        const a = em.createEntity("bare");
        const b = em.createEntity(undefined, []);

        expect(ownerOf(a)).toBe(world.archetypes.getOrCreate([]));
        expect(ownerOf(b)).toBe(ownerOf(a));
        expect(getEntityName(a)).toBe("bare");
    });

    test("setup() runs once per component in array order, after every component is placed", () => {
        let sawBWhileSettingUpA = false;
        class ProbeA extends LoggedA {
            setup(entity: Entity, entityManager: EntityWriteOptions) {
                super.setup(entity, entityManager);
                sawBWhileSettingUpA = em.hasComponent(entity, LoggedB);
            }
        }

        em.createEntity(undefined, [new LoggedB(), new ProbeA()]);
        expect(setupLog).toEqual(["B", "A"]);

        setupLog = [];
        em.createEntity(undefined, [new ProbeA(), new LoggedB()]);
        expect(setupLog).toEqual(["A", "B"]);
        expect(sawBWhileSettingUpA).toBe(true);
    });

    test("a type listed twice keeps the first instance and sets up only that one", () => {
        const first = new LoggedA("first");
        const e = em.createEntity(undefined, [first, new Position(), new LoggedA("second")]);

        const arch = ownerOf(e);
        expect(arch.componentTypes.length).toBe(2);
        expect(arch.getColumn(ComponentType.of(LoggedA))!.get(arch.getIndexOfEntity(e)!)).toBe(first);
        expect(setupLog).toEqual(["first"]);
    });

    test("a setup() companion already in the batch is a no-op: the passed instance stays", () => {
        const parent = em.createEntity(undefined, [new Position()]);
        const transform = new ParentTransform();

        const child = em.createEntity(undefined, [new Parent(parent), transform]);

        const arch = ownerOf(child);
        expect(arch).toBe(world.archetypes.getOrCreate([Parent, ParentTransform]));
        expect(arch.getColumn(ComponentType.of(ParentTransform))!.get(arch.getIndexOfEntity(child)!)).toBe(transform);
        expect(em.hasComponent(parent, Children)).toBe(true);
    });

    test("a setup() companion missing from the batch is added", () => {
        const parent = em.createEntity(undefined, [new Position()]);

        const child = em.createEntity(undefined, [new LocalPosition(1, 2, 3), new Parent(parent)]);

        expect(ownerOf(child)).toBe(world.archetypes.getOrCreate([LocalPosition, Parent, ParentTransform]));
        expect(em.getComponent<Parent>(child, Parent)!.entity).toBe(parent);
        expect(em.getComponent<LocalPosition>(child, LocalPosition)!.z).toBe(3);
    });

    test("column-backed instances passed in view the archetype column afterwards", () => {
        const a = em.createEntity(undefined, [new LocalPosition(1, 2, 3), new Tag()]);
        const pos = new LocalPosition(4, 5, 6);
        const b = em.createEntity(undefined, [pos, new Tag()]);

        const arch = ownerOf(b);
        const col = arch.getColumn(ComponentType.of(LocalPosition))!;
        const row = arch.getIndexOfEntity(b)!;
        expect(Array.from(col.f32Data!.subarray(row * 3, row * 3 + 3))).toEqual([4, 5, 6]);

        pos.y = 50;
        expect(col.f32Data![row * 3 + 1]).toBe(50);
        expect(em.getComponent<LocalPosition>(a, LocalPosition)!.y).toBe(2);
    });
});

describe("EntityManager.addComponents", () => {
    test("moves an existing entity once, creating only the final archetype", () => {
        const e = em.createEntity(undefined, [new Position(1)]);
        const source = ownerOf(e);
        created = [];

        em.addComponents(e, [new Velocity(2), new Tag()]);

        expect(created.length).toBe(1);
        expect(ownerOf(e)).toBe(created[0]);
        expect(ownerOf(e)).toBe(world.archetypes.getOrCreate([Position, Velocity, Tag]));
        expect(source.entityCountUnfiltered).toBe(0);
        expect(em.getComponent<Position>(e, Position)!.x).toBe(1);
        expect(em.getComponent<Velocity>(e, Velocity)!.dx).toBe(2);
    });

    test("types already present keep their instance and get no setup(); new ones set up in order", () => {
        const original = new LoggedA("original");
        const e = em.createEntity(undefined, [original]);
        setupLog = [];

        em.addComponents(e, [new LoggedB(), new LoggedA("replacement"), new Position(), new LoggedB()]);

        const arch = ownerOf(e);
        expect(arch).toBe(world.archetypes.getOrCreate([LoggedA, LoggedB, Position]));
        expect(arch.getColumn(ComponentType.of(LoggedA))!.get(arch.getIndexOfEntity(e)!)).toBe(original);
        expect(setupLog).toEqual(["B"]);
    });

    test("keeps the enabled state and existing column-backed values across the move", () => {
        const pos = new LocalPosition(7, 8, 9);
        const e = em.createEntity(undefined, [pos]);
        em.setEnabledState(e, false);

        em.addComponents(e, [new Velocity(), new Tag()]);

        expect(em.isEnabled(e)).toBe(false);
        const arch = ownerOf(e);
        const col = arch.getColumn(ComponentType.of(LocalPosition))!;
        const row = arch.getIndexOfEntity(e)!;
        expect(Array.from(col.f32Data!.subarray(row * 3, row * 3 + 3))).toEqual([7, 8, 9]);
        pos.x = 70;
        expect(col.f32Data![row * 3]).toBe(70);
    });

    test("a single new type takes the cached edge", () => {
        const e = em.createEntity(undefined, [new Position()]);
        const source = ownerOf(e);

        em.addComponents(e, [new Position(), new Velocity()]);

        expect(source.addEdges.get(ComponentType.of(Velocity))!.target).toBe(ownerOf(e));
    });

    test("nothing new is a no-op", () => {
        const e = em.createEntity(undefined, [new Position(1)]);
        const arch = ownerOf(e);
        const stamp = arch.lastStructuralChangeTime;

        em.addComponents(e, [new Position(2)]);
        em.addComponents(e, []);

        expect(ownerOf(e)).toBe(arch);
        expect(arch.lastStructuralChangeTime).toBe(stamp);
        expect(em.getComponent<Position>(e, Position)!.x).toBe(1);
    });
});

describe("EntityCommandBuffer batch playback", () => {
    test("created entities are placed straight into their final archetype", () => {
        const empty = world.archetypes.getOrCreate([]);
        const placements = countPlacements(empty);
        created = [];
        const ecb = new EntityCommandBuffer();
        const a = ecb.createEntity();
        ecb.addComponent(a, new Position());
        ecb.addComponent(a, new Velocity());
        const b = ecb.createEntity(undefined, [new Position(), new Velocity()]);

        ecb.playback(em);

        expect(placements()).toBe(0);
        expect(created.length).toBe(1);
        expect(ownerOf(a)).toBe(created[0]);
        expect(ownerOf(b)).toBe(created[0]);
    });

    test("createEntity with components records them, setting up each once in array order", () => {
        const ecb = new EntityCommandBuffer();
        const first = new LoggedA("first");
        const e = ecb.createEntity("recorded", [new LoggedB(), first, new LoggedA("second")]);
        expect(setupLog).toEqual(["B", "first"]);

        ecb.playback(em);

        const arch = ownerOf(e);
        expect(arch).toBe(world.archetypes.getOrCreate([LoggedA, LoggedB]));
        expect(arch.getColumn(ComponentType.of(LoggedA))!.get(arch.getIndexOfEntity(e)!)).toBe(first);
        expect(getEntityName(e)).toBe("recorded");
        expect(setupLog).toEqual(["B", "first"]);
    });

    test("addComponents on an existing entity plays back as one move", () => {
        const e = em.createEntity(undefined, [new Position(1)]);
        created = [];
        const ecb = new EntityCommandBuffer();
        ecb.addComponents(e, [new Velocity(), new Tag()]);

        ecb.playback(em);

        expect(created.length).toBe(1);
        expect(ownerOf(e)).toBe(world.archetypes.getOrCreate([Position, Velocity, Tag]));
        expect(em.getComponent<Position>(e, Position)!.x).toBe(1);
    });
});
