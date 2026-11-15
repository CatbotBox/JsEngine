import type {ProjectFileSystem} from "./projectFileSystem";
import {isProjectFilesWorldMessage, PROJECT_FILES_MESSAGE_TYPE} from "./projectFilesProtocol";
import type {ProjectFileReadMessage, ProjectFilesPageMessage, ProjectListedFile} from "./projectFilesProtocol";

export interface ProjectFilesPort {
    postMessage(message: ProjectFilesPageMessage, transfer: ArrayBuffer[]): void;
    addEventListener(type: "message", listener: (event: {readonly data: unknown}) => void): void;
}

export interface ProjectFileServing {
    dispose(): void;
}

const NO_TRANSFER: ArrayBuffer[] = [];

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
    if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) return bytes.buffer;
    return bytes.slice().buffer as ArrayBuffer;
}

export function serveProjectFiles(port: ProjectFilesPort, files: ProjectFileSystem): ProjectFileServing {
    let disposed = false;
    let listingsStarted = 0;
    const post = (message: ProjectFilesPageMessage, transfer: ArrayBuffer[] = NO_TRANSFER): void => {
        if (!disposed) port.postMessage(message, transfer);
    };
    const postListing = async (): Promise<void> => {
        const listing = ++listingsStarted;
        try {
            const entries = await files.list();
            if (listing !== listingsStarted) return;
            const listed: ProjectListedFile[] = entries
                .filter(entry => entry.kind === "file")
                .map(entry => ({path: entry.path, size: entry.size, mtimeMs: entry.mtimeMs}));
            post({type: PROJECT_FILES_MESSAGE_TYPE, kind: "listing", files: listed});
        } catch (error) {
            if (listing === listingsStarted) post({type: PROJECT_FILES_MESSAGE_TYPE, kind: "listingFailed", error: describeError(error)});
        }
    };
    const answer = async (request: ProjectFileReadMessage): Promise<void> => {
        try {
            const bytes = ownedBuffer(await files.read(request.path));
            post({type: PROJECT_FILES_MESSAGE_TYPE, kind: "contents", requestId: request.requestId, ok: true, bytes}, [bytes]);
        } catch (error) {
            post({type: PROJECT_FILES_MESSAGE_TYPE, kind: "contents", requestId: request.requestId, ok: false, error: describeError(error)});
        }
    };

    port.addEventListener("message", event => {
        if (!disposed && isProjectFilesWorldMessage(event.data)) void answer(event.data);
    });
    const stopWatching = files.onChange(() => void postListing());
    void postListing();
    return {
        dispose(): void {
            disposed = true;
            stopWatching();
        },
    };
}
