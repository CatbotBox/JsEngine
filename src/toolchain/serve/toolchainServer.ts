import type {ProjectWorkerBuildReport} from "../../editor/desktop";
import {BUILD_EDITOR_OP, parseToolchainRequest, toolchainReplyRecord} from "../../editor/desktop/toolchainServerProtocol";
import type {BuildEditorOperation, GenerateOperation, ToolchainRequest} from "../../editor/desktop/toolchainServerProtocol";
import type {GenerateProjectReport} from "../../editor/project/projectServerApi";

export interface ToolchainOperations {
    buildEditor(operation: BuildEditorOperation): Promise<ProjectWorkerBuildReport>;
    generate(operation: GenerateOperation): GenerateProjectReport;
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export class ToolchainServer {
    public constructor(private readonly operations: ToolchainOperations) {
    }

    public async answer(line: string): Promise<string | undefined> {
        if (line.trim().length === 0) return undefined;
        const parsed = parseToolchainRequest(line);
        if (!parsed.ok) return toolchainReplyRecord({id: parsed.id, error: parsed.problem});
        const {id} = parsed.request;
        try {
            return toolchainReplyRecord({id, report: await this.reportFor(parsed.request)});
        } catch (error) {
            return toolchainReplyRecord({id, error: describeError(error)});
        }
    }

    private async reportFor(request: ToolchainRequest): Promise<ProjectWorkerBuildReport | GenerateProjectReport> {
        return request.op === BUILD_EDITOR_OP ? await this.operations.buildEditor(request) : this.operations.generate(request);
    }
}

export async function answerRequests(lines: AsyncIterable<string>, server: ToolchainServer, write: (reply: string) => void): Promise<void> {
    for await (const line of lines) {
        const reply = await server.answer(line);
        if (reply !== undefined) write(reply);
    }
}
