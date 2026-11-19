import type {World} from "../../../src/engine/core";
import {installPixelsBackend} from "../../../src/backends/pixels/pixelsBackend";
import type {PixelPresenter} from "../../../src/backends/pixels/pixelPresenter";
import {PIXELS_HUD_TEXT_PASSES} from "../../../src/backends/pixels/pixelsHudTextPasses";
import {PIXELS_SPRITE_PASSES} from "../../../src/backends/pixels/2d/pixelsSpritePasses";

export function installPixelRenderingSwarm(world: World, presenter: PixelPresenter): void {
    installPixelsBackend(world, presenter, [...PIXELS_SPRITE_PASSES, ...PIXELS_HUD_TEXT_PASSES]);
}
