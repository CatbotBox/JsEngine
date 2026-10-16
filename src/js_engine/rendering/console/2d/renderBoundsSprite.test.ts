import {describe, expect, test} from "../../../testing/harness";
import {World} from "../../../core/world";
import {RootSystemGroup} from "../../../core/rootSystemGroup";
import {Component} from "../../../core";
import {LocalPosition} from "../../../translation/localPosition";
import {LocalToWorld} from "../../../translation/localToWorld";
import {TranslationSystemGroup} from "../../../translation/translationSystemGroup";
import {LocalToWorldSystem} from "../../../translation/localToWorldSystem";
import {WorldSpaceRenderBounds} from "../../worldSpaceRenderBounds";
import {Sprite} from "../../2d/sprite";
import {SpriteImage} from "../../2d/spriteImage";
import {RenderBoundsSpriteApplyModifierSystem} from "./renderBoundsSpriteApplyModifierSystem";

/**
 * Pins the sprite bounds pipeline against the "sprites jump on first move /
 * archetype change" regression: WorldSpaceRenderBoundsComputeSystem used to
 * blacklist RenderBounds (a column it *reads*) from its change filter, so the
 * apply-modifier write never woke it — every sprite kept a degenerate
 * point-AABB at its position until LocalToWorld happened to be re-stamped
 * (a move, or an archetype change re-stamping the destination columns), and
 * then visibly snapped by the anchor offset.
 */

class Tag extends Component {
}

function makeWorld() {
    const world = new World();
    world.getOrCreateSystem(TranslationSystemGroup);
    world.getOrCreateSystem(LocalToWorldSystem);
    // Resolves RenderingSystemGroup first, whose onCreate registers
    // WorldSpaceRenderBoundsComputeSystem — the same registration order the
    // demo gets, which is what made the equal-priority ordering bug bite.
    world.getOrCreateSystem(RenderBoundsSpriteApplyModifierSystem);
    const root = world.getOrCreateSystem(RootSystemGroup);
    return {world, root, em: world.entityManager};
}

function tick(root: { update(): void }, n = 8) {
    for (let i = 0; i < n; i++) root.update();
}

describe("sprite render bounds", () => {
    test("a stationary sprite gets its anchored world AABB, not a point", () => {
        const {root, em} = makeWorld();
        const e = em.createEntity("sprite");
        // 3x3 pixels: 3 cells wide, 1.5 cells tall, centered anchor.
        em.addComponent(e, new Sprite(SpriteImage.solid(3, 3, 0xFFFFFF)));
        em.addComponent(e, new LocalToWorld());
        em.addComponent(e, new LocalPosition(10, 20, 0));
        tick(root);

        const wb = em.getComponent<WorldSpaceRenderBounds>(e, WorldSpaceRenderBounds)!;
        expect(wb.xMin).toBe(10 - 1.5);
        expect(wb.xMax).toBe(10 + 1.5);
        expect(wb.yMin).toBe(20 - 0.75);
        expect(wb.yMax).toBe(20 + 0.75);
        expect(wb.zMin).toBe(0);
        expect(wb.zMax).toBe(1);
    });

    test("moving translates the world AABB by exactly the delta", () => {
        const {root, em} = makeWorld();
        const e = em.createEntity("sprite");
        em.addComponent(e, new Sprite(SpriteImage.solid(3, 3, 0xFFFFFF)));
        em.addComponent(e, new LocalToWorld());
        em.addComponent(e, new LocalPosition(10, 20, 0));
        tick(root);

        const pos = em.getComponent<LocalPosition>(e, LocalPosition)!;
        pos.x = 14;
        pos.y = 18;
        tick(root);

        const wb = em.getComponent<WorldSpaceRenderBounds>(e, WorldSpaceRenderBounds)!;
        expect(wb.xMin).toBe(14 - 1.5);
        expect(wb.xMax).toBe(14 + 1.5);
        expect(wb.yMin).toBe(18 - 0.75);
        expect(wb.yMax).toBe(18 + 0.75);
    });

    test("an archetype change leaves the world AABB where it was", () => {
        const {root, em} = makeWorld();
        const e = em.createEntity("sprite");
        em.addComponent(e, new Sprite(SpriteImage.solid(3, 3, 0xFFFFFF)));
        em.addComponent(e, new LocalToWorld());
        em.addComponent(e, new LocalPosition(10, 20, 0));
        tick(root);

        // The fade-completion path in demo/2d: components removed/added move the
        // entity between archetypes, re-stamping the destination columns.
        em.addComponent(e, new Tag());
        tick(root);
        em.removeComponent(e, Tag);
        tick(root);

        const wb = em.getComponent<WorldSpaceRenderBounds>(e, WorldSpaceRenderBounds)!;
        expect(wb.xMin).toBe(10 - 1.5);
        expect(wb.xMax).toBe(10 + 1.5);
        expect(wb.yMin).toBe(20 - 0.75);
        expect(wb.yMax).toBe(20 + 0.75);
    });

    test("swapping the image while stationary updates the world AABB", () => {
        const {root, em} = makeWorld();
        const e = em.createEntity("sprite");
        em.addComponent(e, new Sprite(SpriteImage.solid(3, 3, 0xFFFFFF)));
        em.addComponent(e, new LocalToWorld());
        em.addComponent(e, new LocalPosition(10, 20, 0));
        tick(root);

        // A RenderBounds rewrite with no LocalToWorld change: only the
        // RenderBounds->compute wake-up can propagate this.
        const sprite = em.getComponent<Sprite>(e, Sprite)!;
        sprite.image = SpriteImage.solid(5, 1, 0xFFFFFF);
        tick(root);

        const wb = em.getComponent<WorldSpaceRenderBounds>(e, WorldSpaceRenderBounds)!;
        expect(wb.xMin).toBe(10 - 2.5);
        expect(wb.xMax).toBe(10 + 2.5);
        expect(wb.yMin).toBe(20 - 0.25);
        expect(wb.yMax).toBe(20 + 0.25);
    });
});
