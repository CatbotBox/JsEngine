import {describe, expect, test} from "../../engine/testing/harness";
import {RGBA_BYTES_PER_PIXEL} from "../pixels/pixelFrame";
import type {PixelFrame} from "../pixels/pixelFrame";
import {MemoryPixelPresenter} from "../pixels/memoryPixelPresenter";
import {clearColorOf, DEPTH_FORMAT, GpuFrame} from "./gpuFrame";
import {GpuDeviceResource} from "./gpuDeviceResource";
import {GpuCanvasPixelPresenter, MAX_GPU_FRAMES_IN_FLIGHT} from "./gpuCanvasPixelPresenter";
import {MIN_RENDER_SCALE, MULTISAMPLE_COUNT, SINGLE_SAMPLE_COUNT} from "./gpuMeshPassSettings";
import {OVERLAY_TEXTURE_FORMAT} from "./gpuOverlayPass";
import {FULL_SCREEN_TRIANGLE_VERTICES} from "./shaders/overlayShader";
import {FakeCanvas, FakeCanvasContext, FakeGpuDevice, FakeGpuTexture} from "./testing/fakeGpuDevice";
import type {FakeGpuTextureView, FakeRenderPass} from "./testing/fakeGpuDevice";

const FORMAT: GPUTextureFormat = "bgra8unorm";
const WIDTH = 64, HEIGHT = 32;
const RESIZED_WIDTH = 128, RESIZED_HEIGHT = 48;
const BACKGROUND = 0x102030;
const UNIT_X = 8, UNIT_Y = 16;
const UNSCALED = MIN_RENDER_SCALE;
const DEVICE_RENDER_SCALE = 2;

interface Rig {
    readonly device: FakeGpuDevice;
    readonly canvas: FakeCanvas;
    readonly context: FakeCanvasContext;
    readonly frame: GpuFrame;
}

function rig(): Rig {
    const device = new FakeGpuDevice();
    const canvas = new FakeCanvas();
    const context = new FakeCanvasContext(canvas, FORMAT);
    return {device, canvas, context, frame: new GpuFrame(device, context, canvas, FORMAT)};
}

function pixelFrame(widthPx: number = WIDTH, heightPx: number = HEIGHT): PixelFrame {
    return {widthPx, heightPx, rgba: new Uint8ClampedArray(widthPx * heightPx * RGBA_BYTES_PER_PIXEL), pixelsPerScreenUnitX: UNIT_X, pixelsPerScreenUnitY: UNIT_Y};
}

function textureOf(view: GPUTexture | GPUTextureView | undefined): FakeGpuTexture | undefined {
    return (view as unknown as FakeGpuTextureView | undefined)?.texture;
}

function colorAttachment(pass: FakeRenderPass): GPURenderPassColorAttachment {
    return [...pass.descriptor.colorAttachments][0]!;
}

function overlayPipelineLabel(device: FakeGpuDevice, pass: FakeRenderPass): string | undefined {
    const pipeline = pass.callsOf("setPipeline")[0]?.args[0] as GPURenderPipelineDescriptor | undefined;
    return device.pipelines.includes(pipeline!) ? pipeline!.label : undefined;
}

const nextTask = () => new Promise<void>(done => setTimeout(done, 0));

