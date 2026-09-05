/**
 * Headless integration smoke test: drives a real DebugWorld with the full
 * rendering stack (3D pass + HUD + render group) with stdout captured, and
 * asserts frames are produced, damage tracking suppresses unchanged frames,
 * and scene changes produce new output.
 *
 * Run: bun tests/verifyWorld.ts
 */
process.env.COLUMNS = "200";
process.env.LINES = "60";

// Some sizing paths poke at TTY internals that don't exist on piped stdout.
(process.stdout as any)._refreshSize ??= () => {};

import {DebugWorld, EntityCommandBufferSystem} from "../src/js_engine";
import {Camera, HudElement, RenderBounds} from "../src/js_engine/rendering";
import {LocalPosition, LocalRotation, LocalScale, LocalToWorld} from "../src/js_engine/translation";
import {Ansi, ConsoleHudRenderPassSystem, ConsoleImage, ConsoleImageAnchor} from "../src/js_engine/rendering/console";
import {Console2DRenderPassSystem} from "../src/js_engine/rendering/console/2d/console2DRenderPassSystem";
import {Console3DRenderPassSystem} from "../src/js_engine/rendering/console/3d/console3DRenderPassSystem";
import {Console3DRenderSettings} from "../src/js_engine/rendering/console/3d/console3DRenderSettings";
import {ConsoleRenderSettings} from "../src/js_engine/rendering/console/consoleRenderSettings";
import {RenderMesh} from "../src/js_engine/rendering/3d/renderMesh";
import {Mesh} from "../src/js_engine/rendering/3d/mesh";
import {FieldOfView} from "../src/js_engine/rendering/3d/fieldOfView";
import {Quaternions} from "../src/js_engine/math/quaternions";
import {Vec, Vec3} from "../src/js_engine/math/types/vec";
import {AmbientLight, DirectionalLight, PointLight} from "../src/js_engine/rendering/3d/lighting";

let captured = "";
const realWrite = process.stdout.write.bind(process.stdout);
(process.stdout as any).write = (chunk: unknown) => {
    captured += String(chunk);
    return true;
};

function log(message: string) {
    realWrite(message + "\n");
}

let failures = 0;
function expect(condition: boolean, label: string) {
    if (condition) log(`ok   ${label}`);
    else {
        failures++;
        log(`FAIL ${label}`);
    }
}

const world = new DebugWorld();
const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();

const cameraEntity = buffer.createEntity("camera");
buffer.addComponent(cameraEntity, new Camera());
buffer.addComponent(cameraEntity, new LocalToWorld());
buffer.addComponent(cameraEntity, new LocalPosition());
buffer.addComponent(cameraEntity, new RenderBounds());
buffer.addComponent(cameraEntity, new LocalRotation());
buffer.addComponent(cameraEntity, new FieldOfView());

const meshEntity = buffer.createEntity("mesh");
buffer.addComponent(meshEntity, new RenderMesh(Mesh.fromFile("./demo/3d/blender_monkey.obj")));
buffer.addComponent(meshEntity, new LocalToWorld());
buffer.addTrackedComponent(meshEntity, new LocalPosition(0, 0, 8));
const rotation = buffer.addTrackedComponent(meshEntity, new LocalRotation());
buffer.addComponent(meshEntity, new LocalScale());

const hudEntity = buffer.createEntity("hud");
const hudImage = new ConsoleImage();
hudImage.image = [Ansi.colors.fg.green + "HUDMARKER"];
hudImage.transparentChar = undefined;
buffer.addComponent(hudEntity, hudImage);
buffer.addComponent(hudEntity, new HudElement());
const anchor = new ConsoleImageAnchor();
anchor.anchorPosition = "top-right";
buffer.addComponent(hudEntity, anchor);

// World-space 2D sprites: one inside the camera rect, one far outside it. The
// pass culls straight off the WorldSpaceRenderBounds column, so both halves of
// that test (composited / culled) are worth pinning.
const spriteEntity = buffer.createEntity("sprite");
const spriteImage = new ConsoleImage();
spriteImage.image = [Ansi.colors.fg.green + "SPRITEMARK"];
spriteImage.transparentChar = undefined;
buffer.addComponent(spriteEntity, spriteImage);
buffer.addComponent(spriteEntity, new LocalToWorld());
buffer.addComponent(spriteEntity, new LocalPosition(0, 0, 0));

const offscreenEntity = buffer.createEntity("offscreen-sprite");
const offscreenImage = new ConsoleImage();
offscreenImage.image = [Ansi.colors.fg.red + "OFFSCREENMARK"];
offscreenImage.transparentChar = undefined;
buffer.addComponent(offscreenEntity, offscreenImage);
buffer.addComponent(offscreenEntity, new LocalToWorld());
buffer.addComponent(offscreenEntity, new LocalPosition(5000, 5000, 0));

world.ensureSystemExists(Console3DRenderPassSystem);
world.ensureSystemExists(Console2DRenderPassSystem);
world.ensureSystemExists(ConsoleHudRenderPassSystem);

const tick = () => (world as any).update();

