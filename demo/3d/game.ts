import {EntityCommandBufferSystem, FrameLoopSettings, NULL_ENTITY, System} from "@jsengine/engine/core";
import type {Component, ComponentCtor, EntityCommandBuffer, EntityQuery, World} from "@jsengine/engine/core";
import {Input, resolveInputActions} from "@jsengine/engine/input";
import type {InputAction, ResolvedInputActions} from "@jsengine/engine/input";
import {RenderPasses} from "@jsengine/engine/rendering";
import type {RenderPassKind} from "@jsengine/engine/rendering";
import {EulerAngles, LocalRotation, turnEulerAngles} from "@jsengine/engine/translation";
import {AmbientLight, DirectionalLight, MeshRenderSettings, PointLight} from "@jsengine/engine/rendering/3d";
import {Quaternions, Vec} from "@jsengine/engine/math";
import type {ReadonlyVec3, Vec3} from "@jsengine/engine/math";
import {FlyCameraSystem} from "@jsengine/engine/cameraControllers/3d";
import {DataAssets, dataAssetPathOf, PrefabSpawner} from "@jsengine/engine/scene";
import {requireDebugWorld} from "@jsengine/engine/debugging";
import {ModelGrid} from "./components";
import {assetModelFiles, ModelCatalog} from "./modelCatalog";
import type {CatalogModel} from "./modelCatalog";
import {PlacedModels} from "./placedModels";
import {Demo3dSession, NO_SHOWCASE_LIGHT, sessionOf} from "./session";
import {Demo3dConfig} from "./config";
import {ENTITIES_INCLUDING_DISABLED, INCLUDING_DISABLED} from "./worldAccess";

const DEMO_NAME = "The 3D demo";
const CONTROLS_PRIORITY = -10;
const NO_TURN_RAD = 0;
const LESS_DETAIL_SIGN = 1;
const MORE_DETAIL_SIGN = -1;
const FIRST_MODEL = 0;
const NEXT_INDEX_STEP = 1;

const Demo3dAction = {
    RotateModelsUp: "rotateModelsUp",
    RotateModelsDown: "rotateModelsDown",
    RotateModelsLeft: "rotateModelsLeft",
    RotateModelsRight: "rotateModelsRight",
    ShrinkModels: "shrinkModels",
    GrowModels: "growModels",
    RotateSunUp: "rotateSunUp",
    RotateSunDown: "rotateSunDown",
    RotateSunLeft: "rotateSunLeft",
    RotateSunRight: "rotateSunRight",
    SpawnModel: "spawnModel",
    DespawnModel: "despawnModel",
    NextModel: "nextModel",
    ReloadModels: "reloadModels",
    ToggleMeshPass: "toggleMeshPass",
    ToggleHud: "toggleHud",
    LogSystemOrder: "logSystemOrder",
    ToggleTextures: "toggleTextures",
    ToggleLod: "toggleLod",
    LessDetail: "lessDetail",
    MoreDetail: "moreDetail",
    CycleRenderPacing: "cycleRenderPacing",
    ToggleLights: "toggleLights",
    ToggleLamp: "toggleLamp",
    CycleShowcaseLight: "cycleShowcaseLight",
    Quit: "quit",
} as const;

type Demo3dActions = ResolvedInputActions<typeof Demo3dAction>;

interface ActionHandler {
    readonly action: InputAction;
    readonly run: () => void;
}

type ScaleCombiner = (out: Vec3, scale: ReadonlyVec3, factor: ReadonlyVec3) => Vec3;

function commandBufferOf(world: World): EntityCommandBuffer {
    return world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
}

function requirePrefabSpawner(world: World): PrefabSpawner {
    const spawner = world.resources.tryGet(PrefabSpawner);
    if (spawner === undefined) throw new Error(`${DEMO_NAME} spawns model prefabs through a PrefabSpawner: start it with startGame, whose SceneManager creates one`);
    return spawner;
}

function createSession(world: World): Demo3dSession {
    const spawner = requirePrefabSpawner(world);
    const session = new Demo3dSession(new ModelCatalog(spawner, assetModelFiles(world, spawner)), new PlacedModels(world));
    session.catalog.refresh(world.resources.get(Demo3dConfig).models);
    return session;
}

