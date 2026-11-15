import {consoleOverride} from "../../engine/debugging";
import {originalConsole} from "../../engine/debugging/originalConsole";
import {EDITOR_CONSOLE_LEVELS} from "../editorProtocol";
import type {EditorConsoleEvent, EditorConsoleLevel} from "../editorProtocol";

type ConsoleMethod = (...args: unknown[]) => void;

function ignore(): void {
}

function describeArgument(argument: unknown): string {
    if (typeof argument === "string") return argument;
    if (argument instanceof Error) return argument.stack ?? `${argument.name}: ${argument.message}`;
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

export class ConsoleForwarder {
    private readonly listener: Console;
    private forwarding = false;
    private attached = false;

    public constructor(private readonly forward: (event: EditorConsoleEvent) => void) {
        const methods: Record<string, ConsoleMethod> = {};
        for (const key in originalConsole) methods[key] = ignore;
        for (const level of EDITOR_CONSOLE_LEVELS) methods[level] = (...args: unknown[]) => this.receive(level, args);
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

    private receive(level: EditorConsoleLevel, args: readonly unknown[]): void {
        if (this.forwarding) return;
        this.forwarding = true;
        try {
            this.forward({kind: "console", level, text: consoleText(args), timeMs: Date.now()});
        } catch {
            ignore();
        } finally {
            this.forwarding = false;
        }
    }
}
