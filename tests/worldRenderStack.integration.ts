import {DebugWorld, EntityCommandBufferSystem} from "../src/engine";
import {MemoryPlatform} from "../src/engine/testing/memoryPlatform";
import {nodePlatform} from "../src/hosts/terminal";
import {Camera, HudElement, RenderBounds, TextSprite, ScreenAnchor} from "../src/engine/rendering";
import {LocalPosition, LocalRotation, LocalScale, LocalToWorld} from "../src/engine/translation";
import {Ansi, HudTextSpriteCellPassSystem} from "../src/backends/cells";
import {TextSpriteCellPassSystem} from "../src/backends/cells/2d/textSpriteCellPassSystem";
import {MeshCellPassSystem} from "../src/backends/cells/3d/meshCellPassSystem";
import {MeshCellPassSettings} from "../src/backends/cells/3d/meshCellPassSettings";
import {CellRenderSettings} from "../src/backends/cells/cellRenderSettings";
import {RenderMesh} from "../src/engine/rendering/3d/renderMesh";
import {Mesh} from "../src/engine/rendering/3d/mesh";
import {FieldOfView} from "../src/engine/rendering/3d/fieldOfView";
import {Quaternions} from "../src/engine/math/quaternions";
import {Vec, Vec3} from "../src/engine/math/types/vec";
import {AmbientLight, DirectionalLight, PointLight} from "../src/engine/rendering/3d/lighting";

const SETTLE_TICKS = 4;
const ADDED_ENTITY_SETTLE_TICKS = 3;
const TRUECOLOR_BG = "\x1b[48;2;";
const threadedRasterWorkers = nodePlatform().workers;
const platform = new MemoryPlatform({columns: 200, rows: 60, workers: threadedRasterWorkers});
const output = platform.output;

function log(message: string) {
    process.stdout.write(message + "\n");
}

let failures = 0;
function expect(condition: boolean, label: string) {
    if (condition) log(`ok   ${label}`);
    else {
        failures++;
        log(`FAIL ${label}`);
    }
}

const world = new DebugWorld({platform});
const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();

buffer.createEntity("camera", [new Camera(), new LocalToWorld(), new LocalPosition(), new RenderBounds(), new LocalRotation(), new FieldOfView()]);

const meshEntity = buffer.createEntity("mesh", [new RenderMesh(Mesh.fromFile("./demo/3d/blender_monkey.obj")), new LocalToWorld(), new LocalScale()]);
buffer.addTrackedComponent(meshEntity, new LocalPosition(0, 0, 8));
const rotation = buffer.addTrackedComponent(meshEntity, new LocalRotation());

const hudImage = new TextSprite();
hudImage.image = [Ansi.colors.fg.green + "HUDMARKER"];
hudImage.transparentChar = undefined;
const anchor = new ScreenAnchor();
anchor.anchorPosition = "top-right";
buffer.createEntity("hud", [hudImage, new HudElement(), anchor]);

const spriteImage = new TextSprite();
spriteImage.image = [Ansi.colors.fg.green + "SPRITEMARK"];
spriteImage.transparentChar = undefined;
buffer.createEntity("sprite", [spriteImage, new LocalToWorld(), new LocalPosition(0, 0, 0)]);

const offscreenImage = new TextSprite();
offscreenImage.image = [Ansi.colors.fg.red + "OFFSCREENMARK"];
offscreenImage.transparentChar = undefined;
buffer.createEntity("offscreen-sprite", [offscreenImage, new LocalToWorld(), new LocalPosition(5000, 5000, 0)]);

world.ensureSystemExists(MeshCellPassSystem);
world.ensureSystemExists(TextSpriteCellPassSystem);
world.ensureSystemExists(HudTextSpriteCellPassSystem);

const tick = () => (world as any).update();
const tickTimes = (count: number) => {
    for (let i = 0; i < count; i++) tick();
};

