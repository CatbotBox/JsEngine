import {LIGHT_KIND_DIRECTIONAL, LIGHT_KIND_RECT, LIGHT_KIND_SPOT, VEC3_FLOATS} from "../../engine/rendering/3d/lighting/sceneLights";
import type {SceneLights} from "../../engine/rendering/3d/lighting/sceneLights";
import type {RenderMesh} from "../../engine/rendering/3d/renderMesh";
import {FaceCulling} from "../../engine/rendering/3d/faceCulling";
import {selectLodLevel} from "../../engine/rendering/3d/meshLod";
import {AABB_MAX_X, AABB_MAX_Y, AABB_MAX_Z, AABB_MIN_X, AABB_MIN_Y, AABB_MIN_Z, AABB_STRIDE} from "../../engine/datatypes/aabb";
import {MAT4_FLOATS, MAT4_TRANSLATION_X, MAT4_TRANSLATION_Y, MAT4_TRANSLATION_Z} from "../../engine/math/mat4Layout";
import {asGpuBufferSource, GPU_BUFFER_USAGE, GPU_TEXTURE_USAGE} from "./gpuTypes";
import type {GpuDevice} from "./gpuTypes";
import {assignLightShadowMap, FLOAT_BYTES} from "./gpuLightPacking";
import type {GpuLightPacking} from "./gpuLightPacking";
import {GpuInstanceBatcher, INSTANCE_FLOATS} from "./gpuInstanceBatcher";
import type {GpuMeshCache} from "./gpuMeshCache";
import {BASE_LOD_LEVEL, CULLED, GpuRowLevels, NO_ROW_LEVEL_OFFSET, visitMeshRuns} from "./gpuMeshRuns";
import type {BoundedMeshSpan, MeshRunVisitor, MeshSpan, MeshSpanSource} from "./gpuMeshRuns";
import {BASIS_FLOATS, GpuShadowFit, largestAxisScaleOf, writeLightBasis} from "./gpuShadowFit";
import type {GpuShadowView} from "./gpuShadowFit";
import {GpuShadowCube, GpuShadowFrustum} from "./gpuShadowFrustum";
import type {ShadowCasterView} from "./gpuShadowFrustum";
import {GpuShadowMapArray} from "./gpuShadowMapArray";
import {
    GpuShadowPacking,
    packCubeShadowMap,
    packDirectionalShadowMap,
    packPerspectiveShadowMap,
    packShadowsOff,
    SHADOW_PROJECTION_CUBE,
    SHADOW_PROJECTION_ORTHOGRAPHIC,
    SHADOW_PROJECTION_PERSPECTIVE,
} from "./gpuShadowPacking";
import {
    CUBE_FACES,
    NO_SHADOW_MAP,
    pointShadowBudgetOf,
    pointShadowMapSizeOf,
    shadowedLightBudgetOf,
    shadowMapSizeOf,
    shadowSlopeBiasOf,
    spotShadowMapSizeOf,
} from "./gpuShadowSettings";
import type {GpuShadowSettings} from "./gpuShadowSettings";
import {GpuShadowSelection, shadowEmitterRadiusOf, shadowReachOf, usesCubeShadow} from "./gpuShadowSelection";
import {GpuShadowPipelineCache, SHADOW_MAP_FORMAT} from "./gpuShadowPipelineCache";
import {INSTANCE_VERTEX_BUFFER_SLOT, MESH_VERTEX_BUFFER_SLOT, SHADOW_PCF_REACH_TAPS} from "./shaders/basicLitShader";
import {
    SHADOW_CASTER_BIND_GROUP,
    SHADOW_CASTER_BIND_GROUP_LAYOUT,
    SHADOW_CASTER_UNIFORM_BYTES,
    SHADOW_CASTER_UNIFORM_STRIDE_BYTES,
    SHADOW_CASTER_UNIFORMS_BINDING,
} from "./shaders/shadowCasterShader";

