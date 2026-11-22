import {describe, expect, test} from "../../../engine/testing/harness";
import {MemoryPlatform} from "../../../engine/testing/memoryPlatform";
import {World} from "../../../engine/core/world";
import {RootSystemGroup} from "../../../engine/core/rootSystemGroup";
import {Vec} from "../../../engine/math/types/vec";
import {Camera} from "../../../engine/rendering/camera";
import {Mesh, MeshBuilder} from "../../../engine/rendering/3d/mesh";
import {Material} from "../../../engine/rendering/3d/material";
import {RenderMesh} from "../../../engine/rendering/3d/renderMesh";
import {createUnitCubeMesh} from "../../../engine/rendering/3d/meshAssetType";
import {FieldOfView} from "../../../engine/rendering/3d/fieldOfView";
import {MeshRenderSettings} from "../../../engine/rendering/3d/meshRenderSettings";
import {MeshRenderStats} from "../../../engine/rendering/3d/meshRenderStats";
import {RasterWorkerPool} from "../../../engine/rendering/3d/software";
import {LocalPosition, LocalToWorld} from "../../../engine/translation";
import {MemoryPixelPresenter} from "../memoryPixelPresenter";
import {PixelPresenterResource} from "../pixelPresenterResource";
import {RGBA_BYTES_PER_PIXEL} from "../pixelFrame";
import {MeshPixelPassSettings} from "./meshPixelPassSettings";
import {MeshPixelPassSystem} from "./meshPixelPassSystem";
import {PixelRenderSystemGroup} from "../pixelRenderSystemGroup";

const QUAD_RGB = 0x336699;
const QUAD_HALF_SIZE = 1;
const QUAD_DISTANCE = 4;
const SIZE = {widthPx: 64, heightPx: 48};
const RED_SHIFT = 16, GREEN_SHIFT = 8;
const QUAD_TRIANGLES = 2;
const QUAD_LOD_DRAWS = 1;
const SETTLE_STEPS = 2;
const FRAME_MS = 16;
const EXPLICIT_SUPERSAMPLE = 4;
const CUBE_RGB = 0x996633;
const BLACK_RGB = 0x000000;
const CAMERA_INSIDE_CUBE_Z = 0;

function quad(): Mesh {
    const builder = new MeshBuilder();
    const h = QUAD_HALF_SIZE;
    builder.vertices.push(Vec.alloc3(-h, -h, 0), Vec.alloc3(h, -h, 0), Vec.alloc3(h, h, 0), Vec.alloc3(-h, h, 0));
    builder.uvs.push(Vec.alloc2(0, 0), Vec.alloc2(1, 0), Vec.alloc2(1, 1), Vec.alloc2(0, 1));
    builder.triangles.push(Vec.alloc3(0, 2, 1), Vec.alloc3(0, 3, 2));
    builder.materials.push(new Material("flat", QUAD_RGB));
    builder.vertexMaterial.push(0, 0, 0, 0);
    builder.generateNormals();
    return new Mesh(builder);
}

describe("MeshPixelPassSettings", () => {
    test("fitWorkerPool picks the smallest whole block that keeps the subsamples within the worker pool's buffers", () => {
        const settings = new MeshPixelPassSettings();
        expect(settings.resolvedFramebufferPixelsPerRasterPixel(640, 384)).toBe(1);
        expect(settings.resolvedFramebufferPixelsPerRasterPixel(1920, 1080)).toBe(3);
        const factor = settings.resolvedFramebufferPixelsPerRasterPixel(1920, 1080);
        expect(Math.ceil(1920 / factor) * Math.ceil(1080 / factor) * 4).toBeLessThan(RasterWorkerPool.MAX_CELLS + 1);
        expect(settings.resolvedFramebufferPixelsPerRasterPixel(0, 0)).toBe(1);
    });

    test("an explicit block size is rounded down to whole pixels, at least one", () => {
        const settings = new MeshPixelPassSettings();
        settings.framebufferPixelsPerRasterPixel = 2.9;
        expect(settings.resolvedFramebufferPixelsPerRasterPixel(1920, 1080)).toBe(2);
        settings.framebufferPixelsPerRasterPixel = 0;
        expect(settings.resolvedFramebufferPixelsPerRasterPixel(1920, 1080)).toBe(1);
    });

    test("rasterizes without half blocks or colour quantization, 2x2 supersampled by default, with textures from the mesh settings", () => {
        const meshes = new MeshRenderSettings();
        const config = new MeshPixelPassSettings().toRasterizerConfig(new MemoryPlatform({hardwareConcurrency: 4}), meshes);
        expect([config.halfBlock, config.colorQuantMask, config.supersampleX, config.supersampleY, config.workerCount]).toEqual([false, 0xFFFFFF, 2, 2, 3]);
        const settings = new MeshPixelPassSettings();
        settings.supersampleY = EXPLICIT_SUPERSAMPLE;
        meshes.textures = false;
        const explicit = settings.toRasterizerConfig(new MemoryPlatform(), meshes);
        expect([explicit.supersampleX, explicit.supersampleY, explicit.textures]).toEqual([2, EXPLICIT_SUPERSAMPLE, false]);
    });
});

