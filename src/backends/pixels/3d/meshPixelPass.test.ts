import {describe, expect, test} from "../../../engine/testing/harness";
import {MemoryPlatform} from "../../../engine/testing/memoryPlatform";
import {World} from "../../../engine/core/world";
import {RootSystemGroup} from "../../../engine/core/rootSystemGroup";
import {Vec} from "../../../engine/math/types/vec";
import {Camera} from "../../../engine/rendering/camera";
import {Mesh, MeshBuilder} from "../../../engine/rendering/3d/mesh";
import {Material} from "../../../engine/rendering/3d/material";
import {RenderMesh} from "../../../engine/rendering/3d/renderMesh";
import {FieldOfView} from "../../../engine/rendering/3d/fieldOfView";
import {RasterWorkerPool} from "../../../engine/rendering/3d/software";
import {LocalPosition, LocalToWorld} from "../../../engine/translation";
import {MemoryPixelPresenter} from "../memoryPixelPresenter";
import {PixelPresenterResource} from "../pixelPresenterResource";
import {RGBA_BYTES_PER_PIXEL} from "../pixelFrame";
import {MeshPixelPassSettings} from "./meshPixelPassSettings";
import {MeshPixelPassSystem} from "./meshPixelPassSystem";

const QUAD_RGB = 0x336699;
const QUAD_HALF_SIZE = 1;
const QUAD_DISTANCE = 4;
const SIZE = {widthPx: 64, heightPx: 48};
const RED_SHIFT = 16, GREEN_SHIFT = 8;

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

    test("rasterizes without half blocks or colour quantization", () => {
        const config = new MeshPixelPassSettings().toRasterizerConfig(new MemoryPlatform({hardwareConcurrency: 4}));
        expect([config.halfBlock, config.colorQuantMask, config.supersampleX, config.supersampleY, config.workerCount]).toEqual([false, 0xFFFFFF, 2, 2, 3]);
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
        const pass = world.getOrCreateSystem(MeshPixelPassSystem);

        const centerRgb = () => {
            const frame = presenter.lastFrame!;
            const i = ((SIZE.heightPx / 2) * frame.widthPx + SIZE.widthPx / 2) * RGBA_BYTES_PER_PIXEL;
            return (frame.rgba[i] << RED_SHIFT) | (frame.rgba[i + 1] << GREEN_SHIFT) | frame.rgba[i + 2];
        };

        root.update();
        expect([pass.trianglesDrawn, centerRgb()]).toEqual([0, 0x000000]);

        em.createEntity("settings", [new MeshPixelPassSettings()]);
        root.update();
        root.update();
        expect(pass.trianglesDrawn).toBe(2);
        expect(centerRgb()).toBe(QUAD_RGB);
        expect(pass.rasterWorkers).toBe(0);
    });
});
