import {renderBackendFromQuery} from "./worldWorkerProtocol";
import {isRenderBackendKind} from "../../engine/rendering/renderBackend";
import type {RenderBackendKind} from "../../engine/rendering/renderBackend";

const MODULE_SCRIPT_TYPE = "module";
const GPU_BACKEND = "gpu" satisfies RenderBackendKind;
const GPU_FALLBACK_BACKEND = "pixels" satisfies RenderBackendKind;
const NO_GPU_SCRIPT_REASON = "this page has no WebGPU backend";
const WEBGPU_UNUSABLE_REASON = "WebGPU is not usable in this browser (no navigator.gpu, no adapter, or no OffscreenCanvas transfer)";

export type RenderBackendScripts = Readonly<Record<"cells" | "pixels", string>> & {readonly gpu?: string};

export interface RenderBackendScriptOptions {
    readonly defaultBackend?: RenderBackendKind;
}

export interface GpuAvailability {
    readonly gpuScript: boolean;
    readonly webGpuUsable: boolean;
}

export interface RenderBackendChoice {
    readonly backend: RenderBackendKind;
    readonly fallbackReason?: string;
}

export interface WebGpuNavigator {
    readonly gpu?: {requestAdapter(): Promise<unknown>};
}

export interface OffscreenTransferCanvas {
    readonly transferControlToOffscreen?: unknown;
}

export interface BackendDefaultingPage {
    readonly documentElement: {readonly dataset: {readonly defaultBackend?: string}};
}

export function pageDefaultRenderBackend(page: BackendDefaultingPage): RenderBackendKind | undefined {
    const declared = page.documentElement.dataset.defaultBackend;
    return isRenderBackendKind(declared) ? declared : undefined;
}

export function chooseRenderBackend(requested: RenderBackendKind, {gpuScript, webGpuUsable}: GpuAvailability): RenderBackendChoice {
    if (requested !== GPU_BACKEND) return {backend: requested};
    if (!gpuScript) return {backend: GPU_FALLBACK_BACKEND, fallbackReason: NO_GPU_SCRIPT_REASON};
    if (!webGpuUsable) return {backend: GPU_FALLBACK_BACKEND, fallbackReason: WEBGPU_UNUSABLE_REASON};
    return {backend: GPU_BACKEND};
}

export async function webGpuUsable(nav: WebGpuNavigator, canvas: OffscreenTransferCanvas): Promise<boolean> {
    try {
        if (typeof canvas.transferControlToOffscreen !== "function") return false;
        const gpu = nav.gpu;
        if (gpu === undefined) return false;
        return await gpu.requestAdapter() !== null;
    } catch {
        return false;
    }
}

export function gpuFallbackWarning(reason: string): string {
    return `?backend=${GPU_BACKEND} is experimental and unavailable here: ${reason}; using ?backend=${GPU_FALLBACK_BACKEND}`;
}

function scriptOf(scripts: RenderBackendScripts, backend: RenderBackendKind): string {
    if (backend === GPU_BACKEND) return scripts.gpu ?? scripts[GPU_FALLBACK_BACKEND];
    return scripts[backend];
}

export function loadRenderBackendScript(scripts: RenderBackendScripts, options: RenderBackendScriptOptions = {}): void {
    void loadChosenRenderBackendScript(scripts, options);
}

async function loadChosenRenderBackendScript(scripts: RenderBackendScripts, options: RenderBackendScriptOptions): Promise<void> {
    const requested = renderBackendFromQuery(location.search, options.defaultBackend);
    const gpuScript = scripts.gpu !== undefined;
    const usable = requested === GPU_BACKEND && gpuScript && await webGpuUsable(navigator, HTMLCanvasElement.prototype);
    const choice = chooseRenderBackend(requested, {gpuScript, webGpuUsable: usable});
    if (choice.fallbackReason !== undefined) console.warn(gpuFallbackWarning(choice.fallbackReason));
    const script = document.createElement("script");
    script.type = MODULE_SCRIPT_TYPE;
    script.src = scriptOf(scripts, choice.backend);
    script.addEventListener("load", () => {
        document.documentElement.dataset.renderBackend = choice.backend;
    }, {once: true});
    document.body.append(script);
}