describe("MeshPixelPassSystem", () => {
    test("draws a mesh in front of the camera into the framebuffer, gated on its settings", () => {
        const presenter = new MemoryPixelPresenter(SIZE);
        const world = new World({platform: new MemoryPlatform()});
        world.resources.insert(new PixelPresenterResource(presenter));
        const root = world.getOrCreateSystem(RootSystemGroup);
        const em = world.entityManager;
        em.createEntity("camera", [new Camera(), new LocalToWorld(), new LocalPosition(), new FieldOfView()]);
        em.createEntity("quad", [new RenderMesh(quad()), new LocalToWorld(), new LocalPosition(0, 0, QUAD_DISTANCE)]);
        world.getOrCreateSystem(MeshPixelPassSystem);
        const stats = world.resources.get(MeshRenderStats);

        const centerRgb = () => {
            const frame = presenter.lastFrame!;
            const i = ((SIZE.heightPx / 2) * frame.widthPx + SIZE.widthPx / 2) * RGBA_BYTES_PER_PIXEL;
            return (frame.rgba[i] << RED_SHIFT) | (frame.rgba[i + 1] << GREEN_SHIFT) | frame.rgba[i + 2];
        };

        root.update();
        expect([stats.trianglesDrawn, centerRgb()]).toEqual([0, 0x000000]);

        em.createEntity("settings", [new MeshPixelPassSettings()]);
        root.update();
        root.update();
        expect(stats.trianglesDrawn).toBe(2);
        expect(centerRgb()).toBe(QUAD_RGB);
        expect(stats.rasterWorkers).toBe(0);
    });
});

function centreRgbOfCubeAt(cubeZ: number): number {
    const presenter = new MemoryPixelPresenter(SIZE);
    const world = new World({platform: new MemoryPlatform()});
    world.resources.insert(new PixelPresenterResource(presenter));
    const em = world.entityManager;
    em.createEntity("camera", [new Camera(), new LocalToWorld(), new LocalPosition(), new FieldOfView()]);
    em.createEntity("cube", [new RenderMesh(createUnitCubeMesh(), CUBE_RGB), new LocalToWorld(), new LocalPosition(0, 0, cubeZ)]);
    em.createEntity("settings", [new MeshPixelPassSettings()]);
    world.getOrCreateSystem(MeshPixelPassSystem);
    for (let step = 0; step < SETTLE_STEPS; step++) world.step(FRAME_MS);
    const frame = presenter.lastFrame!;
    const i = ((SIZE.heightPx / 2) * frame.widthPx + SIZE.widthPx / 2) * RGBA_BYTES_PER_PIXEL;
    return (frame.rgba[i] << RED_SHIFT) | (frame.rgba[i + 1] << GREEN_SHIFT) | frame.rgba[i + 2];
}

describe("MeshPixelPassSystem with the built-in unit cube", () => {
    test("draws the cube seen from outside, and culls every face seen from inside, so its faces wind outwards", () => {
        expect(centreRgbOfCubeAt(QUAD_DISTANCE)).toBe(CUBE_RGB);
        expect(centreRgbOfCubeAt(CAMERA_INSIDE_CUBE_Z)).toBe(BLACK_RGB);
    });
});

interface DrawingWorld {
    readonly world: World;
    readonly pass: MeshPixelPassSystem;
    readonly stats: MeshRenderStats;
    readonly group: PixelRenderSystemGroup;
}

function drawingWorld(): DrawingWorld {
    const world = new World({platform: new MemoryPlatform()});
    world.resources.insert(new PixelPresenterResource(new MemoryPixelPresenter(SIZE)));
    const em = world.entityManager;
    em.createEntity("camera", [new Camera(), new LocalToWorld(), new LocalPosition(), new FieldOfView()]);
    em.createEntity("quad", [new RenderMesh(quad()), new LocalToWorld(), new LocalPosition(0, 0, QUAD_DISTANCE)]);
    em.createEntity("settings", [new MeshPixelPassSettings()]);
    const pass = world.getOrCreateSystem(MeshPixelPassSystem);
    for (let step = 0; step < SETTLE_STEPS; step++) world.step(FRAME_MS);
    return {world, pass, stats: world.resources.get(MeshRenderStats), group: world.tryGetSystem(PixelRenderSystemGroup)!};
}

function lodLevelTotal(stats: MeshRenderStats): number {
    return Array.from(stats.lodLevelCounts).reduce((sum, count) => sum + count, 0);
}

describe("MeshRenderStats from the pixels mesh pass", () => {
    test("a pass that stops running keeps its last stats until its group walks its passes again, then reads zero", () => {
        const {world, pass, stats} = drawingWorld();
        expect([stats.trianglesDrawn, lodLevelTotal(stats)]).toEqual([QUAD_TRIANGLES, QUAD_LOD_DRAWS]);

        pass.enabled = false;
        expect([stats.trianglesDrawn, lodLevelTotal(stats)]).toEqual([QUAD_TRIANGLES, QUAD_LOD_DRAWS]);
        world.step(FRAME_MS);
        expect([stats.trianglesDrawn, lodLevelTotal(stats)]).toEqual([0, 0]);

        pass.enabled = true;
        world.step(FRAME_MS);
        expect(stats.trianglesDrawn).toBe(QUAD_TRIANGLES);
    });

    test("a second walk in the same frame without the pass makes the stats of the first walk read zero", () => {
        const {world, pass, stats, group} = drawingWorld();
        const frame = world.time.frameCount;
        group.update();
        expect(stats.trianglesDrawn).toBe(QUAD_TRIANGLES);

        pass.enabled = false;
        group.update();
        expect(world.time.frameCount).toBe(frame);
        expect([stats.trianglesDrawn, lodLevelTotal(stats)]).toEqual([0, 0]);
    });
});
