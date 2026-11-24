import {System} from "../../engine/core";
import type {RenderPassKind} from "../../engine/rendering/renderPasses";
import {Camera} from "../../engine/rendering/camera";
import {RenderCameraOverride} from "../../engine/rendering/renderCameraOverride";
import {LocalToWorld} from "../../engine/translation";
import {RenderMesh} from "../../engine/rendering/3d/renderMesh";
import {FieldOfView} from "../../engine/rendering/3d/fieldOfView";
import {MeshRenderSettings} from "../../engine/rendering/3d/meshRenderSettings";
import {MeshRenderStats, TRACKED_LOD_LEVELS} from "../../engine/rendering/3d/meshRenderStats";
import type {MeshDrawCounts} from "../../engine/rendering/3d/meshRenderStats";
import {RenderMeshBoundsSystem} from "../../engine/rendering/3d/renderMeshBoundsSystem";
import {selectLodLevel} from "../../engine/rendering/3d/meshLod";
import {ScreenProjectedBounds} from "../../engine/rendering/3d/screenProjectedBounds";
import {SceneLights} from "../../engine/rendering/3d/lighting/sceneLights";
import {SceneLightsGatherSystem} from "../../engine/rendering/3d/lighting/sceneLightsGatherSystem";
import {WorldSpaceRenderBounds} from "../../engine/rendering/worldSpaceRenderBounds";
import {AABB_MAX_X, AABB_MAX_Y, AABB_MAX_Z, AABB_MIN_X, AABB_MIN_Y, AABB_MIN_Z, AABB_STRIDE} from "../../engine/datatypes/aabb";
import {asFloat32Array, fromFloat32Array} from "../../engine/math/types/vec";
import type {ReadonlyVec16} from "../../engine/math/types/vec";
import {PixelFramebuffer} from "../pixels/pixelFramebuffer";
import {PixelPresenterResource} from "../pixels/pixelPresenterResource";
import {PixelRenderSystemGroup} from "../pixels/pixelRenderSystemGroup";
import {backgroundColorOf, PixelRenderSettings} from "../pixels/pixelRenderSettings";
import {asGpuBufferSource, GPU_BUFFER_USAGE} from "./gpuTypes";
import type {GpuDevice} from "./gpuTypes";
import {GpuDeviceResource} from "./gpuDeviceResource";
import {gpuFrameOf} from "./gpuCanvasPixelPresenter";
import type {GpuFrame} from "./gpuFrame";
import {FRAME_UNIFORM_FLOATS, frameViewMatrix, perspectiveFocalLength, writeFrameTime, writeFrameUniforms} from "./gpuCamera";
import {FLOAT_BYTES, GpuLightPacking, packSceneLights} from "./gpuLightPacking";
import {GpuInstanceBatcher, INSTANCE_FLOATS} from "./gpuInstanceBatcher";
import {GpuMeshCache} from "./gpuMeshCache";
import {GpuTextureCache} from "./gpuTextureCache";
import {GpuMaterialCache} from "./gpuMaterialCache";
import {GpuPipelineCache} from "./gpuPipelineCache";
import {GpuShaderLibrary} from "./gpuShaderLibrary";
import {GpuSurfaceShader} from "./gpuSurfaceShader";
import {effectiveRenderScale, GpuMeshPassSettings, MIN_RENDER_SCALE, MULTISAMPLE_COUNT, renderTargetPx, SINGLE_SAMPLE_COUNT} from "./gpuMeshPassSettings";
import type {GpuSampleCount} from "./gpuMeshPassSettings";
import {BASE_LOD_LEVEL, CULLED, GpuRowLevels, NO_ROW_LEVEL_OFFSET, visitMeshRuns} from "./gpuMeshRuns";
import type {BoundedMeshSpan, MeshRunVisitor, MeshSpan, MeshSpanSource} from "./gpuMeshRuns";
import {GpuShadowSettings} from "./gpuShadowSettings";
import {GpuShadowInput, GpuShadowPass} from "./gpuShadowPass";
import {
    FRAME_BIND_GROUP,
    FRAME_BIND_GROUP_LAYOUT,
    FRAME_UNIFORMS_BINDING,
    INSTANCE_VERTEX_BUFFER_SLOT,
    LIGHTS_BINDING,
    MATERIAL_BIND_GROUP,
    MATERIAL_BIND_GROUP_LAYOUT,
    MESH_VERTEX_BUFFER_SLOT,
    SHADOW_MAP_BINDING,
    SHADOW_SAMPLER_BINDING,
    SHADOW_UNIFORMS_BINDING,
} from "./shaders/basicLitShader";

