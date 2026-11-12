import {
    EntityCommandBufferSystem,
    System,
    DebugWorld,
    Resource
} from "../../src/engine/core";
import {consoleInput as input, Key} from "../../src/engine/input";
import type {TerminalInputSource} from "../../src/engine/input";

import {Camera, HudElement, RenderBounds, RenderingSystemGroup, ScreenAnchor, TextSprite} from "../../src/engine/rendering";

import {LocalPosition, LocalRotation, LocalScale, LocalToWorld} from "../../src/engine/translation";

import {
    Ansi,
    HudTextSpriteCellPassSystem,
} from "../../src/backends/cells";

import {AverageStat} from "../../src/engine/datatypes";
import {MeshCellPassSystem, MeshCellPassSettings} from "../../src/backends/cells/3d";
import {CellRenderSettings} from "../../src/backends/cells";
import {
    AmbientLight,
    DirectionalLight,
    FaceCulling,
    FieldOfView,
    Mesh,
    PointLight,
    RenderMesh
} from "../../src/engine/rendering/3d";
import {ReadonlyVec3, ReadonlyVec4, Vec, Vec3} from "../../src/engine/math/types/vec";
import {Quaternions} from "../../src/engine/math/quaternions";
import {createHudLabel} from "../_shared/hud";

export interface DemoModel {
    readonly name: string;
    readonly path: string;
}

export interface DemoModelFiles {
    ready(model: DemoModel): boolean;
    fetch(model: DemoModel, onProgress: (loadedBytes: number, totalBytes: number) => void): Promise<void>;
}

export interface Demo3dHost {
    readonly terminal: TerminalInputSource;
    listModels(): readonly DemoModel[];
    readonly modelFiles?: DemoModelFiles;
    quit(): void;
}

const BYTES_PER_MB = 1024 * 1024;
const COMPACT_DIGITS = 3;
const UNIT_STEP = 1000;
const FPS_AVERAGE_FRAMES = 10;
const MS_PER_SECOND = 1000;
const LOD_LEVELS_SHOWN = 5;
const MOVE_STEP = 0.05;
const MODEL_ROTATE_STEP_RAD = 0.1;
const SUN_ROTATE_STEP_RAD = 0.05;
const SCALE_STEP = 1.02;
const FOV_KEY_STEP = 1.01;
const FOV_WHEEL_STEP = 1.05;
const MIN_FOV_DEG = 10, MAX_FOV_DEG = 120;
const PITCH_MARGIN_RAD = 0.01;
const PITCH_LIMIT_RAD = Math.PI / 2 - PITCH_MARGIN_RAD;
const LOOK_RAD_PER_CELL = 0.03;
const CELL_WIDTH_PER_HEIGHT = 0.5;
const GRID_SPACING = 5;

const formatCompact = (num: number): string => {
    const abs = Math.abs(num);
    const sign = num < 0 ? '-' : '';
    const units: [number, string][] = [
        [1e12, 'T'],
        [1e9, 'B'],
        [1e6, 'M'],
        [1e3, 'k'],
    ];

    for (let i = 0; i < units.length; i++) {
        const [value, suffix] = units[i];
        if (abs >= value) {
            let scaled = Number((abs / value).toPrecision(COMPACT_DIGITS));

            if (scaled >= UNIT_STEP && i > 0) {
                const [nextValue, nextSuffix] = units[i - 1];
                scaled = Number((abs / nextValue).toPrecision(COMPACT_DIGITS));
                return `${sign}${scaled}${nextSuffix}`;
            }
            return `${sign}${scaled}${suffix}`;
        }
    }
    return `${sign}${abs}`;
}

class SceneStats extends Resource {
    public sourceTriangles = 0;
}

