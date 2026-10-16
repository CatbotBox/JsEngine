import {
    EntityCommandBufferSystem,
    System,
    DebugWorld,
    Resource
} from "../../src/js_engine/core";
import {consoleInput as input, Key} from "../../src/js_engine/input";

import {Camera, HudElement, RenderBounds, RenderingSystemGroup} from "../../src/js_engine/rendering";

import {LocalPosition, LocalRotation, LocalScale, LocalToWorld} from "../../src/js_engine/translation";

import {
    Ansi,
    ConsoleHudRenderPassSystem,
    ConsoleImage,
    ConsoleImageAnchor,

} from "../../src/js_engine/rendering/console";

import {AverageStat} from "../../src/js_engine/datatypes";
import {Console3DRenderPassSystem, Console3DRenderSettings} from "../../src/js_engine/rendering/console/3d";
import {ConsoleRenderSettings} from "../../src/js_engine/rendering/console";
import {
    AmbientLight,
    DirectionalLight,
    FaceCulling,
    FieldOfView,
    Mesh,
    PointLight,
    RenderMesh
} from "../../src/js_engine/rendering/3d";
import {ReadonlyVec3, ReadonlyVec4, Vec, Vec3} from "../../src/js_engine/math/types/vec";
import {Quaternions} from "../../src/js_engine/math/quaternions";
import {createHudLabel} from "../_shared/hud";

/** A model the demo can spawn: an obj path the world's platform files can read. */
export interface DemoModel {
    readonly name: string;
    readonly path: string;
}

/** For a host whose model files are not all readable up front (a page fetching large models on demand). */
export interface DemoModelFiles {
    /** True once every file loading `model` reads can be read synchronously. */
    ready(model: DemoModel): boolean;
    /** Fetches `model`'s files, reporting transferred bytes as they arrive; resolves once `ready(model)`. */
    fetch(model: DemoModel, onProgress: (loadedBytes: number, totalBytes: number) => void): Promise<void>;
}

/** What differs between the terminal and the browser. */
export interface Demo3dHost {
    /** The models to offer; asked again on every reload (r). */
    listModels(): readonly DemoModel[];
    /**
     * Absent: every listed model loads straight away, as from disk. Present: a model that is not
     * ready is fetched when it is selected or spawned, and spawns once it has arrived.
     */
    readonly modelFiles?: DemoModelFiles;
    /** Ctrl+C or Escape, after the world has stopped and input is disabled. */
    quit(): void;
}

const MB = 1024 * 1024;

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
            let scaled = Number((abs / value).toPrecision(3));

            // rounding can push e.g. 999.5k -> 1000k; bump to next unit up
            if (scaled >= 1000 && i > 0) {
                const [nextValue, nextSuffix] = units[i - 1];
                scaled = Number((abs / nextValue).toPrecision(3));
                return `${sign}${scaled}${nextSuffix}`;
            }
            return `${sign}${scaled}${suffix}`;
        }
    }
    return `${sign}${abs}`;
}

/** Source geometry currently in the scene, kept by the spawn/despawn code; the HUD shows it against what the pass drew. */
class SceneStats extends Resource {
    public sourceTriangles = 0;
}

/**
 * Builds the 3D demo into `world`: loads the host's models through the world's platform files,
 * enables input on its platform and registers the demo's systems. The host starts the loop.
 */
