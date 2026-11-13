import {Vec} from "../../src/engine/math/types/vec";
import {
    Component,
    Entity,
    EntityCommandBufferSystem,
    System,
    DebugWorld
} from "../../src/engine/core";
import {Input, Key} from "../../src/engine/input";

import {Camera, CHANNEL_MAX, GREEN_SHIFT, HudElement, RED_SHIFT, RenderBounds, RenderingSystemGroup, ScreenAnchor, TextColor, WHITE_RGB} from "../../src/engine/rendering";

import {LocalPosition, LocalToWorld, Parent} from "../../src/engine/translation";

import {Sprite, SpriteImage} from "../../src/engine/rendering/2d";
import {AverageStat} from "../../src/engine/datatypes";
import {createHudLabel} from "../_shared/hud";

export interface Demo2dRenderControls {
    toggleSpritePass(): void;
    toggleHalfBlockCells?(): void;
}

export interface Demo2dHost {
    readonly render: Demo2dRenderControls;
    quit(): void;
}

function packRgb(r: number, g: number, b: number): number {
    return (r << RED_SHIFT) | (g << GREEN_SHIFT) | b;
}

const HUD_CROSS_RGB = 0x00FFCC;
const FADE_TARGET_RGB: readonly [number, number, number] = [255, 183, 206];
const FADE_MIN_MS = 5000, FADE_JITTER_MS = 5000;
const PIXELS_PER_SPAWN = 1_000;
const SPAWN_AREA_CELLS = 100;
const PLAYER_STEP_ROWS = 0.5;
const PLAYER_STEP_COLUMNS = 1;
const FPS_AVERAGE_FRAMES = 10;
const MS_PER_SECOND = 1000;
const BEFORE_SIMULATION_PRIORITY = -1;
const TOGGLE_HUD_ACTION = "toggleHud";
const HUD_TEXT_COLOR = TextColor.GREEN;

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

    function createCross(position: LocalPosition, parent?: Entity, name?: string, ...additionalComponents: Component[]): [Entity, LocalPosition, Readonly<LocalToWorld>] {
        const r = Math.round(Math.random() * CHANNEL_MAX)
        const g = Math.round(Math.random() * CHANNEL_MAX)
        const b = Math.round(Math.random() * CHANNEL_MAX)
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
        const r = Math.round(Math.random() * CHANNEL_MAX)
        const g = Math.round(Math.random() * CHANNEL_MAX)
        const b = Math.round(Math.random() * CHANNEL_MAX)
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

    const entityCounterImage = createHudLabel(buffer, "entityCounter", 'HUD element', HUD_TEXT_COLOR, 'bottom-left');
    const fpsCounterImage = createHudLabel(buffer, "fpsCounter", 'FPS: 0', HUD_TEXT_COLOR, 'top-right');

    createHudCross();

    const input = world.resources.getOrCreate(Input);
    input.bindAction(TOGGLE_HUD_ACTION, [Key.Tab]);

    const spawnFadingPixels = () => {
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
    }

    const toggleSystem = (system: System | undefined) => {
        if (system) system.enabled = !system.enabled;
    }

    const keyDownHandlers = new Map<Key, () => void>([
        [Key.Up, () => position.y -= PLAYER_STEP_ROWS],
        [Key.Down, () => position.y += PLAYER_STEP_ROWS],
        [Key.Left, () => position.x -= PLAYER_STEP_COLUMNS],
        [Key.Right, () => position.x += PLAYER_STEP_COLUMNS],
        [Key.W, () => cameraPosition.y -= 1],
        [Key.S, () => cameraPosition.y += 1],
        [Key.A, () => cameraPosition.x -= 1],
        [Key.D, () => cameraPosition.x += 1],
        [Key.Space, spawnFadingPixels],
        [Key.Enter, () => toggleSystem(world.tryGetSystem(RenderingSystemGroup))],
        [Key.Backspace, () => host.render.toggleSpritePass()],
        [Key.H, () => host.render.toggleHalfBlockCells?.()],
        [Key.G, () => world.logSystemUpdateOrder()],
    ]);

    class ControlsSystem extends System {
        override priority(): number {
            return BEFORE_SIMULATION_PRIORITY;
        }

        onUpdate(): void {
            for (const event of input.events) {
                if (event.type !== "keyDown") continue;
                if (event.key === Key.C && event.ctrl) {
                    world.stop();
                    host.quit();
                    return;
                }
                keyDownHandlers.get(event.key)?.();
            }
        }
    }


    class FadeSystem extends System {

        private _query = this.createEntityQuery([OriginalColor, FadeToColor, Sprite])

        protected onCreate() {
            this.requireAllForUpdate(this._query);
        }

        public count() {
            return this._query.enabledEntityCount()
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
            const deltaTimeMs = this.world.time.deltaTimeMs;
            this._query.stream({
                write: {originalColor: OriginalColor, fadeToColor: FadeToColor, sprite: Sprite},
            }, {
                includeEntity: true
            }).consume(({entity, sprite, fadeToColor, originalColor}) => {
                fadeToColor.currentFadeTime += deltaTimeMs;

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

        onUpdate() {
            if (input.actionPressed(TOGGLE_HUD_ACTION)) {
                this._toggle = !this._toggle;
                buffer.setEnabledStateForQuery(this._hudQuery, this._toggle);
            }
            if (!this._toggle) return;
            this._query.enabledEntityCount();
            this._fpsCounter.add(MS_PER_SECOND / this.world.time.deltaTimeMs)
            fpsCounterImage.image = [
                'FPS: ' + this._fpsCounter.getAvg().toFixed(2),
            ]
            const fadeSystem = this.world.tryGetSystem(FadeSystem);
            if (fadeSystem) {
                const fadeSystemCount = fadeSystem.count();
                entityCounterImage.image = [
                    'Entities: ' + fadeSystemCount.toFixed(2),
                ]
            } else {
                entityCounterImage.image = [
                    'Fade System Not Active'
                ]
            }



        }


    }


    world.ensureSystemExists(ControlsSystem);


    world.ensureSystemExists(DebugSystem)

    world.ensureSystemExists(FadeSystem);
}
