export interface CanvasTextMetrics {
    readonly width: number;
    readonly fontBoundingBoxAscent?: number;
    readonly fontBoundingBoxDescent?: number;
}

export interface CanvasCellContext<Image> {
    fillStyle: unknown;
    font: string;
    fillRect(x: number, y: number, width: number, height: number): void;
    measureText(text: string): CanvasTextMetrics;
    drawImage(image: Image, sourceX: number, sourceY: number, sourceWidth: number, sourceHeight: number,
              x: number, y: number, width: number, height: number): void;
}

export interface CanvasGlyphContext {
    fillStyle: unknown;
    font: string;
    textBaseline: string;
    clearRect(x: number, y: number, width: number, height: number): void;
    fillText(text: string, x: number, y: number): void;
    save(): void;
    restore(): void;
    beginPath(): void;
    rect(x: number, y: number, width: number, height: number): void;
    clip(): void;
}

export interface CanvasCellSurface {
    width: number;
    height: number;
}

export interface CanvasGlyphAtlasCanvas extends CanvasCellSurface {
    getContext(contextId: "2d"): CanvasGlyphContext | null;
}
