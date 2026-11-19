import {EntityCommandBufferSystem, FrameLoopSettings, NULL_ENTITY, Resource, System} from "../../src/engine/core";
import type {Component, ComponentCtor, EntityCommandBuffer, EntityQuery, World} from "../../src/engine/core";
import {Input, resolveInputActions} from "../../src/engine/input";
import type {InputAction, InputEvent, ResolvedInputActions} from "../../src/engine/input";
import {RenderPasses, SCREEN_UNIT_HEIGHT_PER_WIDTH} from "../../src/engine/rendering";
import type {RenderPassKind} from "../../src/engine/rendering";
import {LocalPosition, LocalRotation} from "../../src/engine/translation";
import {AmbientLight, DirectionalLight, FieldOfView, MeshRenderSettings, MeshRenderStats, PointLight} from "../../src/engine/rendering/3d";
import {Vec} from "../../src/engine/math/types/vec";
import type {ReadonlyVec3, ReadonlyVec4, Vec3, Vec4} from "../../src/engine/math/types/vec";
import {Quaternions} from "../../src/engine/math/quaternions";
import {DataAssets, dataAssetPathOf, PrefabSpawner} from "../../src/engine/scene";
import {requireDebugWorld} from "../_shared/debugWorld";
import {formatHudLines, formatHudText, HudLabel} from "../_shared/hud";
import {Demo3dHud, EulerAngles, FlyCamera, ModelGrid} from "./components";
import {ModelCatalog} from "./modelCatalog";
import type {CatalogModel, Demo3dModelFiles, ModelDownload} from "./modelCatalog";
import {GridModels} from "./modelGrid";
import {Demo3dTuning} from "./tuning";
import type {Demo3dHudTuning, RenderPacingPreset} from "./tuning";

export type {Demo3dModelFiles} from "./modelCatalog";

export interface Demo3dHost {
    readonly modelFiles?: Demo3dModelFiles;
}

const DEMO_NAME = "The 3D demo";
const BEFORE_SIMULATION_PRIORITY = -1;
const QUARTER_TURN_RAD = Math.PI / 2;
const SCREEN_UNIT_WIDTH_PER_HEIGHT = 1 / SCREEN_UNIT_HEIGHT_PER_WIDTH;
const NO_ROLL_RAD = 0;
const NO_TURN_RAD = 0;
const LESS_DETAIL_SIGN = 1;
const MORE_DETAIL_SIGN = -1;
const FIRST_MODEL = 0;
const FIRST_PRESET = 0;
const NEXT_INDEX_STEP = 1;
const MS_PER_SECOND = 1000;
const BYTES_PER_MB = 1024 * 1024;
const COMPACT_DIGITS = 3;
const UNIT_STEP = 1000;
const NO_TEXT = "";
const PREVIEW_LINE_SEPARATOR = "\n";
const COMPACT_UNITS: readonly (readonly [value: number, suffix: string])[] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
];
const FORWARD: ReadonlyVec3 = Vec.alloc3(0, 0, 1);
const RIGHT: ReadonlyVec3 = Vec.alloc3(1, 0, 0);
const INCLUDING_DISABLED = {includeDisabled: true} as const;
const ENTITIES_INCLUDING_DISABLED = {includeEntity: true, includeDisabled: true} as const;

const Demo3dAction = {
    MoveForward: "moveForward",
    MoveBackward: "moveBackward",
    MoveRight: "moveRight",
    MoveLeft: "moveLeft",
    MoveDown: "moveDown",
    MoveUp: "moveUp",
    RotateModelsUp: "rotateModelsUp",
    RotateModelsDown: "rotateModelsDown",
    RotateModelsLeft: "rotateModelsLeft",
    RotateModelsRight: "rotateModelsRight",
    ShrinkModels: "shrinkModels",
    GrowModels: "growModels",
    ZoomIn: "zoomIn",
    ZoomOut: "zoomOut",
    RotateSunUp: "rotateSunUp",
    RotateSunDown: "rotateSunDown",
    RotateSunLeft: "rotateSunLeft",
    RotateSunRight: "rotateSunRight",
    SpawnModel: "spawnModel",
    DespawnModel: "despawnModel",
    NextModel: "nextModel",
    ReloadModels: "reloadModels",
    Look: "look",
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
    Quit: "quit",
} as const;

