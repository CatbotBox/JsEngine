import {beforeEach, describe, expect, test} from "../testing/harness";
import {World} from "./world";
import {Component} from "./component";
import {EntityManager} from "./entityManager";
import {EntityArchetype} from "./entityArchetype";
import {EntityQuery} from "./entityQuery";
import {getOwner} from "./ownership";
import {Entity} from "./entity";

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

let world: World;
let em: EntityManager;
let created: EntityArchetype[];

beforeEach(() => {
    world = new World();
    em = world.entityManager;
    created = [];
    world.archetypes.onCreateArchetype.add(a => created.push(a));
});

function ownerOf(e: Entity): EntityArchetype {
    return getOwner(world, e) as EntityArchetype;
}

function columnMapOf(edge: { columnMap: Int32Array }): number[] {
    return Array.from(edge.columnMap);
}

describe("archetype edges", () => {
    test("a second add of the same type from the same archetype reuses the cached edge", () => {
        const a = em.createEntity();
        const b = em.createEntity();
        em.addComponent(a, new Position());
        const from = world.archetypes.getOrCreate([]);
        const edge = from.addEdges.get(Position.type());
        expect(edge).toBeDefined();
        const createdAfterFirst = created.length;
        const loadedAfterFirst = world.archetypes.loadedArchetypes;

        em.addComponent(b, new Position());

        expect(from.addEdges.get(Position.type())).toBe(edge);
        expect(world.archetypes.withAdded(from, Position.type())).toBe(edge!);
        expect(created.length).toBe(createdAfterFirst);
        expect(world.archetypes.loadedArchetypes).toBe(loadedAfterFirst);
        expect(ownerOf(b)).toBe(ownerOf(a));
    });

    test("an add/remove round trip lands the entity back in the original archetype object", () => {
        const e = em.createEntity();
        em.addComponent(e, new Position(1, 2));
        const original = ownerOf(e);

        em.addComponent(e, new Velocity(3, 4));
        const withVelocity = ownerOf(e);
        expect(withVelocity === original).toBe(false);

        em.removeComponent(e, Velocity);
        expect(ownerOf(e)).toBe(original);
        expect(em.getComponent<Position>(e, Position)!.x).toBe(1);
        expect(original.addEdges.get(Velocity.type())!.target).toBe(withVelocity);
        expect(withVelocity.removeEdges.get(Velocity.type())!.target).toBe(original);
    });

    test("edges are cached in both directions from either side", () => {
        const from = world.archetypes.getOrCreate([Position, Velocity]);
        const removed = world.archetypes.withRemoved(from, Velocity.type());
        expect(removed.target).toBe(world.archetypes.getOrCreate([Position]));
        expect(removed.target.addEdges.get(Velocity.type())!.target).toBe(from);
    });

    test("columnMap maps every target column to its source column, -1 for the added type", () => {
        const from = world.archetypes.getOrCreate([Velocity, Position]);
        const add = world.archetypes.withAdded(from, Tag.type());
        const addTarget = add.target;
        const expectedAdd = addTarget.componentTypes.map(t => from.componentTypes.indexOf(t));
        expect(columnMapOf(add)).toEqual(expectedAdd);
        expect(columnMapOf(add)[addTarget.columnIndexOf(Tag.type())]).toBe(-1);
        expect(columnMapOf(add)[addTarget.columnIndexOf(Velocity.type())]).toBe(from.columnIndexOf(Velocity.type()));

        const remove = world.archetypes.withRemoved(addTarget, Velocity.type());
        const removeTarget = remove.target;
        expect(removeTarget.componentTypes.length).toBe(2);
        const expectedRemove = removeTarget.componentTypes.map(t => addTarget.columnIndexOf(t));
        expect(columnMapOf(remove)).toEqual(expectedRemove);
        expect(columnMapOf(remove).indexOf(-1)).toBe(-1);
    });

    test("adding a type the archetype has, or removing one it lacks, throws", () => {
        const arch = world.archetypes.getOrCreate([Position]);
        expect(() => world.archetypes.withAdded(arch, Position.type())).toThrow();
        expect(() => world.archetypes.withRemoved(arch, Velocity.type())).toThrow();
    });
});

describe("archetype lifetime", () => {
    test("prune clears edges in both directions and drops the archetype from queries", () => {
        const query = new EntityQuery(world, [Position]);
        const e = em.createEntity();
        em.addComponent(e, new Position());
        em.addComponent(e, new Velocity());
        const withBoth = ownerOf(e);
        const positionOnly = world.archetypes.getOrCreate([Position]);
        expect(Array.from(query.archetypes).indexOf(withBoth) !== -1).toBe(true);

        em.removeComponent(e, Velocity);
        const pruned: EntityArchetype[] = [];
        world.archetypes.onPruneArchetype.add(a => pruned.push(a));
        expect(world.archetypes.prune()).toBe(1);

        expect(pruned.length).toBe(1);
        expect(pruned[0]).toBe(withBoth);
        expect(positionOnly.addEdges.get(Velocity.type())).toBeUndefined();
        expect(withBoth.removeEdges.size).toBe(0);
        expect(withBoth.addEdges.size).toBe(0);
        expect(Array.from(query.archetypes).indexOf(withBoth)).toBe(-1);
        expect(Array.from(world.archetypes.values()).indexOf(withBoth)).toBe(-1);
    });

    test("a pruned archetype is recreated fresh on demand and picked up by queries", () => {
        const query = new EntityQuery(world, [Velocity]);
        const e = em.createEntity();
        em.addComponent(e, new Velocity(5, 6));
        const first = ownerOf(e);
        expect(query.entityCount()).toBe(1);
        em.removeComponent(e, Velocity);
        world.archetypes.prune();

        em.addComponent(e, new Velocity(7, 8));
        const second = ownerOf(e);
        expect(second === first).toBe(false);
        expect(world.archetypes.getOrCreate([Velocity])).toBe(second);
        expect(em.getComponent<Velocity>(e, Velocity)!.dx).toBe(7);
        expect(query.entityCount()).toBe(1);
        expect(Array.from(query.archetypes).indexOf(first)).toBe(-1);
    });

    test("an archetype holding only disabled entities is not pruned", () => {
        const e = em.createEntity();
        em.addComponent(e, new Position());
        const arch = ownerOf(e);
        em.setEnabledState(e, false);
        expect(arch.entityCount).toBe(0);

        world.archetypes.prune();

        expect(world.archetypes.getOrCreate([Position])).toBe(arch);
        expect(ownerOf(e)).toBe(arch);
        expect(em.isEnabled(e)).toBe(false);
    });

    test("the component-less archetype survives pruning", () => {
        const empty = world.archetypes.getOrCreate([]);
        expect(empty.entityCountUnfiltered).toBe(0);
        world.archetypes.prune();
        expect(world.archetypes.getOrCreate([])).toBe(empty);
    });
});
