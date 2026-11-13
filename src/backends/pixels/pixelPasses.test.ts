import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {World} from "../../engine/core/world";
import {RootSystemGroup} from "../../engine/core/rootSystemGroup";
import type {Component} from "../../engine/core";
import {Camera} from "../../engine/rendering/camera";
import {HudElement} from "../../engine/rendering/hudElement";
import {ScreenAnchor} from "../../engine/rendering/screenAnchor";
import type {AnchorPosition} from "../../engine/rendering/screenAnchor";
import {RenderBoundsOffset} from "../../engine/rendering/renderBoundsOffset";
import {TextColor} from "../../engine/rendering/textColor";
import {TextSprite} from "../../engine/rendering/textSprite";
import {resolveTextColorRgb} from "../../engine/rendering/textColorPalette";
import {ASCII_PIXEL_FONT} from "../../engine/rendering/text/asciiPixelFont";
import {isGlyphColumnLit} from "../../engine/rendering/text/pixelFont";
import {Sprite} from "../../engine/rendering/2d/sprite";
import {SpriteImage} from "../../engine/rendering/2d/spriteImage";
import {LocalPosition, LocalToWorld} from "../../engine/translation";
import {MemoryPixelPresenter} from "./memoryPixelPresenter";
import {PixelPresenterResource} from "./pixelPresenterResource";
import {RGBA_BYTES_PER_PIXEL} from "./pixelFrame";
import type {PixelFrame} from "./pixelFrame";
import {TextSpritePixelPassSystem} from "./textSpritePixelPassSystem";
import {HudTextSpritePixelPassSystem} from "./hudTextSpritePixelPassSystem";
import {SpritePixelPassSettings} from "./2d/spritePixelPassSettings";
import {SpritePixelPassSystem} from "./2d/spritePixelPassSystem";
import {HudSpritePixelPassSystem} from "./2d/hudSpritePixelPassSystem";

const SIZE = {widthPx: 64, heightPx: 48};
const UNIT_WIDTH_PX = 8, UNIT_HEIGHT_PX = 16;
const BACKGROUND_RGB = 0x000000;
const GREEN_RGB = resolveTextColorRgb(TextColor.GREEN, BACKGROUND_RGB);
const WHITE_RGB = 0xFFFFFF, RED_RGB = 0xFF0000;
const SPRITE_PIXEL_SIDE_PX = 8;
const SETTLE_UPDATES = 2;
const RED_SHIFT = 16, GREEN_SHIFT = 8;

function rgbAt(frame: PixelFrame, x: number, y: number): number {
    const i = (y * frame.widthPx + x) * RGBA_BYTES_PER_PIXEL;
    return (frame.rgba[i] << RED_SHIFT) | (frame.rgba[i + 1] << GREEN_SHIFT) | frame.rgba[i + 2];
}

function glyphAt(frame: PixelFrame, character: string, left: number, top: number, litRgb: number): boolean {
    const codePoint = character.codePointAt(0)!;
    for (let row = 0; row < UNIT_HEIGHT_PX; row++) {
        const bits = ASCII_PIXEL_FONT.glyphRowBits(codePoint, row);
        for (let column = 0; column < UNIT_WIDTH_PX; column++) {
            const lit = isGlyphColumnLit(bits, column);
            if ((rgbAt(frame, left + column, top + row) === litRgb) !== lit) return false;
        }
    }
    return true;
}

function greenText(text: string): TextSprite {
    const sprite = new TextSprite();
    sprite.foreground = TextColor.GREEN;
    sprite.image = [text];
    return sprite;
}

function anchored(position: AnchorPosition): ScreenAnchor {
    const anchor = new ScreenAnchor();
    anchor.anchorPosition = position;
    return anchor;
}

function render(entities: Component[][]): PixelFrame {
    const presenter = new MemoryPixelPresenter(SIZE);
    const world = new World({platform: new MemoryPlatform()});
    world.resources.insert(new PixelPresenterResource(presenter));
    const root = world.getOrCreateSystem(RootSystemGroup);
    const em = world.entityManager;
    em.createEntity("camera", [new Camera(), new LocalToWorld(), new LocalPosition()]);
    em.createEntity("settings", [new SpritePixelPassSettings()]);
    for (const components of entities) em.createEntity(undefined, components);
    world.getOrCreateSystem(TextSpritePixelPassSystem);
    world.getOrCreateSystem(HudTextSpritePixelPassSystem);
    world.getOrCreateSystem(SpritePixelPassSystem);
    world.getOrCreateSystem(HudSpritePixelPassSystem);
    for (let update = 0; update < SETTLE_UPDATES; update++) root.update();
    return presenter.lastFrame!;
}

describe("pixel passes", () => {
    test("a world text sprite is centred on its position, one glyph per 8x16 screen unit", () => {
        const frame = render([[greenText("AB"), new LocalToWorld(), new LocalPosition()]]);
        expect(glyphAt(frame, "A", 24, 16, GREEN_RGB)).toBe(true);
        expect(glyphAt(frame, "B", 32, 16, GREEN_RGB)).toBe(true);
    });

    test("HUD text anchors flush to the framebuffer edges in pixels and offsets in screen units", () => {
        const offset = new RenderBoundsOffset();
        offset.x = 1;
        const frame = render([
            [greenText("HI"), new HudElement(), anchored("bottom-right")],
            [greenText("T"), new HudElement(), anchored("top-left"), offset],
        ]);
        expect(glyphAt(frame, "H", 48, 32, GREEN_RGB)).toBe(true);
        expect(glyphAt(frame, "I", 56, 32, GREEN_RGB)).toBe(true);
        expect(glyphAt(frame, "T", UNIT_WIDTH_PX, 0, GREEN_RGB)).toBe(true);
    });

    test("a world sprite pixel is a square block half a screen unit tall, centred on its position", () => {
        const frame = render([[new Sprite(SpriteImage.solid(1, 1, WHITE_RGB)), new LocalToWorld(), new LocalPosition(2, 0, 0)]]);
        const left = 44, top = 20;
        expect([rgbAt(frame, left, top), rgbAt(frame, left + SPRITE_PIXEL_SIDE_PX - 1, top + SPRITE_PIXEL_SIDE_PX - 1)]).toEqual([WHITE_RGB, WHITE_RGB]);
        expect([rgbAt(frame, left - 1, top), rgbAt(frame, left, top + SPRITE_PIXEL_SIDE_PX)]).toEqual([BACKGROUND_RGB, BACKGROUND_RGB]);
    });

    test("HUD text draws over a HUD sprite, which draws over the world", () => {
        const frame = render([
            [new Sprite(SpriteImage.solid(2, 4, RED_RGB)), new HudElement(), anchored("top-left")],
            [greenText("#"), new HudElement(), anchored("top-left")],
        ]);
        expect(rgbAt(frame, 0, 0)).toBe(RED_RGB);
        expect(rgbAt(frame, 1, 0)).toBe(GREEN_RGB);
        expect(rgbAt(frame, 15, 31)).toBe(RED_RGB);
        expect(rgbAt(frame, 16, 0)).toBe(BACKGROUND_RGB);
    });
});
