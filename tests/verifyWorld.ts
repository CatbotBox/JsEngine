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
import {Console3DRenderPassSystem} from "../src/js_engine/rendering/console/3d/console3DRenderPassSystem";
import {RenderMesh} from "../src/js_engine/rendering/3d/renderMesh";
import {Mesh} from "../src/js_engine/rendering/3d/mesh";
import {FieldOfView} from "../src/js_engine/rendering/3d/fieldOfView";
import {Quaternions} from "../src/js_engine/math/quaternions";

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
const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).createEntityCommandBuffer();

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

world.ensureSystemExists(Console3DRenderPassSystem);
world.ensureSystemExists(ConsoleHudRenderPassSystem);

const tick = () => (world as any).update();

// A few frames to let command buffers play back and systems settle.
for (let i = 0; i < 4; i++) tick();

expect(captured.includes("\x1b[48;2;"), "3D pass wrote truecolor cells");
// HUD glyphs are emitted one per cell with their own escape codes around each
// char, so strip ANSI before searching for the marker text.
expect(Ansi.strip(captured).includes("HUDMARKER"), "HUD element composited over the frame");

// Static scene â†’ damage tracking should emit nothing new.
const lenBefore = captured.length;
tick();
tick();
expect(captured.length === lenBefore, `static frames write zero bytes (wrote ${captured.length - lenBefore})`);

// Rotate the mesh â†’ new frame bytes must appear.
rotation.xyzw = Quaternions.eulerToQuat([0.4, 0.6, 0]);
tick();
const deltaBytes = captured.length - lenBefore;
expect(deltaBytes > 0, `scene change produced output (${deltaBytes} bytes)`);

// Full-frame estimate for comparison: rough per-changed-frame cost.
rotation.xyzw = Quaternions.eulerToQuat([0.8, 1.2, 0]);
const lenRot = captured.length;
tick();
log(`rotating frame delta: ${captured.length - lenRot} bytes`);

world.stop();
(process.stdout as any).write = realWrite;
Console3DRenderPassSystem.disposeRasterPool();

if (failures > 0) {
    console.error(`${failures} smoke-test failures`);
    process.exit(1);
}
log("world smoke test OK");

