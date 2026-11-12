import type {WorkerFactory, WorkerHandle} from "./platform";
import {WORKER_ENTRY_POINT} from "./platform";

export interface BrowserWorker {
    postMessage(message: unknown, transfer?: readonly ArrayBuffer[]): void;
    addEventListener(type: "message", listener: (event: {readonly data: unknown}) => void): void;
    addEventListener(type: "error", listener: (event: {readonly message?: string, readonly error?: unknown}) => void): void;
    terminate(): void;
}

export interface BrowserWorkerHost {
    readonly Worker?: new (url: string) => BrowserWorker;
    readonly Blob?: new (parts: readonly string[], options: {readonly type: string}) => unknown;
    readonly URL?: {createObjectURL(blob: unknown): string};
    readonly crossOriginIsolated?: boolean;
    readonly SharedArrayBuffer?: unknown;
}

const BROWSER_WORKER_BOOTSTRAP = `
self.onmessage = function (first) {
    self.onmessage = null;
    ${WORKER_ENTRY_POINT}(first.data, {
        postMessage: function (message, transfer) {
            if (transfer === undefined) self.postMessage(message);
            else self.postMessage(message, transfer);
        },
        onMessage: function (callback) {
            self.addEventListener("message", function (event) { callback(event.data); });
        },
    });
};
`;

export function browserWorkerFactory(host: BrowserWorkerHost = globalThis as unknown as BrowserWorkerHost): WorkerFactory {
    const {Worker, Blob, URL} = host;
    if (Worker === undefined || Blob === undefined || URL === undefined) {
        throw new Error("This host cannot spawn Web Workers from a blob URL");
    }
    const urls = new Map<string, string>();
    const urlFor = (source: string): string => {
        let url = urls.get(source);
        if (url === undefined) {
            url = URL.createObjectURL(new Blob([source + BROWSER_WORKER_BOOTSTRAP], {type: "text/javascript"}));
            urls.set(source, url);
        }
        return url;
    };
    return {
        spawn(source: string, data: unknown): WorkerHandle {
            const worker = new Worker(urlFor(source));
            worker.postMessage(data);
            return {
                postMessage(message: unknown, transfer?: readonly ArrayBuffer[]): void {
                    if (transfer === undefined) worker.postMessage(message);
                    else worker.postMessage(message, transfer);
                },
                onMessage(callback: (message: unknown) => void): void {
                    worker.addEventListener("message", event => callback(event.data));
                },
                onError(callback: (error: unknown) => void): void {
                    worker.addEventListener("error", event => callback(event.error ?? event.message ?? event));
                },
                terminate(): void {
                    worker.terminate();
                },
            };
        },
    };
}

export function browserWorkersIfIsolated(host: BrowserWorkerHost = globalThis as unknown as BrowserWorkerHost): WorkerFactory | undefined {
    const shared = host.crossOriginIsolated === true && typeof host.SharedArrayBuffer === "function";
    if (!shared || typeof host.Worker !== "function") return undefined;
    return browserWorkerFactory(host);
}
