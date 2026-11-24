import {spawn} from "child_process";
import {existsSync, watch} from "fs";
import {join} from "path";
import {PROJECT_ENTRY_EXTENSIONS} from "../../engine/project/projectManifest";
import {projectFileExtension} from "../../engine/project/projectPaths";
import type {GameTarget} from "../project/editorSettings";
import {BUILD_EDITOR_OP, GENERATE_OP, TOOLCHAIN_SERVER_COMMAND, toolchainRequestLine, ToolchainReplyReader} from "./toolchainServerProtocol";
import type {ToolchainOperation, ToolchainReply} from "./toolchainServerProtocol";

export interface ToolchainServerEvents {
    readonly stdout: (text: string) => void;
    readonly stderr: (text: string) => void;
    readonly ended: (reason: string) => void;
}

export interface ToolchainServerProcess {
    write(text: string): void;
    kill(): void;
}

export type ToolchainServerStarter = (repoRoot: string, bunPath: string, events: ToolchainServerEvents) => ToolchainServerProcess;

export interface Closable {
    close(): void;
}

export type SourceTreeWatcher = (directory: string, onChange: (path: string | undefined) => void) => Closable | undefined;

export interface ToolchainServerClientOptions {
    readonly repoRoot: string;
    readonly bunPath: string;
    readonly sourceRoot: string;
    readonly start: ToolchainServerStarter;
    readonly watchSources: SourceTreeWatcher;
}

interface PendingRequest {
    readonly id: number;
    readonly resolve: (report: unknown) => void;
    readonly reject: (error: Error) => void;
    output: string;
}

const TOOLCHAIN_CLI: readonly string[] = ["src", "toolchain", "cli.ts"];
const UNIT_TEST_SUFFIX = ".test.ts";
const FIRST_REQUEST_ID = 1;
const WATCH_RECURSIVE = {recursive: true} as const;
const STOPPED_FOR_CHANGED_SOURCES = "the toolchain sources changed";
const STOPPED_FOR_CLOSE = "the project server closed";

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function slashed(path: string): string {
    return path.replace(/\\/g, "/");
}

export function isRuntimeSourceFile(path: string): boolean {
    const file = slashed(path);
    return PROJECT_ENTRY_EXTENSIONS.includes(projectFileExtension(file)) && !file.endsWith(UNIT_TEST_SUFFIX);
}

export function toolchainCliPath(repoRoot: string): string {
    return join(repoRoot, ...TOOLCHAIN_CLI);
}

export function spawnToolchainServer(repoRoot: string, bunPath: string, events: ToolchainServerEvents): ToolchainServerProcess {
    const child = spawn(bunPath, [toolchainCliPath(repoRoot), TOOLCHAIN_SERVER_COMMAND], {
        cwd: repoRoot,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", events.stdout);
    child.stderr.on("data", events.stderr);
    child.stdin.on("error", error => events.ended(describeError(error)));
    child.on("error", error => events.ended(describeError(error)));
    child.on("close", (exitCode, signal) => events.ended(`jsengine ${TOOLCHAIN_SERVER_COMMAND} exited with ${exitCode ?? signal}`));
    return {
        write: text => {
            child.stdin.write(text);
        },
        kill: () => {
            child.kill();
        },
    };
}

export function watchSourceTree(directory: string, onChange: (path: string | undefined) => void): Closable | undefined {
    if (!existsSync(directory)) return undefined;
    try {
        const watcher = watch(directory, WATCH_RECURSIVE, (_event, filename) => onChange(filename === null ? undefined : join(directory, String(filename))));
        watcher.on("error", () => onChange(undefined));
        return watcher;
    } catch {
        return undefined;
    }
}

class ToolchainServerConnection {
    private readonly reader = new ToolchainReplyReader();
    private readonly watcher: Closable | undefined;
    private readonly process: ToolchainServerProcess | undefined;
    private pending: PendingRequest | undefined;
    private endReason: string | undefined;
    private stale: boolean;

    public constructor(options: ToolchainServerClientOptions) {
        this.watcher = options.watchSources(options.sourceRoot, path => this.sourceChanged(path));
        this.stale = this.watcher === undefined;
        try {
            this.process = options.start(options.repoRoot, options.bunPath, {
                stdout: text => this.received(text),
                stderr: text => this.collect(text),
                ended: reason => this.end(reason),
            });
        } catch (error) {
            this.watcher?.close();
            throw error;
        }
        if (this.endReason !== undefined) this.process.kill();
    }

    public get usable(): boolean {
        return this.endReason === undefined && !this.stale;
    }

    public request(id: number, operation: ToolchainOperation): Promise<unknown> {
        const ended = this.endReason;
        if (ended !== undefined) return Promise.reject(new Error(ended));
        return new Promise((resolve, reject) => {
            this.pending = {id, resolve, reject, output: ""};
            this.process?.write(toolchainRequestLine({...operation, id}));
        });
    }

    public stop(reason: string): void {
        this.end(reason);
    }

    private received(text: string): void {
        const {replies, output} = this.reader.read(text);
        this.collect(output);
        for (const reply of replies) this.answer(reply);
    }

    private collect(text: string): void {
        if (this.pending !== undefined) this.pending.output += text;
    }

    private answer(reply: ToolchainReply): void {
        const pending = this.pending;
        if (pending === undefined || (reply.id !== null && reply.id !== pending.id)) return;
        this.pending = undefined;
        if ("error" in reply) pending.reject(new Error(reply.error));
        else pending.resolve(reply.report);
        if (this.stale) this.end(STOPPED_FOR_CHANGED_SOURCES);
    }

    private sourceChanged(path: string | undefined): void {
        if (path !== undefined && !isRuntimeSourceFile(path)) return;
        this.stale = true;
        if (this.pending === undefined) this.end(STOPPED_FOR_CHANGED_SOURCES);
    }

    private end(reason: string): void {
        if (this.endReason !== undefined) return;
        this.endReason = reason;
        this.watcher?.close();
        this.process?.kill();
        const pending = this.pending;
        this.pending = undefined;
        if (pending === undefined) return;
        const output = pending.output.trim();
        pending.reject(new Error(output.length > 0 ? `${reason}: ${output}` : reason));
    }
}

export class ToolchainServerClient {
    private connection: ToolchainServerConnection | undefined;
    private queue: Promise<unknown> = Promise.resolve();
    private nextRequestId = FIRST_REQUEST_ID;
    private closed = false;

    public constructor(private readonly options: ToolchainServerClientOptions) {
    }

    public buildEditor(project: string, gameTarget: GameTarget): Promise<unknown> {
        return this.enqueue({op: BUILD_EDITOR_OP, project, simulate: gameTarget.target, backend: gameTarget.backend});
    }

    public generate(project: string): Promise<unknown> {
        return this.enqueue({op: GENERATE_OP, project});
    }

    public close(): void {
        this.closed = true;
        this.connection?.stop(STOPPED_FOR_CLOSE);
        this.connection = undefined;
    }

    private enqueue(operation: ToolchainOperation): Promise<unknown> {
        const run = this.queue.then(() => this.send(operation));
        this.queue = run.catch(() => undefined);
        return run;
    }

    private send(operation: ToolchainOperation): Promise<unknown> {
        if (this.closed) return Promise.reject(new Error(STOPPED_FOR_CLOSE));
        if (this.connection === undefined || !this.connection.usable) {
            this.connection?.stop(STOPPED_FOR_CHANGED_SOURCES);
            this.connection = new ToolchainServerConnection(this.options);
        }
        return this.connection.request(this.nextRequestId++, operation);
    }
}
