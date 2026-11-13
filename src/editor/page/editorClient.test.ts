import {describe, expect, test} from "../../engine/testing/harness";
import {NULL_ENTITY} from "../../engine/core";
import {EDITOR_MESSAGE_TYPE} from "../editorProtocol";
import type {EditorRequestMessage} from "../editorProtocol";
import {EditorClient, EditorClientClosedError, EditorRequestError, EditorRequestTimeoutError} from "./editorClient";
import type {EditorChannel} from "./editorClient";

const SHORT_TIMEOUT_MS = 5;

class RecordingChannel implements EditorChannel {
    public readonly sent: EditorRequestMessage[] = [];
    private listener: ((event: {readonly data: unknown}) => void) | undefined;

    public postMessage(message: EditorRequestMessage): void {
        this.sent.push(message);
    }

    public addEventListener(_type: "message", listener: (event: {readonly data: unknown}) => void): void {
        this.listener = listener;
    }

    public answer(data: unknown): void {
        this.listener?.({data});
    }
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
    try {
        await promise;
    } catch (error) {
        return error as Error;
    }
    throw new Error("expected the promise to reject");
}

describe("EditorClient", () => {
    test("posts each request with a fresh id and resolves it with the matching result, ignoring unrelated messages", async () => {
        const channel = new RecordingChannel();
        const client = new EditorClient(channel);
        const first = client.request({op: "step"});
        const second = client.request({op: "listEntities"});
        expect(channel.sent).toEqual([
            {type: EDITOR_MESSAGE_TYPE, requestId: 1, request: {op: "step"}},
            {type: EDITOR_MESSAGE_TYPE, requestId: 2, request: {op: "listEntities"}},
        ]);
        channel.answer({type: "frame", frame: {}});
        channel.answer({type: EDITOR_MESSAGE_TYPE, requestId: 99, ok: true, result: {}});
        channel.answer({type: EDITOR_MESSAGE_TYPE, requestId: 2, ok: true, result: {entities: []}});
        channel.answer({type: EDITOR_MESSAGE_TYPE, requestId: 1, ok: true, result: {mode: "paused", gameplayTicks: 1}});
        expect(await second).toEqual({entities: []});
        expect(await first).toEqual({mode: "paused", gameplayTicks: 1});
        expect(client.pendingCount).toBe(0);
    });

    test("an error response rejects with the op and the world's reason", async () => {
        const channel = new RecordingChannel();
        const client = new EditorClient(channel);
        const pending = client.request({op: "getEntity", entity: NULL_ENTITY});
        channel.answer({type: EDITOR_MESSAGE_TYPE, requestId: 1, ok: false, error: "No entity 0 in this world"});
        const error = await rejectionOf(pending);
        expect(error).toBeInstanceOf(EditorRequestError);
        expect(error.message).toBe('Editor request "getEntity" failed: No entity 0 in this world');
    });

    test("a request without an answer rejects with a named timeout naming the op", async () => {
        const client = new EditorClient(new RecordingChannel(), {timeoutMs: SHORT_TIMEOUT_MS});
        const error = await rejectionOf(client.request({op: "saveScene"}));
        expect(error).toBeInstanceOf(EditorRequestTimeoutError);
        expect(error.name).toBe("EditorRequestTimeoutError");
        expect(error.message).toBe(`The world did not answer the editor request "saveScene" within ${SHORT_TIMEOUT_MS} ms`);
        expect(client.pendingCount).toBe(0);
    });

    test("close rejects what is pending and every later request", async () => {
        const client = new EditorClient(new RecordingChannel());
        const pending = client.request({op: "describeSchemas"});
        client.close();
        expect(await rejectionOf(pending)).toBeInstanceOf(EditorClientClosedError);
        expect(await rejectionOf(client.request({op: "step"}))).toBeInstanceOf(EditorClientClosedError);
        expect(client.pendingCount).toBe(0);
    });

    test("a channel that cannot post rejects the request at once", async () => {
        const client = new EditorClient({
            postMessage: () => {
                throw new Error("DataCloneError");
            },
            addEventListener: () => undefined,
        });
        expect((await rejectionOf(client.request({op: "step"}))).message).toBe("DataCloneError");
        expect(client.pendingCount).toBe(0);
    });
});