type Demo3dActions = ResolvedInputActions<typeof Demo3dAction>;

interface ActionHandler {
    readonly action: InputAction;
    readonly run: () => void;
}

type ScaleCombiner = (out: Vec3, scale: ReadonlyVec3, factor: ReadonlyVec3) => Vec3;

class Demo3dSession extends Resource {
    public lightsOn = true;
    public lampOn = true;
    public renderPacingIndex = FIRST_PRESET;
    public selectionPrimed = false;

    public constructor(public readonly catalog: ModelCatalog, public readonly models: GridModels) {
        super();
    }
}

function commandBufferOf(world: World): EntityCommandBuffer {
    return world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
}

function sessionOf(world: World): Demo3dSession {
    return world.resources.get(Demo3dSession);
}

function cameraRotationOf(camera: Readonly<FlyCamera>, scratch: Vec3): Vec4 {
    return Quaternions.eulerToQuat(Vec.set3(scratch, camera.pitchRad, camera.yawRad, NO_ROLL_RAD));
}

function rotateByQuat(q: ReadonlyVec4, v: ReadonlyVec3, out: Vec3): Vec3 {
    const x = Vec.x(q), y = Vec.y(q), z = Vec.z(q), w = Vec.w(q);
    const vx = Vec.x(v), vy = Vec.y(v), vz = Vec.z(v);
    const tx = 2 * (y * vz - z * vy);
    const ty = 2 * (z * vx - x * vz);
    const tz = 2 * (x * vy - y * vx);
    return Vec.set3(out,
        vx + w * tx + (y * tz - z * ty),
        vy + w * ty + (z * tx - x * tz),
        vz + w * tz + (x * ty - y * tx),
    );
}

function formatCompact(num: number): string {
    const abs = Math.abs(num);
    const sign = num < 0 ? "-" : "";
    for (let i = 0; i < COMPACT_UNITS.length; i++) {
        const [value, suffix] = COMPACT_UNITS[i];
        if (abs < value) continue;
        const scaled = Number((abs / value).toPrecision(COMPACT_DIGITS));
        if (scaled >= UNIT_STEP && i > 0) {
            const [nextValue, nextSuffix] = COMPACT_UNITS[i - 1];
            return `${sign}${Number((abs / nextValue).toPrecision(COMPACT_DIGITS))}${nextSuffix}`;
        }
        return `${sign}${scaled}${suffix}`;
    }
    return `${sign}${abs}`;
}

function setEnabledStateOf<IncSpec extends readonly ComponentCtor<Component>[]>(query: EntityQuery<IncSpec>, enabled: boolean, buffer: EntityCommandBuffer): void {
    query.stream({}, ENTITIES_INCLUDING_DISABLED).consume(({entity}) => buffer.setEnabledState(entity, enabled));
}

function renderPacingOf(tuning: Demo3dTuning, session: Demo3dSession): RenderPacingPreset | undefined {
    return tuning.renderPacing[session.renderPacingIndex];
}

class Demo3dControlsSystem extends System {
    private _flyCameras = this.createEntityQuery([FlyCamera, LocalPosition, LocalRotation]);
    private _zoomCameras = this.createEntityQuery([FlyCamera, FieldOfView]);
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
    private readonly _eulerScratch: Vec3 = Vec.alloc3();
    private readonly _directionScratch: Vec3 = Vec.alloc3();
    private _scaleFactor: Vec3 = Vec.alloc3();
    private _scaleStep = Number.NaN;
    private _lastPointerX = 0;
    private _lastPointerY = 0;
    private _looking = false;

    override priority(): number {
        return BEFORE_SIMULATION_PRIORITY;
    }

