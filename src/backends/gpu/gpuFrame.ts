import type {PixelFrame} from "../pixels/pixelFrame";
import {PresentationStats} from "../../engine/rendering/presentationStats";
import {CHANNEL_MASK, CHANNEL_MAX, GREEN_SHIFT, RED_SHIFT} from "../../engine/rendering/packedRgb";
import {GPU_TEXTURE_USAGE} from "./gpuTypes";
import type {GpuCanvasContext, GpuCanvasSurface, GpuDevice} from "./gpuTypes";
import {GpuOverlayPass} from "./gpuOverlayPass";
import {effectiveRenderScale, MIN_RENDER_SCALE, renderTargetPx, SINGLE_SAMPLE_COUNT} from "./gpuMeshPassSettings";
import {bloomLevelCountFor, GpuHdrTargets} from "./gpuHdrTargets";
import type {GpuHdrSceneComposer} from "./gpuHdrTargets";
import {HDR_SCENE_FORMAT} from "./gpuSceneOutput";
import {linearClearColorOf} from "./gpuColorSpace";

export const DEPTH_FORMAT: GPUTextureFormat = "depth32float";
export const COMPOSE_WITHOUT_HDR_SCENE = "GpuFrame.composeHdrScene needs beginHdrScene earlier in the same frame";
const REVERSED_DEPTH_CLEAR = 0;
const OPAQUE_CLEAR_ALPHA = 1;
const CLEARED_CANVAS: GPUColor = {r: 0, g: 0, b: 0, a: OPAQUE_CLEAR_ALPHA};

function releaseNothing(): void {
}

export function clearColorOf(rgb: number): GPUColor {
    return {
        r: ((rgb >> RED_SHIFT) & CHANNEL_MASK) / CHANNEL_MAX,
        g: ((rgb >> GREEN_SHIFT) & CHANNEL_MASK) / CHANNEL_MAX,
        b: (rgb & CHANNEL_MASK) / CHANNEL_MAX,
        a: OPAQUE_CLEAR_ALPHA,
    };
}

interface SceneTargets {
    readonly widthPx: number;
    readonly heightPx: number;
    readonly sampleCount: number;
    readonly colorFormat: GPUTextureFormat;
    readonly depth: GPUTexture;
    readonly depthView: GPUTextureView;
    readonly multisampled: GPUTexture | undefined;
    readonly multisampledView: GPUTextureView | undefined;
}

export class GpuFrame {
    public readonly stats = new PresentationStats();
    private readonly overlay: GpuOverlayPass;
    private encoder: GPUCommandEncoder | undefined;
    private canvasTexture: GPUTexture | undefined;
    private sceneDrawn = false;
    private hdrSceneEncoded = false;
    private targets: SceneTargets | undefined;
    private hdrTargets: GpuHdrTargets | undefined;
    private renderScale = MIN_RENDER_SCALE;
    private _framesInFlight = 0;
    private readonly presentedListeners = new Set<() => void>();

    public constructor(
        private readonly device: GpuDevice,
        private readonly context: GpuCanvasContext,
        private readonly canvas: GpuCanvasSurface,
        private readonly format: GPUTextureFormat,
        private readonly release: () => void = releaseNothing,
    ) {
        this.overlay = new GpuOverlayPass(device, format);
    }

    public get framesInFlight(): number {
        return this._framesInFlight;
    }

    public get canvasFormat(): GPUTextureFormat {
        return this.format;
    }

    public onPresented(listener: () => void): () => void {
        const entry = (): void => listener();
        this.presentedListeners.add(entry);
        return () => {
            this.presentedListeners.delete(entry);
        };
    }

    public beginScene(clearRgb: number, sampleCount: number, framebufferWidthPx: number, framebufferHeightPx: number, renderScale: number): GPURenderPassEncoder {
        this.releaseHdrTargets();
        this.sizeCanvas(framebufferWidthPx, framebufferHeightPx, renderScale);
        const canvasView = this.currentCanvasTexture().createView();
        const targets = this.sceneTargets(this.canvas.width, this.canvas.height, sampleCount, this.format);
        const pass = this.beginScenePass(targets, canvasView, clearColorOf(clearRgb));
        this.sceneDrawn = true;
        return pass;
    }

    public beginHdrScene(
        clearRgb: number, sampleCount: number, framebufferWidthPx: number, framebufferHeightPx: number, renderScale: number, requestedBloomLevels: number,
    ): GPURenderPassEncoder {
        this.sizeCanvas(framebufferWidthPx, framebufferHeightPx, renderScale);
        const widthPx = this.canvas.width, heightPx = this.canvas.height;
        const hdr = this.hdrTargets ??= new GpuHdrTargets(this.device);
        hdr.ensure(widthPx, heightPx, bloomLevelCountFor(requestedBloomLevels, widthPx, heightPx));
        const targets = this.sceneTargets(widthPx, heightPx, sampleCount, HDR_SCENE_FORMAT);
        const pass = this.beginScenePass(targets, hdr.sceneView, linearClearColorOf(clearRgb));
        this.hdrSceneEncoded = true;
        return pass;
    }

