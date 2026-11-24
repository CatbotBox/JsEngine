declare const JSENGINE_DEV_RELOAD: boolean;

export const DEV_RELOAD_DEFINE = "JSENGINE_DEV_RELOAD";
export const DEV_EVENTS_PATH = "/__dev/events";
export const DEV_RELOAD_EVENT = "reload";
export const DEV_DATA_ASSETS_EVENT = "data-assets-changed";
export const DEV_DATA_ASSETS_PAGE_EVENT = "jsengine-dev-data-assets-changed";

const DEV_SERVER_PROTOCOL = "http:";
const SITE_FOLDER_OF_SCRIPT = ".";

export const DEV_RELOAD_ENABLED = typeof JSENGINE_DEV_RELOAD !== "undefined" && JSENGINE_DEV_RELOAD;

export interface DevDataAssetsChange {
    readonly paths: readonly string[];
}

export function isDevDataAssetsChange(value: unknown): value is DevDataAssetsChange {
    if (typeof value !== "object" || value === null) return false;
    const paths = (value as {paths?: unknown}).paths;
    return Array.isArray(paths) && paths.every(path => typeof path === "string");
}

export function parseDevDataAssetsChange(data: string): DevDataAssetsChange | undefined {
    try {
        const parsed: unknown = JSON.parse(data);
        return isDevDataAssetsChange(parsed) ? parsed : undefined;
    } catch {
        return undefined;
    }
}

export function offerDevDataAssetsChange(target: EventTarget, change: DevDataAssetsChange): boolean {
    const offered = new CustomEvent<DevDataAssetsChange>(DEV_DATA_ASSETS_PAGE_EVENT, {detail: change, cancelable: true});
    return !target.dispatchEvent(offered);
}

export function takeDevDataAssetsChanges(target: EventTarget, apply: (change: DevDataAssetsChange) => boolean): () => void {
    const listener = (event: Event): void => {
        const detail = (event as CustomEvent<unknown>).detail;
        if (isDevDataAssetsChange(detail) && apply(detail)) event.preventDefault();
    };
    target.addEventListener(DEV_DATA_ASSETS_PAGE_EVENT, listener);
    return () => target.removeEventListener(DEV_DATA_ASSETS_PAGE_EVENT, listener);
}

export function siteFolderOf(scriptUrl: string, pageUrl: string): string {
    return decodeURI(new URL(SITE_FOLDER_OF_SCRIPT, new URL(scriptUrl, pageUrl)).pathname);
}

export function projectPathsIn(siteFolder: string, sitePaths: readonly string[]): string[] {
    return sitePaths.filter(path => path.startsWith(siteFolder) && path.length > siteFolder.length).map(path => path.slice(siteFolder.length));
}

export function connectDevReload(): void {
    if (!DEV_RELOAD_ENABLED || location.protocol !== DEV_SERVER_PROTOCOL || typeof EventSource === "undefined") return;
    const events = new EventSource(DEV_EVENTS_PATH);
    let opened = false;
    events.addEventListener("open", () => {
        opened = true;
    });
    events.addEventListener(DEV_RELOAD_EVENT, () => location.reload());
    events.addEventListener(DEV_DATA_ASSETS_EVENT, event => {
        const change = parseDevDataAssetsChange((event as MessageEvent<string>).data);
        if (change === undefined || !offerDevDataAssetsChange(window, change)) location.reload();
    });
    events.addEventListener("error", () => {
        if (!opened) events.close();
    });
}
