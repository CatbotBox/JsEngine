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

import {Console2DRenderPassSystem} from "../../src/js_engine/rendering/console/2d";
import {AverageStat} from "../../src/js_engine/datatypes";
import {Console3DRenderPassSystem} from "../../src/js_engine/rendering/console/3d/console3DRenderPassSystem";
import {RenderMesh} from "../../src/js_engine/rendering/3d/renderMesh";
import {Mesh} from "../../src/js_engine/rendering/3d/mesh";
import {Vec, Vec3} from "../../src/js_engine/math/types/vec";
import {Quaternions} from "../../src/js_engine/math/quaternions";
import {FieldOfView} from "../../src/js_engine/rendering/3d/fieldOfView";

const world = new DebugWorld();
const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).createEntityCommandBuffer()

//Camera Stuff
{
    const cameraEntity = buffer.createEntity("cameraEntity");

    buffer.addComponent(cameraEntity, new Camera());
    buffer.addComponent(cameraEntity, new LocalToWorld());
    buffer.addComponent(cameraEntity, new LocalPosition());
    buffer.addComponent(cameraEntity, new RenderBounds());
    buffer.addTrackedComponent(cameraEntity, new LocalRotation());
    const fov = buffer.addTrackedComponent(cameraEntity, new FieldOfView());

    keyboardInput.when({name: 'l'}, () => {
        fov.degrees *= 1.01;
    })
    keyboardInput.when({name: 'm'}, () => {
        fov.degrees /= 1.01;
    })
}


