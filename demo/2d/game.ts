import {EntityCommandBufferSystem, getEntityCreationOrder, NULL_ENTITY, System} from "@jsengine/engine/core";
import type {Component, ComponentCtor, Entity, EntityCommandBuffer, EntityQuery, World} from "@jsengine/engine/core";
import {PanCameraSystem} from "@jsengine/engine/cameraControllers/2d";
import {Input, resolveInputActions} from "@jsengine/engine/input";
import type {InputAction, ResolvedInputActions} from "@jsengine/engine/input";
import {CHANNEL_MASK, CHANNEL_MAX, GREEN_SHIFT, HudElement, RED_SHIFT, RenderingSystemGroup, RenderPasses} from "@jsengine/engine/rendering";
import {Sprite} from "@jsengine/engine/rendering/2d";
import {LocalPosition, LocalToWorld} from "@jsengine/engine/translation";
import {Random, Vec} from "@jsengine/engine/math";
import type {RandomSource} from "@jsengine/engine/math";
import {AverageStat} from "@jsengine/engine/datatypes";
import {PrefabSpawner} from "@jsengine/engine/scene";
import type {PrefabAsset} from "@jsengine/engine/scene";
import {requireDebugWorld} from "@jsengine/engine/debugging";
import {formatHudText, HudLabel} from "@jsengine/engine/rendering/text";
import {Demo2dHud, FadeToColor, OriginalColor, PlayerTag, RandomTint} from "./components";
import {Demo2dTuning} from "./tuning";

const DEMO_NAME = "The 2D demo";
const TUNING_FILE = "assets/demo2d.asset.json";
const BLUE_SHIFT = 0;
const MS_PER_SECOND = 1000;
const HALF = 0.5;
const NO_STEP = 0;
const NO_OFFSET = 0;
const UNSET = -1;
const RANDOM_TINT_PRIORITY = -30;
const CONTROLS_PRIORITY = -10;
const HUD_PRIORITY = 10;
const FADE_PRIORITY = 20;
const INCLUDING_DISABLED = {includeDisabled: true} as const;
const ENTITIES_INCLUDING_DISABLED = {includeEntity: true, includeDisabled: true} as const;

const Demo2dAction = {
    MovePlayerUp: "movePlayerUp",
    MovePlayerDown: "movePlayerDown",
    MovePlayerLeft: "movePlayerLeft",
    MovePlayerRight: "movePlayerRight",
    SpawnPixels: "spawnPixels",
    ToggleRendering: "toggleRendering",
    ToggleSpritePass: "toggleSpritePass",
    LogSystemOrder: "logSystemOrder",
    ToggleHud: "toggleHud",
    Quit: "quit",
} as const;

type Demo2dActions = ResolvedInputActions<typeof Demo2dAction>;

interface ActionHandler {
    readonly action: InputAction;
    readonly run: () => void;
}

function commandBufferOf(world: World): EntityCommandBuffer {
    return world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
}

function randomOf(world: World): Random {
    const random = world.resources.getOrCreate(Random);
    random.reseedIfChanged(world.resources.get(Demo2dTuning).randomSeed);
    return random;
}

function requirePixelPrefab(tuning: Demo2dTuning): PrefabAsset {
    if (tuning.pixelPrefab === undefined) throw new Error(`Demo2dTuning.pixelPrefab names no prefab: set it in ${TUNING_FILE}`);
    return tuning.pixelPrefab;
}

function packRgb(r: number, g: number, b: number): number {
    return (r << RED_SHIFT) | (g << GREEN_SHIFT) | b;
}

function randomChannel(random: RandomSource): number {
    return Math.round(random.next() * CHANNEL_MAX);
}

function randomRgb(random: RandomSource): number {
    const r = randomChannel(random);
    const g = randomChannel(random);
    const b = randomChannel(random);
    return packRgb(r, g, b);
}