export function setupDemo3d(world: DebugWorld, host: Demo3dHost): void {
    const sceneStats = world.resources.getOrCreate(SceneStats);
    const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer()
    const platform = world.platform;


    //Camera
    const cameraEntity = buffer.createEntity("cameraEntity");

    buffer.addComponent(cameraEntity, new Camera());
    buffer.addComponent(cameraEntity, new LocalToWorld());
    const camPos = buffer.addTrackedComponent(cameraEntity, new LocalPosition(0, 0, -10));
    buffer.addComponent(cameraEntity, new RenderBounds());
    const camRot = buffer.addTrackedComponent(cameraEntity, new LocalRotation());
    const fov = buffer.addTrackedComponent(cameraEntity, new FieldOfView());

    //Render settings (singleton entities; the 3D pass is off until this exists)
    const settingsEntity = buffer.createEntity("renderSettings");
    const renderSettings = buffer.addTrackedComponent(settingsEntity, new Console3DRenderSettings());
    buffer.addComponent(settingsEntity, new ConsoleRenderSettings());

    //Lights
    const sunEntity = buffer.createEntity("sun");
    buffer.addComponent(sunEntity, new DirectionalLight(0xFFF4E0, 0.9));
    buffer.addComponent(sunEntity, new LocalToWorld());
    buffer.addComponent(sunEntity, new LocalPosition());
    const sunRotation = buffer.addTrackedComponent(sunEntity, new LocalRotation());
    const sunEuler: Vec3 = Vec.alloc3(0.7, -0.6, 0);

    const lampEntity = buffer.createEntity("lamp");
    buffer.addComponent(lampEntity, new PointLight(14, 0x4FA3F7, 1.2));
    buffer.addComponent(lampEntity, new LocalToWorld());
    buffer.addComponent(lampEntity, new LocalPosition(3, 2, -4));

    const ambientEntity = buffer.createEntity("ambient");
    buffer.addComponent(ambientEntity, new AmbientLight(0xFFFFFF, 0.12));

    let lightsEnabled = true;
    let lampEnabled = true;

    //Meshes
    interface LoadedModel {
        mesh: Mesh;
        color: number;
        faceCulling: FaceCulling;
    }

    interface ModelSlot {
        model: DemoModel;
        index: number;
        /** Undefined while the host is still fetching the model's files. */
        loaded?: LoadedModel;
    }

    /** A model the host is fetching, or failed to; kept by path across reloads (r). */
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

    // Rendering Transforms
    // Shared transform state so new spawns match the rest of the group
    const euler: Vec3 = Vec.alloc3(0, 0, 0);
    let currentScale: Vec3 = Vec.alloc3(1, 1, 1);
    const spacing = 5;

    // Camera look state (driven by the mouse — see registerInputs)
    let camYaw = 0;
    let camPitch = 0;
    const camEulerScratch: Vec3 = Vec.alloc3();
    // Current look orientation as a quaternion; movement is rotated by this so
    // "forward" follows where the camera is pointing.
    let camQuat = Quaternions.eulerToQuat(Vec.alloc3(0, 0, 0));

    // Preview HUD (bottom-right corner) showing the model that will be spawned next
    const previewEntity = buffer.createEntity("spawnPreview");
    const previewImage = buffer.addTrackedComponent(previewEntity, new ConsoleImage());
    previewImage.transparentChar = undefined;
    buffer.addComponent(previewEntity, new HudElement());
    const previewAnchor = new ConsoleImageAnchor();
    previewAnchor.anchorPosition = 'bottom-right';
    buffer.addComponent(previewEntity, previewAnchor);

    // Controls legend (top-left corner)
    const controlsEntity = buffer.createEntity("controls");
    const controlsImage = buffer.addTrackedComponent(controlsEntity, new ConsoleImage());
    controlsImage.transparentChar = undefined;
    controlsImage.image = [
        Ansi.colors.fg.cyan + 'camera  wasd move  q/e down/up  drag look  wheel z/x fov  esc quit',
        Ansi.colors.fg.cyan + 'models  space spawn  bksp despawn  n next  r reload  arrows rotate  [ ] scale',
        Ansi.colors.fg.cyan + 'render  1-4 aa  b halfblock  t textures  f lod  - = detail  v 3d  tab hud  g order',
        Ansi.colors.fg.cyan + 'lights  h all  p lamp  i/k j/l sun',
    ];
    buffer.addComponent(controlsEntity, new HudElement());
    const controlsAnchor = new ConsoleImageAnchor();
    controlsAnchor.anchorPosition = 'top-left';
    buffer.addComponent(controlsEntity, controlsAnchor);

    // Functions
    // Packed 0xRRGGBB base colors; models not listed here cycle the palette.
    const namedColors: Record<string, number> = {
        "bugatti": 0x4FA3F7,           // blue
        "cube": 0xF7F14F,              // yellow
        "blender_monkey": 0xF7A44F,    // orange
        "indoor plant_02": 0x66C96A,   // green
    };
    const palette = [0xF7F14F, 0xE05DD8, 0x5DE0C8, 0xE0645D];
    const untintedWhite = 0xFFFFFF;
    // Models whose faces are not consistently wound; drawn double-sided.
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
        // keep the selection valid if the list shrank
        if (selectedMeshIndex >= models.length) selectedMeshIndex = 0;
        if (models.length > 0) download(models[selectedMeshIndex]);
        updatePreview();
    }

    /** Starts fetching a slot's model unless it is loaded or already on its way; undefined when loaded. */
    const download = (slot: ModelSlot): ModelDownload | undefined => {
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

    const megabytes = (bytes: number) => (bytes / MB).toFixed(1);

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
                + '  [spawned: ' + spawned.length + '] '); //add space for padding
        } else {
            lines.push('Next: ' + models[selectedMeshIndex].model.name
                + '  [spawned: ' + spawned.length + '] '); //add space for padding
        }
        const text = lines.join('\n');
        if (text === previewText) return;
        previewText = text;
        previewImage.image = lines.map(line => Ansi.colors.fg.cyan + line);
    }

