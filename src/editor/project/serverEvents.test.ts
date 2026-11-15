import {describe, expect, test} from "../../engine/testing/harness";
import {ServerEventParser, ServerEventStream} from "./serverEvents";
import type {StreamingFetch, StreamingResponse} from "./serverEvents";

const RETRY_DELAY_MS = 1;

function scriptedResponse(chunks: readonly string[]): StreamingResponse {
    const encoded = chunks.map(chunk => new TextEncoder().encode(chunk));
    let index = 0;
    return {
        ok: true,
        status: 200,
        body: {
            getReader: () => ({
                read: async () => index < encoded.length ? {done: false, value: encoded[index++]} : {done: true},
            }),
        },
    };
}

function waitFor(condition: () => boolean): Promise<void> {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const check = () => {
            if (condition()) resolve();
            else if (Date.now() - started > 1000) reject(new Error("timed out"));
            else setTimeout(check, 1);
        };
        check();
    });
}

describe("ServerEventParser", () => {
    test("dispatches named events at blank lines, joining data lines and ignoring comments", () => {
        const parser = new ServerEventParser();
        expect(parser.push(": connected\n\nevent: rebuilt\ndata: {\"workerUrl\"")).toEqual([]);
        expect(parser.push(":\"/w.js\"}\n\r\ndata: a\ndata: b\n\n")).toEqual([
            {name: "rebuilt", data: "{\"workerUrl\":\"/w.js\"}"},
            {name: "message", data: "a\nb"},
        ]);
    });
});

describe("ServerEventStream", () => {
    test("delivers parsed JSON to listeners of the event name and reconnects after the stream ends", async () => {
        const responses = [
            scriptedResponse(["event: files-changed\ndata: {\"paths\":[\"a\"]}\n", "\n"]),
            scriptedResponse(["event: files-changed\ndata: {\"paths\":[\"b\"]}\n\nevent: other\ndata: 1\n\n"]),
        ];
        let fetches = 0;
        const fetch: StreamingFetch = async () => responses[Math.min(fetches++, responses.length - 1)];
        const stream = new ServerEventStream("/events", {fetch, retryDelayMs: RETRY_DELAY_MS});
        const received: unknown[] = [];
        stream.on("files-changed", data => received.push(data));
        await waitFor(() => received.length >= 2);
        stream.close();
        expect(received.slice(0, 2)).toEqual([{paths: ["a"]}, {paths: ["b"]}]);
        expect(fetches >= 2).toBe(true);
    });

    test("keeps retrying after failed connections and stops once closed", async () => {
        let fetches = 0;
        const fetch: StreamingFetch = async () => {
            fetches++;
            if (fetches < 3) throw new Error("connection refused");
            return scriptedResponse(["event: rebuilt\ndata: {\"workerUrl\":\"/x\"}\n\n"]);
        };
        const stream = new ServerEventStream("/events", {fetch, retryDelayMs: RETRY_DELAY_MS});
        const received: unknown[] = [];
        stream.on("rebuilt", data => received.push(data));
        await waitFor(() => received.length === 1);
        stream.close();
        const afterClose = fetches;
        await new Promise(done => setTimeout(done, RETRY_DELAY_MS * 20));
        expect(fetches).toBe(afterClose);
        expect(received).toEqual([{workerUrl: "/x"}]);
    });

    test("does not connect until something listens", async () => {
        let fetches = 0;
        const stream = new ServerEventStream("/events", {fetch: async () => {
            fetches++;
            return scriptedResponse([]);
        }, retryDelayMs: RETRY_DELAY_MS});
        await new Promise(done => setTimeout(done, RETRY_DELAY_MS * 5));
        expect(fetches).toBe(0);
        stream.close();
    });
});