export const SHADOW_PASS_LABEL = "shadow";
export const DIRECTIONAL_SHADOW_MAPS_LABEL = "directional shadow maps";
export const SPOT_SHADOW_MAPS_LABEL = "spot shadow maps";
export const POINT_SHADOW_MAPS_LABEL = "point shadow maps";
export const NO_SHADOW_MAP_LABEL = "no shadow map";
export const SHADOW_INSTANCES_LABEL = "shadow instances";
export const SHADOWS_LABEL = "shadows";
export const SHADOW_CASTER_UNIFORMS_LABEL = "shadow caster uniforms";
const SHADOW_NEAR_FRACTION_OF_REACH = 0.01;
export const SPOT_SHADOW_MAX_HALF_ANGLE = 1.4;
export const SPOT_SHADOW_MIN_HALF_ANGLE = 1e-3;
export const SPOT_SHADOW_EDGE_MARGIN_TEXELS = SHADOW_PCF_REACH_TAPS + 1;
const SHADOW_CASTER_BATCH = "shadow caster";
const CASTER_CULLING = FaceCulling.None;
const NO_SHADOW_MAP_SIZE = 1;
const NO_SHADOW_MAP_LAYERS = CUBE_FACES;
const SINGLE_MAP_LAYER = 1;
const SINGLE_FACE = 0;
const SINGLE_DYNAMIC_OFFSET = 1;
const NO_RECORD = -1;
const INDEX_FORMAT: GPUIndexFormat = "uint32";
const TRIANGLE_CORNERS = 3;
const FIRST_INDEX = 0;
const NO_BASE_VERTEX = 0;
const SQUARE_PIXEL_HEIGHT_PER_WIDTH = 1;
const NDC_SPAN = 2;
const INITIAL_VIEW_CAPACITY = 8;
const GROWTH_FACTOR = 2;
const CASTER_UNIFORM_STRIDE_FLOATS = SHADOW_CASTER_UNIFORM_STRIDE_BYTES / FLOAT_BYTES;
const SHADOW_ENCODER: GPUCommandEncoderDescriptor = {label: SHADOW_PASS_LABEL};
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

export function spotShadowTanHalfAngleOf(coneCosOuter: number, mapSize: number): number {
    const halfAngle = Math.min(Math.max(Math.acos(Math.min(1, Math.max(-1, coneCosOuter))), SPOT_SHADOW_MIN_HALF_ANGLE), SPOT_SHADOW_MAX_HALF_ANGLE);
    return Math.tan(halfAngle) * mapSize / (mapSize - NDC_SPAN * SPOT_SHADOW_EDGE_MARGIN_TEXELS);
}

class ShadowMapSlot {
    public light = 0;
    public projection = SHADOW_PROJECTION_ORTHOGRAPHIC;
    public firstView = 0;
    public viewCount = 0;
    public layer = 0;
    public record = NO_RECORD;
    private _fit: GpuShadowFit | undefined;
    private _frustum: GpuShadowFrustum | undefined;
    private _cube: GpuShadowCube | undefined;

    public get fit(): GpuShadowFit {
        return this._fit ??= new GpuShadowFit();
    }

    public get frustum(): GpuShadowFrustum {
        return this._frustum ??= new GpuShadowFrustum();
    }

    public get cube(): GpuShadowCube {
        return this._cube ??= new GpuShadowCube();
    }
}

class ShadowViewSlot {
    public caster: ShadowCasterView | undefined;
    public map = 0;
    public face = SINGLE_FACE;
    public instances = 0;
    public firstBatch = 0;
    public endBatch = 0;
}

