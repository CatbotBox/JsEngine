import type {PixelFrame} from "../pixelFrame";
import type {PixelPresenter, PixelPresenterSize} from "../pixelPresenter";

const IMAGE_ORIGIN_PX = 0;

export interface PixelImageData {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8ClampedArray;
}

export interface CanvasPixelContext<Image extends PixelImageData> {
    createImageData(width: number, height: number): Image;
    putImageData(image: Image, x: number, y: number): void;
}

export interface CanvasPixelSurface {
    width: number;
    height: number;
}

export interface CanvasPixelPresenterOptions<Image extends PixelImageData> {
    readonly canvas: CanvasPixelSurface;
    readonly context: CanvasPixelContext<Image>;
}

export class CanvasPixelPresenter<Image extends PixelImageData> implements PixelPresenter {
    private readonly canvas: CanvasPixelSurface;
    private readonly context: CanvasPixelContext<Image>;
    private readonly resizeListeners = new Set<() => void>();
    private image: Image | undefined;

    public constructor(options: CanvasPixelPresenterOptions<Image>) {
        this.canvas = options.canvas;
        this.context = options.context;
    }

    public size(): PixelPresenterSize {
        return {widthPx: this.canvas.width, heightPx: this.canvas.height};
    }

    public onResize(listener: () => void): () => void {
        const entry = () => listener();
        this.resizeListeners.add(entry);
        return () => {
            this.resizeListeners.delete(entry);
        };
    }

    public resize(widthPx: number, heightPx: number): void {
        if (widthPx === this.canvas.width && heightPx === this.canvas.height) return;
        this.canvas.width = widthPx;
        this.canvas.height = heightPx;
        for (const listener of [...this.resizeListeners]) listener();
    }

    public start(): void {
    }

    public stop(): void {
    }

    public present(frame: PixelFrame): void {
        if (frame.widthPx === 0 || frame.heightPx === 0) return;
        const image = this.imageFor(frame.widthPx, frame.heightPx);
        image.data.set(frame.rgba);
        this.context.putImageData(image, IMAGE_ORIGIN_PX, IMAGE_ORIGIN_PX);
    }

    private imageFor(widthPx: number, heightPx: number): Image {
        const cached = this.image;
        if (cached !== undefined && cached.width === widthPx && cached.height === heightPx) return cached;
        const created = this.context.createImageData(widthPx, heightPx);
        this.image = created;
        return created;
    }
}
