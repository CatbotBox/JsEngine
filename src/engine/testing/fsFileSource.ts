import type {FileSource, FileStat} from "../platform/platform";

export interface SyncFileSystem {
    readFileSync(path: string): Uint8Array;
    readFileSync(path: string, encoding: "utf8"): string;
    existsSync(path: string): boolean;
    statSync(path: string): FileStat;
    writeFileSync(path: string, bytes: Uint8Array): void;
}

export function fsFileSource(fs: SyncFileSystem): FileSource {
    return {
        readBytes(path: string): Uint8Array {
            const bytes = fs.readFileSync(path);
            return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        },
        readText(path: string): string {
            return fs.readFileSync(path, "utf8");
        },
        exists(path: string): boolean {
            return fs.existsSync(path);
        },
        stat(path: string): FileStat {
            const stats = fs.statSync(path);
            return {size: stats.size, mtimeMs: stats.mtimeMs};
        },
        write(path: string, bytes: Uint8Array): void {
            fs.writeFileSync(path, bytes);
        },
    };
}