export class GpuShadowPass {
    public readonly sampler: GPUSampler;
    private readonly selection = new GpuShadowSelection();
    private readonly packing = new GpuShadowPacking();
    private readonly batcher = new GpuInstanceBatcher();
    private readonly rowLevels = new GpuRowLevels();
    private readonly pipelines: GpuShadowPipelineCache;
    private readonly casterLayout: GPUBindGroupLayout;
    private readonly directionalMaps: GpuShadowMapArray;
    private readonly spotMaps: GpuShadowMapArray;
    private readonly pointMaps: GpuShadowMapArray;
    private readonly noShadowMap: GPUTexture;
    private readonly noShadowMapArrayView: GPUTextureView;
    private readonly noShadowMapCubeView: GPUTextureView;
    private readonly camera = new Float64Array(MAT4_FLOATS);
    private readonly basis = new Float64Array(BASIS_FLOATS);
    private readonly maps: ShadowMapSlot[] = [];
    private readonly views: ShadowViewSlot[] = [];
    private readonly batchKeys: string[] = [];
    private shadowsBuffer!: GPUBuffer;
    private shadowsBufferBytes = 0;
    private casterUniformBuffer!: GPUBuffer;
    private casterBindGroup!: GPUBindGroup;
    private casterMatrices = new Float32Array(0);
    private dynamicOffsets = new Uint32Array(0);
    private viewCapacity = 0;
    private instanceBuffer: GPUBuffer | undefined;
    private instanceBufferBytes = 0;
    private mapCount = 0;
    private viewCount = 0;
    private recordCount = 0;
    private primaryLight = NO_RECORD;
    private viewUnitsPerWorldUnit = 1;
    private offUploaded = false;
    private unboundedCasters = 0;
    private _revision = 0;
    private _directionalMapsView: GPUTextureView;
    private _spotMapsView: GPUTextureView;
    private _pointMapsView: GPUTextureView;
    private input!: GpuShadowInput;
    private view!: ShadowViewSlot;
    private batchKey = SHADOW_CASTER_BATCH;

    public constructor(private readonly device: GpuDevice) {
        this.casterLayout = device.createBindGroupLayout(SHADOW_CASTER_BIND_GROUP_LAYOUT);
        this.pipelines = new GpuShadowPipelineCache(device, device.createPipelineLayout({label: SHADOW_PASS_LABEL, bindGroupLayouts: [this.casterLayout]}));
        this.createShadowsBuffer(this.packing.data.byteLength);
        this.reserveViews(INITIAL_VIEW_CAPACITY);
        this.sampler = device.createSampler(SHADOW_SAMPLER);
        this.noShadowMap = device.createTexture({
            label: NO_SHADOW_MAP_LABEL,
            size: {width: NO_SHADOW_MAP_SIZE, height: NO_SHADOW_MAP_SIZE, depthOrArrayLayers: NO_SHADOW_MAP_LAYERS},
            format: SHADOW_MAP_FORMAT,
            usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING,
        });
        this.noShadowMapArrayView = this.noShadowMap.createView({label: NO_SHADOW_MAP_LABEL, dimension: "2d-array", arrayLayerCount: SINGLE_MAP_LAYER});
        this.noShadowMapCubeView = this.noShadowMap.createView({label: NO_SHADOW_MAP_LABEL, dimension: "cube-array", arrayLayerCount: NO_SHADOW_MAP_LAYERS});
        this._directionalMapsView = this.noShadowMapArrayView;
        this._spotMapsView = this.noShadowMapArrayView;
        this._pointMapsView = this.noShadowMapCubeView;
        this.directionalMaps = new GpuShadowMapArray(device, DIRECTIONAL_SHADOW_MAPS_LABEL, "2d-array", SINGLE_MAP_LAYER, SHADOW_PASS_LABEL);
        this.spotMaps = new GpuShadowMapArray(device, SPOT_SHADOW_MAPS_LABEL, "2d-array", SINGLE_MAP_LAYER, SHADOW_PASS_LABEL);
        this.pointMaps = new GpuShadowMapArray(device, POINT_SHADOW_MAPS_LABEL, "cube-array", CUBE_FACES, SHADOW_PASS_LABEL);
    }

    public get revision(): number {
        return this._revision;
    }

    public get shadowsBinding(): GPUBuffer {
        return this.shadowsBuffer;
    }

    public get directionalMapsView(): GPUTextureView {
        return this._directionalMapsView;
    }

    public get spotMapsView(): GPUTextureView {
        return this._spotMapsView;
    }

    public get pointMapsView(): GPUTextureView {
        return this._pointMapsView;
    }

    public render(input: GpuShadowInput, unbounded: MeshSpanSource<MeshSpan>, bounded: MeshSpanSource<BoundedMeshSpan>, meshes: GpuMeshCache, frame: number): void {
        this.renderMaps(input, unbounded, bounded, meshes, frame);
        this.publishMapViews(frame);
    }

    public assignLightShadowMaps(lights: GpuLightPacking): void {
        for (let map = 0; map < this.mapCount; map++) {
            const slot = this.maps[map];
            if (slot.record !== NO_RECORD && slot.light < lights.count) assignLightShadowMap(lights, slot.light, slot.record);
        }
    }