    protected onCreate(): void {
        const actions = resolveInputActions(this.world, Demo3dAction);
        this._actions = actions;
        this._keyDownHandlers = [
            {action: actions.MoveForward, run: () => this.moveCamera(FORWARD, this.tuning().camera.moveStepUnits)},
            {action: actions.MoveBackward, run: () => this.moveCamera(FORWARD, -this.tuning().camera.moveStepUnits)},
            {action: actions.MoveRight, run: () => this.moveCamera(RIGHT, this.tuning().camera.moveStepUnits)},
            {action: actions.MoveLeft, run: () => this.moveCamera(RIGHT, -this.tuning().camera.moveStepUnits)},
            {action: actions.MoveDown, run: () => this.raiseCamera(-this.tuning().camera.moveStepUnits)},
            {action: actions.MoveUp, run: () => this.raiseCamera(this.tuning().camera.moveStepUnits)},
            {action: actions.RotateModelsUp, run: () => this.rotateModels(this.tuning().modelControls.rotateStepRad, NO_TURN_RAD)},
            {action: actions.RotateModelsDown, run: () => this.rotateModels(-this.tuning().modelControls.rotateStepRad, NO_TURN_RAD)},
            {action: actions.RotateModelsLeft, run: () => this.rotateModels(NO_TURN_RAD, -this.tuning().modelControls.rotateStepRad)},
            {action: actions.RotateModelsRight, run: () => this.rotateModels(NO_TURN_RAD, this.tuning().modelControls.rotateStepRad)},
            {action: actions.ShrinkModels, run: () => this.scaleModels(Vec.divInto)},
            {action: actions.GrowModels, run: () => this.scaleModels(Vec.mulInto)},
            {action: actions.ZoomIn, run: () => this.zoom(fieldOfView => fieldOfView.degrees /= this.tuning().camera.fovKeyStep)},
            {action: actions.ZoomOut, run: () => this.zoom(fieldOfView => fieldOfView.degrees *= this.tuning().camera.fovKeyStep)},
            {action: actions.RotateSunUp, run: () => this.rotateSun(this.tuning().sunRotateStepRad, NO_TURN_RAD)},
            {action: actions.RotateSunDown, run: () => this.rotateSun(-this.tuning().sunRotateStepRad, NO_TURN_RAD)},
            {action: actions.RotateSunLeft, run: () => this.rotateSun(NO_TURN_RAD, -this.tuning().sunRotateStepRad)},
            {action: actions.RotateSunRight, run: () => this.rotateSun(NO_TURN_RAD, this.tuning().sunRotateStepRad)},
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
            {action: actions.LessDetail, run: () => this.changeLodBias(LESS_DETAIL_SIGN * this.tuning().lodBiasStepLevels)},
            {action: actions.MoreDetail, run: () => this.changeLodBias(MORE_DETAIL_SIGN * this.tuning().lodBiasStepLevels)},
            {action: actions.CycleRenderPacing, run: () => this.cycleRenderPacing()},
            {action: actions.ToggleLights, run: () => this.toggleLights()},
            {action: actions.ToggleLamp, run: () => this.toggleLamp()},
        ];
    }

    onUpdate(): void {
        const input = this.world.resources.get(Input);
        const session = sessionOf(this.world);
        session.models.sync();
        this.primeSelection(session);
        if (input.actionPressed(this._actions.Quit)) {
            this.world.requestQuit();
            return;
        }
        for (const event of input.events) {
            if (event.type !== "keyDown") {
                this.handlePointer(input, event);
                continue;
            }
            for (const handler of this._keyDownHandlers) if (input.isActionEvent(event, handler.action)) handler.run();
            if (event.repeat) continue;
            for (const handler of this._keyPressHandlers) if (input.isActionEvent(event, handler.action)) handler.run();
        }
        for (const command of this._commands) if (input.actionPressed(command.action)) command.run();
    }

