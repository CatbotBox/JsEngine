import {describe, expect, test} from "../../engine/testing/harness";
import type {GameTarget} from "../project/editorSettings";
import {isRuntimeSourceFile, ToolchainServerClient} from "./toolchainServerClient";
import type {Closable, SourceTreeWatcher, ToolchainServerEvents, ToolchainServerStarter} from "./toolchainServerClient";
import {parseToolchainRequest, toolchainReplyRecord} from "./toolchainServerProtocol";
import type {ToolchainRequest} from "./toolchainServerProtocol";

const REPO_ROOT = "/repo";
const SOURCE_ROOT = "/repo/src";
const BUN_PATH = "/bin/bun";
const PROJECT = "/projects/game";
const OTHER_PROJECT = "/projects/other";
const WEB_PIXELS: GameTarget = {target: "web", backend: "pixels"};
const EXITED = "jsengine toolchain-server exited with 1";
const ENGINE_SOURCE = "/repo/src/engine/core/world.ts";

class FakeServer {
    public readonly requests: ToolchainRequest[] = [];
    public killed = false;

    public constructor(public readonly events: ToolchainServerEvents) {
    }

    public reply(report: unknown, index = this.requests.length - 1): void {
        this.events.stdout(toolchainReplyRecord({id: this.requests[index].id, report}));
    }

    public receive(text: string): void {
        const parsed = parseToolchainRequest(text);
        if (!parsed.ok) throw new Error(parsed.problem);
        this.requests.push(parsed.request);
    }
}

class FakeWatcher implements Closable {
    public closed = false;

    public constructor(public readonly change: (path: string | undefined) => void) {
    }

    public close(): void {
        this.closed = true;
    }
}

interface Fakes {
    readonly servers: FakeServer[];
    readonly watchers: FakeWatcher[];
    readonly client: ToolchainServerClient;
}

function fakes(start?: ToolchainServerStarter, watchSources?: SourceTreeWatcher): Fakes {
    const servers: FakeServer[] = [];
    const watchers: FakeWatcher[] = [];
    const startFake: ToolchainServerStarter = (_repoRoot, _bunPath, events) => {
        const server = new FakeServer(events);
        servers.push(server);
        return {write: text => server.receive(text), kill: () => server.killed = true};
    };
    const watchFake: SourceTreeWatcher = (_directory, onChange) => {
        const watcher = new FakeWatcher(onChange);
        watchers.push(watcher);
        return watcher;
    };
    const client = new ToolchainServerClient({repoRoot: REPO_ROOT, bunPath: BUN_PATH, sourceRoot: SOURCE_ROOT, start: start ?? startFake, watchSources: watchSources ?? watchFake});
    return {servers, watchers, client};
}

function nextTask(): Promise<void> {
    return new Promise(resolveTask => setTimeout(resolveTask, 0));
}