    public evictUnused(frame: number, maxUnusedFrames: number): void {
        this.pipelines.evictUnused(frame, maxUnusedFrames);
        this.directionalMaps.evictUnused(frame, maxUnusedFrames);
        this.spotMaps.evictUnused(frame, maxUnusedFrames);
        this.pointMaps.evictUnused(frame, maxUnusedFrames);
    }

    public dispose(): void {
        this.directionalMaps.destroy();
        this.spotMaps.destroy();
        this.pointMaps.destroy();
        this.noShadowMap.destroy();
        this.shadowsBuffer.destroy();
        this.casterUniformBuffer.destroy();
        this.instanceBuffer?.destroy();
        this.instanceBuffer = undefined;
    }

    private renderMaps(input: GpuShadowInput, unbounded: MeshSpanSource<MeshSpan>, bounded: MeshSpanSource<BoundedMeshSpan>, meshes: GpuMeshCache, frame: number): void {
        this.mapCount = 0;
        this.viewCount = 0;
        this.recordCount = 0;
        this.primaryLight = NO_RECORD;
        const settings = input.settings;
        const lights = input.lights;
        if (settings === undefined || lights === undefined || !lights.hasAnyLight || !(settings.strength > 0) || !this.readCamera(input.cameraMatrix)) {
            this.selection.clear();
            this.uploadOff();
            return;
        }
        const camera = this.camera;
        this.selection.select(lights, shadowedLightBudgetOf(settings), pointShadowBudgetOf(settings),
            camera[MAT4_TRANSLATION_X], camera[MAT4_TRANSLATION_Y], camera[MAT4_TRANSLATION_Z]);
        for (let rank = 0; rank < this.selection.count; rank++) this.planMap(input, lights, settings, this.selection.lightAt(rank));
        if (this.viewCount > 0) this.batchCasters(input, unbounded, bounded);
        this.keepMapsWithCasters();
        if (this.recordCount === 0) {
            this.uploadOff();
            return;
        }
        this.ensureMapArrays(settings, frame);
        this.uploadMaps(settings);
        this.uploadCasters();
        this.encode(shadowSlopeBiasOf(settings), meshes, frame);
    }

    private publishMapViews(frame: number): void {
        const directional = this.directionalMaps.viewUsedIn(frame) ?? this.noShadowMapArrayView;
        const spot = this.spotMaps.viewUsedIn(frame) ?? this.noShadowMapArrayView;
        const point = this.pointMaps.viewUsedIn(frame) ?? this.noShadowMapCubeView;
        if (directional === this._directionalMapsView && spot === this._spotMapsView && point === this._pointMapsView) return;
        this._directionalMapsView = directional;
        this._spotMapsView = spot;
        this._pointMapsView = point;
        this._revision++;
    }

    private readCamera(cameraMatrix: ArrayLike<number>): boolean {
        const camera = this.camera;
        for (let i = 0; i < MAT4_FLOATS; i++) camera[i] = cameraMatrix[i];
        const scale = largestAxisScaleOf(camera);
        if (!(scale > 0) || !Number.isFinite(scale)) return false;
        this.viewUnitsPerWorldUnit = 1 / scale;
        return true;
    }

