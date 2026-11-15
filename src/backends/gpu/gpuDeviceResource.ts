import {Resource} from "../../engine/core";
import type {World} from "../../engine/core";
import {GpuFrame} from "./gpuFrame";
import type {GpuDevice} from "./gpuTypes";

const MISSING_DEVICE = "This world has no GpuDeviceResource: the host must insert one "
    + "(world.resources.insert(await GpuDeviceResource.request(canvas, gpu, onLost))) before gpu systems are created";
const DEVICE_DESTROYED_ON_PURPOSE: GPUDeviceLostReason = "destroyed";
const OPAQUE_CANVAS: GPUCanvasAlphaMode = "opaque";

export type GpuEntryPoint = Pick<GPU, "requestAdapter" | "getPreferredCanvasFormat">;

function releaseNothing(): void {
}

export class GpuDeviceResource extends Resource {
    private disposed = false;

    public constructor(public readonly device: GpuDevice, public readonly frame: GpuFrame, private readonly release: () => void = releaseNothing) {
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
        const context = canvas.getContext("webgpu");
        if (context === null) throw new Error("the canvas has no webgpu context");
        const format = gpu.getPreferredCanvasFormat();
        context.configure({device, format, alphaMode: OPAQUE_CANVAS});
        void device.lost.then(info => {
            if (info.reason !== DEVICE_DESTROYED_ON_PURPOSE) onLost(`the WebGPU device was lost (${info.reason}): ${info.message}`);
        });
        return new GpuDeviceResource(device, new GpuFrame(device, context, canvas, format), () => {
            context.unconfigure();
            device.destroy();
        });
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.frame.dispose();
        this.release();
    }
}
