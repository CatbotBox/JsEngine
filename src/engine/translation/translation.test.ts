import {describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {World} from "../core/world";
import {RootSystemGroup} from "../core/rootSystemGroup";
import {Vec, Vec4} from "../math/types/vec";
import {Quaternions} from "../math/quaternions";
import {LocalPosition} from "./localPosition";
import {LocalToWorld} from "./localToWorld";
import {Parent, ParentTransform} from "./parent";
import {LocalRotation} from "./localRotation";
import {LocalScale} from "./localScale";
import {Component} from "../core/component";
import {EntityCommandBufferSystem} from "../core/entityCommandBufferSystem";
import type {EntityManager} from "../core/entityManager";
import {Children} from "./children";
import {TranslationSystemGroup} from "./translationSystemGroup";
import {LocalToWorldSystem} from "./localToWorldSystem";
import type {Entity} from "../core/entity";

function makeWorld() {
    const world = new World({platform: new MemoryPlatform()});
    world.getOrCreateSystem(TranslationSystemGroup);
    world.getOrCreateSystem(LocalToWorldSystem);
    const root = world.getOrCreateSystem(RootSystemGroup);
    return {world, root, em: world.entityManager};
}

const SETTLE_TICKS = 8;

function tick(root: {update(): void}, n = SETTLE_TICKS) {
    for (let i = 0; i < n; i++) root.update();
}

describe("transform hierarchy", () => {
    test("Parent.setup gives the parent a Children component listing every child", () => {
        const {world, root, em} = makeWorld();
        const parent = em.createEntity("parent");
        em.addComponent(parent, new LocalPosition(10, 0, 0));
        em.addComponent(parent, new LocalToWorld());

        const kids: Entity[] = [1, 2, 3].map(x => {
            const e = em.createEntity("child" + x);
            em.addComponent(e, new LocalPosition(x, 0, 0));
            em.addComponent(e, new LocalToWorld());
            em.addComponent(e, new Parent(parent));
            return e;
        });
        tick(root);

        const children = em.getComponent<Children>(parent, Children);
        expect(children).toBeDefined();
        expect(children!.children.length).toBe(3);
        for (const k of kids) expect(children!.has(k)).toBe(true);
        void world;
    });

    test("children inherit the parent transform, and follow when it moves", () => {
        const {root, em} = makeWorld();
        const parent = em.createEntity("parent");
        em.addComponent(parent, new LocalPosition(10, 0, 0));
        em.addComponent(parent, new LocalToWorld());

        const kids: Entity[] = [1, 2, 3].map(x => {
            const e = em.createEntity("child" + x);
            em.addComponent(e, new LocalPosition(x, 0, 0));
            em.addComponent(e, new LocalToWorld());
            em.addComponent(e, new Parent(parent));
            return e;
        });
        tick(root);

        const worldX = (e: Entity) => Vec.x(em.getComponent<LocalToWorld>(e, LocalToWorld)!.position);
        expect(kids.map(worldX)).toEqual([11, 12, 13]);

        em.getComponent<LocalPosition>(parent, LocalPosition)!.x = 100;
        tick(root);
        expect(kids.map(worldX)).toEqual([101, 102, 103]);
    });

    test("a parent handle taken before its first child still moves the children", () => {
        const {root, em} = makeWorld();
        const parent = em.createEntity("parent");
        em.addComponent(parent, new LocalPosition(10, 0, 0));
        em.addComponent(parent, new LocalToWorld());
        const parentPos = em.getComponent<LocalPosition>(parent, LocalPosition)!;

        const kid = em.createEntity("child");
        em.addComponent(kid, new LocalPosition(1, 0, 0));
        em.addComponent(kid, new LocalToWorld());
        em.addComponent(kid, new Parent(parent));
        tick(root);

        const worldX = (e: Entity) => Vec.x(em.getComponent<LocalToWorld>(e, LocalToWorld)!.position);
        expect(worldX(kid)).toBe(11);

        parentPos.x = 100;
        tick(root);
        expect(worldX(kid)).toBe(101);
    });

    test("Children swap-remove keeps the other entries, and adds stay unique", () => {
        const {em} = makeWorld();
        const a = em.createEntity("a"), b = em.createEntity("b"), c = em.createEntity("c");
        const children = new Children(a, b, c);
        expect(children.children.length).toBe(3);

        children.removeChild(b);
        expect(children.children.length).toBe(2);
        expect(children.has(a)).toBe(true);
        expect(children.has(c)).toBe(true);
        expect(children.has(b)).toBe(false);

        children.addChild(a);
        expect(children.children.length).toBe(2);

        children.removeChild(a);
        children.removeChild(c);
        expect(children.children.length).toBe(0);
        expect(children.has(c)).toBe(false);
    });
});

class StampTag extends Component {
}

type EntityDestroyer = (world: World, entity: Entity) => void;

const ENTITY_DESTROYERS: [string, EntityDestroyer][] = [
    ["the EntityManager", (world, entity) => world.entityManager.destroyEntity(entity)],
    ["a command buffer", (world, entity) => world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer().destroyEntity(entity)],
];

const PLAYBACK_TICKS = 1;
const ROUNDING_SCALE = 1e5;
const roundedValues = (values: ArrayLike<number>) => Array.from(values).map(v => Math.round(v * ROUNDING_SCALE) / ROUNDING_SCALE + 0);
const quarterTurnAboutZ = () => Quaternions.qFromAxisAngle(Vec.alloc3(0, 0, 1), Math.PI / 2);

function rotatedScaledParentWithChild(em: EntityManager) {
    const turn = Vec.toArray(quarterTurnAboutZ());
    const parent = em.createEntity("parent", [
        new LocalPosition(10, 0, 0),
        new LocalRotation(turn[0], turn[1], turn[2], turn[3]),
        new LocalScale(2, 2, 2),
        new LocalToWorld(),
    ]);
    const child = em.createEntity("child", [new LocalPosition(1, 0, 0), new LocalToWorld(), new Parent(parent)]);
    return {parent, child};
}

function worldMatrixOf(em: EntityManager, entity: Entity): number[] {
    return roundedValues(Vec.toArray(em.getComponent<LocalToWorld>(entity, LocalToWorld)!.matrix));
}

describe("destroying part of a hierarchy", () => {
    for (const [route, destroy] of ENTITY_DESTROYERS) {
        test(`a child whose parent was destroyed through ${route} becomes a root and keeps its world transform`, () => {
            const {world, root, em} = makeWorld();
            const {parent, child} = rotatedScaledParentWithChild(em);
            tick(root);
            const worldBefore = worldMatrixOf(em, child);
            expect(roundedValues(Vec.toArray(em.getComponent<LocalToWorld>(child, LocalToWorld)!.position))).toEqual([10, 2, 0]);

            destroy(world, parent);
            tick(root, PLAYBACK_TICKS);
            expect(em.exists(parent)).toBe(false);
            expect(worldMatrixOf(em, child)).toEqual(worldBefore);

            em.addComponent(child, new StampTag());
            tick(root);

            expect(em.hasComponent(child, Parent)).toBe(false);
            expect(em.hasComponent(child, ParentTransform)).toBe(false);
            expect(worldMatrixOf(em, child)).toEqual(worldBefore);
            expect(roundedValues(Vec.toArray(em.getComponent<LocalPosition>(child, LocalPosition)!.xyz))).toEqual([10, 2, 0]);
            expect(roundedValues(Vec.toArray(em.getComponent<LocalRotation>(child, LocalRotation)!.xyzw))).toEqual(roundedValues(Vec.toArray(quarterTurnAboutZ())));
            expect(roundedValues(Vec.toArray(em.getComponent<LocalScale>(child, LocalScale)!.xyz))).toEqual([2, 2, 2]);

            em.getComponent<LocalPosition>(child, LocalPosition)!.x = 50;
            tick(root);
            expect(roundedValues(Vec.toArray(em.getComponent<LocalToWorld>(child, LocalToWorld)!.position))).toEqual([50, 2, 0]);
        });

        test(`a child destroyed through ${route} drops out of its parent's Children without coming back`, () => {
            const {world, root, em} = makeWorld();
            const parent = em.createEntity("parent", [new LocalPosition(), new LocalToWorld()]);
            const doomed = em.createEntity("doomed", [new LocalPosition(1, 0, 0), new LocalToWorld(), new Parent(parent)]);
            const survivor = em.createEntity("survivor", [new LocalPosition(2, 0, 0), new LocalToWorld(), new Parent(parent)]);
            tick(root);

            destroy(world, doomed);
            tick(root, PLAYBACK_TICKS);
            em.addComponent(parent, new StampTag());
            tick(root);

            expect(em.exists(doomed)).toBe(false);
            expect(em.getComponent<Children>(parent, Children)!.children).toEqual([survivor]);
            expect(em.getComponent<Parent>(survivor, Parent)!.entity).toBe(parent);
        });
    }

    test("the Children of a destroyed parent resurrect neither the parent nor a link to an entity reusing its slot", () => {
        const {world, root, em} = makeWorld();
        const {parent, child} = rotatedScaledParentWithChild(em);
        tick(root);

        em.destroyEntity(parent);
        const newcomer = em.createEntity("newcomer", [new LocalPosition(), new LocalToWorld()]);
        em.addComponent(child, new StampTag());
        tick(root);

        expect(em.exists(parent)).toBe(false);
        expect(em.hasComponent(newcomer, Children)).toBe(false);
        expect(em.hasComponent(child, Parent)).toBe(false);
        expect([...world.entities()].sort()).toEqual([child, newcomer].sort());
    });
});

describe("LocalToWorld direction helpers", () => {
    const rounded = (values: ArrayLike<number>) => Array.from(values).map(v => Math.round(v * 1e6) / 1e6 + 0);

    test("transformDirection ignores translation", () => {
        const m = LocalToWorld.identity();
        Vec.set(m, 12, 100);
        Vec.set(m, 13, 200);
        Vec.set(m, 14, 300);
        const out = LocalToWorld.transformDirection(m, Vec.alloc3(0, 0, 1));
        expect(rounded(Vec.toArray(out))).toEqual([0, 0, 1]);
    });

    test("normalMatrix3 of a pure rotation is that rotation", () => {
        const quarterTurnAboutZ = Quaternions.qFromAxisAngle(Vec.alloc3(0, 0, 1), Math.PI / 2);
        const m = LocalToWorld.fromTRS(LocalToWorld.identity(), Vec.alloc3(5, 5, 5), quarterTurnAboutZ, Vec.alloc3(1, 1, 1));
        const n = LocalToWorld.normalMatrix3(m, new Float32Array(9));
        const raw = Vec.toArray(m);
        expect(rounded(n)).toEqual(rounded([raw[0], raw[1], raw[2], raw[4], raw[5], raw[6], raw[8], raw[9], raw[10]]));
    });

    test("normalMatrix3 counter-scales normals so a stretched surface keeps its facing", () => {
        const m = LocalToWorld.fromTRS(LocalToWorld.identity(), Vec.alloc3(0, 0, 0), Vec4.alloc(0, 0, 0, 1), Vec.alloc3(2, 1, 1));
        const n = LocalToWorld.normalMatrix3(m, new Float32Array(9));
        const transform = (x: number, y: number, z: number) => {
            const ox = n[0] * x + n[3] * y + n[6] * z;
            const oy = n[1] * x + n[4] * y + n[7] * z;
            const oz = n[2] * x + n[5] * y + n[8] * z;
            const len = Math.hypot(ox, oy, oz);
            return rounded([ox / len, oy / len, oz / len]);
        };
        expect(transform(1, 0, 0)).toEqual([1, 0, 0]);
        const diagonal = transform(1, 1, 0);
        expect(diagonal[1]).toBeGreaterThan(diagonal[0]);
        expect(diagonal[0] * 2).toBeCloseTo(diagonal[1], 5);
    });
});
