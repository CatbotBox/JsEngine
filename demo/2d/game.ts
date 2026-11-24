import {getEntityCreationOrder, System} from "@jsengine/engine/core";
import type {Component, ComponentCtor, Entity, EntityQuery, World} from "@jsengine/engine/core";
import {PanCameraSystem} from "@jsengine/engine/cameraControllers/2d";
import {Input, resolveInputActions} from "@jsengine/engine/input";
import type {InputAction, ResolvedInputActions} from "@jsengine/engine/input";
import {RenderingSystemGroup, RenderPasses} from "@jsengine/engine/rendering";
import {Sprite} from "@jsengine/engine/rendering/2d";
import {LocalPosition, LocalToWorld} from "@jsengine/engine/translation";
import {Random, Vec} from "@jsengine/engine/math";
import {PrefabSpawner} from "@jsengine/engine/scene";
import type {PrefabAsset} from "@jsengine/engine/scene";
import {requireDebugWorld} from "@jsengine/engine/debugging";
import {interpolateRgb, randomRgb} from "./color";
import {FadeToColor, OriginalColor, Player, RandomizeTint} from "./components";
import {Demo2dConfig} from "./config";
import {commandBufferOf, ENTITIES_INCLUDING_DISABLED, INCLUDING_DISABLED} from "./worldAccess";

const DEMO_NAME = "The 2D demo";
const CONFIG_FILE = "assets/demo2d.asset.json";
const HALF = 0.5;
const NO_STEP = 0;
const NO_OFFSET = 0;
const RANDOMIZE_TINT_PRIORITY = -30;
const CONTROLS_PRIORITY = -10;
const COLOR_FADE_PRIORITY = 20;

const Demo2dAction = {
    MovePlayerUp: "movePlayerUp",
    MovePlayerDown: "movePlayerDown",
    MovePlayerLeft: "movePlayerLeft",
    MovePlayerRight: "movePlayerRight",
    SpawnPixels: "spawnPixels",
    ToggleRendering: "toggleRendering",
    ToggleSpritePass: "toggleSpritePass",
    LogSystemOrder: "logSystemOrder",
    Quit: "quit",
} as const;

interface ActionHandler {
    readonly action: InputAction;
    readonly run: () => void;
}

function randomOf(world: World): Random {
    const random = world.resources.getOrCreate(Random);
    random.reseedIfChanged(world.resources.get(Demo2dConfig).randomSeed);
    return random;
}

function requirePixelPrefab(config: Demo2dConfig): PrefabAsset {
    if (config.pixelPrefab === undefined) throw new Error(`Demo2dConfig.pixelPrefab names no prefab: set it in ${CONFIG_FILE}`);
    return config.pixelPrefab;
}

function translate<IncSpec extends readonly ComponentCtor<Component>[]>(query: EntityQuery<IncSpec>, dx: number, dy: number): void {
    query.stream({write: {position: LocalPosition}}, INCLUDING_DISABLED).consume(({position}) => {
        if (dx !== NO_STEP) position.x += dx;
        if (dy !== NO_STEP) position.y += dy;
    });
}

function toggle(system: System | undefined): void {
    if (system) system.enabled = !system.enabled;
}

function byCreationOrder(a: Entity, b: Entity): number {
    return getEntityCreationOrder(a)! - getEntityCreationOrder(b)!;
}

export class RandomizeTintSystem extends System {
    private _tintRequests = this.createEntityQuery([RandomizeTint, Sprite]);

    override priority(): number {
        return RANDOMIZE_TINT_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(Demo2dConfig);
    }

    onUpdate(): void {
        if (this._tintRequests.entityCountIncludingDisabled() === 0) return;
        const requested: Entity[] = [];
        this._tintRequests.stream({}, ENTITIES_INCLUDING_DISABLED).consume(({entity}) => {
            requested.push(entity);
        });
        const random = randomOf(this.world);
        const buffer = commandBufferOf(this.world);
        const tints = new Map<Entity, number>();
        for (const entity of requested.sort(byCreationOrder)) tints.set(entity, randomRgb(random));
        this._tintRequests.stream({write: {sprite: Sprite}}, ENTITIES_INCLUDING_DISABLED).consume(({entity, sprite}) => {
            sprite.tint = tints.get(entity)!;
            buffer.removeComponent(entity, RandomizeTint);
        });
    }
}

