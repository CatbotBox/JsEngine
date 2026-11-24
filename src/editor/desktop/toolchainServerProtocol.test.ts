import {describe, expect, test} from "../../engine/testing/harness";
import {parseToolchainRequest, toolchainReplyRecord, ToolchainReplyReader, toolchainRequestLine} from "./toolchainServerProtocol";
import type {ToolchainReply} from "./toolchainServerProtocol";

const PROJECT = "/projects/game";
const BUILD_REPLY: ToolchainReply = {id: 1, report: {ok: true, bundlePath: "/dist/editor.js", inputs: [], warnings: [], generatedFiles: []}};
const GENERATE_REPLY: ToolchainReply = {id: 2, report: {ok: false, errors: ["no manifest"]}};

function lineOf(value: unknown): string {
    return JSON.stringify(value);
}

describe("toolchain server requests", () => {
    test("a request line reads back as the request it was written from", () => {
        const build = {id: 7, op: "build-editor", project: PROJECT, simulate: "terminal", backend: "cells"} as const;
        const generate = {id: 8, op: "generate", project: PROJECT} as const;
        expect(toolchainRequestLine(build).endsWith("\n")).toBe(true);
        expect(parseToolchainRequest(toolchainRequestLine(build))).toEqual({ok: true, request: build});
        expect(parseToolchainRequest(toolchainRequestLine(generate))).toEqual({ok: true, request: generate});
    });

    test("a line that is not a JSON object, or has no integer id, is refused without an id", () => {
        for (const line of ["not json", "[1]", "null", lineOf({op: "generate", project: PROJECT}), lineOf({id: 1.5, op: "generate", project: PROJECT})]) {
            const parsed = parseToolchainRequest(line);
            expect(parsed.ok).toBe(false);
            if (!parsed.ok) expect(parsed.id).toBe(null);
        }
    });

    test("a request with an id but a bad op, project, simulated target or backend is refused under that id", () => {
        const refused = [
            {id: 3, op: "package", project: PROJECT},
            {id: 3, op: "generate", project: ""},
            {id: 3, op: "generate"},
            {id: 3, op: "build-editor", project: PROJECT, simulate: "editor", backend: "cells"},
            {id: 3, op: "build-editor", project: PROJECT, simulate: "web", backend: "ascii"},
            {id: 3, op: "build-editor", project: PROJECT, simulate: "web"},
        ];
        for (const request of refused) {
            const parsed = parseToolchainRequest(lineOf(request));
            expect(parsed.ok).toBe(false);
            if (!parsed.ok) expect(parsed.id).toBe(3);
        }
        const unknownOp = parseToolchainRequest(lineOf(refused[0]));
        expect(!unknownOp.ok && unknownOp.problem.includes("build-editor or generate")).toBe(true);
    });
});

describe("toolchain server replies", () => {
    test("reply records read back as replies, apart from the output printed around them", () => {
        const reader = new ToolchainReplyReader();
        const stream = `bundling\n${toolchainReplyRecord(BUILD_REPLY)}warning: slow\n${toolchainReplyRecord(GENERATE_REPLY)}`;
        expect(reader.read(stream)).toEqual({replies: [BUILD_REPLY, GENERATE_REPLY], output: "bundling\nwarning: slow\n"});
    });

    test("a record split across chunks is read once it is whole", () => {
        const reader = new ToolchainReplyReader();
        const record = toolchainReplyRecord(BUILD_REPLY);
        const pieces = [record.slice(0, 1), record.slice(1, 9), record.slice(9, record.length - 1), record.slice(record.length - 1)];
        const read = pieces.map(piece => reader.read(piece));
        expect(read.map(each => each.replies.length)).toEqual([0, 0, 0, 1]);
        expect(read[3].replies).toEqual([BUILD_REPLY]);
        expect(read.map(each => each.output).join("")).toBe("");
    });

    test("output printed without a line break before a record does not swallow the record", () => {
        const reader = new ToolchainReplyReader();
        expect(reader.read(`progress 50%${toolchainReplyRecord(GENERATE_REPLY)}`)).toEqual({replies: [GENERATE_REPLY], output: "progress 50%"});
    });

    test("a broken or foreign record is passed on as output, and the record after it still reads", () => {
        const reader = new ToolchainReplyReader();
        const broken = reader.read(`\u001e{"id":1,"rep\u001e{"no":"id"}\n${toolchainReplyRecord(BUILD_REPLY)}`);
        expect(broken.replies).toEqual([BUILD_REPLY]);
        expect(broken.output).toBe(`{"id":1,"rep\n{"no":"id"}\n`);
    });

    test("an error reply may carry no id, for a request whose id could not be read", () => {
        const reader = new ToolchainReplyReader();
        const reply: ToolchainReply = {id: null, error: "a request is one JSON object per line"};
        expect(reader.read(toolchainReplyRecord(reply)).replies).toEqual([reply]);
    });
});