// Without its settings entity the 3D pass must stay silent (the singleton
// settings convention); everything else still renders.
for (let i = 0; i < 4; i++) tick();
expect(!captured.includes("\x1b[48;2;"), "3D pass is off while Console3DRenderSettings is absent");
expect(Ansi.strip(captured).includes("HUDMARKER"), "HUD still renders without 3D settings");

const settingsEntity = buffer.createEntity("render-settings");
buffer.addComponent(settingsEntity, new Console3DRenderSettings());
buffer.addComponent(settingsEntity, new ConsoleRenderSettings());
for (let i = 0; i < 4; i++) tick();

expect(captured.includes("\x1b[48;2;"), "3D pass wrote truecolor cells");
expect(captured.includes("▀"), "default settings render half-block cells");
// HUD glyphs are emitted one per cell with their own escape codes around each
// char, so strip ANSI before searching for the marker text.
expect(Ansi.strip(captured).includes("HUDMARKER"), "HUD element composited over the frame");
expect(Ansi.strip(captured).includes("SPRITEMARK"), "2D sprite composited into the frame");
expect(!Ansi.strip(captured).includes("OFFSCREENMARK"), "off-screen 2D sprite culled");

// Static scene -> damage tracking should emit nothing new.
const lenBefore = captured.length;
tick();
tick();
expect(captured.length === lenBefore, `static frames write zero bytes (wrote ${captured.length - lenBefore})`);

// Rotate the mesh -> new frame bytes must appear.
rotation.xyzw = Quaternions.eulerToQuat(Vec3.alloc(0.4, 0.6, 0));
tick();
const deltaBytes = captured.length - lenBefore;
expect(deltaBytes > 0, `scene change produced output (${deltaBytes} bytes)`);

// Full-frame estimate for comparison: rough per-changed-frame cost.
rotation.xyzw = Quaternions.eulerToQuat(Vec3.alloc(0.8, 1.2, 0));
const lenRot = captured.length;
tick();
log(`rotating frame delta: ${captured.length - lenRot} bytes`);

// Lights arrive after the unlit frames above, so the same scene is rendered both
// ways: adding them must change the frame, and a static lit scene must still be
// fully suppressed by damage tracking.
tick();
const lenUnlit = captured.length;
const sun = buffer.createEntity("sun");
buffer.addComponent(sun, new DirectionalLight(0xFFFFFF, 0.8));
buffer.addComponent(sun, new LocalToWorld());
buffer.addComponent(sun, new LocalPosition());
buffer.addComponent(sun, new LocalRotation(...Vec.toArray(Quaternions.eulerToQuat(Vec3.alloc(0.6, -0.5, 0))) as [number, number, number, number]));
const lamp = buffer.createEntity("lamp");
buffer.addComponent(lamp, new PointLight(12, 0xFF8040, 1));
buffer.addComponent(lamp, new LocalToWorld());
buffer.addComponent(lamp, new LocalPosition(3, 2, 4));
buffer.addComponent(buffer.createEntity("ambient"), new AmbientLight(0xFFFFFF, 0.15));
for (let i = 0; i < 3; i++) tick();
const litDelta = captured.length - lenUnlit;
expect(litDelta > 0, `adding lights changed the frame (${litDelta} bytes)`);
expect(captured.includes("\x1b[48;2;"), "lit 3D pass wrote truecolor cells");

const lenLit = captured.length;
tick();
tick();
expect(captured.length === lenLit, `static lit frames write zero bytes (wrote ${captured.length - lenLit})`);

rotation.xyzw = Quaternions.eulerToQuat(Vec3.alloc(1.0, 1.4, 0.2));
const lenLitRot = captured.length;
tick();
const litRotDelta = captured.length - lenLitRot;
expect(litRotDelta > 0, `rotating a lit mesh produced output (${litRotDelta} bytes)`);

// A textured cube (cube.mtl -> checker.png) next to the monkey: textures must
// show up, and a static textured scene must still be fully suppressed.
tick();
const lenBeforeCube = captured.length;
const cubeEntity = buffer.createEntity("textured-cube");
const cubeMesh = Mesh.fromFile("./demo/3d/cube.obj");
expect(cubeMesh.materials[0].diffuseTexture !== undefined, "cube.obj loaded its checker texture");
buffer.addComponent(cubeEntity, new RenderMesh(cubeMesh));
buffer.addComponent(cubeEntity, new LocalToWorld());
buffer.addComponent(cubeEntity, new LocalPosition(3, 0, 8));
buffer.addComponent(cubeEntity, new LocalRotation(...Vec.toArray(Quaternions.eulerToQuat(Vec3.alloc(0.5, 0.7, 0))) as [number, number, number, number]));
for (let i = 0; i < 3; i++) tick();
const cubeDelta = captured.length - lenBeforeCube;
expect(cubeDelta > 0, `textured cube produced output (${cubeDelta} bytes)`);
const lenTextured = captured.length;
tick();
tick();
expect(captured.length === lenTextured, `static textured frames write zero bytes (wrote ${captured.length - lenTextured})`);

world.stop();
(process.stdout as any).write = realWrite;

if (failures > 0) {
    console.error(`${failures} smoke-test failures`);
    process.exit(1);
}
log("world smoke test OK");

