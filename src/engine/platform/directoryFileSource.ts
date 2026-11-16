import type {FileSource, FileStat} from "./platform";
import {joinPath, normalizePath} from "./paths";

const CURRENT_DIRECTORY = ".";

export function directoryFileSource(files: FileSource, directory: string): FileSource {
    if (normalizePath(directory) === CURRENT_DIRECTORY) return files;
    const inDirectory = (path: string): string => joinPath(directory, path);
    const source: FileSource = {
        readBytes: path => files.readBytes(inDirectory(path)),
        readText: path => files.readText(inDirectory(path)),
        exists: path => files.exists(inDirectory(path)),
    };
    const stat = files.stat;
    const write = files.write;
    if (stat !== undefined) source.stat = (path: string): FileStat => stat.call(files, inDirectory(path));
    if (write !== undefined) source.write = (path: string, bytes: Uint8Array): void => write.call(files, inDirectory(path), bytes);
    return source;
}