async function failureOf(promise: Promise<unknown>): Promise<string> {
    try {
        await promise;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
    throw new Error("expected the request to fail");
}

describe("toolchain server client", () => {
    test("the first request starts the server, later ones reuse it with the next id", async () => {
        const {servers, client} = fakes();
        const built = client.buildEditor(PROJECT, WEB_PIXELS);
        await nextTask();
        expect(servers.length).toBe(1);
        expect(servers[0].requests).toEqual([{id: 1, op: "build-editor", project: PROJECT, simulate: "web", backend: "pixels"}]);
        servers[0].reply({ok: true});
        expect(await built).toEqual({ok: true});
        const generated = client.generate(OTHER_PROJECT);
        await nextTask();
        servers[0].reply({ok: true, written: []});
        expect(await generated).toEqual({ok: true, written: []});
        expect(servers.length).toBe(1);
        expect(servers[0].requests.map(request => [request.id, request.op, request.project])).toEqual([[1, "build-editor", PROJECT], [2, "generate", OTHER_PROJECT]]);
        client.close();
    });

    test("requests go one at a time, across projects too", async () => {
        const {servers, client} = fakes();
        const first = client.generate(PROJECT);
        const second = client.generate(OTHER_PROJECT);
        await nextTask();
        expect(servers[0].requests.length).toBe(1);
        servers[0].reply("first");
        expect(await first).toBe("first");
        await nextTask();
        expect(servers[0].requests.map(request => request.project)).toEqual([PROJECT, OTHER_PROJECT]);
        servers[0].reply("second");
        expect(await second).toBe("second");
        client.close();
    });

    test("output printed around a reply and on stderr does not disturb it", async () => {
        const {servers, client} = fakes();
        const built = client.buildEditor(PROJECT, WEB_PIXELS);
        await nextTask();
        const record = toolchainReplyRecord({id: 1, report: "built"});
        servers[0].events.stderr("warning: slow\n");
        servers[0].events.stdout(`bundling${record.slice(0, 4)}`);
        servers[0].events.stdout(`${record.slice(4)}done\n`);
        expect(await built).toBe("built");
        client.close();
    });

    test("an error reply fails the request, also when the server could not read its id", async () => {
        const {servers, client} = fakes();
        const refused = client.generate(PROJECT);
        await nextTask();
        servers[0].events.stdout(toolchainReplyRecord({id: null, error: "a request is one JSON object per line"}));
        expect(await failureOf(refused)).toBe("a request is one JSON object per line");
        client.close();
    });

    test("a server that dies mid-request fails it with what it printed, and the next request starts a new one", async () => {
        const {servers, watchers, client} = fakes();
        const built = client.buildEditor(PROJECT, WEB_PIXELS);
        await nextTask();
        servers[0].events.stderr("Segmentation fault\n");
        servers[0].events.ended(EXITED);
        expect(await failureOf(built)).toBe(`${EXITED}: Segmentation fault`);
        expect(watchers[0].closed).toBe(true);
        const retried = client.buildEditor(PROJECT, WEB_PIXELS);
        await nextTask();
        expect(servers.length).toBe(2);
        expect(servers[1].requests[0].id).toBe(2);
        servers[1].reply({ok: true});
        expect(await retried).toEqual({ok: true});
        client.close();
    });

    test("a server that dies while idle is replaced on the next request", async () => {
        const {servers, client} = fakes();
        const first = client.generate(PROJECT);
        await nextTask();
        servers[0].reply("first");
        await first;
        servers[0].events.ended(EXITED);
        const second = client.generate(PROJECT);
        await nextTask();
        expect(servers.length).toBe(2);
        servers[1].reply("second");
        expect(await second).toBe("second");
        client.close();
    });

    test("a server that cannot start fails the request with the reason, and the next request tries again", async () => {
        let attempts = 0;
        const unstartable: ToolchainServerStarter = (_repoRoot, bunPath, events) => {
            attempts++;
            if (attempts === 1) throw new Error(`spawn ${bunPath} EACCES`);
            events.ended(`spawn ${bunPath} ENOENT`);
            return {write: () => undefined, kill: () => undefined};
        };
        const {watchers, client} = fakes(unstartable);
        expect(await failureOf(client.generate(PROJECT))).toBe(`spawn ${BUN_PATH} EACCES`);
        expect(watchers[0].closed).toBe(true);
        expect(await failureOf(client.generate(PROJECT))).toBe(`spawn ${BUN_PATH} ENOENT`);
        expect(attempts).toBe(2);
        client.close();
    });

    test("a change to a runtime source stops an idle server, and the next request starts a fresh one", async () => {
        const {servers, watchers, client} = fakes();
        const first = client.generate(PROJECT);
        await nextTask();
        servers[0].reply("first");
        await first;
        watchers[0].change("/repo/src/engine/core/world.test.ts");
        watchers[0].change("/repo/src/editor/README.md");
        expect(servers[0].killed).toBe(false);
        watchers[0].change(ENGINE_SOURCE);
        expect(servers[0].killed).toBe(true);
        expect(watchers[0].closed).toBe(true);
        const second = client.generate(PROJECT);
        await nextTask();
        expect(servers.length).toBe(2);
        servers[1].reply("second");
        expect(await second).toBe("second");
        client.close();
    });

    test("a change while a request runs lets it finish, then stops the server", async () => {
        const {servers, watchers, client} = fakes();
        const built = client.buildEditor(PROJECT, WEB_PIXELS);
        await nextTask();
        watchers[0].change(ENGINE_SOURCE);
        expect(servers[0].killed).toBe(false);
        servers[0].reply({ok: true});
        expect(await built).toEqual({ok: true});
        expect(servers[0].killed).toBe(true);
        const next = client.generate(PROJECT);
        await nextTask();
        expect(servers.length).toBe(2);
        servers[1].reply("next");
        expect(await next).toBe("next");
        client.close();
    });

    test("a change the watcher cannot name counts as a change to the sources", async () => {
        const {servers, watchers, client} = fakes();
        const first = client.generate(PROJECT);
        await nextTask();
        servers[0].reply("first");
        await first;
        watchers[0].change(undefined);
        expect(servers[0].killed).toBe(true);
        client.close();
    });

    test("without a source watcher every request gets a fresh server", async () => {
        const {servers, client} = fakes(undefined, () => undefined);
        for (const project of [PROJECT, OTHER_PROJECT]) {
            const generated = client.generate(project);
            await nextTask();
            servers[servers.length - 1].reply(project);
            expect(await generated).toBe(project);
        }
        expect(servers.length).toBe(2);
        expect(servers.map(server => server.killed)).toEqual([true, true]);
        client.close();
    });

    test("closing stops the server and its watcher, fails the request in flight and refuses later ones", async () => {
        const {servers, watchers, client} = fakes();
        const built = client.buildEditor(PROJECT, WEB_PIXELS);
        await nextTask();
        client.close();
        expect(servers[0].killed).toBe(true);
        expect(watchers[0].closed).toBe(true);
        expect(await failureOf(built)).toBe("the project server closed");
        expect(await failureOf(client.generate(PROJECT))).toBe("the project server closed");
        expect(servers.length).toBe(1);
    });

    test("runtime sources are code files other than unit tests", () => {
        expect(isRuntimeSourceFile(ENGINE_SOURCE)).toBe(true);
        expect(isRuntimeSourceFile("C:\\repo\\src\\toolchain\\cli.ts")).toBe(true);
        expect(isRuntimeSourceFile("/repo/src/engine/core/world.test.ts")).toBe(false);
        expect(isRuntimeSourceFile("/repo/src/editor/launch/editor.css")).toBe(false);
    });
});
