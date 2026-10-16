import {readFileSync} from "fs";
import {join} from "path";
import {describe, expect, test} from "../src/js_engine/testing/harness";

/** The vendored script, run unmodified: as a page script (`window` defined) or as the service worker. */
const SOURCE = readFileSync(join(__dirname, "coi-serviceworker.js"), "utf8");
const SCRIPT_URL = "https://catbotbox.example/jsengine/coi-serviceworker.js";
/** Most loads one navigation may take before the script stops reloading. */
const MAX_LOADS_PER_NAVIGATION = 3;

type Run = (window: unknown, navigator: unknown, self: unknown, fetch: unknown, console: unknown) => void;
const run = new Function("window", "navigator", "self", "fetch", "console", SOURCE) as Run;
const quiet = {log: () => undefined, error: () => undefined};

const settle = () => new Promise<void>(done => setTimeout(done, 0));

/** One browser tab's state across loads; what isolates a load depends on the host and what the browser supports. */
interface Browser {
    /** The host sends COOP/COEP itself (Cloudflare Pages / Netlify reading `_headers`). */
    readonly headers: boolean;
    readonly secure: boolean;
    readonly serviceWorkers: boolean;
    /** Isolates a page whose response carries COEP credentialless / require-corp. */
    readonly credentialless: boolean;
    readonly requireCorp: boolean;
    /** Browsers too old to know `crossOriginIsolated` leave it undefined. */
    readonly knowsIsolation?: boolean;
    readonly session: Map<string, string>;
    workerActive: boolean;
    /** The worker's own `coepCredentialless`, set by the pages it controls; it starts false. */
    workerCredentialless: boolean;
    registrations: number;
}

function browser(options: Partial<Pick<Browser, "headers" | "secure" | "serviceWorkers" | "credentialless" | "requireCorp" | "knowsIsolation">>): Browser {
    return {
        headers: false,
        secure: true,
        serviceWorkers: true,
        credentialless: true,
        requireCorp: true,
        ...options,
        session: new Map(),
        workerActive: false,
        workerCredentialless: false,
        registrations: 0,
    };
}

interface Load {
    readonly isolated: boolean | undefined;
    readonly reloaded: boolean;
}

/** One page load: the response is isolated by the host's headers or by the worker controlling it. */
async function load(tab: Browser): Promise<Load> {
    const controlled = tab.serviceWorkers && tab.workerActive;
    const isolatedByWorker = controlled && (tab.workerCredentialless ? tab.credentialless : tab.requireCorp);
    const isolated = tab.knowsIsolation === false ? undefined : tab.headers || isolatedByWorker;
    let reloaded = false;
    const updateFound: (() => void)[] = [];
    const window = {
        sessionStorage: {
            getItem: (key: string) => tab.session.get(key) ?? null,
            setItem: (key: string, value: string) => tab.session.set(key, String(value)),
            removeItem: (key: string) => tab.session.delete(key),
        },
        crossOriginIsolated: isolated,
        isSecureContext: tab.secure,
        document: {currentScript: {src: SCRIPT_URL}},
        location: {
            reload: () => {
                reloaded = true;
            },
        },
    };
    const serviceWorker = {
        controller: controlled ? {
            postMessage: (message: {type: string, value?: boolean}) => {
                if (message.type === "coepCredentialless") tab.workerCredentialless = message.value === true;
            },
        } : null,
        register: async (url: string) => {
            expect(url).toBe(SCRIPT_URL);
            tab.registrations++;
            const wasActive = tab.workerActive;
            tab.workerActive = true;
            return {
                scope: SCRIPT_URL.slice(0, SCRIPT_URL.lastIndexOf("/") + 1),
                active: wasActive ? {} : null,
                addEventListener: (type: string, listener: () => void) => {
                    if (type === "updatefound" && !wasActive) updateFound.push(listener);
                },
            };
        },
    };
    run(window, {serviceWorker: tab.serviceWorkers ? serviceWorker : undefined}, undefined, undefined, quiet);
    await settle();
    for (const listener of updateFound) listener();
    await settle();
    return {isolated, reloaded};
}