function setEnabledStateOf<IncSpec extends readonly ComponentCtor<Component>[]>(query: EntityQuery<IncSpec>, enabled: boolean, buffer: EntityCommandBuffer): void {
    query.stream({}, ENTITIES_INCLUDING_DISABLED).consume(({entity}) => buffer.setEnabledState(entity, enabled));
}

export class Demo3dFlyCameraSystem extends FlyCameraSystem {
}

export class Demo3dControlsSystem extends System {
    private _suns = this.createEntityQuery([DirectionalLight, EulerAngles, LocalRotation]);
    private _directionalLights = this.createEntityQuery([DirectionalLight]);
    private _ambientLights = this.createEntityQuery([AmbientLight]);
    private _pointLights = this.createEntityQuery([PointLight]);
    private _grids = this.createEntityQuery([ModelGrid]);
    private _frameLoops = this.createEntityQuery([FrameLoopSettings]);
    private _meshSettings = this.createEntityQuery([MeshRenderSettings]);
    private _actions!: Demo3dActions;
    private _keyDownHandlers: readonly ActionHandler[] = [];
    private _keyPressHandlers: readonly ActionHandler[] = [];
    private _commands: readonly ActionHandler[] = [];
    private _scaleFactor: Vec3 = Vec.alloc3();
    private _scaleStep = Number.NaN;

    override priority(): number {
        return CONTROLS_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(Demo3dConfig);
        const session = this.world.resources.insert(createSession(this.world));
        this.downloadModelsLoadedUpFront(session);
        const actions = resolveInputActions(this.world, Demo3dAction);
        this._actions = actions;
        this._keyDownHandlers = [
            {action: actions.RotateModelsUp, run: () => this.rotateModels(this.config().modelControls.rotateStepRad, NO_TURN_RAD)},
            {action: actions.RotateModelsDown, run: () => this.rotateModels(-this.config().modelControls.rotateStepRad, NO_TURN_RAD)},
            {action: actions.RotateModelsLeft, run: () => this.rotateModels(NO_TURN_RAD, -this.config().modelControls.rotateStepRad)},
            {action: actions.RotateModelsRight, run: () => this.rotateModels(NO_TURN_RAD, this.config().modelControls.rotateStepRad)},
            {action: actions.ShrinkModels, run: () => this.scaleModels(Vec.divInto)},
            {action: actions.GrowModels, run: () => this.scaleModels(Vec.mulInto)},
            {action: actions.RotateSunUp, run: () => this.rotateSun(this.config().sunRotateStepRad, NO_TURN_RAD)},
            {action: actions.RotateSunDown, run: () => this.rotateSun(-this.config().sunRotateStepRad, NO_TURN_RAD)},
            {action: actions.RotateSunLeft, run: () => this.rotateSun(NO_TURN_RAD, -this.config().sunRotateStepRad)},
            {action: actions.RotateSunRight, run: () => this.rotateSun(NO_TURN_RAD, this.config().sunRotateStepRad)},
        ];
        this._keyPressHandlers = [
            {action: actions.SpawnModel, run: () => this.spawnSelected()},
            {action: actions.DespawnModel, run: () => this.despawnLast()},
            {action: actions.NextModel, run: () => this.selectNextModel()},
            {action: actions.ReloadModels, run: () => this.reloadModels()},
        ];
        this._commands = [
            {action: actions.ToggleMeshPass, run: () => this.togglePass("meshes")},
            {action: actions.ToggleHud, run: () => this.togglePass("hudText")},
            {action: actions.LogSystemOrder, run: () => requireDebugWorld(this.world, DEMO_NAME).logSystemUpdateOrder()},
            {action: actions.ToggleTextures, run: () => this.changeMeshSettings(settings => settings.textures = !settings.textures)},
            {action: actions.ToggleLod, run: () => this.changeMeshSettings(settings => settings.lod = !settings.lod)},
            {action: actions.LessDetail, run: () => this.changeLodBias(LESS_DETAIL_SIGN * this.config().lodBiasStepLevels)},
            {action: actions.MoreDetail, run: () => this.changeLodBias(MORE_DETAIL_SIGN * this.config().lodBiasStepLevels)},
            {action: actions.CycleRenderPacing, run: () => this.cycleRenderPacing()},
            {action: actions.ToggleLights, run: () => this.toggleLights()},
            {action: actions.ToggleLamp, run: () => this.toggleLamp()},
            {action: actions.CycleShowcaseLight, run: () => this.cycleShowcaseLight()},
        ];
    }

