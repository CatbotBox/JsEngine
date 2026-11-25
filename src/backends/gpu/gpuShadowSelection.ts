import {
    LIGHT_CASTS_NO_SHADOWS,
    LIGHT_KIND_DIRECTIONAL,
    LIGHT_KIND_POINT,
    LIGHT_KIND_RECT,
    LIGHT_KIND_SPHERE,
    LIGHT_KIND_SPOT,
    LIGHT_KIND_TUBE,
    VEC3_FLOATS,
} from "../../engine/rendering/3d/lighting/sceneLights";
import type {SceneLights} from "../../engine/rendering/3d/lighting/sceneLights";

export const SELECTED_SCORE_BONUS = 0.25;
const DIRECTIONAL_TIER = 0;
const POSITIONAL_TIER = 1;
const DIRECTIONAL_SCORE = 0;
const NOT_SELECTED = 0;
const SELECTED = 1;
const FULL_CONE_COSINE = 1;
const INITIAL_CAPACITY = 8;
const GROWTH_FACTOR = 2;
const NO_EMITTER_RADIUS = 0;

export function usesCubeShadow(kind: number): boolean {
    return kind === LIGHT_KIND_POINT || kind === LIGHT_KIND_SPHERE || kind === LIGHT_KIND_TUBE || kind === LIGHT_KIND_RECT;
}

export function shadowReachOf(lights: SceneLights, index: number): number {
    const kind = lights.kind[index], range = lights.range[index];
    if (kind === LIGHT_KIND_SPHERE) return range + lights.radius[index];
    if (kind === LIGHT_KIND_TUBE) return range + lights.radius[index] + lights.extentX[index];
    if (kind === LIGHT_KIND_RECT) return range + Math.hypot(lights.extentX[index], lights.extentY[index]);
    return range;
}

export function shadowEmitterRadiusOf(lights: SceneLights, index: number): number {
    const kind = lights.kind[index];
    return kind === LIGHT_KIND_SPHERE || kind === LIGHT_KIND_TUBE ? lights.radius[index] : NO_EMITTER_RADIUS;
}

function hasDirection(lights: SceneLights, index: number): boolean {
    const d = index * VEC3_FLOATS;
    return Math.hypot(lights.direction[d], lights.direction[d + 1], lights.direction[d + 2]) > 0;
}

export function canCastShadows(lights: SceneLights, index: number): boolean {
    if (lights.castsShadows[index] === LIGHT_CASTS_NO_SHADOWS) return false;
    const kind = lights.kind[index];
    if (kind === LIGHT_KIND_DIRECTIONAL) return hasDirection(lights, index);
    const p = index * VEC3_FLOATS;
    const reach = shadowReachOf(lights, index);
    if (!Number.isFinite(lights.position[p] + lights.position[p + 1] + lights.position[p + 2]) || !(reach > 0) || !Number.isFinite(reach)) return false;
    if (kind === LIGHT_KIND_SPOT) return lights.coneCosOuter[index] < FULL_CONE_COSINE && hasDirection(lights, index);
    return true;
}

export class GpuShadowSelection {
    private _selected = new Int32Array(INITIAL_CAPACITY);
    private _count = 0;
    private candidates = new Int32Array(INITIAL_CAPACITY);
    private tiers = new Uint8Array(INITIAL_CAPACITY);
    private scores = new Float64Array(INITIAL_CAPACITY);
    private wasSelected = new Uint8Array(INITIAL_CAPACITY);

    public get count(): number {
        return this._count;
    }

    public lightAt(rank: number): number {
        return this._selected[rank];
    }

    public clear(): void {
        this._count = 0;
        this.wasSelected.fill(NOT_SELECTED);
    }

    public select(lights: SceneLights, maxLights: number, maxCubeLights: number, cameraX: number, cameraY: number, cameraZ: number): void {
        this.reserve(lights.count);
        let candidateCount = 0;
        for (let light = 0; light < lights.count; light++) {
            if (!canCastShadows(lights, light)) continue;
            const directional = lights.kind[light] === LIGHT_KIND_DIRECTIONAL;
            const tier = directional ? DIRECTIONAL_TIER : POSITIONAL_TIER;
            const score = directional ? DIRECTIONAL_SCORE : this.scoreOf(lights, light, cameraX, cameraY, cameraZ);
            this.insertCandidate(candidateCount++, light, tier, score);
        }
        this.wasSelected.fill(NOT_SELECTED);
        let count = 0, cubes = 0;
        for (let rank = 0; rank < candidateCount && count < maxLights; rank++) {
            const light = this.candidates[rank];
            const cube = usesCubeShadow(lights.kind[light]);
            if (cube && cubes >= maxCubeLights) continue;
            if (cube) cubes++;
            this._selected[count++] = light;
            this.wasSelected[light] = SELECTED;
        }
        this._count = count;
    }

    private scoreOf(lights: SceneLights, light: number, cameraX: number, cameraY: number, cameraZ: number): number {
        const p = light * VEC3_FLOATS;
        const distance = Math.hypot(lights.position[p] - cameraX, lights.position[p + 1] - cameraY, lights.position[p + 2] - cameraZ);
        const score = distance / shadowReachOf(lights, light);
        return this.wasSelected[light] === SELECTED ? score - SELECTED_SCORE_BONUS : score;
    }

    private insertCandidate(at: number, light: number, tier: number, score: number): void {
        let slot = at;
        while (slot > 0 && (this.tiers[slot - 1] > tier || (this.tiers[slot - 1] === tier && this.scores[slot - 1] > score))) {
            this.candidates[slot] = this.candidates[slot - 1];
            this.tiers[slot] = this.tiers[slot - 1];
            this.scores[slot] = this.scores[slot - 1];
            slot--;
        }
        this.candidates[slot] = light;
        this.tiers[slot] = tier;
        this.scores[slot] = score;
    }

    private reserve(lightCount: number): void {
        if (lightCount <= this.candidates.length) return;
        let capacity = this.candidates.length;
        while (capacity < lightCount) capacity *= GROWTH_FACTOR;
        this._selected = new Int32Array(capacity);
        this.candidates = new Int32Array(capacity);
        this.tiers = new Uint8Array(capacity);
        this.scores = new Float64Array(capacity);
        const wasSelected = new Uint8Array(capacity);
        wasSelected.set(this.wasSelected);
        this.wasSelected = wasSelected;
    }
}