tickTimes(SETTLE_TICKS);
expect(!output.text().includes(TRUECOLOR_BG), "3D pass is off while MeshCellPassSettings is absent");
expect(Ansi.strip(output.text()).includes("HUDMARKER"), "HUD still renders without 3D settings");

buffer.createEntity("render-settings", [new MeshCellPassSettings(), new CellRenderSettings()]);
tickTimes(SETTLE_TICKS);

expect(output.text().includes(TRUECOLOR_BG), "3D pass wrote truecolor cells");
expect(output.text().includes("▀"), "default settings render half-block cells");
expect(Ansi.strip(output.text()).includes("HUDMARKER"), "HUD element composited over the frame");
expect(Ansi.strip(output.text()).includes("SPRITEMARK"), "2D sprite composited into the frame");
expect(!Ansi.strip(output.text()).includes("OFFSCREENMARK"), "off-screen 2D sprite culled");

const lenBefore = output.length;
tick();
tick();
expect(output.length === lenBefore, `static frames write zero bytes (wrote ${output.length - lenBefore})`);

rotation.xyzw = Quaternions.eulerToQuat(Vec3.alloc(0.4, 0.6, 0));
tick();
const deltaBytes = output.length - lenBefore;
expect(deltaBytes > 0, `scene change produced output (${deltaBytes} bytes)`);

rotation.xyzw = Quaternions.eulerToQuat(Vec3.alloc(0.8, 1.2, 0));
const lenRot = output.length;
tick();
log(`rotating frame delta: ${output.length - lenRot} bytes`);

tick();
const lenUnlit = output.length;
buffer.createEntity("sun", [
    new DirectionalLight(0xFFFFFF, 0.8),
    new LocalToWorld(),
    new LocalPosition(),
    new LocalRotation(...Vec.toArray(Quaternions.eulerToQuat(Vec3.alloc(0.6, -0.5, 0))) as [number, number, number, number]),
]);
buffer.createEntity("lamp", [new PointLight(12, 0xFF8040, 1), new LocalToWorld(), new LocalPosition(3, 2, 4)]);
buffer.createEntity("ambient", [new AmbientLight(0xFFFFFF, 0.15)]);
tickTimes(ADDED_ENTITY_SETTLE_TICKS);
const litDelta = output.length - lenUnlit;
expect(litDelta > 0, `adding lights changed the frame (${litDelta} bytes)`);
expect(output.text().includes(TRUECOLOR_BG), "lit 3D pass wrote truecolor cells");

const lenLit = output.length;
tick();
tick();
expect(output.length === lenLit, `static lit frames write zero bytes (wrote ${output.length - lenLit})`);

rotation.xyzw = Quaternions.eulerToQuat(Vec3.alloc(1.0, 1.4, 0.2));
const lenLitRot = output.length;
tick();
const litRotDelta = output.length - lenLitRot;
expect(litRotDelta > 0, `rotating a lit mesh produced output (${litRotDelta} bytes)`);

tick();
const lenBeforeCube = output.length;
const cubeMesh = Mesh.fromFile("./demo/3d/cube.obj");
expect(cubeMesh.materials[0].diffuseTexture !== undefined, "cube.obj loaded its checker texture");
buffer.createEntity("textured-cube", [
    new RenderMesh(cubeMesh),
    new LocalToWorld(),
    new LocalPosition(3, 0, 8),
    new LocalRotation(...Vec.toArray(Quaternions.eulerToQuat(Vec3.alloc(0.5, 0.7, 0))) as [number, number, number, number]),
]);
tickTimes(ADDED_ENTITY_SETTLE_TICKS);
const cubeDelta = output.length - lenBeforeCube;
expect(cubeDelta > 0, `textured cube produced output (${cubeDelta} bytes)`);
const lenTextured = output.length;
tick();
tick();
expect(output.length === lenTextured, `static textured frames write zero bytes (wrote ${output.length - lenTextured})`);

world.stop();

if (failures > 0) {
    console.error(`${failures} smoke-test failures`);
    process.exit(1);
}
log("world smoke test OK");

