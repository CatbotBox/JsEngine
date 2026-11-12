import {Vec} from "../../src/engine/math/types/vec";
import {
    Component,
    Entity,
    EntityCommandBufferSystem,
    System,
    DebugWorld
} from "../../src/engine/core";
import {consoleInput, Key} from "../../src/engine/input";
import type {TerminalInputSource} from "../../src/engine/input";

import {Camera, HudElement, RenderBounds, RenderingSystemGroup, ScreenAnchor} from "../../src/engine/rendering";

import {LocalPosition, LocalToWorld, Parent} from "../../src/engine/translation";

import {
    Ansi,
    HudTextSpriteCellPassSystem,
} from "../../src/backends/cells";

import {
    TextSpriteCellPassSettings,
    HudSpriteCellPassSystem,
    SpriteCellPassSystem,
} from "../../src/backends/cells/2d";
import {Sprite, SpriteImage} from "../../src/engine/rendering/2d";
import {AverageStat} from "../../src/engine/datatypes";
import {createHudLabel} from "../_shared/hud";

export interface Demo2dHost {
    readonly terminal: TerminalInputSource;
    quit(): void;
}

function packRgb(r: number, g: number, b: number): number {
    return (r << 16) | (g << 8) | b;
}

const WHITE_RGB = 0xFFFFFF;
const HUD_CROSS_RGB = 0x00FFCC;
const MAX_CHANNEL = 255;
const FADE_TARGET_RGB: readonly [number, number, number] = [255, 183, 206];
const FADE_MIN_MS = 5000, FADE_JITTER_MS = 5000;
const PIXELS_PER_SPAWN = 1_000;
const SPAWN_AREA_CELLS = 100;
const PLAYER_STEP_ROWS = 0.5;
const PLAYER_STEP_COLUMNS = 1;
const FPS_AVERAGE_FRAMES = 10;
const MS_PER_SECOND = 1000;

const CROSS_IMAGE = SpriteImage.fromPattern([
    ' # ',
    '###',
    ' # ',
], {'#': WHITE_RGB});
const PIXEL_IMAGE = SpriteImage.solid(1, 1, WHITE_RGB);

class FadeToColor extends Component {
    public color: [number, number, number] = [255, 255, 255];
    public fadeTime: number = 0;
    public currentFadeTime: number = 0;
}

class OriginalColor extends Component {
    public color: [number, number, number] = [255, 255, 255];
}

class PlayerTag extends Component {

}

const FADE_SCRATCH: [number, number, number] = [0, 0, 0];

