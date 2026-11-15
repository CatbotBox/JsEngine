declare const JSENGINE_DEV_RELOAD: boolean;

export const DEV_RELOAD_DEFINE = "JSENGINE_DEV_RELOAD";
export const DEV_EVENTS_PATH = "/__dev/events";
export const DEV_RELOAD_EVENT = "reload";

const DEV_SERVER_PROTOCOL = "http:";

export const DEV_RELOAD_ENABLED = typeof JSENGINE_DEV_RELOAD !== "undefined" && JSENGINE_DEV_RELOAD;

export function connectDevReload(): void {
    if (!DEV_RELOAD_ENABLED || location.protocol !== DEV_SERVER_PROTOCOL || typeof EventSource === "undefined") return;
    const events = new EventSource(DEV_EVENTS_PATH);
    let opened = false;
    events.addEventListener("open", () => {
        opened = true;
    });
    events.addEventListener(DEV_RELOAD_EVENT, () => location.reload());
    events.addEventListener("error", () => {
        if (!opened) events.close();
    });
}
