/**
 * Reproduces the two cascades visible in logs/latest.log frame 4 (127.25 ms total)
 * and measures what the `Unchanged` write opt-out actually buys for each.
 *
 * CASCADE 1 -- a colour-only change to ConsoleImage
 *   FadeSystem rewrites `image.image` every frame. The glyph dimensions never
 *   change, so RenderBounds2DApplyModifierSystem (20.39 ms in the log) recomputes
 *   bounds that are already correct.
 *
 * CASCADE 2 -- an entity arriving in a large archetype
 *   A completed fade removes two components, which *moves* the entity into another
 *   archetype. Arriving stamps every column there, so LocalToWorldSystem (10.64 ms)
 *   and WorldSpaceRenderBoundsComputeSystem (17.89 ms) reprocess every settled
 *   entity, and Console2DRenderPassSystem (28.15 ms) rebatches them.
 *
 * Each scenario is run against a control where the work is genuinely required, so
 * the gap isolates the saving rather than reporting a bare number.
 *
 * Run: bun bench/boundsCascade.bench.ts
 */
import {World} from "../src/js_engine/core/world";
import {EntityQuery} from "../src/js_engine/core/entityQuery";
import {Ansi} from "../src/js_engine/rendering/console/ansi";
import {ConsoleImage} from "../src/js_engine/rendering/console/consoleImage";
import {LocalPosition, LocalToWorld} from "../src/js_engine/translation";
import {LocalToWorldSystem} from "../src/js_engine/translation/LocalToWorldSystem";
import {Camera} from "../src/js_engine/rendering/camera";
import {ScreenSize} from "../src/js_engine/rendering/screenSize";
import {
    RenderBounds2DApplyModifierSystem
} from "../src/js_engine/rendering/console/2d/renderBounds2DApplyModifierSystem";
import {WorldSpaceRenderBoundsComputeSystem} from "../src/js_engine/rendering/worldSpaceRenderBoundsComputeSystem";
import {Console2DRenderPassSystem} from "../src/js_engine/rendering/console/2d/console2DRenderPassSystem";
import {fmt, median} from "./_harness";

const N = 40_000;
const FRAMES = 30;
const WARMUP = 5;
const ARRIVALS_PER_FRAME = 400;

// Median, not mean: a single GC pause inside a 25-frame sample moves a mean far more than
// it moves the middle value. CLAUDE.md documents this bench as noisy for exactly that reason.
const aggregate = median;

function spawn(world: World, count: number) {
    const em = world.entityManager;
    const images: ConsoleImage[] = [];
    for (let i = 0; i < count; i++) {
        const e = em.createEntity();
        const img = new ConsoleImage();
        img.transparentChar = "0";
        img.image = [Ansi.bgRGB(1, 2, 3) + " "];
        // ConsoleImage.setup adds RenderBounds, which adds WorldSpaceRenderBounds
        em.addComponent(e, img);
        em.addComponent(e, new LocalToWorld());
        em.addComponent(e, new LocalPosition(i % 200, (i / 200) | 0, 0));
        images.push(em.getComponent<ConsoleImage>(e, ConsoleImage)!);
    }
    return images;
}

// ---------------------------------------------------------------- cascade 1

function cascade1(mode: "colour-only" | "geometry") {
    const world = new World();
    const modifier = world.getOrCreateSystem(RenderBounds2DApplyModifierSystem);
    const images = spawn(world, N);

    const samples: number[] = [];
    for (let f = 0; f < FRAMES; f++) {
        const c = Ansi.bgRGB((f * 7) % 256, (f * 11) % 256, (f * 13) % 256);
        // "geometry" changes the visible width, so the derived bounds really move
        const glyphs = mode === "geometry" ? " ".repeat(1 + (f % 4)) : " ";
        for (let i = 0; i < N; i++) images[i].image = [c + glyphs];

        const t = performance.now();
        modifier.update();
        if (f >= WARMUP) samples.push(performance.now() - t);
    }
    return aggregate(samples);
}