export const GPU_BACKEND_EXPERIMENTAL_NOTICE = "The WebGPU render backend (?backend=gpu) is experimental: "
    + "lighting is per-pixel and output differs from ?backend=pixels.";

const SQUARE_PIXEL_HEIGHT_PER_WIDTH = 1;
const NO_RASTER_WORKERS = 0;
const NOTHING_DRAWN = 0;
const NO_BASE_VERTEX = 0;
const INDEX_FORMAT: GPUIndexFormat = "uint32";
const MS_PER_SECOND = 1000;
const CAMERA_SPEC = {camera: Camera, localToWorld: LocalToWorld};
const FIELD_OF_VIEW_SPEC = {fieldOfView: FieldOfView};

class GpuDrawCounts implements MeshDrawCounts {
    public trianglesDrawn = NOTHING_DRAWN;
    public readonly lodLevelCounts = new Int32Array(TRACKED_LOD_LEVELS);
    public readonly rasterWorkers = NO_RASTER_WORKERS;

    public reset(): void {
        this.trianglesDrawn = NOTHING_DRAWN;
        this.lodLevelCounts.fill(NOTHING_DRAWN);
    }
}

export class GpuMeshPassSystem extends System {
    public static readonly renderPass: RenderPassKind = "meshes";

    private readonly _drawn = new GpuDrawCounts();

    private _settingsQuery = this.createEntityQuery([GpuMeshPassSettings]);
    private _meshSettingsQuery = this.createEntityQuery([MeshRenderSettings]);
    private _shadowSettingsQuery = this.createEntityQuery([GpuShadowSettings]);
    private _renderSettingsQuery = this.createEntityQuery([PixelRenderSettings]);
    private _cameraQuery = this.createEntityQuery([Camera, LocalToWorld]);
    private _unboundedMeshQuery = this.createEntityQuery([RenderMesh, LocalToWorld], [WorldSpaceRenderBounds]);
    private _boundedMeshQuery = this.createEntityQuery([RenderMesh, LocalToWorld, WorldSpaceRenderBounds]);
    private readonly _defaultSettings = new GpuMeshPassSettings();
    private readonly _defaultMeshSettings = new MeshRenderSettings();
    private _settings = this._defaultSettings;
    private _meshSettings = this._defaultMeshSettings;
    private readonly _batcher = new GpuInstanceBatcher();
    private readonly _frameUniforms = new Float32Array(FRAME_UNIFORM_FLOATS);
    private readonly _lights = new GpuLightPacking();
    private readonly _projectedBounds = new ScreenProjectedBounds();
    private readonly _rowLevels = new GpuRowLevels();
    private readonly _shadowInput = new GpuShadowInput();
    private _renderPxPerFramebufferPxX = MIN_RENDER_SCALE;
    private _renderPxPerFramebufferPxY = MIN_RENDER_SCALE;
    private _frameNumber = 0;
    private _cameraMatrix: ReadonlyVec16 | undefined;
    private _cameraFieldOfView: number | undefined;
    private _startTimeMs = 0;

    private _gpu!: GpuDeviceResource;
    private _frameBindGroupLayout!: GPUBindGroupLayout;
    private _frameUniformBuffer!: GPUBuffer;
    private _lightBuffer!: GPUBuffer;
    private _lightBufferBytes = 0;
    private _frameBindGroup: GPUBindGroup | undefined;
    private _frameBindGroupShadowView: GPUTextureView | undefined;
    private _instanceBuffer: GPUBuffer | undefined;
    private _instanceBufferBytes = 0;
    private _textures!: GpuTextureCache;
    private _materials!: GpuMaterialCache;
    private _meshes!: GpuMeshCache;
    private _pipelines!: GpuPipelineCache;
    private _shadows!: GpuShadowPass;

