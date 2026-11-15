import type {PixelFrame} from "../../backends/pixels/pixelFrame";

export class PixelFrameBufferPool {
    private readonly buffers: ArrayBuffer[] = [];

    public constructor(private readonly capacity: number) {
    }

    public get pooledCount(): number {
        return this.buffers.length;
    }

    public give(buffer: ArrayBuffer): void {
        if (buffer.byteLength === 0) return;
        if (this.buffers.length >= this.capacity) this.buffers.shift();
        this.buffers.push(buffer);
    }

    public take(byteLength: number): ArrayBuffer | undefined {
        let taken: ArrayBuffer | undefined;
        let kept = 0;
        for (const buffer of this.buffers) {
            if (taken === undefined && buffer.byteLength === byteLength) taken = buffer;
            else if (buffer.byteLength === byteLength) this.buffers[kept++] = buffer;
        }
        this.buffers.length = kept;
        return taken;
    }

    public copy(frame: PixelFrame): PixelFrame {
        const byteLength = frame.rgba.length;
        const rgba = new Uint8ClampedArray(this.take(byteLength) ?? new ArrayBuffer(byteLength));
        rgba.set(frame.rgba);
        return {
            widthPx: frame.widthPx,
            heightPx: frame.heightPx,
            rgba,
            pixelsPerScreenUnitX: frame.pixelsPerScreenUnitX,
            pixelsPerScreenUnitY: frame.pixelsPerScreenUnitY,
        };
    }
}