export function setupDemo2d(world: DebugWorld, host: Demo2dHost): void {
    const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer()


    const cameraEntity = buffer.createEntity("cameraEntity", [new Camera(), new LocalToWorld(), new RenderBounds()]);
    const cameraPosition = buffer.addTrackedComponent(cameraEntity, new LocalPosition());

    const settingsEntity = buffer.createEntity("2dRenderSettings");
    const renderSettings = buffer.addTrackedComponent(settingsEntity, new TextSpriteCellPassSettings());

    function createCross(position: LocalPosition, parent?: Entity, name?: string, ...additionalComponents: Component[]): [Entity, LocalPosition, Readonly<LocalToWorld>] {
        const r = Math.round(Math.random() * MAX_CHANNEL)
        const g = Math.round(Math.random() * MAX_CHANNEL)
        const b = Math.round(Math.random() * MAX_CHANNEL)
        const localToWorld = new LocalToWorld();
        const components: Component[] = [new Sprite(CROSS_IMAGE, packRgb(r, g, b)), localToWorld];
        if (parent) {
            components.push(new Parent(parent));
        }
        components.push(...additionalComponents);
        const objectEntity = buffer.createEntity(name, components);
        const position2 = buffer.addTrackedComponent(objectEntity, position);
        return [objectEntity, position2, localToWorld];
    }

    function createPixel(position: LocalPosition, parent?: Entity, name?: string, ...additionalComponents: Component[]): [Entity, LocalPosition, Readonly<LocalToWorld>] {
        const r = Math.round(Math.random() * MAX_CHANNEL)
        const g = Math.round(Math.random() * MAX_CHANNEL)
        const b = Math.round(Math.random() * MAX_CHANNEL)
        const originalColor = new OriginalColor()
        originalColor.color = [r, g, b];
        const localToWorld = new LocalToWorld();
        const components: Component[] = [originalColor, new Sprite(PIXEL_IMAGE, packRgb(r, g, b)), localToWorld];
        if (parent) {
            components.push(new Parent(parent));
        }
        components.push(...additionalComponents);
        const objectEntity = buffer.createEntity(name, components);
        return [objectEntity, buffer.addTrackedComponent(objectEntity, position), localToWorld];
    }

    function createHudCross(): void {
        const hudAnchor = new ScreenAnchor();
        hudAnchor.anchorPosition = 'bottom-right';
        buffer.createEntity("hudCross", [new Sprite(CROSS_IMAGE, HUD_CROSS_RGB), new HudElement(), hudAnchor]);
    }

    const [entity, position, localToWorld] = createCross(new LocalPosition(), cameraEntity, "cross1", new PlayerTag())
    createCross(new LocalPosition(-5, -5), entity, "cross2")
    createCross(new LocalPosition(-5, +5), entity, "cross3")
    createCross(new LocalPosition(+5, -5), entity, "cross4")
    createCross(new LocalPosition(+5, +5), entity, "cross5")

    const entityCounterImage = createHudLabel(buffer, "entityCounter", Ansi.colors.fg.green + 'HUD element', 'bottom-left');
    const fpsCounterImage = createHudLabel(buffer, "fpsCounter", Ansi.colors.fg.green + 'FPS: 0', 'top-right');

    createHudCross();

    consoleInput.enable({terminal: host.terminal, platform: world.platform})
    consoleInput.whenKey(Key.Up, () => {
        position.y -= PLAYER_STEP_ROWS;
    })
    consoleInput.whenKey(Key.Down, () => {
        position.y += PLAYER_STEP_ROWS;
    })
    consoleInput.whenKey(Key.Left, () => {
        position.x -= PLAYER_STEP_COLUMNS;
    })
    consoleInput.whenKey(Key.Right, () => {
        position.x += PLAYER_STEP_COLUMNS;
    })

    consoleInput.whenKey(Key.W, () => {
        cameraPosition.y -= 1;
    })
    consoleInput.whenKey(Key.S, () => {
        cameraPosition.y += 1;
    })
    consoleInput.whenKey(Key.A, () => {
        cameraPosition.x -= 1;
    })
    consoleInput.whenKey(Key.D, () => {
        cameraPosition.x += 1;
    })


    consoleInput.whenKey(Key.Space, () => {
        for (let i = 0; i < PIXELS_PER_SPAWN; i++) {
            const x = (Math.random() - 0.5) * SPAWN_AREA_CELLS
            const y = (Math.random() - 0.5) * SPAWN_AREA_CELLS
            const newPos = new LocalPosition();
            newPos.x = x + Vec.x(localToWorld.position)
            newPos.y = y + Vec.y(localToWorld.position)
            newPos.z = Math.random()
            const fadeToColor = new FadeToColor();
            fadeToColor.color = [...FADE_TARGET_RGB]
            fadeToColor.fadeTime = Math.random() * FADE_JITTER_MS + FADE_MIN_MS;
            createPixel(newPos, undefined, undefined, fadeToColor);
        }
    })
    consoleInput.whenKey(Key.Enter, () => {
        const renderer = world.tryGetSystem(RenderingSystemGroup);
        if (!renderer) return;
        renderer.enabled = !renderer.enabled;
    })
    consoleInput.whenKey(Key.Backspace, () => {
        const renderer = world.tryGetSystem(SpriteCellPassSystem);
        if (!renderer) return;
        renderer.enabled = !renderer.enabled;
    })
    consoleInput.whenKey(Key.H, () => {
        renderSettings.halfBlockCells = !renderSettings.halfBlockCells;
    })
    consoleInput.whenKey(Key.G, () => {
        world.logSystemUpdateOrder();
    })

    consoleInput.onKeyMatch({name: 'c', ctrl: true}, () => {
        world.stop()
        host.quit();
    })


    class FadeSystem extends System {

        private _query = this.createEntityQuery([OriginalColor, FadeToColor, Sprite])

        protected onCreate() {
            this.requireAllForUpdate(this._query);
        }

        public count() {
            return this._query.entityCount()
        }

        private interpolate(color1: readonly [number, number, number], color2: readonly [number, number, number], scale: number): [number, number, number] {
            const out = FADE_SCRATCH;
            if (scale >= 1) {
                out[0] = color2[0];
                out[1] = color2[1];
                out[2] = color2[2];
                return out;
            }
            if (scale <= 0) {
                out[0] = color1[0];
                out[1] = color1[1];
                out[2] = color1[2];
                return out;
            }
            out[0] = Math.round(color1[0] + (color2[0] - color1[0]) * scale);
            out[1] = Math.round(color1[1] + (color2[1] - color1[1]) * scale);
            out[2] = Math.round(color1[2] + (color2[2] - color1[2]) * scale);
            return out;

        }

        onUpdate(): void {
            const deltaTime = this.world.time.deltaTime;
            this._query.stream({
                write: {originalColor: OriginalColor, fadeToColor: FadeToColor, sprite: Sprite},
            }, {
                includeEntity: true
            }).consume(({entity, sprite, fadeToColor, originalColor}) => {
                fadeToColor.currentFadeTime += deltaTime;

                const scale = fadeToColor.currentFadeTime / fadeToColor.fadeTime;
                const finalColor = this.interpolate(originalColor.color, fadeToColor.color, scale)
                sprite.tint = packRgb(finalColor[0], finalColor[1], finalColor[2]);
                if (fadeToColor.currentFadeTime >= fadeToColor.fadeTime) {
                    originalColor.color = fadeToColor.color;
                    buffer.removeComponent(entity, FadeToColor);
                    buffer.removeComponent(entity, OriginalColor);
                }
            })
        }
    }

    class DebugSystem extends System {
        private _query = this.createEntityQuery([LocalToWorld])
        private _hudQuery = this.createEntityQuery([HudElement])
        private _toggle = true;
        private _fpsCounter = new AverageStat(FPS_AVERAGE_FRAMES)

        protected onCreate() {
            consoleInput.whenKeyDown(Key.Tab, () => {
                this._toggle = !this._toggle;
                buffer.setEnabledStateForQuery(this._hudQuery, this._toggle);
            })
        }

        onUpdate() {
            if (!this._toggle) return;
            this._query.entityCount();
            this._fpsCounter.add(MS_PER_SECOND / this.world.time.deltaTime)
            fpsCounterImage.image = [
                Ansi.colors.fg.green + 'FPS: ' + this._fpsCounter.getAvg().toFixed(2),
            ]
            const fadeSystem = this.world.tryGetSystem(FadeSystem);
            if (fadeSystem) {
                const fadeSystemCount = fadeSystem.count();
                entityCounterImage.image = [
                    Ansi.colors.fg.green + 'Entities: ' +
                    fadeSystemCount.toFixed(2),
                ]
            } else {
                entityCounterImage.image = [
                    Ansi.colors.fg.green + 'Fade System Not Active'
                ]
            }



        }


    }


    world.ensureSystemExists(SpriteCellPassSystem);
    world.ensureSystemExists(HudSpriteCellPassSystem);
    world.ensureSystemExists(HudTextSpriteCellPassSystem);


    world.ensureSystemExists(DebugSystem)

    world.ensureSystemExists(FadeSystem);
}
