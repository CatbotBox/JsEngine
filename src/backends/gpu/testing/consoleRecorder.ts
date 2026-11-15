import {consoleOverride} from "../../../engine/debugging";
import {originalConsole} from "../../../engine/debugging/originalConsole";

type ConsoleMethod = (...args: unknown[]) => void;

function ignore(): void {
}

function joined(args: readonly unknown[]): string {
    return args.map(String).join(" ");
}

export class ConsoleRecorder {
    public readonly warnings: string[] = [];
    public readonly errors: string[] = [];
    private readonly listener: Console;

    public constructor() {
        const methods: Record<string, ConsoleMethod> = {};
        for (const key in originalConsole) methods[key] = ignore;
        methods.warn = (...args: unknown[]) => this.warnings.push(joined(args));
        methods.error = (...args: unknown[]) => this.errors.push(joined(args));
        this.listener = methods as unknown as Console;
        consoleOverride.removeConsoleEventListener(originalConsole);
        consoleOverride.addConsoleEventListener(this.listener);
    }

    public detach(): void {
        consoleOverride.removeConsoleEventListener(this.listener);
        consoleOverride.addConsoleEventListener(originalConsole);
    }
}
