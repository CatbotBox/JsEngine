import {consoleOverride} from "../../engine/debugging";
import {errorFrames, errorHeadline, stackFramesOrUndefined} from "../../engine/debugging/errorStack";
import {originalConsole} from "../../engine/debugging/originalConsole";
import {EDITOR_CONSOLE_LEVELS} from "../editorProtocol";
import type {EditorConsoleEvent, EditorConsoleLevel} from "../editorProtocol";

type ConsoleMethod = (...args: unknown[]) => void;

type StackBoundary = (...args: never[]) => unknown;

interface StackHolder {
    stack?: string;
}

type ErrorConstructorWithCapture = ErrorConstructor & {
    captureStackTrace?: (target: object, boundary?: StackBoundary) => void;
};

const STACK_CAPTURING_LEVELS: ReadonlySet<EditorConsoleLevel> = new Set(["warn", "error"]);
const STACK_LINE_SEPARATOR = "\n";
const PLAIN_STACK_HEADER = "Error";

function ignore(): void {
}

function describeArgument(argument: unknown): string {
    if (typeof argument === "string") return argument;
    if (argument instanceof Error) return errorHeadline(argument);
    if (argument === undefined || typeof argument === "function" || typeof argument === "symbol" || typeof argument === "bigint") return String(argument);
    try {
        return JSON.stringify(argument) ?? String(argument);
    } catch {
        return String(argument);
    }
}

export function consoleText(args: readonly unknown[]): string {
    return args.map(describeArgument).join(" ");
}

function framesBelowHeader(stack: string | undefined): string | undefined {
    if (stack === undefined) return undefined;
    const lines = stack.split(STACK_LINE_SEPARATOR);
    const frames = lines[0] === PLAIN_STACK_HEADER ? lines.slice(1) : lines;
    return stackFramesOrUndefined(frames.join(STACK_LINE_SEPARATOR));
}

function stackAbove(boundary: StackBoundary): string | undefined {
    const capture = (Error as ErrorConstructorWithCapture).captureStackTrace;
    if (typeof capture !== "function") return framesBelowHeader(new Error().stack);
    const holder: StackHolder = {};
    capture(holder, boundary);
    return framesBelowHeader(holder.stack);
}

export function consoleStack(level: EditorConsoleLevel, args: readonly unknown[], boundaries: readonly StackBoundary[]): string | undefined {
    const error = args.find((argument): argument is Error => argument instanceof Error);
    if (error !== undefined) return errorFrames(error);
    if (!STACK_CAPTURING_LEVELS.has(level)) return undefined;
    for (const boundary of boundaries) {
        const frames = stackAbove(boundary);
        if (frames !== undefined) return frames;
    }
    return undefined;
}

export class ConsoleForwarder {
    private readonly listener: Console;
    private forwarding = false;
    private attached = false;

    public constructor(private readonly forward: (event: EditorConsoleEvent) => void) {
        const methods: Record<string, ConsoleMethod> = {};
        for (const key in originalConsole) methods[key] = ignore;
        for (const level of EDITOR_CONSOLE_LEVELS) {
            const method: ConsoleMethod = (...args: unknown[]) => {
                this.receive(level, args, method);
            };
            methods[level] = method;
        }
        this.listener = methods as unknown as Console;
    }

    public attach(): void {
        if (this.attached) return;
        this.attached = true;
        consoleOverride.addConsoleEventListener(this.listener);
    }

    public detach(): void {
        if (!this.attached) return;
        this.attached = false;
        consoleOverride.removeConsoleEventListener(this.listener);
    }

    private receive(level: EditorConsoleLevel, args: readonly unknown[], listenerMethod: ConsoleMethod): void {
        if (this.forwarding) return;
        this.forwarding = true;
        try {
            const event: EditorConsoleEvent = {kind: "console", level, text: consoleText(args), timeMs: Date.now()};
            const stack = consoleStack(level, args, [console[level] as ConsoleMethod, listenerMethod]);
            this.forward(stack === undefined ? event : {...event, stack});
        } catch {
            ignore();
        } finally {
            this.forwarding = false;
        }
    }
}
