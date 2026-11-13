import {copyPixelFrame} from "./pixelFrame";
import type {PixelFrame} from "./pixelFrame";
import type {PixelPresenter, PixelPresenterSize} from "./pixelPresenter";

const DEFAULT_WIDTH_PX = 320;
const DEFAULT_HEIGHT_PX = 192;

export class MemoryPixelPresenter implements PixelPresenter {
    public readonly frames: PixelFrame[] = [];
    public starts = 0;
    public stops = 0;
    public disposals = 0;
    public isBacklogged = false;

    private widthPx: number;
    private heightPx: number;
    private readonly resizeListeners = new Set<() => void>();

    public constructor(size: PixelPresenterSize = {widthPx: DEFAULT_WIDTH_PX, heightPx: DEFAULT_HEIGHT_PX}) {
        this.widthPx = size.widthPx;
        this.heightPx = size.heightPx;
    }

    public get lastFrame(): PixelFrame | undefined {
        return this.frames[this.frames.length - 1];
    }

    public get resizeListenerCount(): number {
        return this.resizeListeners.size;
    }

    public size(): PixelPresenterSize {
        return {widthPx: this.widthPx, heightPx: this.heightPx};
    }

    public onResize(listener: () => void): () => void {
        const entry = () => listener();
        this.resizeListeners.add(entry);
        return () => {
            this.resizeListeners.delete(entry);
        };
    }

    public resize(widthPx: number, heightPx: number): void {
        this.widthPx = widthPx;
        this.heightPx = heightPx;
        for (const listener of [...this.resizeListeners]) listener();
    }

    public backlogged(): boolean {
        return this.isBacklogged;
    }

    public start(): void {
        this.starts++;
    }

    public stop(): void {
        this.stops++;
    }

    public dispose(): void {
        this.disposals++;
    }

    public present(frame: PixelFrame): void {
        this.frames.push(copyPixelFrame(frame));
    }
}