    override systemGroup() {
        return PixelRenderSystemGroup;
    }

    override priority(): number {
        return 0;
    }

    protected onCreate() {
        console.warn(GPU_BACKEND_EXPERIMENTAL_NOTICE);
        this.world.resources.getOrCreate(MeshRenderStats);
        this.requireQueryOrResourceForUpdate(this._cameraQuery, RenderCameraOverride);
        this.requireAnyForUpdate(this._unboundedMeshQuery);
        this.requireAnyForUpdate(this._boundedMeshQuery);
        this.world.ensureSystemExists(RenderMeshBoundsSystem);
        this.world.ensureSystemExists(SceneLightsGatherSystem);

        this._gpu = GpuDeviceResource.deviceOf(this.world);
        const device = this._gpu.device;
        this._frameBindGroupLayout = device.createBindGroupLayout(FRAME_BIND_GROUP_LAYOUT);
        const materialBindGroupLayout = device.createBindGroupLayout(MATERIAL_BIND_GROUP_LAYOUT);
        const pipelineLayout = device.createPipelineLayout({label: "mesh", bindGroupLayouts: [this._frameBindGroupLayout, materialBindGroupLayout]});
        this._frameUniformBuffer = device.createBuffer({
            label: "frame uniforms",
            size: FRAME_UNIFORM_FLOATS * FLOAT_BYTES,
            usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
        });
        this.createLightBuffer(device);
        this._textures = new GpuTextureCache(device);
        this._materials = new GpuMaterialCache(device, materialBindGroupLayout, this._textures);
        this._meshes = new GpuMeshCache(device);
        this._pipelines = new GpuPipelineCache(device, pipelineLayout);
        this._shadows = new GpuShadowPass(device);
        this._startTimeMs = this.world.time.elapsedTimeMs;
    }

    override onEnable(): void {
        this.world.renderers.add("gpu");
    }

    override onDisable(): void {
        this.world.renderers.remove("gpu");
    }

    onUpdate() {
        this._drawn.reset();
        this.drawScene();
        this.world.resources.getOrCreate(MeshRenderStats).record(this.world.tryGetSystem(PixelRenderSystemGroup), this._drawn);
    }

    private drawScene(): void {
        const framebuffer = this.world.resources.tryGet(PixelFramebuffer);
        if (framebuffer === undefined || framebuffer.widthPx === 0 || framebuffer.heightPx === 0) return;
        if (!this.readSingleCamera()) return;
        const settings = this._settingsQuery.tryGetSingleton({settings: GpuMeshPassSettings})?.settings ?? this._defaultSettings;
        const meshSettings = this._meshSettingsQuery.tryGetSingleton({settings: MeshRenderSettings})?.settings ?? this._defaultMeshSettings;
        this._settings = settings;
        this._meshSettings = meshSettings;
        const sampleCount: GpuSampleCount = settings.sampleCount > SINGLE_SAMPLE_COUNT ? MULTISAMPLE_COUNT : SINGLE_SAMPLE_COUNT;
        const device = this._gpu.device;
        const widthPx = framebuffer.widthPx, heightPx = framebuffer.heightPx;
        const renderScale = effectiveRenderScale(settings.renderScale, widthPx, heightPx);
        this._renderPxPerFramebufferPxX = renderTargetPx(widthPx, renderScale) / widthPx;
        this._renderPxPerFramebufferPxY = renderTargetPx(heightPx, renderScale) / heightPx;
        this._frameNumber++;

        writeFrameUniforms(this._frameUniforms, this._cameraMatrix!, this._cameraFieldOfView, widthPx, heightPx,
            SQUARE_PIXEL_HEIGHT_PER_WIDTH, settings.orthographicDepthRange);
        writeFrameTime(this._frameUniforms, (this.world.time.elapsedTimeMs - this._startTimeMs) / MS_PER_SECOND);
        device.queue.writeBuffer(this._frameUniformBuffer, 0, asGpuBufferSource(this._frameUniforms));
        const view = frameViewMatrix(this._frameUniforms);
        const sceneLights = this.world.resources.tryGet(SceneLights);
        packSceneLights(sceneLights, view, this._lights);
        this.uploadLights(device);
        const focalLength = this._cameraFieldOfView === undefined ? undefined : perspectiveFocalLength(this._cameraFieldOfView, heightPx);
        this._projectedBounds.begin(fromFloat32Array<16>(view), focalLength, SQUARE_PIXEL_HEIGHT_PER_WIDTH, widthPx, heightPx);
        const surface = {surfaceShader: GpuSurfaceShader};
        const unbounded = this._unboundedMeshQuery.stream({read: {renderMesh: RenderMesh, localToWorld: LocalToWorld}, optional: surface});
        const bounded = this._boundedMeshQuery.stream({read: {renderMesh: RenderMesh, localToWorld: LocalToWorld, bounds: WorldSpaceRenderBounds}, optional: surface});
        this.batchInstances(unbounded, bounded);
        this.uploadInstances(device);
        this.renderShadows(sceneLights, widthPx, heightPx, unbounded, bounded);
        const frameBindGroup = this.frameBindGroup(device);

        const background = backgroundColorOf(this._renderSettingsQuery.tryGetSingleton({settings: PixelRenderSettings})?.settings);
        const pass = this.presentedFrame().beginScene(background, sampleCount, widthPx, heightPx, settings.renderScale);
        this.drawBatches(pass, frameBindGroup, settings, meshSettings, sampleCount, this.world.resources.getOrCreate(GpuShaderLibrary));
        pass.end();
        this.evictUnused(settings.evictUnusedAfterFrames);
    }

