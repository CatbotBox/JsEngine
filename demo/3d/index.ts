import {
    EntityCommandBufferSystem,
    System,
    DebugWorld
} from "../../src/js_engine";
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

const world = new DebugWorld();
const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer()


// Setup
{
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
    let meshes: { name: string, mesh: Mesh, color: number, faceCulling: FaceCulling }[] = [];


    let selectedMeshIndex = 0;
    let totalTriCount = 0;

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
        Ansi.colors.fg.cyan + 'wasd/qe move  arrows rotate  i/o scale  z/x fov',
        Ansi.colors.fg.cyan + 'drag: look   scroll: zoom',
        Ansi.colors.fg.cyan + 'space spawn  bksp despawn  n next  r reload  ^C quit',
        Ansi.colors.fg.cyan + 'j/l u/m sun   h lights   p lamp   t textures   b halfblock   1-4 aa   v 3d   tab hud',
    ];
    buffer.addComponent(controlsEntity, new HudElement());
    const controlsAnchor = new ConsoleImageAnchor();
    controlsAnchor.anchorPosition = 'top-left';
    buffer.addComponent(controlsEntity, controlsAnchor);

    // Functions
    const fetchModels = () => {
        const fs = require("fs") as typeof import("fs");
        const folders = ["./demo/3d/", "./"].filter(folder => fs.existsSync(folder));
        const files: {
            path: string,
            name: string
        }[] = folders.map(folder => fs.readdirSync(folder).filter(file => file.endsWith(".obj")).map(file => {
            const data = file.split(".");
            return {
                name: data[0],
                path: folder + data[0] + "." + data[1]
            }
        })).flat();
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
        meshes = files.map((file, index) => {
            const mesh = Mesh.fromFile(file.path);
            const textured = mesh.materials.some(material => material.diffuseTexture !== undefined);
            return {
                name: file.name,
                mesh,
                color: textured ? untintedWhite : namedColors[file.name] ?? palette[index % palette.length],
                faceCulling: doubleSidedModels.has(file.name) ? FaceCulling.None : FaceCulling.BackFaces,
            };
        });
        // keep the selection valid if the list shrank
        if (selectedMeshIndex >= meshes.length) selectedMeshIndex = 0;
        updatePreview();
    }

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

    const updatePreview = () => {
        if (meshes.length == 0) {
            previewImage.image = [
                Ansi.colors.fg.cyan + 'no meshes found, add an obj file in the same folder as this file and press r'
                + '  [spawned: ' + spawned.length + '] ', //add space for padding
            ];
            return;
        }
        previewImage.image = [
            Ansi.colors.fg.cyan + 'Next: ' + meshes[selectedMeshIndex].name
            + '  [spawned: ' + spawned.length + '] ', //add space for padding
            formatCompact(totalTriCount) + ' triangles'
        ];
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

    const spawnModel = () => {
        if (meshes.length == 0) return;
        const entity = buffer.createEntity();
        const model = meshes[selectedMeshIndex];
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
        totalTriCount += meshes[selectedMeshIndex].mesh.triangleCount;
        relayout();
        updatePreview();
    }

    const despawnLast = () => {
        const last = spawned.pop();
        if (!last) return;
        buffer.destroyEntity(last.entity);
        const renderMesh = world.entityManager.getComponent(last.entity, RenderMesh) as RenderMesh;
        totalTriCount -= renderMesh.mesh!.triangleCount;
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
        input.enable({mouse: true, hideCursor: true})

        // Ctrl+C: the input system no longer force-quits, so we own shutdown here.
        // (Raw mode has no auto-SIGINT — without a handler like this, Ctrl+C does
        //  nothing, so keep some exit path registered.)
        input.onKeyMatch({name: 'c', ctrl: true}, () => {
            const renderer = world.tryGetSystem(RenderingSystemGroup);
            if (renderer) renderer.enabled = false;
            world.stop();
            input.disable();
            process.exit(0);
        })

        // ---- spawning ----
        // space: spawn a new model | backspace: remove the last one
        // n: cycle which model spawns next | r: reload model list
        input.whenKeyDown(Key.Space, () => spawnModel())
        input.whenKeyDown(Key.Backspace, () => despawnLast())
        input.whenKeyDown(Key.N, () => {
            if (meshes.length === 0) return;
            selectedMeshIndex = (selectedMeshIndex + 1) % meshes.length;
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

        // ---- model scale (i/o) ----
        input.whenKey(Key.I, () => {
            Vec.divInto(currentScale, currentScale, scaleFactor);
            applyScale();
        })
        input.whenKey(Key.O, () => {
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
        const supersamplePresets: [Key, number, number][] = [[Key.Num1, 1, 1], [Key.Num2, 2, 2], [Key.Num3, 2, 4], [Key.Num4, 4, 4]];
        for (const [key, x, y] of supersamplePresets) {
            input.whenKeyDown(key, () => {
                renderSettings.supersampleX = x;
                renderSettings.supersampleY = y;
            })
        }

        // ---- lighting ----
        // j/l: sun yaw | u/m: sun pitch | h: all lights on/off | p: point light on/off
        input.whenKey(Key.J, () => {
            Vec.setY(sunEuler, Vec.y(sunEuler) - 0.05);
            applySunRotation();
        })
        input.whenKey(Key.L, () => {
            Vec.setY(sunEuler, Vec.y(sunEuler) + 0.05);
            applySunRotation();
        })
        input.whenKey(Key.U, () => {
            Vec.setX(sunEuler, Vec.x(sunEuler) + 0.05);
            applySunRotation();
        })
        input.whenKey(Key.M, () => {
            Vec.setX(sunEuler, Vec.x(sunEuler) - 0.05);
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
    spawnModel();
}

//systems
class DebugSystem extends System {
    private _toggle = true;
    private _fpsCounter = new AverageStat(10)
    private _entityCounterImage!: ConsoleImage;
    private _fpsCounterImage!: ConsoleImage;

    protected onCreate() {
        const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer()


        this._entityCounterImage = createHudLabel(buffer, "entityCounter", Ansi.colors.fg.green + 'HUD element', 'bottom-left');
        this._fpsCounterImage = createHudLabel(buffer, "fpsCounter", Ansi.colors.fg.green + 'FPS: 0', 'top-right');
    }

    onUpdate() {
        if (!this._toggle) return;
        this._fpsCounter.add(1000 / this.world.time.deltaTime)
        this._fpsCounterImage.image = [
            Ansi.colors.fg.green + 'FPS: ' + this._fpsCounter.getAvg().toFixed(2),
        ]

        this._entityCounterImage.image = [
            Ansi.colors.fg.green + 'Entities: ' + (this.world.entityCount),
        ]
    }
}


world.ensureSystemExists(Console3DRenderPassSystem);
world.ensureSystemExists(ConsoleHudRenderPassSystem);

world.ensureSystemExists(DebugSystem)

world.startLoop()