// Mesh Stuff
{
    const fs = require("fs");
    const files = fs.readdirSync("./demo/3d/").filter(file => file.endsWith(".obj")).map(file => file.split("."));
    // Packed 0xRRGGBB base colors; models not listed here cycle the palette.
    const namedColors: Record<string, number> = {
        "cube": 0x4FA3F7,              // blue
        "blender_monkey": 0xF7A44F,    // orange
        "indoor plant_02": 0x66C96A,   // green
    };
    const palette = [0xF7F14F, 0xE05DD8, 0x5DE0C8, 0xE0645D];
    const meshes: { name: string, mesh: Mesh, color: number }[] = files.map((file, index) => ({
        name: file[0],
        mesh: Mesh.fromFile("./demo/3d/" + file[0] + "." + file[1]),
        color: namedColors[file[0]] ?? palette[index % palette.length],
    }));
    // [
    //     {name: 'cube', mesh: Mesh.fromFile("./demo/3d/cube.obj")},
    //     {name: 'monkey', mesh: Mesh.fromFile("./demo/3d/blender_monkey.obj")},
    //     {name: 'plant', mesh: Mesh.fromFile("./demo/3d/indoor plant_02.obj")},
    // ];

    let selectedMeshIndex = 0;

    interface SpawnedModel {
        entity: ReturnType<typeof buffer.createEntity>;
        position: LocalPosition;
        rotation: LocalRotation;
        scale: LocalScale;
    }

    const spawned: SpawnedModel[] = [];

    // Shared transform state so new spawns match the rest of the group
    const euler: Vec3 = [0, 0, 0];
    let currentScale: Vec3 = [1, 1, 1];
    const groupOffset: Vec3 = [0, 0, 10];
    const spacing = 5;

    // Preview HUD (bottom-right corner) showing the model that will be spawned next
    const previewEntity = buffer.createEntity("spawnPreview");
    const previewImage = buffer.addTrackedComponent(previewEntity, new ConsoleImage());
    previewImage.transparentChar = undefined;
    buffer.addComponent(previewEntity, new HudElement());
    const previewAnchor = new ConsoleImageAnchor();
    previewAnchor.anchorPosition = 'bottom-right';
    buffer.addComponent(previewEntity, previewAnchor);

    const updatePreview = () => {
        previewImage.image = [
            Ansi.colors.fg.cyan + 'Next: ' + meshes[selectedMeshIndex].name
            + '  [spawned: ' + spawned.length + '] ', //add space for padding
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

            s.position.x = groupOffset[0] + (x - (sx - 1) / 2) * spacing;
            s.position.y = groupOffset[1] + (y - (sy - 1) / 2) * spacing;
            s.position.z = groupOffset[2] + (z - (sz - 1) / 2) * spacing;
        });
    }

    const spawnModel = () => {
        const entity = buffer.createEntity();
        buffer.addComponent(entity, new RenderMesh(meshes[selectedMeshIndex].mesh, meshes[selectedMeshIndex].color));
        buffer.addComponent(entity, new LocalToWorld());
        const position = buffer.addTrackedComponent(entity, new LocalPosition());
        const rotation = buffer.addTrackedComponent(entity, new LocalRotation());
        const scale = buffer.addTrackedComponent(entity, new LocalScale());

        rotation.xyzw = Quaternions.eulerToQuat(euler);
        scale.xyz = [...currentScale] as Vec3;

        spawned.push({entity, position, rotation, scale});
        relayout();
        updatePreview();
    }

    const despawnLast = () => {
        const last = spawned.pop();
        if (!last) return;
        buffer.destroyEntity(last.entity);
        relayout();
        updatePreview();
    }

    // space: spawn a new model | backspace: remove the last one | n: cycle which model spawns next
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

    // wasd/qe: move the whole group
    keyboardInput.when({name: 'w'}, () => {
        groupOffset[1] -= 0.05;
        relayout();
    })
    keyboardInput.when({name: 's'}, () => {
        groupOffset[1] += 0.05;
        relayout();
    })
    keyboardInput.when({name: 'a'}, () => {
        groupOffset[0] -= 0.05;
        relayout();
    })
    keyboardInput.when({name: 'd'}, () => {
        groupOffset[0] += 0.05;
        relayout();
    })
    keyboardInput.when({name: 'q'}, () => {
        groupOffset[2] -= 0.05;
        relayout();
    })
    keyboardInput.when({name: 'e'}, () => {
        groupOffset[2] += 0.05;
        relayout();
    })

    // arrows: rotate all spawned models together
    const applyRotation = () => {
        const quat = Quaternions.eulerToQuat(euler);
        for (const s of spawned) {
            s.rotation.xyzw = quat;
        }
    }

    keyboardInput.when({name: 'up'}, ({shift}) => {
        euler[0] += shift ? -0.1 : 0.1;
        applyRotation();
    })
    keyboardInput.when({name: 'left'}, ({shift}) => {
        euler[1] += shift ? -0.1 : 0.1;
        applyRotation();
    })
    keyboardInput.when({name: 'right'}, ({shift}) => {
        euler[2] += shift ? -0.1 : 0.1;
        applyRotation();
    })
    keyboardInput.when({name: 'down'}, ({shift}) => {
        const value = shift ? -0.1 : 0.1;
        euler[0] += value;
        euler[1] += value;
        euler[2] += value;
        applyRotation();
    })

    // i/o: scale all spawned models together
    const scaleFactor: Vec3 = [1.02, 1.02, 1.02];

    const applyScale = () => {
        for (const s of spawned) {
            s.scale.xyz = [...currentScale] as Vec3;
        }
    }

    keyboardInput.when({name: 'i'}, () => {
        currentScale = Vec.mul(currentScale, scaleFactor) as Vec3;
        applyScale();
    })
    keyboardInput.when({name: 'o'}, () => {
        currentScale = Vec.div(currentScale, scaleFactor) as Vec3;
        applyScale();
    })

    // start with one model on screen
    spawnModel();
}


keyboardInput.when({name: 'return'}, () => {
    const renderer = world.tryGetSystem(RenderingSystemGroup);
    if (!renderer) return;
    renderer.enabled = !renderer.enabled;
})
// backspace is now used for despawning, so the 2D render pass toggle moved to 'b'
keyboardInput.when({name: 'b'}, () => {
    const renderer = world.tryGetSystem(Console2DRenderPassSystem);
    if (!renderer) return;
    renderer.enabled = !renderer.enabled;
})
keyboardInput.when({name: 'g'}, () => {
    world.logSystemUpdateOrder();
})

keyboardInput.when({name: 'c', ctrl: true}, () => {
    world.stop()
    process.exit(0);
})


class DebugSystem extends System {
    private _hudQuery = this.createEntityQuery([HudElement])
    private _toggle = true;
    private _fpsCounter = new AverageStat(10)
    private _entityCounterImage!: ConsoleImage;
    private _fpsCounterImage!: ConsoleImage;

    protected onCreate() {
        const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).createEntityCommandBuffer()
        keyboardInput.when({name: 'tab'}, () => {
            this._toggle = !this._toggle;
            buffer.setEnabledStateForQuery(this._hudQuery, this._toggle);
            console.log("toggle hud", this._hudQuery.entityCount() + " | " + this._hudQuery.entityCountUnfiltered());
            console.log(this._hudQuery.archetypes)
        })

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