export function setupDemo3d(world: DebugWorld, host: Demo3dHost): void {
    const sceneStats = world.resources.getOrCreate(SceneStats);
    const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer()
    const platform = world.platform;


    const cameraEntity = buffer.createEntity("cameraEntity", [new Camera(), new LocalToWorld(), new RenderBounds()]);
    const camPos = buffer.addTrackedComponent(cameraEntity, new LocalPosition(0, 0, -10));
    const camRot = buffer.addTrackedComponent(cameraEntity, new LocalRotation());
    const fov = buffer.addTrackedComponent(cameraEntity, new FieldOfView());

    const settingsEntity = buffer.createEntity("renderSettings", [new CellRenderSettings()]);
    const renderSettings = buffer.addTrackedComponent(settingsEntity, new MeshCellPassSettings());

    const sunEntity = buffer.createEntity("sun", [new DirectionalLight(0xFFF4E0, 0.9), new LocalToWorld(), new LocalPosition()]);
    const sunRotation = buffer.addTrackedComponent(sunEntity, new LocalRotation());
    const sunEuler: Vec3 = Vec.alloc3(0.7, -0.6, 0);

    const lampEntity = buffer.createEntity("lamp", [new PointLight(14, 0x4FA3F7, 1.2), new LocalToWorld(), new LocalPosition(3, 2, -4)]);

    const ambientEntity = buffer.createEntity("ambient", [new AmbientLight(0xFFFFFF, 0.12)]);

    let lightsEnabled = true;
    let lampEnabled = true;

    interface LoadedModel {
        mesh: Mesh;
        color: number;
        faceCulling: FaceCulling;
    }

    interface ModelSlot {
        model: DemoModel;
        index: number;
        loaded?: LoadedModel;
    }

    interface ModelDownload {
        loadedBytes: number;
        totalBytes: number;
        queuedSpawns: number;
        failure?: string;
    }

    let models: ModelSlot[] = [];
    const downloads = new Map<string, ModelDownload>();
    let previewText = "";

    let selectedMeshIndex = 0;

    interface SpawnedModel {
        entity: ReturnType<typeof buffer.createEntity>;
        position: LocalPosition;
        rotation: LocalRotation;
        scale: LocalScale;
    }

    const spawned: SpawnedModel[] = [];

    const groupEuler: Vec3 = Vec.alloc3(0, 0, 0);
    let groupScale: Vec3 = Vec.alloc3(1, 1, 1);

    let camYaw = 0;
    let camPitch = 0;
    const camEulerScratch: Vec3 = Vec.alloc3();
    let camQuat = Quaternions.eulerToQuat(Vec.alloc3(0, 0, 0));

    const previewAnchor = new ScreenAnchor();
    previewAnchor.anchorPosition = 'bottom-right';
    const previewEntity = buffer.createEntity("spawnPreview", [new HudElement(), previewAnchor]);
    const previewImage = buffer.addTrackedComponent(previewEntity, new TextSprite());
    previewImage.transparentChar = undefined;

    const controlsAnchor = new ScreenAnchor();
    controlsAnchor.anchorPosition = 'top-left';
    const controlsEntity = buffer.createEntity("controls", [new HudElement(), controlsAnchor]);
    const controlsImage = buffer.addTrackedComponent(controlsEntity, new TextSprite());
    controlsImage.transparentChar = undefined;
    controlsImage.image = [
        Ansi.colors.fg.cyan + 'camera  wasd move  q/e down/up  drag look  wheel z/x fov  esc quit',
        Ansi.colors.fg.cyan + 'models  space spawn  bksp despawn  n next  r reload  arrows rotate  [ ] scale',
        Ansi.colors.fg.cyan + 'render  1-4 aa  b halfblock  t textures  f lod  - = detail  v 3d  tab hud  g order',
        Ansi.colors.fg.cyan + 'lights  h all  p lamp  i/k j/l sun',
    ];

    const namedColors: Record<string, number> = {
        "bugatti": 0x4FA3F7,
        "cube": 0xF7F14F,
        "blender_monkey": 0xF7A44F,
        "indoor plant_02": 0x66C96A,
    };
    const palette = [0xF7F14F, 0xE05DD8, 0x5DE0C8, 0xE0645D];
    const untintedWhite = 0xFFFFFF;
    const doubleSidedModels = new Set(["bugatti"]);

    const loadModel = (model: DemoModel, index: number): LoadedModel => {
        const mesh = Mesh.fromFile(model.path, {files: platform.files, inflate: platform.inflate});
        const textured = mesh.materials.some(material => material.diffuseTexture !== undefined);
        return {
            mesh,
            color: textured ? untintedWhite : namedColors[model.name] ?? palette[index % palette.length],
            faceCulling: doubleSidedModels.has(model.name) ? FaceCulling.None : FaceCulling.BackFaces,
        };
    }

    const isReady = (model: DemoModel) => host.modelFiles?.ready(model) ?? true;

    const fetchModels = () => {
        models = host.listModels().map((model, index) => ({
            model,
            index,
            loaded: isReady(model) ? loadModel(model, index) : undefined,
        }));
        if (selectedMeshIndex >= models.length) selectedMeshIndex = 0;
        if (models.length > 0) downloadUnlessLoaded(models[selectedMeshIndex]);
        updatePreview();
    }

    const downloadUnlessLoaded = (slot: ModelSlot): ModelDownload | undefined => {
        const modelFiles = host.modelFiles;
        if (slot.loaded !== undefined || modelFiles === undefined) return undefined;
        const path = slot.model.path;
        const running = downloads.get(path);
        if (running !== undefined && running.failure === undefined) return running;
        const started: ModelDownload = {loadedBytes: 0, totalBytes: 0, queuedSpawns: 0};
        downloads.set(path, started);
        modelFiles.fetch(slot.model, (loadedBytes, totalBytes) => {
            started.loadedBytes = loadedBytes;
            started.totalBytes = totalBytes;
            updatePreview();
        }).then(() => {
            const current = models.find(candidate => candidate.model.path === path);
            if (current !== undefined) {
                current.loaded ??= loadModel(current.model, current.index);
                for (let i = 0; i < started.queuedSpawns; i++) spawn(current.loaded);
            }
            downloads.delete(path);
            updatePreview();
        }).catch(error => {
            started.failure = error instanceof Error ? error.message : String(error);
            console.error(`Could not load ${slot.model.name}:`, error);
            updatePreview();
        });
        return started;
    }

    const megabytes = (bytes: number) => (bytes / BYTES_PER_MB).toFixed(1);

    const downloadLine = (name: string, progress: ModelDownload) => {
        if (progress.failure !== undefined) return `Could not load ${name}: ${progress.failure}`;
        const queued = progress.queuedSpawns === 0 ? '' : `, ${progress.queuedSpawns} to spawn`;
        return `Loading ${name}... ${megabytes(progress.loadedBytes)} / ${megabytes(progress.totalBytes)} MB${queued}`;
    }

    const updatePreview = () => {
        const lines = [...downloads].map(([path, progress]) =>
            downloadLine(models.find(slot => slot.model.path === path)?.model.name ?? path, progress) + ' ');
        if (models.length == 0) {
            lines.push('no meshes found, add an obj file in the same folder as this file and press r'
                + '  [spawned: ' + spawned.length + '] ');
        } else {
            lines.push('Next: ' + models[selectedMeshIndex].model.name
                + '  [spawned: ' + spawned.length + '] ');
        }
        const text = lines.join('\n');
        if (text === previewText) return;
        previewText = text;
        previewImage.image = lines.map(line => Ansi.colors.fg.cyan + line);
    }

    const relayoutInGrid = () => {
        const n = spawned.length;
        if (n === 0) return;

        const sx = Math.ceil(Math.cbrt(n));
        const sy = Math.ceil(Math.sqrt(n / sx));
        const sz = Math.ceil(n / (sx * sy));

        spawned.forEach((s, i) => {
            const x = i % sx;
            const y = Math.floor(i / sx) % sy;
            const z = Math.floor(i / (sx * sy));

            s.position.x = (x - (sx - 1) / 2) * GRID_SPACING;
            s.position.y = (y - (sy - 1) / 2) * GRID_SPACING;
            s.position.z = (z - (sz - 1) / 2) * GRID_SPACING;
        });
    }

    const spawnSelected = () => {
        const slot = models[selectedMeshIndex];
        if (slot === undefined) return;
        if (slot.loaded !== undefined) {
            spawn(slot.loaded);
            return;
        }
        const pending = downloadUnlessLoaded(slot);
        if (pending !== undefined) pending.queuedSpawns++;
        updatePreview();
    }

    const spawn = (model: LoadedModel) => {
        const renderMesh = new RenderMesh(model.mesh, model.color);
        renderMesh.faceCulling = model.faceCulling;
        const entity = buffer.createEntity(undefined, [renderMesh, new LocalToWorld()]);
        const position = buffer.addTrackedComponent(entity, new LocalPosition());
        const rotation = buffer.addTrackedComponent(entity, new LocalRotation());
        const scale = buffer.addTrackedComponent(entity, new LocalScale());

        rotation.xyzw = Quaternions.eulerToQuat(groupEuler);
        scale.xyz = groupScale;

        spawned.push({entity, position, rotation, scale});
        sceneStats.sourceTriangles += model.mesh.triangleCount;
        relayoutInGrid();
        updatePreview();
    }

    const despawnLast = () => {
        const last = spawned.pop();
        if (!last) return;
        buffer.destroyEntity(last.entity);
        const renderMesh = world.entityManager.getComponent(last.entity, RenderMesh) as RenderMesh;
        sceneStats.sourceTriangles -= renderMesh.mesh!.triangleCount;
        relayoutInGrid();
        updatePreview();
    }


    const applyGroupRotation = () => {
        const quat = Quaternions.eulerToQuat(groupEuler);
        for (const s of spawned) {
            s.rotation.xyzw = quat;
        }
    }

    const applySunRotation = () => {
        sunRotation.xyzw = Quaternions.eulerToQuat(sunEuler);
    }
    applySunRotation();

    const applyLightEnabledState = () => {
        buffer.setEnabledState(sunEntity, lightsEnabled);
        buffer.setEnabledState(ambientEntity, lightsEnabled);
        buffer.setEnabledState(lampEntity, lightsEnabled && lampEnabled);
    }

    const scaleFactor: Vec3 = Vec.alloc3(SCALE_STEP, SCALE_STEP, SCALE_STEP);

    const applyGroupScale = () => {
        for (const s of spawned) {
            s.scale.xyz = groupScale;
        }
    }

    const applyCameraLook = () => {
        camPitch = Math.max(-PITCH_LIMIT_RAD, Math.min(PITCH_LIMIT_RAD, camPitch));
        camQuat = Quaternions.eulerToQuat(Vec.set3(camEulerScratch, camPitch, camYaw, 0));
        camRot.xyzw = camQuat;
    }

    const DIR_FWD: ReadonlyVec3 = Vec.alloc3(0, 0, 1);
    const DIR_RIGHT: ReadonlyVec3 = Vec.alloc3(1, 0, 0);
    const rotateScratch: Vec3 = Vec.alloc3();

    const rotateByQuat = (q: ReadonlyVec4, v: ReadonlyVec3): Vec3 => {
        const x = Vec.x(q), y = Vec.y(q), z = Vec.z(q), w = Vec.w(q);
        const vx = Vec.x(v), vy = Vec.y(v), vz = Vec.z(v);
        const tx = 2 * (y * vz - z * vy);
        const ty = 2 * (z * vx - x * vz);
        const tz = 2 * (x * vy - y * vx);
        return Vec.set3(rotateScratch,
            vx + w * tx + (y * tz - z * ty),
            vy + w * ty + (z * tx - x * tz),
            vz + w * tz + (x * ty - y * tx),
        );
    }

    const moveCameraLocal = (localDir: ReadonlyVec3, amount: number) => {
        const d = rotateByQuat(camQuat, localDir);
        const dx = Vec.x(d), dy = Vec.y(d), dz = Vec.z(d);
        camPos.x += dx * amount;
        camPos.y += dy * amount;
        camPos.z += dz * amount;
    }

    const enableInputAndQuitKeys = () => {
        input.enable({terminal: host.terminal, platform, mouse: true, hideCursor: true})

        const quit = () => {
            const renderer = world.tryGetSystem(RenderingSystemGroup);
            if (renderer) renderer.enabled = false;
            world.stop();
            input.disable();
            host.quit();
        }
        input.onKeyMatch({name: 'c', ctrl: true}, quit)
        input.whenKeyDown(Key.Escape, quit)
    }

    const registerSpawnKeys = () => {
        input.whenKeyDown(Key.Space, () => spawnSelected())
        input.whenKeyDown(Key.Backspace, () => despawnLast())
        input.whenKeyDown(Key.N, () => {
            if (models.length === 0) return;
            selectedMeshIndex = (selectedMeshIndex + 1) % models.length;
            downloadUnlessLoaded(models[selectedMeshIndex]);
            updatePreview();
        })
        input.whenKeyDown(Key.R, () => fetchModels())
    }

    const registerMovementKeys = () => {
        input.whenKey(Key.W, () => moveCameraLocal(DIR_FWD, MOVE_STEP))
        input.whenKey(Key.S, () => moveCameraLocal(DIR_FWD, -MOVE_STEP))
        input.whenKey(Key.D, () => moveCameraLocal(DIR_RIGHT, MOVE_STEP))
        input.whenKey(Key.A, () => moveCameraLocal(DIR_RIGHT, -MOVE_STEP))
        input.whenKey(Key.Q, () => {
            camPos.y -= MOVE_STEP;
        })
        input.whenKey(Key.E, () => {
            camPos.y += MOVE_STEP;
        })
    }

    const registerModelRotationKeys = () => {
        input.whenKey(Key.Up, () => {
            Vec.setX(groupEuler, Vec.x(groupEuler) + MODEL_ROTATE_STEP_RAD);
            applyGroupRotation();
        })
        input.whenKey(Key.Down, () => {
            Vec.setX(groupEuler, Vec.x(groupEuler) - MODEL_ROTATE_STEP_RAD);
            applyGroupRotation();
        })
        input.whenKey(Key.Left, () => {
            Vec.setY(groupEuler, Vec.y(groupEuler) - MODEL_ROTATE_STEP_RAD);
            applyGroupRotation();
        })
        input.whenKey(Key.Right, () => {
            Vec.setY(groupEuler, Vec.y(groupEuler) + MODEL_ROTATE_STEP_RAD);
            applyGroupRotation();
        })
    }

    const registerModelScaleKeys = () => {
        input.whenKey('[', () => {
            Vec.divInto(groupScale, groupScale, scaleFactor);
            applyGroupScale();
        })
        input.whenKey(']', () => {
            Vec.mulInto(groupScale, groupScale, scaleFactor);
            applyGroupScale();
        })
    }

    const registerFovKeys = () => {
        input.whenKey(Key.Z, () => {
            fov.degrees /= FOV_KEY_STEP;
        })
        input.whenKey(Key.X, () => {
            fov.degrees *= FOV_KEY_STEP;
        })
    }

    const registerRenderToggleKeys = () => {
        input.whenKeyDown(Key.V, () => {
            const renderer = world.tryGetSystem(MeshCellPassSystem);
            if (renderer) renderer.enabled = !renderer.enabled;
        })
        input.whenKeyDown(Key.Tab, () => {
            const renderer = world.tryGetSystem(HudTextSpriteCellPassSystem);
            if (renderer) renderer.enabled = !renderer.enabled;
        })
        input.whenKeyDown(Key.G, () => world.logSystemUpdateOrder())
        input.whenKeyDown(Key.T, () => {
            renderSettings.textures = !renderSettings.textures;
        })
        input.whenKeyDown(Key.B, () => {
            renderSettings.halfBlockCells = !renderSettings.halfBlockCells;
        })
        input.whenKeyDown(Key.F, () => {
            renderSettings.lod = !renderSettings.lod;
        })
        input.whenKeyDown('-', () => {
            renderSettings.lodBias += 1;
        })
        input.whenKeyDown('=', () => {
            renderSettings.lodBias -= 1;
        })
        const supersamplePresets: [Key, number, number][] = [[Key.Num1, 1, 1], [Key.Num2, 2, 2], [Key.Num3, 2, 4], [Key.Num4, 4, 4]];
        for (const [key, x, y] of supersamplePresets) {
            input.whenKeyDown(key, () => {
                renderSettings.supersampleX = x;
                renderSettings.supersampleY = y;
            })
        }
    }

    const registerLightingKeys = () => {
        input.whenKey(Key.I, () => {
            Vec.setX(sunEuler, Vec.x(sunEuler) + SUN_ROTATE_STEP_RAD);
            applySunRotation();
        })
        input.whenKey(Key.K, () => {
            Vec.setX(sunEuler, Vec.x(sunEuler) - SUN_ROTATE_STEP_RAD);
            applySunRotation();
        })
        input.whenKey(Key.J, () => {
            Vec.setY(sunEuler, Vec.y(sunEuler) - SUN_ROTATE_STEP_RAD);
            applySunRotation();
        })
        input.whenKey(Key.L, () => {
            Vec.setY(sunEuler, Vec.y(sunEuler) + SUN_ROTATE_STEP_RAD);
            applySunRotation();
        })
        input.whenKeyDown(Key.H, () => {
            lightsEnabled = !lightsEnabled;
            applyLightEnabledState();
        })
        input.whenKeyDown(Key.P, () => {
            lampEnabled = !lampEnabled;
            applyLightEnabledState();
        })
    }

    const registerMouseLook = () => {
        let lastX = 0;
        let lastY = 0;
        let looking = false;

        input.onMouseDown.add((e) => {
            if (e.button !== 'left') return;
            looking = true;
            lastX = e.x;
            lastY = e.y;
        })
        input.onMouseUp.add((e) => {
            if (e.button === 'left') looking = false;
        })
        input.onMouseMove.add((e) => {
            if (!looking) return;
            const dx = e.x - lastX;
            const dy = e.y - lastY;
            lastX = e.x;
            lastY = e.y;
            camYaw += dx * LOOK_RAD_PER_CELL;
            camPitch += dy * LOOK_RAD_PER_CELL * CELL_WIDTH_PER_HEIGHT;
            applyCameraLook();
        })
    }

    const registerWheelZoom = () => {
        input.onWheel.add((e) => {
            const factor = e.button === 'wheelUp' ? 1 / FOV_WHEEL_STEP : FOV_WHEEL_STEP;
            fov.degrees = Math.max(MIN_FOV_DEG, Math.min(MAX_FOV_DEG, fov.degrees * factor));
        })
    }

    enableInputAndQuitKeys();
    registerSpawnKeys();
    registerMovementKeys();
    registerModelRotationKeys();
    registerModelScaleKeys();
    registerFovKeys();
    registerRenderToggleKeys();
    registerLightingKeys();
    registerMouseLook();
    registerWheelZoom();
    fetchModels();
    spawnSelected();

    world.ensureSystemExists(MeshCellPassSystem);
    world.ensureSystemExists(HudTextSpriteCellPassSystem);

    world.ensureSystemExists(DebugSystem)
}