function channelOf(rgb: number, shift: number): number {
    return (rgb >> shift) & CHANNEL_MASK;
}

function interpolateChannel(from: number, to: number, shift: number, scale: number): number {
    const start = channelOf(from, shift);
    return Math.round(start + (channelOf(to, shift) - start) * scale);
}

function interpolateRgb(from: number, to: number, scale: number): number {
    if (scale >= 1) return to;
    if (scale <= 0) return from;
    return packRgb(interpolateChannel(from, to, RED_SHIFT, scale), interpolateChannel(from, to, GREEN_SHIFT, scale), interpolateChannel(from, to, BLUE_SHIFT, scale));
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

export class RandomTintSystem extends System {
    private _tinted = this.createEntityQuery([RandomTint, Sprite]);

    override priority(): number {
        return RANDOM_TINT_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(Demo2dTuning);
    }

    onUpdate(): void {
        if (this._tinted.entityCountIncludingDisabled() === 0) return;
        const tinted: Entity[] = [];
        this._tinted.stream({read: {tint: RandomTint}}, ENTITIES_INCLUDING_DISABLED).consume(({entity}) => {
            tinted.push(entity);
        });
        const random = randomOf(this.world);
        const buffer = commandBufferOf(this.world);
        const tints = new Map<Entity, number>();
        for (const entity of tinted.sort(byCreationOrder)) tints.set(entity, randomRgb(random));
        this._tinted.stream({write: {sprite: Sprite}}, ENTITIES_INCLUDING_DISABLED).consume(({entity, sprite}) => {
            sprite.tint = tints.get(entity)!;
            buffer.removeComponent(entity, RandomTint);
        });
    }
}

export class Demo2dControlsSystem extends System {
    private _players = this.createEntityQuery([PlayerTag, LocalPosition]);
    private _playerTransforms = this.createEntityQuery([PlayerTag, LocalToWorld]);
    private _actions!: Demo2dActions;
    private _handlers: readonly ActionHandler[] = [];

    override priority(): number {
        return CONTROLS_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(Demo2dTuning);
        const actions = resolveInputActions(this.world, Demo2dAction);
        this._actions = actions;
        this._handlers = [
            {action: actions.MovePlayerUp, run: () => translate(this._players, NO_STEP, -this.tuning().playerStepYUnits)},
            {action: actions.MovePlayerDown, run: () => translate(this._players, NO_STEP, this.tuning().playerStepYUnits)},
            {action: actions.MovePlayerLeft, run: () => translate(this._players, -this.tuning().playerStepXUnits, NO_STEP)},
            {action: actions.MovePlayerRight, run: () => translate(this._players, this.tuning().playerStepXUnits, NO_STEP)},
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

    private tuning(): Demo2dTuning {
        return this.world.resources.get(Demo2dTuning);
    }

    private spawnFadingPixels(): void {
        const tuning = this.tuning();
        const random = randomOf(this.world);
        const spawner = this.world.resources.get(PrefabSpawner);
        const prefab = requirePixelPrefab(tuning);
        const buffer = commandBufferOf(this.world);
        const origin = this._playerTransforms.tryGetSingleton({transform: LocalToWorld}, INCLUDING_DISABLED)?.transform.position;
        const originX = origin === undefined ? NO_OFFSET : Vec.x(origin);
        const originY = origin === undefined ? NO_OFFSET : Vec.y(origin);
        for (let i = 0; i < tuning.pixelsPerSpawn; i++) {
            const x = (random.next() - HALF) * tuning.spawnAreaUnits;
            const y = (random.next() - HALF) * tuning.spawnAreaUnits;
            const z = random.next();
            const fadeTime = random.next() * tuning.fadeJitterMs + tuning.fadeMinMs;
            const rgb = randomRgb(random);
            const pixel = spawner.spawn(buffer, prefab);
            const position = pixel.rootComponent(LocalPosition);
            position.x = x + originX;
            position.y = y + originY;
            position.z = z;
            pixel.rootComponent(FadeToColor).fadeTime = fadeTime;
            pixel.rootComponent(OriginalColor).rgb = rgb;
            pixel.rootComponent(Sprite).tint = rgb;
        }
    }
}

export class Demo2dPanCameraSystem extends PanCameraSystem {
}

export class FadeSystem extends System {
    private _fading = this.createEntityQuery([OriginalColor, FadeToColor, Sprite]);

    override priority(): number {
        return FADE_PRIORITY;
    }

    protected onCreate(): void {
        this.requireAllForUpdate(this._fading);
    }

    public count(): number {
        return this._fading.enabledEntityCount();
    }

    onUpdate(): void {
        const deltaTimeMs = this.world.time.deltaTimeMs;
        const buffer = commandBufferOf(this.world);
        this._fading.stream({
            write: {originalColor: OriginalColor, fadeToColor: FadeToColor, sprite: Sprite},
        }, {
            includeEntity: true,
        }).consume(({entity, sprite, fadeToColor, originalColor}) => {
            fadeToColor.currentFadeTime += deltaTimeMs;
            const scale = fadeToColor.currentFadeTime / fadeToColor.fadeTime;
            sprite.tint = interpolateRgb(originalColor.rgb, fadeToColor.rgb, scale);
            if (fadeToColor.currentFadeTime >= fadeToColor.fadeTime) {
                originalColor.rgb = fadeToColor.rgb;
                buffer.removeComponent(entity, FadeToColor);
                buffer.removeComponent(entity, OriginalColor);
            }
        });
    }
}

export class Demo2dHudSystem extends System {
    private _hud = this.createEntityQuery([Demo2dHud]);
    private _hudElements = this.createEntityQuery([HudElement]);
    private _entityCounter = new HudLabel();
    private _fpsCounter = new HudLabel();
    private _fps: AverageStat | undefined;
    private _fpsAverageFrames = UNSET;
    private _visible = true;
    private _actions!: Demo2dActions;

    override priority(): number {
        return HUD_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(Demo2dTuning);
        this._actions = resolveInputActions(this.world, Demo2dAction);
    }

    onUpdate(): void {
        if (this.world.resources.get(Input).actionPressed(this._actions.ToggleHud)) {
            this._visible = !this._visible;
            commandBufferOf(this.world).setEnabledStateForQuery(this._hudElements, this._visible);
        }
        if (!this._visible) return;
        const tuning = this.world.resources.get(Demo2dTuning).hud;
        const fps = this.fpsAveragedOver(tuning.fpsAverageFrames);
        const frameDeltaMs = this.world.time.frameDeltaTimeMs;
        if (frameDeltaMs > 0) fps.add(MS_PER_SECOND / frameDeltaMs);
        const hud = this._hud.tryGetSingleton({hud: Demo2dHud}, INCLUDING_DISABLED)?.hud;
        this._fpsCounter.bindTo(this.world, hud?.fpsCounter ?? NULL_ENTITY);
        this._entityCounter.bindTo(this.world, hud?.entityCounter ?? NULL_ENTITY);
        this._fpsCounter.show([formatHudText(tuning.fpsFormat, {fps: fps.getAvg().toFixed(tuning.fpsDecimals)})]);
        const fadeSystem = this.world.tryGetSystem(FadeSystem);
        this._entityCounter.show([fadeSystem === undefined
            ? tuning.fadeSystemInactiveText
            : formatHudText(tuning.entitiesFormat, {entities: fadeSystem.count().toFixed(tuning.entitiesDecimals)})]);
    }

    private fpsAveragedOver(frames: number): AverageStat {
        if (this._fps === undefined || this._fpsAverageFrames !== frames) {
            this._fps = new AverageStat(frames);
            this._fpsAverageFrames = frames;
        }
        return this._fps;
    }
}
