import {
    EntityCommandBufferSystem,
    System,
    DebugWorld
} from "../../src/js_engine";
import {keyboardInput} from "../../src/js_engine/input";

import {Camera, HudElement, RenderBounds, RenderingSystemGroup} from "../../src/js_engine/rendering";

import {LocalPosition, LocalRotation, LocalScale, LocalToWorld} from "../../src/js_engine/translation";

import {
    Ansi,
    ConsoleHudRenderPassSystem,
    ConsoleImage,
    ConsoleImageAnchor,

} from "../../src/js_engine/rendering/console";

import {AverageStat} from "../../src/js_engine/datatypes";
import {Console3DRenderPassSystem} from "../../src/js_engine/rendering/console/3d/console3DRenderPassSystem";
import {RenderMesh} from "../../src/js_engine/rendering/3d/renderMesh";
import {Mesh} from "../../src/js_engine/rendering/3d/mesh";
import {Vec, Vec3} from "../../src/js_engine/math/types/vec";
import {Quaternions} from "../../src/js_engine/math/quaternions";
import {FieldOfView} from "../../src/js_engine/rendering/3d/fieldOfView";

const world = new DebugWorld();
const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).createEntityCommandBuffer()


// Setup
{
    //Camera
    const cameraEntity = buffer.createEntity("cameraEntity");

    buffer.addComponent(cameraEntity, new Camera());
    buffer.addComponent(cameraEntity, new LocalToWorld());
    const camPos = buffer.addTrackedComponent(cameraEntity, new LocalPosition(0, 0, -10));
    buffer.addComponent(cameraEntity, new RenderBounds());
    buffer.addTrackedComponent(cameraEntity, new LocalRotation());
    const fov = buffer.addTrackedComponent(cameraEntity, new FieldOfView());

    //Meshes
    let meshes: { name: string, mesh: Mesh, color: number }[] = [];


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
    const euler: Vec3 = [0, 0, 0];
    let currentScale: Vec3 = [1, 1, 1];
    const spacing = 5;

    // Preview HUD (bottom-right corner) showing the model that will be spawned next
    const previewEntity = buffer.createEntity("spawnPreview");
    const previewImage = buffer.addTrackedComponent(previewEntity, new ConsoleImage());
    previewImage.transparentChar = undefined;
    buffer.addComponent(previewEntity, new HudElement());
    const previewAnchor = new ConsoleImageAnchor();
    previewAnchor.anchorPosition = 'bottom-right';
    buffer.addComponent(previewEntity, previewAnchor);

    // Functions
    const fetchModels = () => {
        const fs = require("fs");
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
        meshes = files.map((file, index) => ({
            name: file.name,
            mesh: Mesh.fromFile(file.path),
            color: namedColors[file.name] ?? palette[index % palette.length],
        }));
        updatePreview();
    }

    function formatCompact(num: number): string {
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
        buffer.addComponent(entity, new RenderMesh(meshes[selectedMeshIndex].mesh, meshes[selectedMeshIndex].color));
        buffer.addComponent(entity, new LocalToWorld());
        const position = buffer.addTrackedComponent(entity, new LocalPosition());
        const rotation = buffer.addTrackedComponent(entity, new LocalRotation());
        const scale = buffer.addTrackedComponent(entity, new LocalScale());

        rotation.xyzw = Quaternions.eulerToQuat(euler);
        scale.xyz = [...currentScale] as Vec3;

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

    // i/o: scale all spawned models together
    const scaleFactor: Vec3 = [1.02, 1.02, 1.02];

    const applyScale = () => {
        for (const s of spawned) {
            s.scale.xyz = [...currentScale] as Vec3;
        }
    }

    const registerInputs = () => {
        // space: spawn a new model | backspace: remove the last one
        // n: cycle which model spawns next | r: reload model list
        keyboardInput.when({name: 'space'}, () => {
            spawnModel();
        })
        keyboardInput.when({name: 'backspace'}, () => {
            despawnLast();
        })
        keyboardInput.when({name: 'n'}, () => {
            selectedMeshIndex = (selectedMeshIndex + 1) % meshes.length;
            updatePreview();
        })
        keyboardInput.when({name: 'r'}, () => {
            fetchModels();
        })

        // wasd + qe: move the whole group (fly-camera style)
        // w/s: forward/back | a/d: left/right | q/e: down/up
        keyboardInput.when({name: 'w'}, () => {
            camPos.z += 0.05;
        })
        keyboardInput.when({name: 's'}, () => {
            camPos.z -= 0.05;
        })
        keyboardInput.when({name: 'a'}, () => {
            camPos.x -= 0.05;
        })
        keyboardInput.when({name: 'd'}, () => {
            camPos.x += 0.05;
        })
        keyboardInput.when({name: 'q'}, () => {
            camPos.y -= 0.05;
        })
        keyboardInput.when({name: 'e'}, () => {
            camPos.y += 0.05;
        })

        // arrow keys: rotate (up/down = pitch, left/right = yaw)
        keyboardInput.when({name: 'up'}, () => {
            euler[0] += 0.1;
            applyRotation();
        })
        keyboardInput.when({name: 'left'}, () => {
            euler[1] -= 0.1;
            applyRotation();
        })
        keyboardInput.when({name: 'right'}, () => {
            euler[1] += 0.1;
            applyRotation();
        })
        keyboardInput.when({name: 'down'}, () => {
            euler[0] -= 0.1;
            applyRotation();
        })

        // i/o: scale down/up
        keyboardInput.when({name: 'i'}, () => {
            currentScale = Vec.div(currentScale, scaleFactor) as Vec3;
            applyScale();
        })
        keyboardInput.when({name: 'o'}, () => {
            currentScale = Vec.mul(currentScale, scaleFactor) as Vec3;
            applyScale();
        })

        // z/x: zoom in/out (field of view)
        keyboardInput.when({name: 'z'}, () => {
            fov.degrees /= 1.01;
        })
        keyboardInput.when({name: 'x'}, () => {
            fov.degrees *= 1.01;
        })

        // keyboardInput.when({name: 'return'}, () => {
        //     const renderer = world.tryGetSystem(RenderingSystemGroup);
        //     if (!renderer) return;
        //     renderer.enabled = !renderer.enabled;
        // })

        keyboardInput.when({name: 'v'}, () => {
            const renderer = world.tryGetSystem(Console3DRenderPassSystem);
            if (!renderer) return;
            renderer.enabled = !renderer.enabled;
        })

        keyboardInput.when({name: 'tab'}, () => {
            const renderer = world.tryGetSystem(ConsoleHudRenderPassSystem);
            if (!renderer) return;
            renderer.enabled = !renderer.enabled;
        })

        keyboardInput.when({name: 'g'}, () => {
            world.logSystemUpdateOrder();
        })

        keyboardInput.when({name: 'c', ctrl: true}, () => {
            const renderer = world.tryGetSystem(RenderingSystemGroup);
            if (!renderer) return;
            renderer.enabled = !renderer.enabled;
            world.stop()
            process.exit(0);
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
        const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).createEntityCommandBuffer()


        //hud element
// entityCounter
        const entityCounterEntity = buffer.createEntity("entityCounter");
        this._entityCounterImage = buffer.addTrackedComponent(entityCounterEntity, new ConsoleImage());
        this._entityCounterImage.image = [
            Ansi.colors.fg.green + 'HUD element',
        ]
        this._entityCounterImage.transparentChar = undefined; // no transparency for HUD
        buffer.addComponent(entityCounterEntity, new HudElement());
        const anchor = new ConsoleImageAnchor()
        anchor.anchorPosition = 'bottom-left';
        buffer.addComponent(entityCounterEntity, anchor);

// fps counter
        const fpsCounterEntity = buffer.createEntity("fpsCounter");
        this._fpsCounterImage = buffer.addTrackedComponent(fpsCounterEntity, new ConsoleImage());
        this._fpsCounterImage.image = [
            Ansi.colors.fg.green + 'FPS: 0',
        ]
        this._fpsCounterImage.transparentChar = undefined; // no transparency for HUD
        buffer.addComponent(fpsCounterEntity, new HudElement());
        const fpsAnchor = new ConsoleImageAnchor()
        fpsAnchor.anchorPosition = 'top-right';
        buffer.addComponent(fpsCounterEntity, fpsAnchor);
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