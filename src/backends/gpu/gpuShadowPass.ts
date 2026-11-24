import type {SceneLights} from "../../engine/rendering/3d/lighting/sceneLights";
import type {RenderMesh} from "../../engine/rendering/3d/renderMesh";
import {FaceCulling} from "../../engine/rendering/3d/faceCulling";
import {selectLodLevel} from "../../engine/rendering/3d/meshLod";
import {AABB_MAX_X, AABB_MAX_Y, AABB_MAX_Z, AABB_MIN_X, AABB_MIN_Y, AABB_MIN_Z, AABB_STRIDE} from "../../engine/datatypes/aabb";
import {MAT4_FLOATS} from "../../engine/math/mat4Layout";
import {asGpuBufferSource, GPU_BUFFER_USAGE, GPU_TEXTURE_USAGE} from "./gpuTypes";
import type {GpuDevice} from "./gpuTypes";
import {FLOAT_BYTES} from "./gpuLightPacking";
import {GpuInstanceBatcher, INSTANCE_FLOATS} from "./gpuInstanceBatcher";
import type {GpuMeshCache} from "./gpuMeshCache";
import {BASE_LOD_LEVEL, CULLED, GpuRowLevels, NO_ROW_LEVEL_OFFSET, visitMeshRuns} from "./gpuMeshRuns";
import type {BoundedMeshSpan, MeshRunVisitor, MeshSpan, MeshSpanSource} from "./gpuMeshRuns";
import {GpuShadowFit} from "./gpuShadowFit";
import type {GpuShadowView} from "./gpuShadowFit";
import {firstDirectionalLightOf, GpuShadowUniforms, NO_SHADOWED_LIGHT, packShadowsOff, packShadowUniforms, SHADOW_MAP_FARTHEST_DEPTH, SHADOW_UNIFORM_FLOATS} from "./gpuShadowPacking";
import {NO_SHADOW_MAP, shadowMapSizeOf, shadowSlopeBiasOf} from "./gpuShadowSettings";
import type {GpuShadowSettings} from "./gpuShadowSettings";
import {GpuShadowPipelineCache, SHADOW_MAP_FORMAT} from "./gpuShadowPipelineCache";
import {INSTANCE_VERTEX_BUFFER_SLOT, MESH_VERTEX_BUFFER_SLOT} from "./shaders/basicLitShader";
import {SHADOW_CASTER_BIND_GROUP, SHADOW_CASTER_BIND_GROUP_LAYOUT, SHADOW_CASTER_UNIFORMS_BINDING} from "./shaders/shadowCasterShader";

export const SHADOW_PASS_LABEL = "shadow";
export const SHADOW_MAP_LABEL = "shadow map";
export const SHADOW_INSTANCES_LABEL = "shadow instances";
export const SHADOW_UNIFORMS_LABEL = "shadow uniforms";
export const SHADOW_CASTER_UNIFORMS_LABEL = "shadow caster uniforms";
const NO_SHADOW_MAP_LABEL = "no shadow map";
const SHADOW_CASTER_BATCH = "shadow caster";
const CASTER_CULLING = FaceCulling.None;
const NO_SHADOW_MAP_SIZE = 1;
const INDEX_FORMAT: GPUIndexFormat = "uint32";
const TRIANGLE_CORNERS = 3;
const FIRST_INDEX = 0;
const NO_BASE_VERTEX = 0;
const SQUARE_PIXEL_HEIGHT_PER_WIDTH = 1;
const VEC3_FLOATS = 3;
const SHADOW_SAMPLER: GPUSamplerDescriptor = {
    label: "shadow comparison",
    compare: "less-equal",
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
};

export class GpuShadowInput implements GpuShadowView {
    public settings: GpuShadowSettings | undefined = undefined;
    public lights: SceneLights | undefined = undefined;
    public cameraMatrix: ArrayLike<number> = new Float32Array(MAT4_FLOATS);
    public fieldOfViewRadians: number | undefined = undefined;
    public widthPx = 0;
    public heightPx = 0;
    public pixelHeightPerWidth = SQUARE_PIXEL_HEIGHT_PER_WIDTH;
    public orthographicDepthRange = 0;
    public lod = false;
    public lodBias = 0;
    public lodTrianglesPerPixel = 0;
}

