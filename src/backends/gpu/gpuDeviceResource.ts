import {Resource} from "../../engine/core";
import type {World} from "../../engine/core";
import {GpuFrame} from "./gpuFrame";
import type {GpuDevice} from "./gpuTypes";

const MISSING_DEVICE = "This world has no GpuDeviceResource: the host must insert one "
    + "(world.resources.insert(await GpuDeviceResource.request(canvas, gpu, onLost))) before gpu systems are created";
const DEVICE_DESTROYED_ON_PURPOSE: GPUDeviceLostReason = "destroyed";
const OPAQUE_CANVAS: GPUCanvasAlphaMode = "opaque";

const NO_OTHER_CANVASES = "This GpuDeviceResource draws on one canvas only: make it with GpuDeviceResource.request to draw on more";

export type GpuEntryPoint = Pick<GPU, "requestAdapter" | "getPreferredCanvasFormat">;

export type GpuCanvasAttacher = (canvas: OffscreenCanvas) => GpuFrame;

function releaseNothing(): void {
}

export class GpuDeviceResource extends Resource {
    private disposed = false;

    public constructor(
        public readonly device: GpuDevice,
        public readonly frame: GpuFrame,
        private readonly release: () => void = releaseNothing,
        private readonly attachCanvas?: GpuCanvasAttacher,
    ) {
        super();
    }

    public get format(): GPUTextureFormat {
        return this.frame.canvasFormat;
    }

    public static deviceOf(world: World): GpuDeviceResource {
        const resource = world.resources.tryGet(GpuDeviceResource);
        if (resource === undefined) throw new Error(MISSING_DEVICE);
        return resource;
    }

    public static async request(canvas: OffscreenCanvas, gpu: GpuEntryPoint, onLost: (message: string) => void): Promise<GpuDeviceResource> {
        const adapter = await gpu.requestAdapter();
        if (adapter === null) throw new Error("no WebGPU adapter is available");
        const device = await adapter.requestDevice();
        const format = gpu.getPreferredCanvasFormat();
        const configure = (target: OffscreenCanvas): GPUCanvasContext => {
            const context = target.getContext("webgpu");
            if (context === null) throw new Error("the canvas has no webgpu context");
            context.configure({device, format, alphaMode: OPAQUE_CANVAS});
            return context;
        };
        const context = configure(canvas);
        void device.lost.then(info => {
            if (info.reason !== DEVICE_DESTROYED_ON_PURPOSE) onLost(`the WebGPU device was lost (${info.reason}): ${info.message}`);
        });
        const release = (): void => {
            context.unconfigure();
            device.destroy();
        };
        return new GpuDeviceResource(device, new GpuFrame(device, context, canvas, format), release, target => {
            const targetContext = configure(target);
            return new GpuFrame(device, targetContext, target, format, () => targetContext.unconfigure());
        });
    }

    public frameOn(canvas: OffscreenCanvas): GpuFrame {
        if (this.attachCanvas === undefined) throw new Error(NO_OTHER_CANVASES);
        return this.attachCanvas(canvas);
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.frame.dispose();
        this.release();
    }
}
