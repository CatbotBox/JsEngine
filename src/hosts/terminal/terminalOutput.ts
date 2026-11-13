export interface TerminalSize {
    readonly columns: number;
    readonly rows: number;
}

export interface TerminalOutput {
    write(chunk: string): void;
    size(): TerminalSize;
    onResize(listener: () => void): () => void;
    backlogged?(): boolean;
}