export class GpuShadowPass {
    public readonly uniformBuffer: GPUBuffer;
    public readonly sampler: GPUSampler;
    private readonly fit = new GpuShadowFit();
    private readonly uniforms = new GpuShadowUniforms();
    private readonly batcher = new GpuInstanceBatcher();
    private readonly rowLevels = new GpuRowLevels();
    private readonly pipelines: GpuShadowPipelineCache;
    private readonly casterUniformBuffer: GPUBuffer;
    private readonly casterBindGroup: GPUBindGroup;
    private readonly noShadowMap: GPUTexture;
    private readonly noShadowMapView: GPUTextureView;
    private map: GPUTexture | undefined;
    private mapView: GPUTextureView | undefined;
    private mapSize = NO_SHADOW_MAP;
    private mapLastUsedFrame = 0;
    private instanceBuffer: GPUBuffer | undefined;
    private instanceBufferBytes = 0;
    private active = false;
    private offUploaded = false;
    private unboundedCasters = 0;
    private input!: GpuShadowInput;

    public constructor(private readonly device: GpuDevice) {
        const casterLayout = device.createBindGroupLayout(SHADOW_CASTER_BIND_GROUP_LAYOUT);
        this.pipelines = new GpuShadowPipelineCache(device, device.createPipelineLayout({label: SHADOW_PASS_LABEL, bindGroupLayouts: [casterLayout]}));
        this.uniformBuffer = device.createBuffer({
            label: SHADOW_UNIFORMS_LABEL,
            size: SHADOW_UNIFORM_FLOATS * FLOAT_BYTES,
            usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
        });
        this.casterUniformBuffer = device.createBuffer({
            label: SHADOW_CASTER_UNIFORMS_LABEL,
            size: MAT4_FLOATS * FLOAT_BYTES,
            usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
        });
        this.casterBindGroup = device.createBindGroup({
            label: SHADOW_CASTER_UNIFORMS_LABEL,
            layout: casterLayout,
            entries: [{binding: SHADOW_CASTER_UNIFORMS_BINDING, resource: {buffer: this.casterUniformBuffer}}],
        });
        this.sampler = device.createSampler(SHADOW_SAMPLER);
        this.noShadowMap = device.createTexture({
            label: NO_SHADOW_MAP_LABEL,
            size: {width: NO_SHADOW_MAP_SIZE, height: NO_SHADOW_MAP_SIZE},
            format: SHADOW_MAP_FORMAT,
            usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING,
        });
        this.noShadowMapView = this.noShadowMap.createView();
    }

    public get sampledView(): GPUTextureView {
        return this.active ? this.mapView! : this.noShadowMapView;
    }

    public render(input: GpuShadowInput, unbounded: MeshSpanSource<MeshSpan>, bounded: MeshSpanSource<BoundedMeshSpan>, meshes: GpuMeshCache, frame: number): void {
        this.active = false;
        const settings = input.settings;
        const lights = input.lights;
        const lightIndex = settings === undefined ? NO_SHADOWED_LIGHT : firstDirectionalLightOf(lights);
        if (settings === undefined || lights === undefined || lightIndex === NO_SHADOWED_LIGHT || !(settings.strength > 0)) {
            this.uploadOff();
            return;
        }
        const mapSize = shadowMapSizeOf(settings);
        const direction = lightIndex * VEC3_FLOATS;
        if (mapSize === NO_SHADOW_MAP || !this.fit.fit(input, settings.maxDistance, mapSize,
            lights.direction[direction], lights.direction[direction + 1], lights.direction[direction + 2])) {
            this.uploadOff();
            return;
        }
        this.batchCasters(input, unbounded, bounded);
        if (this.batcher.instanceCount === 0) {
            this.uploadOff();
            return;
        }
        this.fit.finish(this.unboundedCasters > 0);
        const mapView = this.ensureMap(mapSize, frame);
        this.uploadCasters();
        packShadowUniforms(this.uniforms, this.fit, settings, lightIndex);
        this.device.queue.writeBuffer(this.uniformBuffer, 0, asGpuBufferSource(this.uniforms.data));
        this.offUploaded = false;
        this.encode(mapView, shadowSlopeBiasOf(settings), meshes, frame);
        this.active = true;
    }