    private tuning(): Demo3dTuning {
        return this.world.resources.get(Demo3dTuning);
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

    private moveCamera(localDirection: ReadonlyVec3, amount: number): void {
        this._flyCameras.stream({read: {camera: FlyCamera}, write: {position: LocalPosition}}, INCLUDING_DISABLED).consume(({camera, position}) => {
            const direction = rotateByQuat(cameraRotationOf(camera, this._eulerScratch), localDirection, this._directionScratch);
            const dx = Vec.x(direction), dy = Vec.y(direction), dz = Vec.z(direction);
            position.x += dx * amount;
            position.y += dy * amount;
            position.z += dz * amount;
        });
    }

    private raiseCamera(amount: number): void {
        this._flyCameras.stream({write: {position: LocalPosition}}, INCLUDING_DISABLED).consume(({position}) => {
            position.y += amount;
        });
    }

    private look(yawRad: number, pitchRad: number): void {
        const pitchLimit = QUARTER_TURN_RAD - this.tuning().camera.pitchMarginRad;
        this._flyCameras.stream({write: {camera: FlyCamera, rotation: LocalRotation}}, INCLUDING_DISABLED).consume(({camera, rotation}) => {
            camera.yawRad += yawRad;
            camera.pitchRad += pitchRad;
            camera.pitchRad = Math.max(-pitchLimit, Math.min(pitchLimit, camera.pitchRad));
            rotation.xyzw = cameraRotationOf(camera, this._eulerScratch);
        });
    }

    private zoom(change: (fieldOfView: FieldOfView) => void): void {
        this._zoomCameras.stream({write: {fieldOfView: FieldOfView}}, INCLUDING_DISABLED).consume(({fieldOfView}) => {
            change(fieldOfView);
        });
    }

    private rotateSun(pitchRad: number, yawRad: number): void {
        this._suns.stream({write: {euler: EulerAngles, rotation: LocalRotation}}, INCLUDING_DISABLED).consume(({euler, rotation}) => {
            if (pitchRad !== NO_TURN_RAD) Vec.setX(euler.radians, Vec.x(euler.radians) + pitchRad);
            if (yawRad !== NO_TURN_RAD) Vec.setY(euler.radians, Vec.y(euler.radians) + yawRad);
            rotation.xyzw = Quaternions.eulerToQuat(euler.radians);
        });
    }

    private rotateModels(pitchRad: number, yawRad: number): void {
        const grid = this.grid();
        if (grid === undefined) return;
        if (pitchRad !== NO_TURN_RAD) Vec.setX(grid.rotationRad, Vec.x(grid.rotationRad) + pitchRad);
        if (yawRad !== NO_TURN_RAD) Vec.setY(grid.rotationRad, Vec.y(grid.rotationRad) + yawRad);
        sessionOf(this.world).models.rotateAll(Quaternions.eulerToQuat(grid.rotationRad));
    }

    private scaleModels(applyFactor: ScaleCombiner): void {
        const grid = this.grid();
        if (grid === undefined) return;
        applyFactor(grid.scale, grid.scale, this.scaleFactor(this.tuning().modelControls.scaleStep));
        sessionOf(this.world).models.scaleAll(grid.scale);
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
        if (grid.selectedModel >= session.catalog.models.length) grid.selectedModel = FIRST_MODEL;
    }

    private downloadSelected(grid: ModelGrid, session: Demo3dSession): void {
        const model = session.catalog.models[grid.selectedModel];
        if (model !== undefined) session.catalog.downloadUnlessLoaded(model, (loaded, queuedSpawns) => this.spawnQueued(loaded, queuedSpawns));
    }

    private spawnSelected(): void {
        const grid = this.grid();
        if (grid === undefined) return;
        const session = sessionOf(this.world);
        const model = session.catalog.models[grid.selectedModel];
        if (model === undefined) return;
        if (model.template !== undefined) {
            session.models.spawn(model.template, commandBufferOf(this.world), grid);
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
        session.models.sync();
        for (let i = 0; i < count; i++) session.models.spawn(template, commandBufferOf(this.world), grid);
    }

    private despawnLast(): void {
        const grid = this.grid();
        if (grid !== undefined) sessionOf(this.world).models.despawnLast(commandBufferOf(this.world), grid);
    }

    private selectNextModel(): void {
        const grid = this.grid();
        const session = sessionOf(this.world);
        const count = session.catalog.models.length;
        if (grid === undefined || count === 0) return;
        grid.selectedModel = (grid.selectedModel + NEXT_INDEX_STEP) % count;
        this.downloadSelected(grid, session);
    }

    private reloadModels(): void {
        const tuning = this.tuning();
        const session = sessionOf(this.world);
        const path = dataAssetPathOf(tuning);
        try {
            if (path !== undefined) this.world.resources.get(DataAssets).reload(path);
        } catch (error) {
            console.error(`Could not reload ${path}:`, error);
        }
        session.catalog.refresh(tuning.models);
        const grid = this.grid();
        if (grid === undefined) return;
        this.clampSelection(grid, session);
        this.downloadSelected(grid, session);
    }

    private cycleRenderPacing(): void {
        const session = sessionOf(this.world);
        const presets = this.tuning().renderPacing;
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

    private applyLightEnabledState(session: Demo3dSession): void {
        const buffer = commandBufferOf(this.world);
        setEnabledStateOf(this._directionalLights, session.lightsOn, buffer);
        setEnabledStateOf(this._ambientLights, session.lightsOn, buffer);
        setEnabledStateOf(this._pointLights, session.lightsOn && session.lampOn, buffer);
    }

    private handlePointer(input: Input, event: InputEvent): void {
        switch (event.type) {
            case "pointerDown":
                if (!input.isActionEvent(event, this._actions.Look)) return;
                this._looking = true;
                this._lastPointerX = event.x;
                this._lastPointerY = event.y;
                return;
            case "pointerUp":
                if (input.isActionEvent(event, this._actions.Look)) this._looking = false;
                return;
            case "pointerMove": {
                if (!this._looking) return;
                const dx = event.x - this._lastPointerX;
                const dy = event.y - this._lastPointerY;
                this._lastPointerX = event.x;
                this._lastPointerY = event.y;
                const lookRadPerUnit = this.tuning().camera.lookRadPerUnit;
                this.look(dx * lookRadPerUnit, dy * lookRadPerUnit * SCREEN_UNIT_WIDTH_PER_HEIGHT);
                return;
            }
            case "wheel": {
                const camera = this.tuning().camera;
                this.zoom(fieldOfView => {
                    fieldOfView.degrees = Math.max(camera.minFovDegrees, Math.min(camera.maxFovDegrees, fieldOfView.degrees * Math.pow(camera.fovWheelStep, -event.delta)));
                });
                return;
            }
        }
    }
}

class Demo3dHudSystem extends System {
    private _hud = this.createEntityQuery([Demo3dHud]);
    private _grids = this.createEntityQuery([ModelGrid]);
    private _preview = new HudLabel();
    private _entityCounter = new HudLabel();
    private _fpsCounter = new HudLabel();
    private _previewText: string | undefined;
    private _rateWindowStartMs = 0;
    private _rateWindowFrames = 0;
    private _rateWindowTicks = 0;
    private _framesPerSecond = 0;
    private _ticksPerSecond = 0;

    protected onCreate(): void {
        this._rateWindowStartMs = this.world.time.elapsedTimeMs;
    }

    onUpdate(): void {
        const session = sessionOf(this.world);
        const tuning = this.world.resources.get(Demo3dTuning);
        const hud = this._hud.tryGetSingleton({hud: Demo3dHud}, INCLUDING_DISABLED)?.hud;
        this._preview.bindTo(this.world, hud?.preview ?? NULL_ENTITY);
        this._entityCounter.bindTo(this.world, hud?.entityCounter ?? NULL_ENTITY);
        this._fpsCounter.bindTo(this.world, hud?.fpsCounter ?? NULL_ENTITY);
        session.models.sync();
        this.refreshPreview(session, tuning.hud);
        this.measureRates(tuning.hud.rateWindowMs);
        const pacing = renderPacingOf(tuning, session);
        this._fpsCounter.show(formatHudLines(tuning.hud.fpsLines, {
            fps: this._framesPerSecond.toFixed(tuning.hud.rateDecimals),
            ticks: this._ticksPerSecond.toFixed(tuning.hud.rateDecimals),
            pacing: this.pacingLabel(pacing, tuning.hud),
        }));
        const stats = this.world.resources.tryGet(MeshRenderStats);
        const lodLevels = stats === undefined ? NO_TEXT : formatHudText(tuning.hud.lodLevelsFormat, {
            levels: Array.from(stats.lodLevelCounts.subarray(0, tuning.hud.lodLevelsShown)).join(tuning.hud.lodLevelSeparator),
        });
        const rasterWorkers = stats === undefined ? 0 : stats.rasterWorkers;
        this._entityCounter.show(formatHudLines(tuning.hud.statsLines, {
            entities: this.world.enabledEntityCount,
            drawn: formatCompact(stats === undefined ? 0 : stats.trianglesDrawn),
            source: formatCompact(session.models.sourceTriangles()),
            lodLevels,
            rasterWorkers: rasterWorkers === 0 ? tuning.hud.singleThreadedRasterText : rasterWorkers,
        }));
    }

    private pacingLabel(pacing: RenderPacingPreset | undefined, hud: Demo3dHudTuning): string {
        const label = pacing?.label ?? NO_TEXT;
        const limit = this.world.loopTiming.renderRateLimit;
        return Number.isFinite(limit) ? formatHudText(hud.pacingWithCpuLimitFormat, {label, limit}) : label;
    }

    private refreshPreview(session: Demo3dSession, hud: Demo3dHudTuning): void {
        const catalog = session.catalog;
        const spawned = session.models.count;
        const lines = [...catalog.downloads].map(([path, progress]) => this.downloadLine(catalog.modelFrom(path)?.name ?? path, progress, hud));
        const selected = this.selectedModel(session);
        lines.push(selected === undefined
            ? formatHudText(hud.noModelsFormat, {spawned})
            : formatHudText(hud.nextModelFormat, {model: selected.name, spawned}));
        const text = lines.join(PREVIEW_LINE_SEPARATOR);
        if (text === this._previewText) return;
        this._previewText = text;
        this._preview.show(lines);
    }

    private selectedModel(session: Demo3dSession): CatalogModel | undefined {
        const models = session.catalog.models;
        const selectedIndex = this._grids.tryGetSingleton({grid: ModelGrid}, INCLUDING_DISABLED)?.grid.selectedModel ?? FIRST_MODEL;
        return models[selectedIndex] ?? models[FIRST_MODEL];
    }

    private downloadLine(name: string, progress: ModelDownload, hud: Demo3dHudTuning): string {
        if (progress.failure !== undefined) return formatHudText(hud.downloadFailedFormat, {model: name, failure: progress.failure});
        const queued = progress.queuedSpawns === 0 ? NO_TEXT : formatHudText(hud.queuedSpawnsFormat, {queued: progress.queuedSpawns});
        return formatHudText(hud.downloadFormat, {
            model: name,
            loaded: (progress.loadedBytes / BYTES_PER_MB).toFixed(hud.megabyteDecimals),
            total: (progress.totalBytes / BYTES_PER_MB).toFixed(hud.megabyteDecimals),
            queued,
        });
    }

    private measureRates(rateWindowMs: number): void {
        const time = this.world.time;
        const nowMs = time.elapsedTimeMs;
        const windowMs = nowMs - this._rateWindowStartMs;
        if (windowMs < rateWindowMs) return;
        this._framesPerSecond = (time.frameCount - this._rateWindowFrames) * MS_PER_SECOND / windowMs;
        this._ticksPerSecond = (time.tickCount - this._rateWindowTicks) * MS_PER_SECOND / windowMs;
        this._rateWindowStartMs = nowMs;
        this._rateWindowFrames = time.frameCount;
        this._rateWindowTicks = time.tickCount;
    }
}

function requirePrefabSpawner(world: World): PrefabSpawner {
    const spawner = world.resources.tryGet(PrefabSpawner);
    if (spawner === undefined) throw new Error(`${DEMO_NAME} spawns model prefabs through a PrefabSpawner: launch it with launchProject or startProject, whose SceneManager creates one`);
    return spawner;
}

export function setupDemo3d(world: World, host: Demo3dHost): void {
    const tuning = world.resources.get(Demo3dTuning);
    const session = new Demo3dSession(new ModelCatalog(requirePrefabSpawner(world), host.modelFiles), new GridModels(world));
    world.resources.insert(session);
    session.catalog.refresh(tuning.models);
    world.ensureSystemExists(Demo3dControlsSystem);
    world.ensureSystemExists(Demo3dHudSystem);
}
