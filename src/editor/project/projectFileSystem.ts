export type ProjectEntryKind = "file" | "directory";

export interface ProjectEntry {
    readonly path: string;
    readonly kind: ProjectEntryKind;
    readonly size: number;
    readonly mtimeMs: number;
}

export interface ProjectFileChange {
    readonly paths: readonly string[];
}

export interface ProjectFileSystem {
    readonly rootLabel: string;

    list(): Promise<readonly ProjectEntry[]>;

    read(path: string): Promise<Uint8Array>;

    readText(path: string): Promise<string>;

    write(path: string, contents: Uint8Array | string): Promise<void>;

    remove(path: string): Promise<void>;

    rename(from: string, to: string): Promise<void>;

    makeDirectory(path: string): Promise<void>;

    onChange(listener: (change: ProjectFileChange) => void): () => void;

    openExternally?(path: string): Promise<void>;

    showInFolder?(path: string): Promise<void>;
}
