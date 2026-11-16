import {describe, expect, test} from "../../testing/harness";
import {MemoryPlatform} from "../../testing/memoryPlatform";
import {World} from "../../core/world";
import {RootSystemGroup} from "../../core/rootSystemGroup";
import type {Entity} from "../../core";
import {LocalPosition} from "../../translation/localPosition";
import {LocalToWorld} from "../../translation/localToWorld";
import {Sprite} from "./sprite";
import {SpriteImage} from "./spriteImage";
import {SpriteBoundsSystem} from "./spriteBoundsSystem";
import {isSpritePatternImage, SpritePattern, SpritePatternColor, spritePatternImage} from "./spritePattern";

const SHIP_ROWS = ["  #  ", " #o# ", "#####", "#   #"];
const HULL_RGB = 0x40E0FF;
const COCKPIT_RGB = 0xFFFFFF;
const BULLET_RGB = 0xFFFF80;
const OTHER_RGB = 0x102030;
const TICKS = 2;
const DISABLED = false;

function colors(...entries: readonly [string, number][]): SpritePatternColor[] {
    return entries.map(([char, rgb]) => new SpritePatternColor(char, rgb));
}

function makeWorld() {
    const world = new World({platform: new MemoryPlatform()});
    world.getOrCreateSystem(SpriteBoundsSystem);
    return {world, root: world.getOrCreateSystem(RootSystemGroup), em: world.entityManager};
}

function tick(root: {update(): void}): void {
    for (let i = 0; i < TICKS; i++) root.update();
}

function patterned(world: World, pattern: SpritePattern): Entity {
    return world.entityManager.createEntity("patterned", [new Sprite(), pattern, new LocalPosition(), new LocalToWorld()]);
}

function imageOf(world: World, entity: Entity): SpriteImage | undefined {
    return world.entityManager.getComponent<Sprite>(entity, Sprite)!.image;
}

describe("sprite patterns", () => {
    test("a pattern image has the same pixels as fromPattern and solid", () => {
        const image = spritePatternImage(SHIP_ROWS, colors(["#", HULL_RGB], ["o", COCKPIT_RGB]));
        const expected = SpriteImage.fromPattern(SHIP_ROWS, {"#": HULL_RGB, "o": COCKPIT_RGB});
        expect([image.sizeX, image.sizeY]).toEqual([expected.sizeX, expected.sizeY]);
        expect([...image.rgba]).toEqual([...expected.rgba]);
        expect([...spritePatternImage(["#"], colors(["#", BULLET_RGB])).rgba]).toEqual([...SpriteImage.solid(1, 1, BULLET_RGB).rgba]);
    });

    test("the first colour of a repeated character wins and unlisted characters stay transparent", () => {
        const image = spritePatternImage(["#x"], colors(["#", BULLET_RGB], ["#", OTHER_RGB]));
        expect([...image.rgba]).toEqual([...SpriteImage.fromPattern(["#x"], {"#": BULLET_RGB}).rgba]);
    });

    test("only images built from a pattern count as pattern images", () => {
        expect(isSpritePatternImage(spritePatternImage(["#"], colors(["#", BULLET_RGB])))).toBe(true);
        expect(isSpritePatternImage(SpriteImage.fromPattern(["#"], {"#": BULLET_RGB}))).toBe(false);
        expect(isSpritePatternImage(SpriteImage.solid(1, 1, BULLET_RGB))).toBe(false);
    });

    test("the sprite of a patterned entity gets its image before the bounds are computed, and equal patterns share one image", () => {
        const {world, root} = makeWorld();
        const first = patterned(world, new SpritePattern(["#"], colors(["#", BULLET_RGB])));
        const second = patterned(world, new SpritePattern(["#"], colors(["#", BULLET_RGB])));
        root.update();
        const image = imageOf(world, first);
        expect(image?.sizeX).toBe(1);
        expect(imageOf(world, second)).toBe(image);
    });

    test("editing the pattern rebuilds the image, and disabled entities get theirs too", () => {
        const {world, root, em} = makeWorld();
        const entity = patterned(world, new SpritePattern(["#"], colors(["#", BULLET_RGB])));
        const hidden = patterned(world, new SpritePattern(SHIP_ROWS, colors(["#", HULL_RGB])));
        em.setEnabledState(hidden, DISABLED);
        tick(root);
        em.getComponent<SpritePattern>(entity, SpritePattern)!.rows = SHIP_ROWS;
        tick(root);
        expect([imageOf(world, entity)?.sizeX, imageOf(world, entity)?.sizeY]).toEqual([SHIP_ROWS[0].length, SHIP_ROWS.length]);
        expect(imageOf(world, hidden)?.sizeY).toBe(SHIP_ROWS.length);
    });
});
