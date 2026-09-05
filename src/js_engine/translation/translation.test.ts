import {describe, expect, test} from "../testing/harness";
import {World} from "../core/world";
import {RootSystemGroup} from "../core/rootSystemGroup";
import {Vec, Vec4} from "../math/types/vec";
import {Quaternions} from "../math/quaternions";
import {LocalPosition} from "./localPosition";
import {LocalToWorld} from "./localToWorld";
import {Parent} from "./parent";
import {Children} from "./children";
import {TranslationSystemGroup} from "./translationSystemGroup";
import {LocalToWorldSystem} from "./localToWorldSystem";
import type {Entity} from "../core/entity";

/**
 * The transform hierarchy had no coverage at all, which is why the Children
 * storage change (Set -> dense array + swap-remove) could not be verified
 * against anything. These pin the behaviour that change could plausibly break.
 *
 * Two traps worth knowing when writing more of these:
 *  - Import everything relatively. An absolute path resolves to a *separate*
 *    module instance, so `RootSystemGroup` becomes a different class object,
 *    lands under a second key in World's system map, and nothing attaches to
 *    the group you then tick.
 *  - Create LocalToWorldSystem, not just TranslationSystemGroup. Its onCreate
 *    ensures ParentTransformSyncSystem, which ensures HierarchySyncSystem;
 *    creating only the group leaves all three absent and nothing syncs.
 */
function makeWorld() {
    const world = new World();
    world.getOrCreateSystem(TranslationSystemGroup);
    world.getOrCreateSystem(LocalToWorldSystem);
    const root = world.getOrCreateSystem(RootSystemGroup);
    return {world, root, em: world.entityManager};
}

function tick(root: {update(): void}, n = 8) {
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
        // Regression: getComponent's tracked handle used to bind to the archetype
        // it was fetched from. Adding the first child gives the parent a Children
        // component -- a structural move -- after which writes through that handle
        // stamped the archetype the parent had left, and the cascade never ran.
        const {root, em} = makeWorld();
        const parent = em.createEntity("parent");
        em.addComponent(parent, new LocalPosition(10, 0, 0));
        em.addComponent(parent, new LocalToWorld());
        const parentPos = em.getComponent<LocalPosition>(parent, LocalPosition)!;

        const kid = em.createEntity("child");
        em.addComponent(kid, new LocalPosition(1, 0, 0));
        em.addComponent(kid, new LocalToWorld());
        em.addComponent(kid, new Parent(parent));   // parent gains Children here
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

        // Remove the MIDDLE one: swap-remove moves the last entry into its slot,
        // which is exactly where an off-by-one would drop the wrong entity.
        children.removeChild(b);
        expect(children.children.length).toBe(2);
        expect(children.has(a)).toBe(true);
        expect(children.has(c)).toBe(true);
        expect(children.has(b)).toBe(false);

        children.addChild(a); // Set semantics preserved: no duplicates
        expect(children.children.length).toBe(2);

        children.removeChild(a);
        children.removeChild(c);
        expect(children.children.length).toBe(0);
        expect(children.has(c)).toBe(false);
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
