import * as fs from "fs";
import {World} from "../src/engine/core/world";
import {EntityQuery} from "../src/engine/core/entityQuery";
import {Ansi} from "../src/backends/cells/ansiEncoding";
import {TextSprite} from "../src/engine/rendering/textSprite";
import {LocalPosition, LocalToWorld} from "../src/engine/translation";
import {LocalToWorldSystem} from "../src/engine/translation/localToWorldSystem";
import {Camera} from "../src/engine/rendering/camera";
import {ScreenSize} from "../src/engine/rendering/screenSize";
import {
    TextSpriteBoundsSystem
} from "../src/engine/rendering/textSpriteBoundsSystem";
import {WorldSpaceRenderBoundsComputeSystem} from "../src/engine/rendering/worldSpaceRenderBoundsComputeSystem";
import {TextSpriteCellPassSystem} from "../src/backends/cells/2d/textSpriteCellPassSystem";
import {CellGrid} from "../src/backends/cells/cellGrid";
import {formatMs, median} from "./_harness";

const N = 40_000;
const FRAMES = 30;
const WARMUP = 5;
const ARRIVALS_PER_FRAME = 400;
const GRID_COLUMNS = 200;
const MAX_GLYPH_WIDTH = 4;
const MOVE_STEP = 0.5;
const SCREEN_COLUMNS = 200, SCREEN_ROWS = 50;
const REPORT_PATH = "bench/boundsCascade.out.txt";

function spawn(world: World, count: number) {
    const em = world.entityManager;
    const images: TextSprite[] = [];
    for (let i = 0; i < count; i++) {
        const e = em.createEntity();
        const img = new TextSprite();
        img.transparentChar = "0";
        img.image = [Ansi.bgRGB(1, 2, 3) + " "];
        em.addComponent(e, img);
        em.addComponent(e, new LocalToWorld());
        em.addComponent(e, new LocalPosition(i % GRID_COLUMNS, (i / GRID_COLUMNS) | 0, 0));
        images.push(em.getComponent<TextSprite>(e, TextSprite)!);
    }
    return images;
}

function imageRewriteCascadeMs(mode: "colour-only" | "geometry") {
    const world = new World();
    const modifier = world.getOrCreateSystem(TextSpriteBoundsSystem);
    const images = spawn(world, N);

    const samples: number[] = [];
    for (let f = 0; f < FRAMES; f++) {
        const c = Ansi.bgRGB((f * 7) % 256, (f * 11) % 256, (f * 13) % 256);
        const glyphs = mode === "geometry" ? " ".repeat(1 + (f % MAX_GLYPH_WIDTH)) : " ";
        for (let i = 0; i < N; i++) images[i].image = [c + glyphs];

        const t = performance.now();
        modifier.update();
        if (f >= WARMUP) samples.push(performance.now() - t);
    }
    return median(samples);
}

function archetypeArrivalCascadeMs(mode: "arrivals" | "quiet" | "moving") {
    const world = new World();
    const em = world.entityManager;

    const cam = em.createEntity("camera");
    em.addComponent(cam, new Camera());
    em.addComponent(cam, new ScreenSize());
    em.addComponent(cam, new LocalToWorld());

    const l2w = world.getOrCreateSystem(LocalToWorldSystem);
    const wsb = world.getOrCreateSystem(WorldSpaceRenderBoundsComputeSystem);
    const screen = world.resources.getOrCreate(CellGrid);
    const pass = world.getOrCreateSystem(TextSpriteCellPassSystem);

    spawn(world, N);
    const moveQuery = new EntityQuery(world, [LocalPosition, TextSprite]);

    const l2wS: number[] = [], wsbS: number[] = [], passS: number[] = [];
    for (let f = 0; f < FRAMES; f++) {
        if (mode === "arrivals") spawn(world, ARRIVALS_PER_FRAME);
        if (mode === "moving") {
            moveQuery.stream({write: {pos: LocalPosition}}).consume(({pos}) => {
                pos.x = pos.x + MOVE_STEP;
            });
        }

        let t = performance.now();
        l2w.update();
        if (f >= WARMUP) l2wS.push(performance.now() - t);

        t = performance.now();
        wsb.update();
        if (f >= WARMUP) wsbS.push(performance.now() - t);

        screen.screenBuffer.beginFrame({screenSize: {x: SCREEN_COLUMNS, y: SCREEN_ROWS} as ScreenSize}, " ");
        t = performance.now();
        pass.update();
        if (f >= WARMUP) passS.push(performance.now() - t);
    }
    return {l2w: median(l2wS), wsb: median(wsbS), pass: median(passS)};
}

function warmUpEveryShape() {
    imageRewriteCascadeMs("colour-only");
    imageRewriteCascadeMs("geometry");
    archetypeArrivalCascadeMs("arrivals");
    archetypeArrivalCascadeMs("moving");
}

warmUpEveryShape();

const c1Colour = imageRewriteCascadeMs("colour-only");
const c1Geom = imageRewriteCascadeMs("geometry");

const c2Quiet = archetypeArrivalCascadeMs("quiet");
const c2Arrivals = archetypeArrivalCascadeMs("arrivals");
const c2Moving = archetypeArrivalCascadeMs("moving");

const totalMs = (r: { l2w: number; wsb: number; pass: number }) => r.l2w + r.wsb + r.pass;

const report = [
    `N=${N}, mean ms/frame over ${FRAMES - WARMUP} frames`,
    ``,
    `CASCADE 1 -- TextSprite rewritten every frame`,
    `                                 colour-only    geometry (control)`,
    `TextSpriteBoundsSystem           ${formatMs(c1Colour)} ms  ${formatMs(c1Geom)} ms`,
    ``,
    `CASCADE 2 -- ${ARRIVALS_PER_FRAME} entities arriving per frame`,
    `                                     quiet      arrivals     moving (control)`,
    `LocalToWorldSystem               ${formatMs(c2Quiet.l2w)} ms  ${formatMs(c2Arrivals.l2w)} ms  ${formatMs(c2Moving.l2w)} ms`,
    `WorldSpaceRenderBoundsCompute    ${formatMs(c2Quiet.wsb)} ms  ${formatMs(c2Arrivals.wsb)} ms  ${formatMs(c2Moving.wsb)} ms`,
    `TextSpriteCellPass (cull+blit)   ${formatMs(c2Quiet.pass)} ms  ${formatMs(c2Arrivals.pass)} ms  ${formatMs(c2Moving.pass)} ms`,
    `                                 --------------------------------------------`,
    `total                            ${formatMs(totalMs(c2Quiet))} ms  ${formatMs(totalMs(c2Arrivals))} ms  ${formatMs(totalMs(c2Moving))} ms`,
    ``,
].join("\n");

fs.writeFileSync(REPORT_PATH, report);
process.exit(0);