    private renderShadows(sceneLights: SceneLights | undefined, widthPx: number, heightPx: number,
        unbounded: MeshSpanSource<MeshSpan>, bounded: MeshSpanSource<BoundedMeshSpan>): void {
        const input = this._shadowInput;
        input.settings = this._shadowSettingsQuery.tryGetSingleton({settings: GpuShadowSettings})?.settings;
        input.lights = sceneLights;
        input.cameraMatrix = asFloat32Array(this._cameraMatrix!);
        input.fieldOfViewRadians = this._cameraFieldOfView;
        input.widthPx = widthPx;
        input.heightPx = heightPx;
        input.pixelHeightPerWidth = SQUARE_PIXEL_HEIGHT_PER_WIDTH;
        input.orthographicDepthRange = this._settings.orthographicDepthRange;
        input.lod = this._meshSettings.lod;
        input.lodBias = this._meshSettings.lodBias;
        input.lodTrianglesPerPixel = this._settings.lodTrianglesPerPixel;
        this._shadows.render(input, unbounded, bounded, this._meshes, this._frameNumber);
    }

    private presentedFrame(): GpuFrame {
        const presenter = this.world.resources.tryGet(PixelPresenterResource)?.presenter;
        return (presenter === undefined ? undefined : gpuFrameOf(presenter)) ?? this._gpu.frame;
    }

    private evictUnused(maxUnusedFrames: number): void {
        const frame = this._frameNumber;
        this._meshes.evictUnused(frame, maxUnusedFrames);
        this._materials.evictUnused(frame, maxUnusedFrames);
        this._textures.evictUnused(frame, maxUnusedFrames);
        this._pipelines.evictUnused(frame, maxUnusedFrames);
        this._shadows.evictUnused(frame, maxUnusedFrames);
    }

    override onDestroy(): void {
        this._meshes.dispose();
        this._materials.dispose();
        this._textures.dispose();
        this._shadows.dispose();
        this._frameUniformBuffer.destroy();
        this._lightBuffer.destroy();
        this._instanceBuffer?.destroy();
        this._instanceBuffer = undefined;
    }

    private readSingleCamera(): boolean {
        const override = this.world.resources.tryGet(RenderCameraOverride);
        if (override !== undefined) return this.readOverrideCamera(override);
        let cameras = 0;
        this._cameraQuery.stream({read: {localToWorld: LocalToWorld}, optional: {fieldOfView: FieldOfView}}).consume(({localToWorld, fieldOfView}) => {
            cameras++;
            this._cameraMatrix = localToWorld.matrix;
            this._cameraFieldOfView = fieldOfView?.radians;
        });
        return cameras === 1;
    }

