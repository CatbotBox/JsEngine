export interface ServerEvent {
    readonly name: string;
    readonly data: string;
}

export interface StreamReaderLike {
    read(): Promise<{readonly done: boolean, readonly value?: Uint8Array}>;
}

export interface StreamingResponse {
    readonly ok: boolean;
    readonly status: number;
    readonly body: {getReader(): StreamReaderLike} | null;
}

export interface StreamingRequestInit {
    readonly signal?: AbortSignal;
    readonly cache?: RequestCache;
}

export type StreamingFetch = (url: string, init: StreamingRequestInit) => Promise<StreamingResponse>;

export interface ServerEventStreamOptions {
    readonly fetch: StreamingFetch;
    readonly retryDelayMs?: number;
}

export type ServerEventListener = (data: unknown) => void;

export const DEFAULT_SERVER_EVENT_RETRY_DELAY_MS = 1000;

const DEFAULT_EVENT_NAME = "message";
const FIELD_SEPARATOR = ":";
const LINE_BREAK = /\r\n|\r|\n/;

export class ServerEventParser {
    private pendingText = "";
    private eventName = DEFAULT_EVENT_NAME;
    private dataLines: string[] = [];

    public push(text: string): ServerEvent[] {
        const lines = (this.pendingText + text).split(LINE_BREAK);
        this.pendingText = lines.pop() ?? "";
        const events: ServerEvent[] = [];
        for (const line of lines) {
            const event = this.line(line);
            if (event !== undefined) events.push(event);
        }
        return events;
    }

    private line(line: string): ServerEvent | undefined {
        if (line.length === 0) return this.dispatch();
        if (line.startsWith(FIELD_SEPARATOR)) return undefined;
        const separator = line.indexOf(FIELD_SEPARATOR);
        const field = separator < 0 ? line : line.slice(0, separator);
        let value = separator < 0 ? "" : line.slice(separator + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "event") this.eventName = value;
        else if (field === "data") this.dataLines.push(value);
        return undefined;
    }

    private dispatch(): ServerEvent | undefined {
        const event = this.dataLines.length === 0 ? undefined : {name: this.eventName, data: this.dataLines.join("\n")};
        this.eventName = DEFAULT_EVENT_NAME;
        this.dataLines = [];
        return event;
    }
}

function parsedJsonOrUndefined(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

export class ServerEventStream {
    private readonly listeners = new Map<string, Set<ServerEventListener>>();
    private readonly retryDelayMs: number;
    private abort: AbortController | undefined;
    private retryTimer: ReturnType<typeof setTimeout> | undefined;
    private wakeRetry: (() => void) | undefined;
    private running = false;
    private closed = false;

    public constructor(private readonly url: string, private readonly options: ServerEventStreamOptions) {
        this.retryDelayMs = options.retryDelayMs ?? DEFAULT_SERVER_EVENT_RETRY_DELAY_MS;
    }

    public on(eventName: string, listener: ServerEventListener): () => void {
        let named = this.listeners.get(eventName);
        if (named === undefined) this.listeners.set(eventName, named = new Set());
        const entry: ServerEventListener = data => listener(data);
        named.add(entry);
        if (!this.running && !this.closed) void this.run();
        return () => {
            named.delete(entry);
        };
    }

    public close(): void {
        this.closed = true;
        this.abort?.abort();
        if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
        this.wakeRetry?.();
    }

    private async run(): Promise<void> {
        this.running = true;
        try {
            while (!this.closed) {
                await this.readOnce().catch(() => undefined);
                if (this.closed) break;
                await new Promise<void>(resume => {
                    this.wakeRetry = resume;
                    this.retryTimer = setTimeout(resume, this.retryDelayMs);
                });
                this.wakeRetry = undefined;
                this.retryTimer = undefined;
            }
        } finally {
            this.running = false;
        }
    }

    private async readOnce(): Promise<void> {
        const abort = new AbortController();
        this.abort = abort;
        const response = await this.options.fetch(this.url, {signal: abort.signal, cache: "no-store"});
        if (!response.ok || response.body === null) throw new Error(`${this.url}: HTTP ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = new ServerEventParser();
        for (;;) {
            const {done, value} = await reader.read();
            if (done || this.closed) return;
            if (value === undefined || value.length === 0) continue;
            for (const event of parser.push(decoder.decode(value, {stream: true}))) this.dispatch(event);
        }
    }

    private dispatch(event: ServerEvent): void {
        const named = this.listeners.get(event.name);
        if (named === undefined || named.size === 0) return;
        const data = parsedJsonOrUndefined(event.data);
        for (const listener of [...named]) listener(data);
    }
}