describe("GpuFrame", () => {
    test("finishing a frame without a scene clears the canvas, draws the 2D overlay opaque and submits once", () => {
        const {device, canvas, context, frame} = rig();
        frame.finish(pixelFrame());
        expect([canvas.width, canvas.height]).toEqual([WIDTH, HEIGHT]);
        expect(device.queue.submissions.length).toBe(1);
        const passes = device.submittedPasses;
        expect(passes.length).toBe(1);
        const attachment = colorAttachment(passes[0]);
        expect([attachment.loadOp, attachment.storeOp]).toEqual(["clear", "store"]);
        expect(textureOf(attachment.view)).toBe(context.currentTextures[0]);
        expect(overlayPipelineLabel(device, passes[0])).toBe("overlay opaque");
        expect(passes[0].callsOf("draw").map(call => call.args[0])).toEqual([FULL_SCREEN_TRIANGLE_VERTICES]);
        expect(passes[0].ended).toBe(true);
        const upload = device.queue.textureWrites[0];
        expect([upload.texture.descriptor.format, upload.size, upload.layout.bytesPerRow]).toEqual([OVERLAY_TEXTURE_FORMAT, {width: WIDTH, height: HEIGHT}, WIDTH * RGBA_BYTES_PER_PIXEL]);
    });

    test("a scene pass clears to the background with reversed depth, resolves its multisamples into the canvas, and the overlay blends over it", () => {
        const {device, context, frame} = rig();
        const scene = frame.beginScene(BACKGROUND, MULTISAMPLE_COUNT, WIDTH, HEIGHT, UNSCALED);
        scene.end();
        frame.finish(pixelFrame());
        const [scenePass, overlayPass] = device.submittedPasses;
        const sceneColor = colorAttachment(scenePass);
        expect(sceneColor.clearValue).toEqual(clearColorOf(BACKGROUND));
        expect(textureOf(sceneColor.view)?.descriptor.sampleCount).toBe(MULTISAMPLE_COUNT);
        expect(textureOf(sceneColor.resolveTarget)).toBe(context.currentTextures[0]);
        const depth = scenePass.descriptor.depthStencilAttachment!;
        expect([depth.depthClearValue, depth.depthLoadOp, textureOf(depth.view)?.descriptor.format]).toEqual([0, "clear", DEPTH_FORMAT]);
        expect(colorAttachment(overlayPass).loadOp).toBe("load");
        expect(overlayPipelineLabel(device, overlayPass)).toBe("overlay blended");
        expect([device.queue.submissions.length, context.currentTextures.length]).toEqual([1, 1]);
    });

    test("a single-sample scene draws straight into the canvas texture", () => {
        const {device, context, frame} = rig();
        frame.beginScene(BACKGROUND, SINGLE_SAMPLE_COUNT, WIDTH, HEIGHT, UNSCALED).end();
        frame.finish(pixelFrame());
        const sceneColor = colorAttachment(device.submittedPasses[0]);
        expect([textureOf(sceneColor.view), sceneColor.resolveTarget, sceneColor.storeOp]).toEqual([context.currentTextures[0], undefined, "store"]);
    });

    test("depth and multisample targets follow the canvas size and sample count, and are kept otherwise", () => {
        const {device, canvas, frame} = rig();
        const sceneTargets = () => device.textures.filter(texture => texture.descriptor.label?.startsWith("scene"));
        frame.beginScene(BACKGROUND, MULTISAMPLE_COUNT, WIDTH, HEIGHT, UNSCALED).end();
        frame.finish(pixelFrame());
        frame.beginScene(BACKGROUND, MULTISAMPLE_COUNT, WIDTH, HEIGHT, UNSCALED).end();
        frame.finish(pixelFrame());
        expect(sceneTargets().length).toBe(2);
        frame.beginScene(BACKGROUND, MULTISAMPLE_COUNT, RESIZED_WIDTH, RESIZED_HEIGHT, UNSCALED).end();
        frame.finish(pixelFrame(RESIZED_WIDTH, RESIZED_HEIGHT));
        expect([canvas.width, canvas.height]).toEqual([RESIZED_WIDTH, RESIZED_HEIGHT]);
        const live = sceneTargets().filter(texture => !texture.destroyed);
        expect(live.map(texture => texture.descriptor.size)).toEqual([{width: RESIZED_WIDTH, height: RESIZED_HEIGHT}, {width: RESIZED_WIDTH, height: RESIZED_HEIGHT}]);
        expect(sceneTargets().length).toBe(4);
        frame.beginScene(BACKGROUND, SINGLE_SAMPLE_COUNT, RESIZED_WIDTH, RESIZED_HEIGHT, UNSCALED).end();
        frame.finish(pixelFrame(RESIZED_WIDTH, RESIZED_HEIGHT));
        expect(sceneTargets().filter(texture => !texture.destroyed).map(texture => texture.descriptor.format)).toEqual([DEPTH_FORMAT]);
    });

    test("a render scale draws the scene into a canvas that many times the framebuffer, and the framebuffer-sized overlay stretches over it", () => {
        const {device, canvas, context, frame} = rig();
        const scaledSize = {width: WIDTH * DEVICE_RENDER_SCALE, height: HEIGHT * DEVICE_RENDER_SCALE};
        frame.beginScene(BACKGROUND, MULTISAMPLE_COUNT, WIDTH, HEIGHT, DEVICE_RENDER_SCALE).end();
        frame.finish(pixelFrame());
        expect([canvas.width, canvas.height]).toEqual([scaledSize.width, scaledSize.height]);
        const [scenePass, overlayPass] = device.submittedPasses;
        expect(textureOf(colorAttachment(scenePass).view)?.descriptor.size).toEqual(scaledSize);
        expect(textureOf(scenePass.descriptor.depthStencilAttachment!.view)?.descriptor.size).toEqual(scaledSize);
        expect(textureOf(colorAttachment(overlayPass).view)).toBe(context.currentTextures[0]);
        expect(context.currentTextures[0].descriptor.size).toEqual(scaledSize);
        expect([colorAttachment(overlayPass).loadOp, context.currentTextures.length, device.queue.submissions.length]).toEqual(["load", 1, 1]);
        expect(overlayPass.callsOf("draw").map(call => call.args[0])).toEqual([FULL_SCREEN_TRIANGLE_VERTICES]);
        expect(device.queue.textureWrites[0].size).toEqual({width: WIDTH, height: HEIGHT});
    });

    test("frames without a scene keep the last render scale, so the canvas is not resized between them", () => {
        const {canvas, context, frame} = rig();
        frame.beginScene(BACKGROUND, SINGLE_SAMPLE_COUNT, WIDTH, HEIGHT, DEVICE_RENDER_SCALE).end();
        frame.finish(pixelFrame());
        frame.finish(pixelFrame());
        expect([canvas.width, canvas.height]).toEqual([WIDTH * DEVICE_RENDER_SCALE, HEIGHT * DEVICE_RENDER_SCALE]);
        expect(context.currentTextures.length).toBe(2);
        frame.beginScene(BACKGROUND, SINGLE_SAMPLE_COUNT, WIDTH, HEIGHT, UNSCALED).end();
        frame.finish(pixelFrame());
        expect([canvas.width, canvas.height]).toEqual([WIDTH, HEIGHT]);
    });

    test("an empty frame submits nothing", () => {
        const {device, frame} = rig();
        frame.finish(pixelFrame(0, 0));
        expect(device.queue.submissions.length).toBe(0);
        expect(frame.framesInFlight).toBe(0);
    });

    test("dispose destroys the targets and the overlay texture", () => {
        const {device, frame} = rig();
        frame.beginScene(BACKGROUND, MULTISAMPLE_COUNT, WIDTH, HEIGHT, UNSCALED).end();
        frame.finish(pixelFrame());
        frame.dispose();
        expect(device.liveTextures().length).toBe(0);
    });
});