/** Follows the script's reloads until a load does not reload; fails past MAX_LOADS_PER_NAVIGATION. */
async function navigate(tab: Browser): Promise<Load[]> {
    const loads: Load[] = [];
    for (;;) {
        const loaded = await load(tab);
        loads.push(loaded);
        if (!loaded.reloaded) return loads;
        if (loads.length >= MAX_LOADS_PER_NAVIGATION) throw new Error(`still reloading after ${loads.length} loads`);
    }
}

describe("coi-serviceworker (vendored), page side", () => {
    test("a host sending COOP/COEP is isolated on the first load: nothing registered, no reload", async () => {
        const tab = browser({headers: true});
        for (let visit = 0; visit < 3; visit++) {
            expect(await navigate(tab)).toEqual([{isolated: true, reloaded: false}]);
        }
        expect(tab.registrations).toBe(0);
    });

    test("a host without headers: registers, reloads once, isolated from then on", async () => {
        const tab = browser({});
        expect(await navigate(tab)).toEqual([{isolated: false, reloaded: true}, {isolated: true, reloaded: false}]);
        expect(tab.registrations).toBe(1);
        for (let visit = 0; visit < 3; visit++) {
            expect(await navigate(tab)).toEqual([{isolated: true, reloaded: false}]);
        }
        expect(tab.workerCredentialless).toBe(true);
    });

    test("no COEP credentialless (Safari): one more reload degrades the worker to require-corp, then it stays", async () => {
        const tab = browser({credentialless: false});
        expect((await navigate(tab)).map(loaded => loaded.isolated)).toEqual([false, true]);
        expect((await navigate(tab)).map(loaded => loaded.isolated)).toEqual([false, true]);
        expect(tab.workerCredentialless).toBe(false);
        for (let visit = 0; visit < 3; visit++) {
            expect(await navigate(tab)).toEqual([{isolated: true, reloaded: false}]);
        }
    });

    test("a browser the worker cannot isolate at all stops reloading: the page runs single-threaded", async () => {
        const tab = browser({credentialless: false, requireCorp: false});
        const first = await navigate(tab);
        expect(first.length).toBeLessThan(MAX_LOADS_PER_NAVIGATION + 1);
        expect(first[first.length - 1]).toEqual({isolated: false, reloaded: false});
        for (let visit = 0; visit < 3; visit++) {
            const loads = await navigate(tab);
            expect(loads.length).toBeLessThan(MAX_LOADS_PER_NAVIGATION);
            expect(loads.every(loaded => loaded.isolated === false)).toBe(true);
        }
    });

    test("an insecure context, no service workers, or no notion of isolation: nothing registered, no reload", async () => {
        for (const tab of [browser({secure: false}), browser({serviceWorkers: false}), browser({knowsIsolation: false})]) {
            const loads = await navigate(tab);
            expect(loads.length).toBe(1);
            expect(loads[0].reloaded).toBe(false);
            expect(tab.registrations).toBe(0);
        }
    });
});

describe("coi-serviceworker (vendored), worker side", () => {
    test("adds COOP and COEP to every response it passes through, credentialless once a page asks", async () => {
        const listeners = new Map<string, (event: unknown) => void>();
        const self = {
            addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
            skipWaiting: () => undefined,
            clients: {claim: async () => undefined},
        };
        const fetch = async () => new Response("page", {status: 200, headers: {"Content-Type": "text/html"}});
        run(undefined, undefined, self, fetch, quiet);

        const respond = async (): Promise<Response> => {
            let responded: Promise<Response> | undefined;
            listeners.get("fetch")!({
                request: {cache: "default", mode: "navigate"},
                respondWith: (response: Promise<Response>) => {
                    responded = response;
                },
            });
            return await responded!;
        };
        const first = await respond();
        expect(first.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
        expect(first.headers.get("Cross-Origin-Embedder-Policy")).toBe("require-corp");
        expect(first.headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
        expect(first.headers.get("Content-Type")).toBe("text/html");
        expect(await first.text()).toBe("page");

        listeners.get("message")!({data: {type: "coepCredentialless", value: true}});
        const later = await respond();
        expect(later.headers.get("Cross-Origin-Embedder-Policy")).toBe("credentialless");
        expect(later.headers.get("Cross-Origin-Resource-Policy")).toBe(null);
    });
});
