import type {PixelFrame} from "./pixelFrame";

export interface PixelPresenterSize {
    readonly widthPx: number;
    readonly heightPx: number;
}

export interface PixelPresenter {
    size(): PixelPresenterSize;
    onResize(listener: () => void): () => void;
    backlogged?(): boolean;
    start(): void;
    stop(): void;
    dispose?(): void;
    present(frame: PixelFrame): void;
}
