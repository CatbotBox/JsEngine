export interface CellSurfaceSize {
    readonly columns: number;
    readonly rows: number;
}

export interface CellSurface {
    write(chunk: string): void;
    backlogged?(): boolean;
    size(): CellSurfaceSize;
    onResize(callback: () => void): () => void;
}