// Re-space all spawned models in a 3D grid, centered on the group offset
    const relayout = () => {
        const n = spawned.length;
        if (n === 0) return;

        // Roughly cubic dimensions
        const sx = Math.ceil(Math.cbrt(n));
        const sy = Math.ceil(Math.sqrt(n / sx));
        const sz = Math.ceil(n / (sx * sy));

        spawned.forEach((s, i) => {
            const x = i % sx;
            const y = Math.floor(i / sx) % sy;
            const z = Math.floor(i / (sx * sy));

            s.position.x = (x - (sx - 1) / 2) * spacing;
            s.position.y = (y - (sy - 1) / 2) * spacing;
            s.position.z = (z - (sz - 1) / 2) * spacing;
        });
    }

    // A model still on its way spawns when it arrives.
    const spawnSelected = () => {
        const slot = models[selectedMeshIndex];
        if (slot === undefined) return;
        if (slot.loaded !== undefined) {
            spawn(slot.loaded);
            return;
        }
        const pending = download(slot);
        if (pending !== undefined) pending.queuedSpawns++;
        updatePreview();
    }

    const spawn = (model: LoadedModel) => {
        const entity = buffer.createEntity();
        const renderMesh = new RenderMesh(model.mesh, model.color);
        renderMesh.faceCulling = model.faceCulling;
        buffer.addComponent(entity, renderMesh);
        buffer.addComponent(entity, new LocalToWorld());
        const position = buffer.addTrackedComponent(entity, new LocalPosition());
        const rotation = buffer.addTrackedComponent(entity, new LocalRotation());
        const scale = buffer.addTrackedComponent(entity, new LocalScale());

        rotation.xyzw = Quaternions.eulerToQuat(euler);
        scale.xyz = currentScale;

        spawned.push({entity, position, rotation, scale});
        sceneStats.sourceTriangles += model.mesh.triangleCount;
        relayout();
        updatePreview();
    }

    const despawnLast = () => {
        const last = spawned.pop();
        if (!last) return;
        buffer.destroyEntity(last.entity);
        const renderMesh = world.entityManager.getComponent(last.entity, RenderMesh) as RenderMesh;
        sceneStats.sourceTriangles -= renderMesh.mesh!.triangleCount;
        relayout();
        updatePreview();
    }


    // arrows: rotate all spawned models together
    const applyRotation = () => {
        const quat = Quaternions.eulerToQuat(euler);
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

    // i/o: scale all spawned models together
    const scaleFactor: Vec3 = Vec.alloc3(1.02, 1.02, 1.02);

    const applyScale = () => {
        for (const s of spawned) {
            s.scale.xyz = currentScale;
        }
    }

    // mouse: rotate the CAMERA (FPS-style look). Pitch is clamped to avoid flipping.
    const applyCameraLook = () => {
        const limit = Math.PI / 2 - 0.01;
        camPitch = Math.max(-limit, Math.min(limit, camPitch));
        camQuat = Quaternions.eulerToQuat(Vec.set3(camEulerScratch, camPitch, camYaw, 0));
        camRot.xyzw = camQuat;
    }

    // Rotate a vector by a quaternion [x,y,z,w] (standard v + 2w(q×v) + 2q×(q×v)).
    // Convention-agnostic: uses the exact quat the engine built, so movement always
    // lines up with the view regardless of eulerToQuat's internal axis order.
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

    // Move the camera along a look-relative axis (forward = +Z, right = +X at rest).
    const moveSpeed = 0.05;
    const moveLocal = (localDir: ReadonlyVec3, amount: number) => {
        const d = rotateByQuat(camQuat, localDir);
        const dx = Vec.x(d), dy = Vec.y(d), dz = Vec.z(d);
        camPos.x += dx * amount;
        camPos.y += dy * amount;
        camPos.z += dz * amount;
    }

    const registerInputs = () => {
        input.enable({platform, mouse: true, hideCursor: true})

        // Ctrl+C / Escape: the input system no longer force-quits, so we own shutdown here.
        // (Raw mode has no auto-SIGINT — without a handler like this, Ctrl+C does
        //  nothing, so keep some exit path registered.)
        const quit = () => {
            const renderer = world.tryGetSystem(RenderingSystemGroup);
            if (renderer) renderer.enabled = false;
            world.stop();
            input.disable();
            host.quit();
        }
        input.onKeyMatch({name: 'c', ctrl: true}, quit)
        input.whenKeyDown(Key.Escape, quit)

        // ---- spawning ----
        // space: spawn a new model | backspace: remove the last one
        // n: cycle which model spawns next | r: reload model list
        input.whenKeyDown(Key.Space, () => spawnSelected())
        input.whenKeyDown(Key.Backspace, () => despawnLast())
        input.whenKeyDown(Key.N, () => {
            if (models.length === 0) return;
            selectedMeshIndex = (selectedMeshIndex + 1) % models.length;
            download(models[selectedMeshIndex]);
            updatePreview();
        })
        input.whenKeyDown(Key.R, () => fetchModels())

        // ---- movement (whenKey = repeats while held) ----
        // wasd moves relative to where the camera is looking; q/e are world up/down
        // w/s: forward/back | a/d: strafe left/right | q/e: down/up
        input.whenKey(Key.W, () => moveLocal(DIR_FWD, moveSpeed))
        input.whenKey(Key.S, () => moveLocal(DIR_FWD, -moveSpeed))
        input.whenKey(Key.D, () => moveLocal(DIR_RIGHT, moveSpeed))
        input.whenKey(Key.A, () => moveLocal(DIR_RIGHT, -moveSpeed))
        input.whenKey(Key.Q, () => {
            camPos.y -= moveSpeed;
        })
        input.whenKey(Key.E, () => {
            camPos.y += moveSpeed;
        })

        // ---- model rotation (arrow keys) ----
        // up/down = pitch, left/right = yaw
        input.whenKey(Key.Up, () => {
            Vec.setX(euler, Vec.x(euler) + 0.1);
            applyRotation();
        })
        input.whenKey(Key.Down, () => {
            Vec.setX(euler, Vec.x(euler) - 0.1);
            applyRotation();
        })
        input.whenKey(Key.Left, () => {
            Vec.setY(euler, Vec.y(euler) - 0.1);
            applyRotation();
        })
        input.whenKey(Key.Right, () => {
            Vec.setY(euler, Vec.y(euler) + 0.1);
            applyRotation();
        })

        // ---- model scale ([ smaller, ] larger) ----
        input.whenKey('[', () => {
            Vec.divInto(currentScale, currentScale, scaleFactor);
            applyScale();
        })
        input.whenKey(']', () => {
            Vec.mulInto(currentScale, currentScale, scaleFactor);
            applyScale();
        })

        // ---- field of view (z/x) ----
        input.whenKey(Key.Z, () => {
            fov.degrees /= 1.01;
        })
        input.whenKey(Key.X, () => {
            fov.degrees *= 1.01;
        })

        // ---- render toggles (once per press) ----
        // 1-4: anti-aliasing presets | b: half-block cells | t: textures
        // f: detail levels on/off | -/=: coarser/finer detail bias
        // v: 3D pass | tab: HUD | g: log system order
        input.whenKeyDown(Key.V, () => {
            const renderer = world.tryGetSystem(Console3DRenderPassSystem);
            if (renderer) renderer.enabled = !renderer.enabled;
        })
        input.whenKeyDown(Key.Tab, () => {
            const renderer = world.tryGetSystem(ConsoleHudRenderPassSystem);
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

        // ---- lighting ----
        // i/k: sun pitch | j/l: sun yaw (the arrow cluster, as arrows rotate the models)
        // h: all lights on/off | p: point light on/off
        input.whenKey(Key.I, () => {
            Vec.setX(sunEuler, Vec.x(sunEuler) + 0.05);
            applySunRotation();
        })
        input.whenKey(Key.K, () => {
            Vec.setX(sunEuler, Vec.x(sunEuler) - 0.05);
            applySunRotation();
        })
        input.whenKey(Key.J, () => {
            Vec.setY(sunEuler, Vec.y(sunEuler) - 0.05);
            applySunRotation();
        })
        input.whenKey(Key.L, () => {
            Vec.setY(sunEuler, Vec.y(sunEuler) + 0.05);
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

        // input.whenKeyDown(Key.Enter, () => {
        //     const renderer = world.tryGetSystem(RenderingSystemGroup);
        //     if (renderer) renderer.enabled = !renderer.enabled;
        // })

        // ---- MOUSE: hold LEFT and drag to rotate the camera ----
        // Terminal coords are absolute cells, so we accumulate deltas ourselves.
        // (Flip the += signs below for inverted look. * 0.5 on pitch compensates
        //  for the ~2:1 height:width aspect of terminal cells.)
        let lastX = 0;
        let lastY = 0;
        let looking = false;
        const sensitivity = 0.03; // radians per cell

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
            camYaw += dx * sensitivity;
            camPitch += dy * sensitivity * 0.5;
            applyCameraLook();
        })

        // ---- MOUSE WHEEL: zoom via field of view ----
        input.onWheel.add((e) => {
            const factor = e.button === 'wheelUp' ? 1 / 1.05 : 1.05;
            fov.degrees = Math.max(10, Math.min(120, fov.degrees * factor));
        })
    }

    registerInputs();
    fetchModels();
    // start with one model on screen
    spawnSelected();

    world.ensureSystemExists(Console3DRenderPassSystem);
    world.ensureSystemExists(ConsoleHudRenderPassSystem);

    world.ensureSystemExists(DebugSystem)
}

//systems
class DebugSystem extends System {
    private _toggle = true;
    private _fpsCounter = new AverageStat(10)
    private _entityCounterImage!: ConsoleImage;
    private _fpsCounterImage!: ConsoleImage;

    protected onCreate() {
        const buffer = this.world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer()


        this._entityCounterImage = createHudLabel(buffer, "entityCounter", Ansi.colors.fg.green + 'HUD element', 'bottom-left');
        this._fpsCounterImage = createHudLabel(buffer, "fpsCounter", Ansi.colors.fg.green + 'FPS: 0', 'top-right');
    }

    onUpdate() {
        if (!this._toggle) return;
        this._fpsCounter.add(1000 / this.world.time.deltaTime)
        this._fpsCounterImage.image = [
            Ansi.colors.fg.green + 'FPS: ' + this._fpsCounter.getAvg().toFixed(2),
        ]

        const pass = this.world.tryGetSystem(Console3DRenderPassSystem);
        const drawn = pass === undefined ? 0 : pass.trianglesDrawn;
        const levels = pass === undefined ? '' : '  LOD levels: ' + Array.from(pass.lodLevelCounts.subarray(0, 5)).join('/');
        const rasterWorkers = pass === undefined ? 0 : pass.rasterWorkers;
        this._entityCounterImage.image = [
            Ansi.colors.fg.green + 'Entities: ' + (this.world.entityCount),
            Ansi.colors.fg.green + 'Triangles: ' + formatCompact(drawn) + ' drawn / ' + formatCompact(this.world.resources.getOrCreate(SceneStats).sourceTriangles) + ' source' + levels,
            Ansi.colors.fg.green + 'Raster workers: ' + (rasterWorkers === 0 ? 'none (single-threaded)' : rasterWorkers),
        ]
    }
}