    private planMap(input: GpuShadowInput, lights: SceneLights, settings: GpuShadowSettings, light: number): void {
        const slot = this.claimMap(light);
        const kind = lights.kind[light];
        const d = light * VEC3_FLOATS;
        if (kind === LIGHT_KIND_DIRECTIONAL) {
            const mapSize = shadowMapSizeOf(settings);
            if (mapSize === NO_SHADOW_MAP || !slot.fit.fit(input, settings.maxDistance, mapSize, lights.direction[d], lights.direction[d + 1], lights.direction[d + 2])) {
                this.mapCount--;
                return;
            }
            slot.projection = SHADOW_PROJECTION_ORTHOGRAPHIC;
            this.addView(slot.fit, SINGLE_FACE);
            return;
        }
        const reach = shadowReachOf(lights, light);
        const near = Math.max(reach * SHADOW_NEAR_FRACTION_OF_REACH, shadowEmitterRadiusOf(lights, light));
        const mapSize = kind === LIGHT_KIND_SPOT ? spotShadowMapSizeOf(settings) : pointShadowMapSizeOf(settings);
        if (mapSize === NO_SHADOW_MAP || !(near < reach)) {
            this.mapCount--;
            return;
        }
        const x = lights.position[d], y = lights.position[d + 1], z = lights.position[d + 2];
        if (usesCubeShadow(kind)) {
            const cube = slot.cube;
            cube.aim(x, y, z, near, reach, mapSize);
            if (kind === LIGHT_KIND_RECT) cube.cullBehind(lights.direction[d], lights.direction[d + 1], lights.direction[d + 2]);
            cube.finishView(this.camera);
            slot.projection = SHADOW_PROJECTION_CUBE;
            for (let face = 0; face < CUBE_FACES; face++) this.addView(cube.faces[face], face);
            return;
        }
        writeLightBasis(this.basis, lights.direction[d], lights.direction[d + 1], lights.direction[d + 2]);
        const frustum = slot.frustum;
        frustum.aim(x, y, z, this.basis, spotShadowTanHalfAngleOf(lights.coneCosOuter[light], mapSize), near, reach, mapSize);
        frustum.finishView(this.camera);
        slot.projection = SHADOW_PROJECTION_PERSPECTIVE;
        this.addView(frustum, SINGLE_FACE);
    }

    private claimMap(light: number): ShadowMapSlot {
        if (this.mapCount === this.maps.length) this.maps.push(new ShadowMapSlot());
        const slot = this.maps[this.mapCount++];
        slot.light = light;
        slot.firstView = this.viewCount;
        slot.viewCount = 0;
        slot.record = NO_RECORD;
        return slot;
    }

    private addView(caster: ShadowCasterView, face: number): void {
        if (this.viewCount === this.views.length) {
            this.views.push(new ShadowViewSlot());
            this.batchKeys.push(`${SHADOW_CASTER_BATCH} ${this.batchKeys.length}`);
        }
        const view = this.views[this.viewCount++];
        view.caster = caster;
        view.map = this.mapCount - 1;
        view.face = face;
        view.instances = 0;
        this.maps[view.map].viewCount++;
    }

    private keepMapsWithCasters(): void {
        let directional = 0, spot = 0, cube = 0;
        for (let map = 0; map < this.mapCount; map++) {
            const slot = this.maps[map];
            let instances = 0;
            for (let view = slot.firstView; view < slot.firstView + slot.viewCount; view++) instances += this.views[view].instances;
            if (instances === 0) continue;
            slot.record = this.recordCount++;
            if (slot.projection === SHADOW_PROJECTION_ORTHOGRAPHIC) {
                if (this.primaryLight === NO_RECORD) this.primaryLight = slot.light;
                slot.layer = directional++;
            } else if (slot.projection === SHADOW_PROJECTION_PERSPECTIVE) {
                slot.layer = spot++;
            } else {
                slot.layer = cube++;
            }
        }
    }

    private mapsUsing(projection: number): number {
        let count = 0;
        for (let map = 0; map < this.mapCount; map++) {
            const slot = this.maps[map];
            if (slot.record !== NO_RECORD && slot.projection === projection) count++;
        }
        return count;
    }

    private ensureMapArrays(settings: GpuShadowSettings, frame: number): void {
        const budget = shadowedLightBudgetOf(settings);
        this.ensureMapArray(this.directionalMaps, shadowMapSizeOf(settings), this.mapsUsing(SHADOW_PROJECTION_ORTHOGRAPHIC), budget, frame);
        this.ensureMapArray(this.spotMaps, spotShadowMapSizeOf(settings), this.mapsUsing(SHADOW_PROJECTION_PERSPECTIVE), budget, frame);
        this.ensureMapArray(this.pointMaps, pointShadowMapSizeOf(settings), this.mapsUsing(SHADOW_PROJECTION_CUBE), pointShadowBudgetOf(settings), frame);
    }

    private ensureMapArray(maps: GpuShadowMapArray, size: number, used: number, budget: number, frame: number): void {
        if (used > 0) maps.ensure(size, used, budget, frame);
    }

    private arrayFor(projection: number): GpuShadowMapArray {
        if (projection === SHADOW_PROJECTION_ORTHOGRAPHIC) return this.directionalMaps;
        return projection === SHADOW_PROJECTION_PERSPECTIVE ? this.spotMaps : this.pointMaps;
    }