    onUpdate(): void {
        const input = this.world.resources.get(Input);
        const session = sessionOf(this.world);
        session.placedModels.sync();
        this.primeSelection(session);
        if (input.actionPressed(this._actions.Quit)) {
            this.world.requestQuit();
            return;
        }
        for (const event of input.events) {
            if (event.type !== "keyDown") continue;
            for (const handler of this._keyDownHandlers) if (input.isActionEvent(event, handler.action)) handler.run();
            if (event.repeat) continue;
            for (const handler of this._keyPressHandlers) if (input.isActionEvent(event, handler.action)) handler.run();
        }
        for (const command of this._commands) if (input.actionPressed(command.action)) command.run();
    }

    private config(): Demo3dConfig {
        return this.world.resources.get(Demo3dConfig);
    }

    private togglePass(kind: RenderPassKind): void {
        this.world.resources.tryGet(RenderPasses)?.toggle(kind);
    }

    private changeMeshSettings(change: (settings: MeshRenderSettings) => void): void {
        this._meshSettings.stream({write: {settings: MeshRenderSettings}}, INCLUDING_DISABLED).consume(({settings}) => change(settings));
    }

    private changeLodBias(levels: number): void {
        this.changeMeshSettings(settings => settings.lodBias += levels);
    }

    private grid(): ModelGrid | undefined {
        return this._grids.tryGetSingleton({grid: ModelGrid}, INCLUDING_DISABLED)?.grid;
    }

    private rotateSun(pitchRad: number, yawRad: number): void {
        this._suns.stream({write: {euler: EulerAngles, rotation: LocalRotation}}, INCLUDING_DISABLED).consume(({euler, rotation}) => {
            turnEulerAngles(euler, rotation, pitchRad, yawRad);
        });
    }

    private rotateModels(pitchRad: number, yawRad: number): void {
        const grid = this.grid();
        if (grid === undefined) return;
        if (pitchRad !== NO_TURN_RAD) Vec.setX(grid.rotationRad, Vec.x(grid.rotationRad) + pitchRad);
        if (yawRad !== NO_TURN_RAD) Vec.setY(grid.rotationRad, Vec.y(grid.rotationRad) + yawRad);
        sessionOf(this.world).placedModels.rotateAll(Quaternions.eulerToQuat(grid.rotationRad));
    }

    private scaleModels(applyFactor: ScaleCombiner): void {
        const grid = this.grid();
        if (grid === undefined) return;
        applyFactor(grid.scale, grid.scale, this.scaleFactor(this.config().modelControls.scaleStep));
        sessionOf(this.world).placedModels.scaleAll(grid.scale);
    }

    private scaleFactor(step: number): ReadonlyVec3 {
        if (step !== this._scaleStep) {
            this._scaleStep = step;
            this._scaleFactor = Vec.alloc3(step, step, step);
        }
        return this._scaleFactor;
    }

    private primeSelection(session: Demo3dSession): void {
        if (session.selectionPrimed) return;
        const grid = this.grid();
        if (grid === undefined) return;
        session.selectionPrimed = true;
        this.clampSelection(grid, session);
        this.downloadSelected(grid, session);
    }

    private clampSelection(grid: ModelGrid, session: Demo3dSession): void {
        if (grid.selectedModelIndex >= session.catalog.models.length) grid.selectedModelIndex = FIRST_MODEL;
    }

    private downloadModelsLoadedUpFront(session: Demo3dSession): void {
        session.catalog.downloadModelsLoadedUpFront((loaded, queuedSpawns) => this.spawnQueued(loaded, queuedSpawns));
    }

    private downloadSelected(grid: ModelGrid, session: Demo3dSession): void {
        const model = session.catalog.models[grid.selectedModelIndex];
        if (model !== undefined) session.catalog.downloadUnlessLoaded(model, (loaded, queuedSpawns) => this.spawnQueued(loaded, queuedSpawns));
    }