export class Demo2dControlsSystem extends System {
    private _players = this.createEntityQuery([Player, LocalPosition]);
    private _playerTransforms = this.createEntityQuery([Player, LocalToWorld]);
    private _actions!: ResolvedInputActions<typeof Demo2dAction>;
    private _handlers: readonly ActionHandler[] = [];

    override priority(): number {
        return CONTROLS_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(Demo2dConfig);
        const actions = resolveInputActions(this.world, Demo2dAction);
        this._actions = actions;
        this._handlers = [
            {action: actions.MovePlayerUp, run: () => translate(this._players, NO_STEP, -this.config().playerStepYUnits)},
            {action: actions.MovePlayerDown, run: () => translate(this._players, NO_STEP, this.config().playerStepYUnits)},
            {action: actions.MovePlayerLeft, run: () => translate(this._players, -this.config().playerStepXUnits, NO_STEP)},
            {action: actions.MovePlayerRight, run: () => translate(this._players, this.config().playerStepXUnits, NO_STEP)},
            {action: actions.SpawnPixels, run: () => this.spawnFadingPixels()},
            {action: actions.ToggleRendering, run: () => toggle(this.world.tryGetSystem(RenderingSystemGroup))},
            {action: actions.ToggleSpritePass, run: () => this.world.resources.tryGet(RenderPasses)?.toggle("sprites")},
            {action: actions.LogSystemOrder, run: () => requireDebugWorld(this.world, DEMO_NAME).logSystemUpdateOrder()},
        ];
    }

    onUpdate(): void {
        const input = this.world.resources.get(Input);
        for (const event of input.events) {
            if (event.type !== "keyDown") continue;
            if (input.isActionEvent(event, this._actions.Quit)) {
                this.world.requestQuit();
                return;
            }
            for (const handler of this._handlers) if (input.isActionEvent(event, handler.action)) handler.run();
        }
    }

    private config(): Demo2dConfig {
        return this.world.resources.get(Demo2dConfig);
    }

    private spawnFadingPixels(): void {
        const config = this.config();
        const random = randomOf(this.world);
        const spawner = this.world.resources.get(PrefabSpawner);
        const prefab = requirePixelPrefab(config);
        const buffer = commandBufferOf(this.world);
        const origin = this._playerTransforms.tryGetSingleton({transform: LocalToWorld}, INCLUDING_DISABLED)?.transform.position;
        const originX = origin === undefined ? NO_OFFSET : Vec.x(origin);
        const originY = origin === undefined ? NO_OFFSET : Vec.y(origin);
        for (let i = 0; i < config.pixelsPerSpawn; i++) {
            const x = (random.next() - HALF) * config.spawnAreaUnits;
            const y = (random.next() - HALF) * config.spawnAreaUnits;
            const z = random.next();
            const fadeDurationMs = random.next() * config.fadeJitterMs + config.fadeMinMs;
            const rgb = randomRgb(random);
            const pixel = spawner.spawn(buffer, prefab);
            const position = pixel.rootComponent(LocalPosition);
            position.x = x + originX;
            position.y = y + originY;
            position.z = z;
            pixel.rootComponent(FadeToColor).durationMs = fadeDurationMs;
            pixel.rootComponent(OriginalColor).rgb = rgb;
            pixel.rootComponent(Sprite).tint = rgb;
        }
    }
}

export class Demo2dPanCameraSystem extends PanCameraSystem {
}

export class ColorFadeSystem extends System {
    private _fading = this.createEntityQuery([OriginalColor, FadeToColor, Sprite]);

    override priority(): number {
        return COLOR_FADE_PRIORITY;
    }

    protected onCreate(): void {
        this.requireAllForUpdate(this._fading);
    }

    public fadingCount(): number {
        return this._fading.enabledEntityCount();
    }

    onUpdate(): void {
        const deltaTimeMs = this.world.time.deltaTimeMs;
        const buffer = commandBufferOf(this.world);
        this._fading.stream({
            read: {originalColor: OriginalColor},
            write: {fadeToColor: FadeToColor, sprite: Sprite},
        }, {
            includeEntity: true,
        }).consume(({entity, sprite, fadeToColor, originalColor}) => {
            fadeToColor.elapsedMs += deltaTimeMs;
            const progress = fadeToColor.elapsedMs / fadeToColor.durationMs;
            sprite.tint = interpolateRgb(originalColor.rgb, fadeToColor.targetRgb, progress);
            if (fadeToColor.elapsedMs >= fadeToColor.durationMs) {
                buffer.removeComponent(entity, FadeToColor);
                buffer.removeComponent(entity, OriginalColor);
            }
        });
    }
}