    private uploadOff(): void {
        if (this.offUploaded) return;
        packShadowsOff(this.packing);
        this.device.queue.writeBuffer(this.shadowsBuffer, 0, asGpuBufferSource(this.packing.data), 0, this.packing.usedFloats);
        this.offUploaded = true;
    }

    private uploadMaps(settings: GpuShadowSettings): void {
        const packing = this.packing;
        packing.begin(this.recordCount);
        if (this.primaryLight !== NO_RECORD) packing.setPrimaryLight(this.primaryLight);
        for (let map = 0; map < this.mapCount; map++) {
            const slot = this.maps[map];
            if (slot.record === NO_RECORD) continue;
            if (slot.projection === SHADOW_PROJECTION_ORTHOGRAPHIC) packDirectionalShadowMap(packing, slot.record, slot.fit, settings, slot.layer);
            else if (slot.projection === SHADOW_PROJECTION_PERSPECTIVE) packPerspectiveShadowMap(packing, slot.record, slot.frustum, settings, slot.layer, this.viewUnitsPerWorldUnit);
            else packCubeShadowMap(packing, slot.record, slot.cube, settings, slot.layer, this.viewUnitsPerWorldUnit);
        }
        if (packing.data.byteLength > this.shadowsBufferBytes) {
            this.shadowsBuffer.destroy();
            this.createShadowsBuffer(packing.data.byteLength);
            this._revision++;
        }
        this.device.queue.writeBuffer(this.shadowsBuffer, 0, asGpuBufferSource(packing.data), 0, packing.usedFloats);
        this.offUploaded = false;
    }

    private createShadowsBuffer(bytes: number): void {
        this.shadowsBufferBytes = bytes;
        this.shadowsBuffer = this.device.createBuffer({
            label: SHADOWS_LABEL,
            size: bytes,
            usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
        });
    }

    private reserveViews(views: number): void {
        if (views <= this.viewCapacity) return;
        let capacity = Math.max(this.viewCapacity, INITIAL_VIEW_CAPACITY);
        while (capacity < views) capacity *= GROWTH_FACTOR;
        this.casterUniformBuffer?.destroy();
        this.casterUniformBuffer = this.device.createBuffer({
            label: SHADOW_CASTER_UNIFORMS_LABEL,
            size: capacity * SHADOW_CASTER_UNIFORM_STRIDE_BYTES,
            usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
        });
        this.casterBindGroup = this.device.createBindGroup({
            label: SHADOW_CASTER_UNIFORMS_LABEL,
            layout: this.casterLayout,
            entries: [{binding: SHADOW_CASTER_UNIFORMS_BINDING, resource: {buffer: this.casterUniformBuffer, size: SHADOW_CASTER_UNIFORM_BYTES}}],
        });
        this.casterMatrices = new Float32Array(capacity * CASTER_UNIFORM_STRIDE_FLOATS);
        this.dynamicOffsets = Uint32Array.from({length: capacity}, (_, view) => view * SHADOW_CASTER_UNIFORM_STRIDE_BYTES);
        this.viewCapacity = capacity;
    }

    private batchCasters(input: GpuShadowInput, unbounded: MeshSpanSource<MeshSpan>, bounded: MeshSpanSource<BoundedMeshSpan>): void {
        this.input = input;
        const batcher = this.batcher;
        batcher.begin();
        this.rowLevels.rewind();
        for (let index = 0; index < this.viewCount; index++) {
            const view = this.views[index];
            this.view = view;
            this.batchKey = this.batchKeys[index];
            this.unboundedCasters = 0;
            view.firstBatch = batcher.batches.length;
            unbounded.consumeSpans(this.countUnboundedSpan);
            bounded.consumeSpans(this.countBoundedSpan);
            view.endBatch = batcher.batches.length;
            const slot = this.maps[view.map];
            if (slot.projection === SHADOW_PROJECTION_ORTHOGRAPHIC) slot.fit.finish(this.unboundedCasters > 0);
        }
        batcher.layout();
        this.rowLevels.rewind();
        for (let index = 0; index < this.viewCount; index++) {
            this.batchKey = this.batchKeys[index];
            unbounded.consumeSpans(this.fillUnboundedSpan);
            bounded.consumeSpans(this.fillBoundedSpan);
        }
    }