    private readOverrideCamera(override: RenderCameraOverride): boolean {
        const camera = override.componentsOf(this.world, CAMERA_SPEC);
        if (camera === undefined) return false;
        this._cameraMatrix = camera.localToWorld.matrix;
        this._cameraFieldOfView = override.componentsOf(this.world, FIELD_OF_VIEW_SPEC)?.fieldOfView.radians;
        return true;
    }

    private createLightBuffer(device: GpuDevice): void {
        this._lightBufferBytes = this._lights.data.byteLength;
        this._lightBuffer = device.createBuffer({
            label: "scene lights",
            size: this._lightBufferBytes,
            usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
        });
        this._frameBindGroup = undefined;
    }

    private frameBindGroup(device: GpuDevice): GPUBindGroup {
        const shadowView = this._shadows.sampledView;
        if (this._frameBindGroup !== undefined && this._frameBindGroupShadowView === shadowView) return this._frameBindGroup;
        this._frameBindGroupShadowView = shadowView;
        this._frameBindGroup = device.createBindGroup({
            label: "frame",
            layout: this._frameBindGroupLayout,
            entries: [
                {binding: FRAME_UNIFORMS_BINDING, resource: {buffer: this._frameUniformBuffer}},
                {binding: LIGHTS_BINDING, resource: {buffer: this._lightBuffer}},
                {binding: SHADOW_UNIFORMS_BINDING, resource: {buffer: this._shadows.uniformBuffer}},
                {binding: SHADOW_MAP_BINDING, resource: shadowView},
                {binding: SHADOW_SAMPLER_BINDING, resource: this._shadows.sampler},
            ],
        });
        return this._frameBindGroup;
    }

    private uploadLights(device: GpuDevice): void {
        if (this._lights.data.byteLength > this._lightBufferBytes) {
            this._lightBuffer.destroy();
            this.createLightBuffer(device);
        }
        device.queue.writeBuffer(this._lightBuffer, 0, asGpuBufferSource(this._lights.data), 0, this._lights.usedFloats);
    }

    private batchInstances(unbounded: MeshSpanSource<MeshSpan>, bounded: MeshSpanSource<BoundedMeshSpan>): void {
        this._batcher.begin();
        unbounded.consumeSpans(this.countUnboundedSpan);
        this._rowLevels.rewind();
        bounded.consumeSpans(this.countBoundedSpan);
        this._batcher.layout();
        unbounded.consumeSpans(this.fillUnboundedSpan);
        this._rowLevels.rewind();
        bounded.consumeSpans(this.fillBoundedSpan);
    }

    private readonly countRun: MeshRunVisitor = (mesh, level, culling, _color, surfaceShader, _params, _matrices, startRow, endRow) => {
        const instances = endRow - startRow;
        this._batcher.count(mesh, culling, surfaceShader, instances);
        this._drawn.trianglesDrawn += mesh.triangleCount * instances;
        if (level < this._drawn.lodLevelCounts.length) this._drawn.lodLevelCounts[level] += instances;
    };

    private readonly fillRun: MeshRunVisitor = (mesh, _level, culling, color, surfaceShader, params, matrices, startRow, endRow) => {
        this._batcher.addRows(mesh, culling, surfaceShader, matrices, startRow, endRow, color, params);
    };

    private readonly countUnboundedSpan = (span: MeshSpan): void => visitMeshRuns(span, undefined, NO_ROW_LEVEL_OFFSET, this.countRun);

    private readonly fillUnboundedSpan = (span: MeshSpan): void => visitMeshRuns(span, undefined, NO_ROW_LEVEL_OFFSET, this.fillRun);

    private readonly countBoundedSpan = (span: BoundedMeshSpan): void => {
        const firstLevel = this._rowLevels.claim(span);
        this.selectRowLevels(span, firstLevel);
        visitMeshRuns(span, this._rowLevels.levels, firstLevel, this.countRun);
    };

    private readonly fillBoundedSpan = (span: BoundedMeshSpan): void => {
        const firstLevel = this._rowLevels.claim(span);
        visitMeshRuns(span, this._rowLevels.levels, firstLevel, this.fillRun);
    };

