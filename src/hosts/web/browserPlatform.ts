import type {FileSource, Platform} from "../../engine/platform/platform";
import {inflate} from "../../engine/assets/image/inflate";

interface BrowserHost {
    readonly navigator?: {readonly hardwareConcurrency?: number};
    addEventListener?(type: string, listener: () => void): void;
    removeEventListener?(type: string, listener: () => void): void;
}

const EXIT_EVENTS = ["pagehide", "beforeunload"] as const;

export function browserPlatform(files: FileSource): Platform {
    const host = globalThis as unknown as BrowserHost;
    return {
        files,
        inflate,
        hardwareConcurrency: () => host.navigator?.hardwareConcurrency ?? 1,
        now: () => performance.now(),
        onExit: callback => onPageExit(host, callback),
    };
}

function onPageExit(host: BrowserHost, callback: () => void): () => void {
    const cancel = (): void => {
        for (const type of EXIT_EVENTS) host.removeEventListener?.(type, run);
    };
    const run = (): void => {
        cancel();
        callback();
    };
    for (const type of EXIT_EVENTS) host.addEventListener?.(type, run);
    return cancel;
}