// ---------------------------------------------------------------- cascade 2

function cascade2(mode: "arrivals" | "quiet" | "moving") {
    const world = new World();
    const em = world.entityManager;

    const cam = em.createEntity("camera");
    em.addComponent(cam, new Camera());
    em.addComponent(cam, new ScreenSize());
    em.addComponent(cam, new LocalToWorld());

    const l2w = world.getOrCreateSystem(LocalToWorldSystem);
    const wsb = world.getOrCreateSystem(WorldSpaceRenderBoundsComputeSystem);
    // no ConsoleScreenBuffer resource: onUpdate does updateIndex() and then returns
    // before blitting, which isolates the index maintenance we care about
    const pass = world.getOrCreateSystem(Console2DRenderPassSystem);

    spawn(world, N);
    const moveQuery = new EntityQuery(world, [LocalPosition, ConsoleImage]);

    const l2wS: number[] = [], wsbS: number[] = [], passS: number[] = [];
    for (let f = 0; f < FRAMES; f++) {
        if (mode === "arrivals") spawn(world, ARRIVALS_PER_FRAME);
        if (mode === "moving") {
            // streaming with a declared write is what stamps the column
            moveQuery.stream({write: {pos: LocalPosition}}).consume(({pos}) => {
                pos.x = pos.x + 0.5;
            });
        }

        let t = performance.now();
        l2w.update();
        if (f >= WARMUP) l2wS.push(performance.now() - t);

        t = performance.now();
        wsb.update();
        if (f >= WARMUP) wsbS.push(performance.now() - t);

        t = performance.now();
        pass.update();
        if (f >= WARMUP) passS.push(performance.now() - t);
    }
    return {l2w: aggregate(l2wS), wsb: aggregate(wsbS), pass: aggregate(passS)};
}

// ---------------------------------------------------------------- report

// prime the JIT with every shape before measuring any of them
cascade1("colour-only");
cascade1("geometry");
cascade2("arrivals");
cascade2("moving");

const c1Colour = cascade1("colour-only");
const c1Geom = cascade1("geometry");

const c2Quiet = cascade2("quiet");
const c2Arrivals = cascade2("arrivals");
const c2Moving = cascade2("moving");

const tot = (r: { l2w: number; wsb: number; pass: number }) => r.l2w + r.wsb + r.pass;

// Console2DRenderPassSystem's group takes over the terminal with alt-screen ANSI
// the moment it is created, so stdout is not usable for the report.
const out = [
    `N=${N}, mean ms/frame over ${FRAMES - WARMUP} frames`,
    ``,
    `CASCADE 1 -- ConsoleImage rewritten every frame`,
    `                                 colour-only    geometry (control)`,
    `RenderBounds2DApplyModifier      ${fmt(c1Colour)} ms  ${fmt(c1Geom)} ms`,
    ``,
    `CASCADE 2 -- ${ARRIVALS_PER_FRAME} entities arriving per frame`,
    `                                     quiet      arrivals     moving (control)`,
    `LocalToWorldSystem               ${fmt(c2Quiet.l2w)} ms  ${fmt(c2Arrivals.l2w)} ms  ${fmt(c2Moving.l2w)} ms`,
    `WorldSpaceRenderBoundsCompute    ${fmt(c2Quiet.wsb)} ms  ${fmt(c2Arrivals.wsb)} ms  ${fmt(c2Moving.wsb)} ms`,
    `Console2DRenderPass (index)      ${fmt(c2Quiet.pass)} ms  ${fmt(c2Arrivals.pass)} ms  ${fmt(c2Moving.pass)} ms`,
    `                                 --------------------------------------------`,
    `total                            ${fmt(tot(c2Quiet))} ms  ${fmt(tot(c2Arrivals))} ms  ${fmt(tot(c2Moving))} ms`,
    ``,
].join("\n");

require("fs").writeFileSync("bench/boundsCascade.out.txt", out);
process.exit(0);