class DebugSystem extends System {
    private _toggle = true;
    private _fpsCounter = new AverageStat(FPS_AVERAGE_FRAMES)
    private _entityCounterImage!: TextSprite;
    private _fpsCounterImage!: TextSprite;

    protected onCreate() {
        const buffer = this.world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer()


        this._entityCounterImage = createHudLabel(buffer, "entityCounter", Ansi.colors.fg.green + 'HUD element', 'bottom-left');
        this._fpsCounterImage = createHudLabel(buffer, "fpsCounter", Ansi.colors.fg.green + 'FPS: 0', 'top-right');
    }

    onUpdate() {
        if (!this._toggle) return;
        this._fpsCounter.add(MS_PER_SECOND / this.world.time.deltaTime)
        this._fpsCounterImage.image = [
            Ansi.colors.fg.green + 'FPS: ' + this._fpsCounter.getAvg().toFixed(2),
        ]

        const pass = this.world.tryGetSystem(MeshCellPassSystem);
        const drawn = pass === undefined ? 0 : pass.trianglesDrawn;
        const levels = pass === undefined ? '' : '  LOD levels: ' + Array.from(pass.lodLevelCounts.subarray(0, LOD_LEVELS_SHOWN)).join('/');
        const rasterWorkers = pass === undefined ? 0 : pass.rasterWorkers;
        this._entityCounterImage.image = [
            Ansi.colors.fg.green + 'Entities: ' + (this.world.entityCount),
            Ansi.colors.fg.green + 'Triangles: ' + formatCompact(drawn) + ' drawn / ' + formatCompact(this.world.resources.getOrCreate(SceneStats).sourceTriangles) + ' source' + levels,
            Ansi.colors.fg.green + 'Raster workers: ' + (rasterWorkers === 0 ? 'none (single-threaded)' : rasterWorkers),
        ]
    }
}