    private readonly countRun: MeshRunVisitor = (mesh, _level, _culling, _color, _surfaceShader, _params, _matrices, startRow, endRow) => {
        this.view.instances += endRow - startRow;
        this.batcher.count(mesh, CASTER_CULLING, this.batchKey, endRow - startRow);
    };

    private readonly countUnboundedRun: MeshRunVisitor = (mesh, level, culling, color, surfaceShader, params, matrices, startRow, endRow) => {
        this.unboundedCasters += endRow - startRow;
        this.countRun(mesh, level, culling, color, surfaceShader, params, matrices, startRow, endRow);
    };

    private readonly fillRun: MeshRunVisitor = (mesh, _level, _culling, color, _surfaceShader, params, matrices, startRow, endRow) => {
        this.batcher.addRows(mesh, CASTER_CULLING, this.batchKey, matrices, startRow, endRow, color, params);
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
        const caster = this.view.caster!;
        const input = this.input;
        for (let row = start, out = firstLevel, b = start * AABB_STRIDE; row < end; row++, out++, b += AABB_STRIDE) {
            const mesh = (renderMeshes.get(row) as RenderMesh).mesh;
            const casts = mesh !== undefined && caster.acceptsCaster(
                bounds[b + AABB_MIN_X], bounds[b + AABB_MIN_Y], bounds[b + AABB_MIN_Z],
                bounds[b + AABB_MAX_X], bounds[b + AABB_MAX_Y], bounds[b + AABB_MAX_Z],
            );
            if (!casts) {
                levels[out] = CULLED;
            } else if (input.lod && mesh.lods.length > 1) {
                levels[out] = selectLodLevel(mesh.lods, caster.casterWidthTexels, caster.casterHeightTexels, input.lodTrianglesPerPixel, input.lodBias);
            } else {
                levels[out] = BASE_LOD_LEVEL;
            }
        }
    }

    private uploadCasters(): void {
        const batcher = this.batcher;
        if (batcher.instanceCount > 0) {
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
        }
        this.reserveViews(this.viewCount);
        const matrices = this.casterMatrices;
        for (let index = 0; index < this.viewCount; index++) matrices.set(this.views[index].caster!.worldToLightClip, index * CASTER_UNIFORM_STRIDE_FLOATS);
        this.device.queue.writeBuffer(this.casterUniformBuffer, 0, asGpuBufferSource(matrices), 0, this.viewCount * CASTER_UNIFORM_STRIDE_FLOATS);
    }

    private encode(slopeBias: number, meshes: GpuMeshCache, frame: number): void {
        const encoder = this.device.createCommandEncoder(SHADOW_ENCODER);
        const pipeline = this.pipelines.pipelineFor(slopeBias, frame);
        const batches = this.batcher.batches;
        for (let index = 0; index < this.viewCount; index++) {
            const view = this.views[index];
            const slot = this.maps[view.map];
            if (slot.record === NO_RECORD) continue;
            const pass = encoder.beginRenderPass(this.arrayFor(slot.projection).passFor(slot.layer, view.face));
            pass.setPipeline(pipeline);
            pass.setBindGroup(SHADOW_CASTER_BIND_GROUP, this.casterBindGroup, this.dynamicOffsets, index, SINGLE_DYNAMIC_OFFSET);
            if (view.instances > 0) {
                pass.setVertexBuffer(INSTANCE_VERTEX_BUFFER_SLOT, this.instanceBuffer!);
                for (let b = view.firstBatch; b < view.endBatch; b++) {
                    const batch = batches[b];
                    const gpuMesh = meshes.ensure(batch.mesh, frame);
                    pass.setVertexBuffer(MESH_VERTEX_BUFFER_SLOT, gpuMesh.vertexBuffer);
                    pass.setIndexBuffer(gpuMesh.indexBuffer, INDEX_FORMAT);
                    pass.drawIndexed(batch.mesh.triangleCount * TRIANGLE_CORNERS, batch.instanceCount, FIRST_INDEX, NO_BASE_VERTEX, batch.firstInstance);
                }
            }
            pass.end();
        }
        this.device.queue.submit([encoder.finish()]);
    }
}