describe("GpuCanvasPixelPresenter", () => {
    test("overlays the scene, takes its size from the page surface and reports the screen unit of each frame", () => {
        const {device, frame} = rig();
        const surface = new MemoryPixelPresenter({widthPx: WIDTH, heightPx: HEIGHT});
        const reported: [number, number][] = [];
        const presenter = new GpuCanvasPixelPresenter(surface, new GpuDeviceResource(device, frame), (x, y) => reported.push([x, y]));
        let resized = 0;
        presenter.onResize(() => resized++);
        surface.resize(RESIZED_WIDTH, RESIZED_HEIGHT);
        expect([presenter.overlaysScene, presenter.size(), resized]).toEqual([true, {widthPx: RESIZED_WIDTH, heightPx: RESIZED_HEIGHT}, 1]);
        presenter.present(pixelFrame());
        expect(reported).toEqual([[UNIT_X, UNIT_Y]]);
        expect(device.queue.submissions.length).toBe(1);
    });

    test(`is backlogged while ${MAX_GPU_FRAMES_IN_FLIGHT} submitted frames are unfinished on the GPU`, async () => {
        const {device, frame} = rig();
        const presenter = new GpuCanvasPixelPresenter(new MemoryPixelPresenter(), new GpuDeviceResource(device, frame), () => {});
        presenter.present(pixelFrame());
        expect(presenter.backlogged()).toBe(false);
        presenter.present(pixelFrame());
        expect(presenter.backlogged()).toBe(true);
        device.queue.completeSubmittedWork();
        await nextTask();
        expect([presenter.backlogged(), frame.framesInFlight]).toEqual([false, 0]);
    });

    test("tells its presented listeners each time a submitted frame finishes on the GPU, until they stop listening", async () => {
        const {device, frame} = rig();
        const presenter = new GpuCanvasPixelPresenter(new MemoryPixelPresenter(), new GpuDeviceResource(device, frame), () => {});
        const inFlightWhenHeard: number[] = [];
        const stopListening = presenter.onPresented(() => inFlightWhenHeard.push(frame.framesInFlight));
        presenter.present(pixelFrame());
        presenter.present(pixelFrame());
        device.queue.completeSubmittedWork();
        await nextTask();
        expect(inFlightWhenHeard).toEqual([1, 0]);
        stopListening();
        presenter.present(pixelFrame());
        device.queue.completeSubmittedWork();
        await nextTask();
        expect(inFlightWhenHeard).toEqual([1, 0]);
    });

    test("dispose releases the device once", () => {
        const {device, frame} = rig();
        let releases = 0;
        const presenter = new GpuCanvasPixelPresenter(new MemoryPixelPresenter(), new GpuDeviceResource(device, frame, () => releases++), () => {});
        presenter.dispose();
        presenter.dispose();
        expect(releases).toBe(1);
    });
});
