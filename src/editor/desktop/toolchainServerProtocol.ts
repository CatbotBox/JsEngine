import {isRenderBackendKind, RENDER_BACKEND_KINDS} from "../../engine/rendering/renderBackend";
import type {RenderBackendKind} from "../../engine/rendering/renderBackend";
import {SIMULATED_TARGETS} from "../project/editorSettings";
import type {SimulatedTarget} from "../project/editorSettings";

export const TOOLCHAIN_SERVER_COMMAND = "toolchain-server";
export const BUILD_EDITOR_OP = "build-editor";
export const GENERATE_OP = "generate";

export interface BuildEditorOperation {
    readonly op: typeof BUILD_EDITOR_OP;
    readonly project: string;
    readonly simulate: SimulatedTarget;
    readonly backend: RenderBackendKind;
}

export interface GenerateOperation {
    readonly op: typeof GENERATE_OP;
    readonly project: string;
}

export type ToolchainOperation = BuildEditorOperation | GenerateOperation;

export type ToolchainRequest = ToolchainOperation & {readonly id: number};

export type ToolchainReply =
    | {readonly id: number; readonly report: unknown}
    | {readonly id: number | null; readonly error: string};

export type ParsedToolchainRequest =
    | {readonly ok: true; readonly request: ToolchainRequest}
    | {readonly ok: false; readonly id: number | null; readonly problem: string};

export interface ReadReplies {
    readonly replies: readonly ToolchainReply[];
    readonly output: string;
}

const RECORD_START = "\u001e";
const LINE_END = "\n";
const NOT_FOUND = -1;
const UNKNOWN_ID = null;

function isRecord(value: unknown): value is {readonly [key: string]: unknown} {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequestId(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value);
}

function isSimulatedTarget(value: unknown): value is SimulatedTarget {
    return SIMULATED_TARGETS.some(target => target === value);
}

function jsonOrUndefined(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

export function toolchainRequestLine(request: ToolchainRequest): string {
    return JSON.stringify(request) + LINE_END;
}

export function parseToolchainRequest(line: string): ParsedToolchainRequest {
    const value = jsonOrUndefined(line);
    if (!isRecord(value)) return {ok: false, id: UNKNOWN_ID, problem: `a request is one JSON object per line; got ${JSON.stringify(line)}`};
    const id = value.id;
    if (!isRequestId(id)) return {ok: false, id: UNKNOWN_ID, problem: `"id" must be an integer; got ${JSON.stringify(id)}`};
    const project = value.project;
    if (typeof project !== "string" || project.length === 0) return {ok: false, id, problem: `"project" must name a project folder; got ${JSON.stringify(project)}`};
    switch (value.op) {
        case GENERATE_OP:
            return {ok: true, request: {id, op: GENERATE_OP, project}};
        case BUILD_EDITOR_OP: {
            const {simulate, backend} = value;
            if (!isSimulatedTarget(simulate)) return {ok: false, id, problem: `"simulate" must be one of ${SIMULATED_TARGETS.join(", ")}; got ${JSON.stringify(simulate)}`};
            if (typeof backend !== "string" || !isRenderBackendKind(backend)) return {ok: false, id, problem: `"backend" must be one of ${RENDER_BACKEND_KINDS.join(", ")}; got ${JSON.stringify(backend)}`};
            return {ok: true, request: {id, op: BUILD_EDITOR_OP, project, simulate, backend}};
        }
        default:
            return {ok: false, id, problem: `"op" must be ${BUILD_EDITOR_OP} or ${GENERATE_OP}; got ${JSON.stringify(value.op)}`};
    }
}

export function toolchainReplyRecord(reply: ToolchainReply): string {
    return RECORD_START + JSON.stringify(reply) + LINE_END;
}

function toolchainReplyOf(text: string): ToolchainReply | undefined {
    const value = jsonOrUndefined(text);
    if (!isRecord(value)) return undefined;
    const {id, error} = value;
    if (typeof error === "string" && (id === UNKNOWN_ID || isRequestId(id))) return {id, error};
    if (isRequestId(id) && "report" in value) return {id, report: value.report};
    return undefined;
}

export class ToolchainReplyReader {
    private record: string | undefined;

    public read(chunk: string): ReadReplies {
        const replies: ToolchainReply[] = [];
        let output = "";
        let rest = chunk;
        while (rest.length > 0) {
            if (this.record === undefined) {
                const start = rest.indexOf(RECORD_START);
                if (start === NOT_FOUND) {
                    output += rest;
                    break;
                }
                output += rest.slice(0, start);
                rest = rest.slice(start + RECORD_START.length);
                this.record = "";
                continue;
            }
            const end = rest.indexOf(LINE_END);
            const restart = rest.indexOf(RECORD_START);
            if (restart !== NOT_FOUND && (end === NOT_FOUND || restart < end)) {
                output += this.record + rest.slice(0, restart) + LINE_END;
                rest = rest.slice(restart + RECORD_START.length);
                this.record = "";
                continue;
            }
            if (end === NOT_FOUND) {
                this.record += rest;
                break;
            }
            const text = this.record + rest.slice(0, end);
            rest = rest.slice(end + LINE_END.length);
            this.record = undefined;
            const reply = toolchainReplyOf(text);
            if (reply === undefined) output += text + LINE_END;
            else replies.push(reply);
        }
        return {replies, output};
    }
}
