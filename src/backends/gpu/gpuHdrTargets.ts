import {GPU_TEXTURE_USAGE} from "./gpuTypes";
import type {GpuDevice} from "./gpuTypes";
import {HDR_SCENE_FORMAT} from "./gpuSceneOutput";
import {NO_BLOOM_LEVELS} from "./gpuPostProcessSettings";
import {POST_BLOOM_BINDING, POST_SAMPLER_BINDING, POST_SOURCE_BINDING, POST_UNIFORMS_BINDING} from "./shaders/postProcessLayout";

export const HDR_SCENE_LABEL = "hdr scene";
export const BLOOM_LEVEL_LABEL = "bloom level";
const HALVED = 2;
const SMALLEST_BLOOM_LEVEL_PX = 1;
const NO_SIZE = 0;
const FIRST_BLOOM_LEVEL = 0;

export type GpuHdrTargetDevice = Pick<GpuDevice, "createTexture" | "createBindGroup">;

export interface GpuPostProcessBindings {
    readonly bloomLayout: GPUBindGroupLayout;
    readonly compositeLayout: GPUBindGroupLayout;
    readonly sampler: GPUSampler;
    readonly uniformBuffer: GPUBuffer;
    readonly noBloomView: GPUTextureView;
}

export interface GpuHdrSceneComposer {
    compose(encoder: GPUCommandEncoder, targets: GpuHdrTargets, canvasView: GPUTextureView, canvasFormat: GPUTextureFormat): void;
}

export function bloomLevelPx(scenePx: number, level: number): number {
    return Math.floor(scenePx / HALVED ** (level + 1));
}

export function bloomLevelCountFor(requestedLevels: number, widthPx: number, heightPx: number): number {
    let levels = NO_BLOOM_LEVELS;
    while (levels < requestedLevels && Math.min(bloomLevelPx(widthPx, levels), bloomLevelPx(heightPx, levels)) >= SMALLEST_BLOOM_LEVEL_PX) levels++;
    return levels;
}

export class GpuHdrTargets {
    private scene: GPUTexture | undefined;
    private _sceneView: GPUTextureView | undefined;
    private readonly levels: GPUTexture[] = [];
    private readonly levelViews: GPUTextureView[] = [];
    private widthPx = NO_SIZE;
    private heightPx = NO_SIZE;
    private boundTo: GpuPostProcessBindings | undefined;
    private sceneSource: GPUBindGroup | undefined;
    private readonly levelSources: (GPUBindGroup | undefined)[] = [];
    private composite: GPUBindGroup | undefined;

    public constructor(private readonly device: GpuHdrTargetDevice) {
    }

    public get sceneView(): GPUTextureView {
        return this._sceneView!;
    }

    public get bloomLevelCount(): number {
        return this.levels.length;
    }

    public get sceneWidthPx(): number {
        return this.widthPx;
    }

    public get sceneHeightPx(): number {
        return this.heightPx;
    }

    public levelView(level: number): GPUTextureView {
        return this.levelViews[level];
    }

    public ensure(widthPx: number, heightPx: number, bloomLevels: number): void {
        const resized = this.scene === undefined || widthPx !== this.widthPx || heightPx !== this.heightPx;
        if (resized) {
            this.destroyScene();
            this.scene = this.createTarget(HDR_SCENE_LABEL, widthPx, heightPx);
            this._sceneView = this.scene.createView();
            this.widthPx = widthPx;
            this.heightPx = heightPx;
        }
        if (resized || bloomLevels !== this.levels.length) this.createLevels(bloomLevels);
    }

    public sceneSourceBindGroup(bindings: GpuPostProcessBindings): GPUBindGroup {
        this.bindWith(bindings);
        return this.sceneSource ??= this.sourceBindGroup(bindings, this.sceneView);
    }

    public levelSourceBindGroup(bindings: GpuPostProcessBindings, level: number): GPUBindGroup {
        this.bindWith(bindings);
        return this.levelSources[level] ??= this.sourceBindGroup(bindings, this.levelViews[level]);
    }

    public compositeBindGroup(bindings: GpuPostProcessBindings): GPUBindGroup {
        this.bindWith(bindings);
        return this.composite ??= this.device.createBindGroup({
            label: HDR_SCENE_LABEL,
            layout: bindings.compositeLayout,
            entries: [
                {binding: POST_SAMPLER_BINDING, resource: bindings.sampler},
                {binding: POST_SOURCE_BINDING, resource: this.sceneView},
                {binding: POST_UNIFORMS_BINDING, resource: {buffer: bindings.uniformBuffer}},
                {binding: POST_BLOOM_BINDING, resource: this.levels.length > NO_BLOOM_LEVELS ? this.levelViews[FIRST_BLOOM_LEVEL] : bindings.noBloomView},
            ],
        });
    }

    public dispose(): void {
        this.destroyScene();
        this.destroyLevels();
    }

    private createTarget(label: string, widthPx: number, heightPx: number): GPUTexture {
        return this.device.createTexture({
            label,
            size: {width: widthPx, height: heightPx},
            format: HDR_SCENE_FORMAT,
            usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.TEXTURE_BINDING,
        });
    }

    private createLevels(bloomLevels: number): void {
        this.destroyLevels();
        for (let level = 0; level < bloomLevels; level++) {
            const texture = this.createTarget(BLOOM_LEVEL_LABEL, bloomLevelPx(this.widthPx, level), bloomLevelPx(this.heightPx, level));
            this.levels.push(texture);
            this.levelViews.push(texture.createView());
        }
    }

    private sourceBindGroup(bindings: GpuPostProcessBindings, view: GPUTextureView): GPUBindGroup {
        return this.device.createBindGroup({
            label: BLOOM_LEVEL_LABEL,
            layout: bindings.bloomLayout,
            entries: [
                {binding: POST_SAMPLER_BINDING, resource: bindings.sampler},
                {binding: POST_SOURCE_BINDING, resource: view},
                {binding: POST_UNIFORMS_BINDING, resource: {buffer: bindings.uniformBuffer}},
            ],
        });
    }

    private bindWith(bindings: GpuPostProcessBindings): void {
        if (this.boundTo === bindings) return;
        this.boundTo = bindings;
        this.forgetBindGroups();
    }

    private forgetBindGroups(): void {
        this.sceneSource = undefined;
        this.levelSources.length = 0;
        this.composite = undefined;
    }

    private destroyScene(): void {
        this.scene?.destroy();
        this.scene = undefined;
        this._sceneView = undefined;
        this.widthPx = NO_SIZE;
        this.heightPx = NO_SIZE;
        this.forgetBindGroups();
    }

    private destroyLevels(): void {
        for (const level of this.levels) level.destroy();
        this.levels.length = 0;
        this.levelViews.length = 0;
        this.forgetBindGroups();
    }
}