    private spawnSelected(): void {
        const grid = this.grid();
        if (grid === undefined) return;
        const session = sessionOf(this.world);
        const model = session.catalog.models[grid.selectedModelIndex];
        if (model === undefined) return;
        if (model.template !== undefined) {
            session.placedModels.spawn(model.template, commandBufferOf(this.world), grid);
            return;
        }
        const pending = session.catalog.downloadUnlessLoaded(model, (loaded, queuedSpawns) => this.spawnQueued(loaded, queuedSpawns));
        if (pending !== undefined) pending.queuedSpawns++;
    }

    private spawnQueued(model: CatalogModel, count: number): void {
        const grid = this.grid();
        const template = model.template;
        if (grid === undefined || template === undefined) return;
        const session = sessionOf(this.world);
        session.placedModels.sync();
        for (let i = 0; i < count; i++) session.placedModels.spawn(template, commandBufferOf(this.world), grid);
    }

    private despawnLast(): void {
        const grid = this.grid();
        if (grid !== undefined) sessionOf(this.world).placedModels.despawnLast(commandBufferOf(this.world), grid);
    }

    private selectNextModel(): void {
        const grid = this.grid();
        const session = sessionOf(this.world);
        const count = session.catalog.models.length;
        if (grid === undefined || count === 0) return;
        grid.selectedModelIndex = (grid.selectedModelIndex + NEXT_INDEX_STEP) % count;
        this.downloadSelected(grid, session);
    }

    private reloadModels(): void {
        const config = this.config();
        const session = sessionOf(this.world);
        const path = dataAssetPathOf(config);
        try {
            if (path !== undefined) this.world.resources.get(DataAssets).reload(path);
        } catch (error) {
            console.error(`Could not reload ${path}:`, error);
        }
        session.catalog.refresh(config.models);
        this.downloadModelsLoadedUpFront(session);
        const grid = this.grid();
        if (grid === undefined) return;
        this.clampSelection(grid, session);
        this.downloadSelected(grid, session);
    }

    private cycleRenderPacing(): void {
        const session = sessionOf(this.world);
        const presets = this.config().renderPacing;
        if (presets.length === 0) return;
        session.renderPacingIndex = (session.renderPacingIndex + NEXT_INDEX_STEP) % presets.length;
        const preset = presets[session.renderPacingIndex];
        this._frameLoops.stream({write: {settings: FrameLoopSettings}}, INCLUDING_DISABLED).consume(({settings}) => {
            settings.renderRate = preset.renderRate;
            settings.matchDisplay = preset.matchDisplay;
        });
    }

    private toggleLights(): void {
        const session = sessionOf(this.world);
        session.lightsOn = !session.lightsOn;
        this.applyLightEnabledState(session);
    }

    private toggleLamp(): void {
        const session = sessionOf(this.world);
        session.lampOn = !session.lampOn;
        this.applyLightEnabledState(session);
    }

    private cycleShowcaseLight(): void {
        const session = sessionOf(this.world);
        const buffer = commandBufferOf(this.world);
        if (session.showcaseLight !== NULL_ENTITY && this.world.entityManager.exists(session.showcaseLight)) buffer.destroyEntity(session.showcaseLight);
        session.showcaseLight = NULL_ENTITY;
        const prefabs = this.config().showcaseLights;
        const next = session.showcaseLightIndex + NEXT_INDEX_STEP;
        session.showcaseLightIndex = next < prefabs.length ? next : NO_SHOWCASE_LIGHT;
        const prefab = prefabs[session.showcaseLightIndex];
        if (prefab !== undefined) session.showcaseLight = requirePrefabSpawner(this.world).spawn(buffer, prefab).root;
    }

    private applyLightEnabledState(session: Demo3dSession): void {
        const buffer = commandBufferOf(this.world);
        setEnabledStateOf(this._directionalLights, session.lightsOn, buffer);
        setEnabledStateOf(this._ambientLights, session.lightsOn, buffer);
        setEnabledStateOf(this._pointLights, session.lightsOn && session.lampOn, buffer);
    }
}