    public evictUnused(frame: number, maxUnusedFrames: number): void {
        this.pipelines.evictUnused(frame, maxUnusedFrames);
        if (this.map === undefined || this.active || frame - this.mapLastUsedFrame <= maxUnusedFrames) return;
        this.destroyMap();
    }

    public dispose(): void {
        this.destroyMap();
        this.noShadowMap.destroy();
        this.uniformBuffer.destroy();
        this.casterUniformBuffer.destroy();
        this.instanceBuffer?.destroy();
        this.instanceBuffer = undefined;
    }

    private uploadOff(): void {
        if (this.offUploaded) return;
        packShadowsOff(this.uniforms);
        this.device.queue.writeBuffer(this.uniformBuffer, 0, asGpuBufferSource(this.uniforms.data));
        this.offUploaded = true;
    }

    private batchCasters(input: GpuShadowInput, unbounded: MeshSpanSource<MeshSpan>, bounded: MeshSpanSource<BoundedMeshSpan>): void {
        this.input = input;
        this.unboundedCasters = 0;
        this.batcher.begin();
        unbounded.consumeSpans(this.countUnboundedSpan);
        this.rowLevels.rewind();
        bounded.consumeSpans(this.countBoundedSpan);
        this.batcher.layout();
        unbounded.consumeSpans(this.fillUnboundedSpan);
        this.rowLevels.rewind();
        bounded.consumeSpans(this.fillBoundedSpan);
    }

    private readonly countRun: MeshRunVisitor = (mesh, _level, _culling, _color, _surfaceShader, _params, _matrices, startRow, endRow) => {
        this.batcher.count(mesh, CASTER_CULLING, SHADOW_CASTER_BATCH, endRow - startRow);
    };

    private readonly countUnboundedRun: MeshRunVisitor = (mesh, _level, _culling, _color, _surfaceShader, _params, _matrices, startRow, endRow) => {
        this.unboundedCasters += endRow - startRow;
        this.batcher.count(mesh, CASTER_CULLING, SHADOW_CASTER_BATCH, endRow - startRow);
    };

    private readonly fillRun: MeshRunVisitor = (mesh, _level, _culling, color, _surfaceShader, params, matrices, startRow, endRow) => {
        this.batcher.addRows(mesh, CASTER_CULLING, SHADOW_CASTER_BATCH, matrices, startRow, endRow, color, params);
    };

    private readonly countUnboundedSpan = (span: MeshSpan): void => visitMeshRuns(span, undefined, NO_ROW_LEVEL_OFFSET, this.countUnboundedRun);

    private readonly fillUnboundedSpan = (span: MeshSpan): void => visitMeshRuns(span, undefined, NO_ROW_LEVEL_OFFSET, this.fillRun);

    private readonly countBoundedSpan = (span: BoundedMeshSpan): void => {
        const firstLevel = this.rowLevels.claim(span);
        this.selectCasterLevels(span, firstLevel);
        visitMeshRuns(span, this.rowLevels.levels, firstLevel, this.countRun);
    };

    private readonly fillBoundedSpan = (span: BoundedMeshSpan): void => {
        const firstLevel = this.rowLevels.claim(span);
        visitMeshRuns(span, this.rowLevels.levels, firstLevel, this.fillRun);
    };