    public composeHdrScene(composer: GpuHdrSceneComposer): void {
        const hdr = this.hdrTargets;
        if (!this.hdrSceneEncoded || hdr === undefined) throw new Error(COMPOSE_WITHOUT_HDR_SCENE);
        composer.compose(this.currentEncoder(), hdr, this.currentCanvasTexture().createView(), this.format);
        this.sceneDrawn = true;
    }

    public finish(frame: PixelFrame): void {
        if (frame.widthPx === 0 || frame.heightPx === 0) {
            this.abandonFrame();
            return;
        }
        if (this.sizeCanvasFor(frame.widthPx, frame.heightPx)) this.abandonFrame();
        const canvasView = this.currentCanvasTexture().createView();
        const uploadedBytes = this.overlay.upload(frame);
        const encoder = this.currentEncoder();
        const pass = encoder.beginRenderPass({
            label: "overlay",
            colorAttachments: [{
                view: canvasView,
                clearValue: CLEARED_CANVAS,
                loadOp: this.sceneDrawn ? "load" : "clear",
                storeOp: "store",
            }],
        });
        this.overlay.draw(pass, this.sceneDrawn);
        pass.end();
        this.device.queue.submit([encoder.finish()]);
        this.abandonFrame();
        this.trackSubmittedWork();
        this.stats.recordSubmittedFrame(uploadedBytes);
    }

    public dispose(): void {
        this.abandonFrame();
        this.destroyTargets();
        this.releaseHdrTargets();
        this.overlay.dispose();
        this.release();
    }

    private sizeCanvas(framebufferWidthPx: number, framebufferHeightPx: number, renderScale: number): void {
        this.renderScale = renderScale;
        if (this.sizeCanvasFor(framebufferWidthPx, framebufferHeightPx)) this.abandonFrame();
    }

    private beginScenePass(targets: SceneTargets, resolvedView: GPUTextureView, clearValue: GPUColor): GPURenderPassEncoder {
        const multisampledView = targets.multisampledView;
        return this.currentEncoder().beginRenderPass({
            label: "scene",
            colorAttachments: [{
                view: multisampledView ?? resolvedView,
                resolveTarget: multisampledView === undefined ? undefined : resolvedView,
                clearValue,
                loadOp: "clear",
                storeOp: multisampledView === undefined ? "store" : "discard",
            }],
            depthStencilAttachment: {
                view: targets.depthView,
                depthClearValue: REVERSED_DEPTH_CLEAR,
                depthLoadOp: "clear",
                depthStoreOp: "discard",
            },
        });
    }

    private releaseHdrTargets(): void {
        this.hdrTargets?.dispose();
        this.hdrTargets = undefined;
    }

    private sizeCanvasFor(framebufferWidthPx: number, framebufferHeightPx: number): boolean {
        const scale = effectiveRenderScale(this.renderScale, framebufferWidthPx, framebufferHeightPx);
        const widthPx = renderTargetPx(framebufferWidthPx, scale), heightPx = renderTargetPx(framebufferHeightPx, scale);
        if (this.canvas.width === widthPx && this.canvas.height === heightPx) return false;
        this.canvas.width = widthPx;
        this.canvas.height = heightPx;
        return true;
    }

    private currentCanvasTexture(): GPUTexture {
        return this.canvasTexture ??= this.context.getCurrentTexture();
    }

    private currentEncoder(): GPUCommandEncoder {
        return this.encoder ??= this.device.createCommandEncoder({label: "frame"});
    }

    private abandonFrame(): void {
        this.encoder = undefined;
        this.canvasTexture = undefined;
        this.sceneDrawn = false;
        this.hdrSceneEncoded = false;
    }

    private sceneTargets(widthPx: number, heightPx: number, sampleCount: number, colorFormat: GPUTextureFormat): SceneTargets {
        const current = this.targets;
        if (current !== undefined && current.widthPx === widthPx && current.heightPx === heightPx && current.sampleCount === sampleCount
            && current.colorFormat === colorFormat) return current;
        this.destroyTargets();
        const size = {width: widthPx, height: heightPx};
        const depth = this.device.createTexture({label: "scene depth", size, format: DEPTH_FORMAT, sampleCount, usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT});
        const multisampled = sampleCount > SINGLE_SAMPLE_COUNT
            ? this.device.createTexture({label: "scene colour", size, format: colorFormat, sampleCount, usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT})
            : undefined;
        const targets: SceneTargets = {
            widthPx, heightPx, sampleCount, colorFormat,
            depth,
            depthView: depth.createView(),
            multisampled,
            multisampledView: multisampled?.createView(),
        };
        this.targets = targets;
        return targets;
    }

    private destroyTargets(): void {
        this.targets?.depth.destroy();
        this.targets?.multisampled?.destroy();
        this.targets = undefined;
    }

    private trackSubmittedWork(): void {
        this._framesInFlight++;
        void this.device.queue.onSubmittedWorkDone().then(this.releaseSubmittedFrame, this.releaseSubmittedFrame);
    }

    private readonly releaseSubmittedFrame = (): void => {
        this._framesInFlight--;
        for (const listener of this.presentedListeners) listener();
    };
}
