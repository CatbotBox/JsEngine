import {EDITOR_MESSAGE_TYPE, isEditorResponseMessage} from "../editorProtocol";
import type {EditorOp, EditorRequest, EditorRequestMessage, EditorResult, EditorResultOf} from "../editorProtocol";

export interface EditorChannel {
    postMessage(message: EditorRequestMessage): void;
    addEventListener(type: "message", listener: (event: {readonly data: unknown}) => void): void;
}

export interface EditorClientOptions {
    readonly timeoutMs?: number;
}

export const DEFAULT_EDITOR_REQUEST_TIMEOUT_MS = 10_000;

const FIRST_REQUEST_ID = 1;

export class EditorRequestTimeoutError extends Error {
    public override readonly name = "EditorRequestTimeoutError";

    public constructor(public readonly op: EditorOp, public readonly timeoutMs: number) {
        super(`The world did not answer the editor request "${op}" within ${timeoutMs} ms`);
    }
}

export class EditorRequestError extends Error {
    public override readonly name = "EditorRequestError";

    public constructor(public readonly op: EditorOp, reason: string) {
        super(`Editor request "${op}" failed: ${reason}`);
    }
}

export class EditorClientClosedError extends Error {
    public override readonly name = "EditorClientClosedError";

    public constructor(public readonly op: EditorOp) {
        super(`Editor request "${op}" was abandoned because the editor client closed`);
    }
}

interface PendingRequest {
    readonly op: EditorOp;
    readonly timer: ReturnType<typeof setTimeout>;
    resolve(result: EditorResult): void;
    reject(error: Error): void;
}

export class EditorClient {
    private nextRequestId = FIRST_REQUEST_ID;
    private closed = false;
    private readonly pending = new Map<number, PendingRequest>();
    private readonly timeoutMs: number;

    public constructor(private readonly channel: EditorChannel, options: EditorClientOptions = {}) {
        this.timeoutMs = options.timeoutMs ?? DEFAULT_EDITOR_REQUEST_TIMEOUT_MS;
        channel.addEventListener("message", event => this.receive(event.data));
    }

    public get pendingCount(): number {
        return this.pending.size;
    }

    public request<R extends EditorRequest>(request: R): Promise<EditorResultOf<R>> {
        const op = request.op;
        if (this.closed) return Promise.reject(new EditorClientClosedError(op));
        const requestId = this.nextRequestId++;
        return new Promise<EditorResultOf<R>>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new EditorRequestTimeoutError(op, this.timeoutMs));
            }, this.timeoutMs);
            this.pending.set(requestId, {op, timer, resolve: result => resolve(result as EditorResultOf<R>), reject});
            try {
                this.channel.postMessage({type: EDITOR_MESSAGE_TYPE, requestId, request});
            } catch (error) {
                clearTimeout(timer);
                this.pending.delete(requestId);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    public close(): void {
        this.closed = true;
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new EditorClientClosedError(pending.op));
        }
        this.pending.clear();
    }

    private receive(data: unknown): void {
        if (!isEditorResponseMessage(data)) return;
        const pending = this.pending.get(data.requestId);
        if (pending === undefined) return;
        this.pending.delete(data.requestId);
        clearTimeout(pending.timer);
        if (data.ok) pending.resolve(data.result);
        else pending.reject(new EditorRequestError(pending.op, data.error));
    }
}
