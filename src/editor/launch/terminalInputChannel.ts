import type {TerminalInputSource} from "../../hosts/terminalInput/terminalInputSource";

export const TERMINAL_INPUT_MESSAGE_TYPE = "jsengine-terminal-input";

export interface TerminalInputMessage {
    readonly type: typeof TERMINAL_INPUT_MESSAGE_TYPE;
    readonly data: string;
}

export interface TerminalInputPort {
    addEventListener(type: "message", listener: (event: {readonly data: unknown}) => void): void;
}

const ALWAYS_AVAILABLE = true;

export function terminalInputMessage(data: string): TerminalInputMessage {
    return {type: TERMINAL_INPUT_MESSAGE_TYPE, data};
}

export function isTerminalInputMessage(value: unknown): value is TerminalInputMessage {
    if (typeof value !== "object" || value === null) return false;
    const message = value as {type?: unknown, data?: unknown};
    return message.type === TERMINAL_INPUT_MESSAGE_TYPE && typeof message.data === "string";
}

export class TerminalInputChannel implements TerminalInputSource {
    private onData: ((data: string) => void) | undefined;

    public constructor(port: TerminalInputPort) {
        port.addEventListener("message", event => {
            if (isTerminalInputMessage(event.data)) this.onData?.(event.data.data);
        });
    }

    public available(): boolean {
        return ALWAYS_AVAILABLE;
    }

    public start(onData: (data: string) => void): void {
        this.onData = onData;
    }

    public stop(): void {
        this.onData = undefined;
    }

    public write(): void {
    }
}
