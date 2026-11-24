import {describe, expect, test} from "../../engine/testing/harness";
import type {ProjectWorkerBuildReport} from "../../editor/desktop";
import {ToolchainReplyReader, toolchainRequestLine} from "../../editor/desktop/toolchainServerProtocol";
import type {BuildEditorOperation, GenerateOperation, ToolchainReply} from "../../editor/desktop/toolchainServerProtocol";
import type {GenerateProjectReport} from "../../editor/project/projectServerApi";
import {answerRequests, ToolchainServer} from "./toolchainServer";
import type {ToolchainOperations} from "./toolchainServer";

const PROJECT = "/projects/game";
const BUILD_REPORT: ProjectWorkerBuildReport = {ok: true, bundlePath: "/dist/editor.web-pixels.worker.js", inputs: ["/projects/game/game.ts"], warnings: [], generatedFiles: ["generated/game.ts"]};
const GENERATE_REPORT: GenerateProjectReport = {ok: true, written: [], unchanged: ["generated/game.ts"], warnings: []};

class RecordingOperations implements ToolchainOperations {
    public readonly calls: string[] = [];

    public async buildEditor(operation: BuildEditorOperation): Promise<ProjectWorkerBuildReport> {
        this.calls.push(`build ${operation.project} ${operation.simulate} ${operation.backend}`);
        await Promise.resolve();
        this.calls.push("build done");
        return BUILD_REPORT;
    }

    public generate(operation: GenerateOperation): GenerateProjectReport {
        if (operation.project !== PROJECT) throw new Error(`unexpected project ${operation.project}`);
        this.calls.push(`generate ${operation.project}`);
        return GENERATE_REPORT;
    }
}

function repliesOf(text: string): readonly ToolchainReply[] {
    const read = new ToolchainReplyReader().read(text);
    expect(read.output).toBe("");
    return read.replies;
}

async function* linesOf(lines: readonly string[]): AsyncIterable<string> {
    for (const line of lines) yield line;
}

describe("toolchain server", () => {
    test("each op runs its operation and is answered with that report under the request's id", async () => {
        const operations = new RecordingOperations();
        const server = new ToolchainServer(operations);
        const built = await server.answer(toolchainRequestLine({id: 4, op: "build-editor", project: PROJECT, simulate: "window", backend: "gpu"}));
        const generated = await server.answer(toolchainRequestLine({id: 5, op: "generate", project: PROJECT}));
        expect(repliesOf(`${built}${generated}`)).toEqual([{id: 4, report: BUILD_REPORT}, {id: 5, report: GENERATE_REPORT}]);
        expect(operations.calls).toEqual([`build ${PROJECT} window gpu`, "build done", `generate ${PROJECT}`]);
    });

    test("a request it cannot read is answered with an error, under its id when it has one", async () => {
        const server = new ToolchainServer(new RecordingOperations());
        const unreadable = repliesOf(await server.answer("{") ?? "");
        expect(unreadable.length).toBe(1);
        expect(unreadable[0].id).toBe(null);
        const unknownOp = repliesOf(await server.answer(JSON.stringify({id: 9, op: "package", project: PROJECT})) ?? "");
        expect(unknownOp.length).toBe(1);
        expect(unknownOp[0].id).toBe(9);
        expect("error" in unknownOp[0]).toBe(true);
    });

    test("an operation that throws is answered with its message instead of ending the server", async () => {
        const server = new ToolchainServer(new RecordingOperations());
        const replies = repliesOf(await server.answer(toolchainRequestLine({id: 2, op: "generate", project: "/elsewhere"})) ?? "");
        expect(replies).toEqual([{id: 2, error: "unexpected project /elsewhere"}]);
    });

    test("blank lines are skipped and requests are answered one after another, in order", async () => {
        const operations = new RecordingOperations();
        const written: string[] = [];
        const lines = [
            toolchainRequestLine({id: 1, op: "build-editor", project: PROJECT, simulate: "web", backend: "pixels"}).trimEnd(),
            "   ",
            toolchainRequestLine({id: 2, op: "generate", project: PROJECT}).trimEnd(),
        ];
        await answerRequests(linesOf(lines), new ToolchainServer(operations), reply => written.push(reply));
        expect(written.length).toBe(2);
        expect(repliesOf(written.join("")).map(reply => reply.id)).toEqual([1, 2]);
        expect(operations.calls).toEqual([`build ${PROJECT} web pixels`, "build done", `generate ${PROJECT}`]);
    });
});
