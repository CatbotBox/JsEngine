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
    const cameraRot = buffer.addTrackedComponent(cameraEntity, new LocalRotation());
    const fov = buffer.addTrackedComponent(cameraEntity, new FieldOfView());

    keyboardInput.when({name: 'l'}, () => {
        fov.degrees *= 1.01;
    })
    keyboardInput.when({name: 'm'}, () => {
        fov.degrees /= 1.01;
    })

    // keyboardInput.when({name: 'w'}, () => {
    //     cameraPosition.y -= 1;
    // })
    // keyboardInput.when({name: 's'}, () => {
    //     cameraPosition.y += 1;
    // })
    // keyboardInput.when({name: 'a'}, () => {
    //     cameraPosition.x -= 1;
    // })
    // keyboardInput.when({name: 'd'}, () => {
    //     cameraPosition.x += 1;
    // })
}


// Mesh Stuff
{

    // mesh constructed in builder works its just one-sided and not complex enough
//     const builder = new MeshBuilder();
//     builder.vertices = [[40, 10, 1], [25, 30, 1], [0, 35, 1], [30, 10, 1], [75, 60, 1], [50, -35, 1]
//         , [-10, -10, 0], [10, -10, 0], [-10, 10, 0], [10, 10, 0]]
// // builder.uvs = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]
// // builder.normals = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]
//
//     builder.triangles = [[0, 1, 2], [5, 4, 3], [6, 7, 8], [8, 7, 9]]
//     builder.generateNormals();
//
//     builder.generateUvs();
    const meshes: Mesh[] = [];
    meshes.push(Mesh.fromFile("./demo/3d/cube.obj"));
    meshes.push(Mesh.fromFile("./demo/3d/blender_monkey.obj"));
    // meshes.push(new Mesh(builder));

    const testMesh = buffer.createEntity();
    const testMesh2 = buffer.createEntity();
    const testMesh3 = buffer.createEntity();

    let meshIndex = 0;
    const renderMesh = buffer.addTrackedComponent(testMesh, new RenderMesh(meshes[0]));
    const renderMesh2 = buffer.addTrackedComponent(testMesh2, new RenderMesh(meshes[0]));
    const renderMesh3 = buffer.addTrackedComponent(testMesh3, new RenderMesh(meshes[0]));
    keyboardInput.when({name: 'space'}, () => {
        meshIndex += 1;
        if (meshIndex === meshes.length) meshIndex = 0;
        renderMesh.mesh = meshes[meshIndex];
        renderMesh2.mesh = meshes[meshIndex];
        renderMesh3.mesh = meshes[meshIndex];
    })

    const cubePosition = buffer.addTrackedComponent(testMesh, new LocalPosition(0, 0, 10));
    const cubePosition2 = buffer.addTrackedComponent(testMesh2, new LocalPosition(5, 0, 10));
    const cubePosition3 = buffer.addTrackedComponent(testMesh3, new LocalPosition(-5, 0, 10));
    keyboardInput.when({name: 'w'}, () => {
        cubePosition.y -= 1;
    })
    keyboardInput.when({name: 's'}, () => {
        cubePosition.y += 1;
    })
    keyboardInput.when({name: 'a'}, () => {
        cubePosition.x -= 1;
    })
    keyboardInput.when({name: 'd'}, () => {
        cubePosition.x += 1;
    })
    keyboardInput.when({name: 'q'}, () => {
        cubePosition.z -= 1;
    })
    keyboardInput.when({name: 'e'}, () => {
        cubePosition.z += 1;
    })

    buffer.addComponent(testMesh, new LocalToWorld());
    buffer.addComponent(testMesh2, new LocalToWorld());
    buffer.addComponent(testMesh3, new LocalToWorld());
    const rotation = buffer.addTrackedComponent(testMesh, new LocalRotation());
    const rotation2 = buffer.addTrackedComponent(testMesh2, new LocalRotation());
    const rotation3 = buffer.addTrackedComponent(testMesh3, new LocalRotation());

    const euler: Vec3 = [0, 0, 0]
    keyboardInput.when({name: 'up'}, ({shift}) => {
        const value = shift ? -0.1 : 0.1;
        euler[0] += value;
        rotation.xyzw = Quaternions.eulerToQuat(euler);
        rotation2.xyzw = Quaternions.eulerToQuat(euler);
        rotation3.xyzw = Quaternions.eulerToQuat(euler);

    })
    keyboardInput.when({name: 'left'}, ({shift}) => {
        const value = shift ? -0.1 : 0.1;
        euler[1] += value
        rotation.xyzw = Quaternions.eulerToQuat(euler);
        rotation2.xyzw = Quaternions.eulerToQuat(euler);
        rotation3.xyzw = Quaternions.eulerToQuat(euler);
    })
    keyboardInput.when({name: 'right'}, ({shift}) => {
        const value = shift ? -0.1 : 0.1;
        euler[2] += value
        rotation.xyzw = Quaternions.eulerToQuat(euler);
        rotation2.xyzw = Quaternions.eulerToQuat(euler);
        rotation3.xyzw = Quaternions.eulerToQuat(euler);
    })
    keyboardInput.when({name: 'down'}, ({shift}) => {
        const value = shift ? -0.1 : 0.1;
        euler[0] += value
        euler[1] += value
        euler[2] += value
        rotation.xyzw = Quaternions.eulerToQuat(euler);
        rotation2.xyzw = Quaternions.eulerToQuat(euler);
        rotation3.xyzw = Quaternions.eulerToQuat(euler);
    })

    const scale = buffer.addTrackedComponent(testMesh, new LocalScale());
    const scale2 = buffer.addTrackedComponent(testMesh2, new LocalScale());
    const scale3 = buffer.addTrackedComponent(testMesh3, new LocalScale());

    const scaleFactor: Vec3 = [1.1, 1.1, 1.1];
    keyboardInput.when({name: 'i'}, () => {
        scale.xyz = Vec.mul(scale.xyz, scaleFactor);
        scale2.xyz = Vec.mul(scale.xyz, scaleFactor);
        scale3.xyz = Vec.mul(scale.xyz, scaleFactor);
    })
    keyboardInput.when({name: 'o'}, () => {
        scale.xyz = Vec.div(scale.xyz, scaleFactor);
        scale2.xyz = Vec.div(scale.xyz, scaleFactor);
        scale3.xyz = Vec.div(scale.xyz, scaleFactor);
    })

}


keyboardInput.when({name: 'return'}, () => {
    const renderer = world.tryGetSystem(RenderingSystemGroup);
    if (!renderer) return;
    renderer.enabled = !renderer.enabled;
})
keyboardInput.when({name: 'backspace'}, () => {
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
        // this.requireAnyForUpdate(this._query);
        // this.enabled = false;
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
