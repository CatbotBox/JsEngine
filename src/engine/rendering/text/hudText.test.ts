import {describe, expect, test} from "../../testing/harness";
import {MemoryPlatform} from "../../testing/memoryPlatform";
import {NULL_ENTITY, World} from "../../core";
import type {Entity} from "../../core";
import {TextColor} from "../textColor";
import {TextSprite} from "../textSprite";
import {formatHudLines, formatHudText} from "./hudText";
import {HudLabel} from "./hudLabel";

const SHOWN_LINES = ["FPS: 60", "Entities: 3"];
const LATER_LINES = ["FPS: 30"];

function newWorld(): World {
    return new World({platform: new MemoryPlatform()});
}

function labelEntity(world: World, name: string): Entity {
    return world.entityManager.createEntity(name, [new TextSprite()]);
}

function spriteOf(world: World, entity: Entity): TextSprite {
    return world.entityManager.getComponent<TextSprite>(entity, TextSprite)!;
}

describe("formatHudText", () => {
    test("fills each named placeholder with its value", () => {
        expect(formatHudText("Score {score}, wave {wave}", {score: 120, wave: "3"})).toBe("Score 120, wave 3");
    });

    test("fills a placeholder every time it appears", () => {
        expect(formatHudText("{n} + {n}", {n: 2})).toBe("2 + 2");
    });

    test("leaves a placeholder with no value as written", () => {
        expect(formatHudText("Lives {lives} of {max}", {lives: 2})).toBe("Lives 2 of {max}");
    });

    test("ignores values inherited from the object prototype", () => {
        expect(formatHudText("{toString}", {})).toBe("{toString}");
    });

    test("formats every line of a template", () => {
        expect(formatHudLines(["FPS: {fps}", "Entities: {entities}"], {fps: 60, entities: 3})).toEqual(SHOWN_LINES);
    });
});

describe("HudLabel", () => {
    test("shows lines on the bound entity's TextSprite", () => {
        const world = newWorld();
        const entity = labelEntity(world, "label");
        const label = new HudLabel();
        label.bindTo(world, entity);
        label.show(SHOWN_LINES);
        expect(spriteOf(world, entity).image).toEqual(SHOWN_LINES);
    });

    test("applies lines and colour shown before binding once it binds", () => {
        const world = newWorld();
        const entity = labelEntity(world, "label");
        const label = new HudLabel();
        label.show(SHOWN_LINES);
        label.paint(TextColor.YELLOW);
        label.bindTo(world, entity);
        const sprite = spriteOf(world, entity);
        expect(sprite.image).toEqual(SHOWN_LINES);
        expect(sprite.foreground).toBe(TextColor.YELLOW);
    });

    test("keeps its text while bound to no entity and carries it to the next binding", () => {
        const world = newWorld();
        const first = labelEntity(world, "first");
        const second = labelEntity(world, "second");
        const label = new HudLabel();
        label.bindTo(world, first);
        label.bindTo(world, NULL_ENTITY);
        label.show(LATER_LINES);
        expect(spriteOf(world, first).image).toEqual([]);
        label.bindTo(world, second);
        expect(spriteOf(world, second).image).toEqual(LATER_LINES);
    });

    test("leaves an entity it is no longer bound to alone", () => {
        const world = newWorld();
        const first = labelEntity(world, "first");
        const second = labelEntity(world, "second");
        const label = new HudLabel();
        label.bindTo(world, first);
        label.show(SHOWN_LINES);
        label.bindTo(world, second);
        label.show(LATER_LINES);
        expect(spriteOf(world, first).image).toEqual(SHOWN_LINES);
        expect(spriteOf(world, second).image).toEqual(LATER_LINES);
    });
});
