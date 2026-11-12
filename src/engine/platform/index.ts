export type {
    Platform,
    PlatformOutput,
    PlatformInput,
    PlatformScreen,
    TerminalSize,
    FileSource,
    FileStat,
    Inflate,
    AssetLoadOptions,
    WorkerFactory,
    WorkerHandle,
    WorkerPort,
} from "./platform";
export {WORKER_ENTRY_POINT} from "./platform";
export {joinPath, dirname, normalizePath, isAbsolutePath} from "./paths";