    private selectRowLevels({start, end, stores, cols}: BoundedMeshSpan, firstLevel: number): void {
        const renderMeshes = stores.renderMesh!;
        const bounds = cols.bounds!;
        const levels = this._rowLevels.levels;
        const projected = this._projectedBounds;
        const settings = this._settings;
        const meshSettings = this._meshSettings;
        const lodEnabled = meshSettings.lod;
        const renderPxPerFramebufferPxX = this._renderPxPerFramebufferPxX, renderPxPerFramebufferPxY = this._renderPxPerFramebufferPxY;
        for (let row = start, out = firstLevel, b = start * AABB_STRIDE; row < end; row++, out++, b += AABB_STRIDE) {
            const mesh = (renderMeshes.get(row) as RenderMesh).mesh;
            const visible = mesh !== undefined && projected.project(
                bounds[b + AABB_MIN_X], bounds[b + AABB_MIN_Y], bounds[b + AABB_MIN_Z],
                bounds[b + AABB_MAX_X], bounds[b + AABB_MAX_Y], bounds[b + AABB_MAX_Z],
            );
            if (!visible) {
                levels[out] = CULLED;
            } else if (lodEnabled && mesh.lods.length > 1) {
                levels[out] = selectLodLevel(
                    mesh.lods, projected.width * renderPxPerFramebufferPxX, projected.height * renderPxPerFramebufferPxY,
                    settings.lodTrianglesPerPixel, meshSettings.lodBias,
                );
            } else {
                levels[out] = BASE_LOD_LEVEL;
            }
        }
    }

    private uploadInstances(device: GpuDevice): void {
        const batcher = this._batcher;
        if (batcher.instanceCount === 0) return;
        const capacityBytes = batcher.capacity * INSTANCE_FLOATS * FLOAT_BYTES;
        if (this._instanceBuffer === undefined || capacityBytes > this._instanceBufferBytes) {
            this._instanceBuffer?.destroy();
            this._instanceBufferBytes = capacityBytes;
            this._instanceBuffer = device.createBuffer({
                label: "instances",
                size: capacityBytes,
                usage: GPU_BUFFER_USAGE.VERTEX | GPU_BUFFER_USAGE.COPY_DST,
            });
        }
        device.queue.writeBuffer(this._instanceBuffer, 0, asGpuBufferSource(batcher.instanceData), 0, batcher.instanceCount * INSTANCE_FLOATS);
    }

    private drawBatches(pass: GPURenderPassEncoder, frameBindGroup: GPUBindGroup, settings: GpuMeshPassSettings, meshSettings: MeshRenderSettings,
        sampleCount: GpuSampleCount, library: GpuShaderLibrary): void {
        const instanceBuffer = this._instanceBuffer;
        if (instanceBuffer === undefined || this._batcher.instanceCount === 0) return;
        pass.setBindGroup(FRAME_BIND_GROUP, frameBindGroup);
        pass.setVertexBuffer(INSTANCE_VERTEX_BUFFER_SLOT, instanceBuffer);
        const format = this._gpu.format;
        let currentPipeline: GPURenderPipeline | undefined;
        for (const batch of this._batcher.batches) {
            const pipeline = this._pipelines.pipelineFor(library.shaderNamed(batch.surfaceShader), batch.culling, format, sampleCount, this._frameNumber);
            if (pipeline === undefined) continue;
            if (pipeline !== currentPipeline) {
                pass.setPipeline(pipeline);
                currentPipeline = pipeline;
            }
            const mesh = batch.mesh;
            const gpuMesh = this._meshes.ensure(mesh, this._frameNumber);
            pass.setVertexBuffer(MESH_VERTEX_BUFFER_SLOT, gpuMesh.vertexBuffer);
            pass.setIndexBuffer(gpuMesh.indexBuffer, INDEX_FORMAT);
            for (const range of gpuMesh.ranges) {
                const material = this._materials.prepare(mesh.materials[range.material], meshSettings.textures, settings.textureFiltering, this._frameNumber);
                pass.setBindGroup(MATERIAL_BIND_GROUP, material.bindGroup);
                pass.drawIndexed(range.indexCount, batch.instanceCount, range.firstIndex, NO_BASE_VERTEX, batch.firstInstance);
            }
        }
    }
}
