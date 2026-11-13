import type {CellFrame} from "./cellFrame";

export interface CellPresenterSize {
    readonly columns: number;
    readonly rows: number;
}

export type CellRepaint = "full" | "changes";

export interface CellPresenter {
    size(): CellPresenterSize;
    onResize(listener: () => void): () => void;
    backlogged?(): boolean;
    start(): void;
    stop(): void;
    dispose?(): void;
    present(frame: CellFrame, repaint: CellRepaint): void;
}