    private selectCasterLevels({start, end, stores, cols}: BoundedMeshSpan, firstLevel: number): void {
        const renderMeshes = stores.renderMesh!;
        const bounds = cols.bounds!;
        const levels = this.rowLevels.levels;
        const fit = this.fit;
        const input = this.input;
        for (let row = start, out = firstLevel, b = start * AABB_STRIDE; row < end; row++, out++, b += AABB_STRIDE) {
            const mesh = (renderMeshes.get(row) as RenderMesh).mesh;
            const casts = mesh !== undefined && fit.acceptsCaster(
                bounds[b + AABB_MIN_X], bounds[b + AABB_MIN_Y], bounds[b + AABB_MIN_Z],
                bounds[b + AABB_MAX_X], bounds[b + AABB_MAX_Y], bounds[b + AABB_MAX_Z],
            );
            if (!casts) {
                levels[out] = CULLED;
            } else if (input.lod && mesh.lods.length > 1) {
                levels[out] = selectLodLevel(mesh.lods, fit.casterWidthTexels, fit.casterHeightTexels, input.lodTrianglesPerPixel, input.lodBias);
            } else {
                levels[out] = BASE_LOD_LEVEL;
            }
        }
    }

    private ensureMap(size: number, frame: number): GPUTextureView {
        if (this.map === undefined || this.mapSize !== size) {
            this.destroyMap();
            this.map = this.device.createTexture({
                label: SHADOW_MAP_LABEL,
                size: {width: size, height: size},
                format: SHADOW_MAP_FORMAT,
                usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.TEXTURE_BINDING,
            });
            this.mapView = this.map.createView();
            this.mapSize = size;
        }
        this.mapLastUsedFrame = frame;
        return this.mapView!;
    }

    private destroyMap(): void {
        this.map?.destroy();
        this.map = undefined;
        this.mapView = undefined;
        this.mapSize = NO_SHADOW_MAP;
    }

    private uploadCasters(): void {
        const batcher = this.batcher;
        const capacityBytes = batcher.capacity * INSTANCE_FLOATS * FLOAT_BYTES;
        if (this.instanceBuffer === undefined || capacityBytes > this.instanceBufferBytes) {
            this.instanceBuffer?.destroy();
            this.instanceBufferBytes = capacityBytes;
            this.instanceBuffer = this.device.createBuffer({
                label: SHADOW_INSTANCES_LABEL,
                size: capacityBytes,
                usage: GPU_BUFFER_USAGE.VERTEX | GPU_BUFFER_USAGE.COPY_DST,
            });
        }
        this.device.queue.writeBuffer(this.instanceBuffer, 0, asGpuBufferSource(batcher.instanceData), 0, batcher.instanceCount * INSTANCE_FLOATS);
        this.device.queue.writeBuffer(this.casterUniformBuffer, 0, asGpuBufferSource(this.fit.worldToLightClip));
    }

    private encode(mapView: GPUTextureView, slopeBias: number, meshes: GpuMeshCache, frame: number): void {
        const encoder = this.device.createCommandEncoder({label: SHADOW_PASS_LABEL});
        const pass = encoder.beginRenderPass({
            label: SHADOW_PASS_LABEL,
            colorAttachments: [],
            depthStencilAttachment: {
                view: mapView,
                depthClearValue: SHADOW_MAP_FARTHEST_DEPTH,
                depthLoadOp: "clear",
                depthStoreOp: "store",
            },
        });
        pass.setPipeline(this.pipelines.pipelineFor(slopeBias, frame));
        pass.setBindGroup(SHADOW_CASTER_BIND_GROUP, this.casterBindGroup);
        pass.setVertexBuffer(INSTANCE_VERTEX_BUFFER_SLOT, this.instanceBuffer!);
        for (const batch of this.batcher.batches) {
            const gpuMesh = meshes.ensure(batch.mesh, frame);
            pass.setVertexBuffer(MESH_VERTEX_BUFFER_SLOT, gpuMesh.vertexBuffer);
            pass.setIndexBuffer(gpuMesh.indexBuffer, INDEX_FORMAT);
            pass.drawIndexed(batch.mesh.triangleCount * TRIANGLE_CORNERS, batch.instanceCount, FIRST_INDEX, NO_BASE_VERTEX, batch.firstInstance);
        }
        pass.end();
        this.device.queue.submit([encoder.finish()]);
    }
}
