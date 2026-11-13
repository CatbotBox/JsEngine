import type {BrowserTerminal, TerminalSubscription} from "./browserPlatform";
import type {InputEvent, InputEventSink} from "../../engine/input/inputEvent";
import type {PageToWorldMessage} from "./worldWorkerProtocol";
import {isWorldToPageMessage} from "./worldWorkerProtocol";

export interface PageTerminal extends BrowserTerminal {
    write(data: string, callback?: () => void): void;
}

export interface WorldWorker {
    postMessage(message: PageToWorldMessage): void;
    addEventListener(type: "message", listener: (event: {readonly data: unknown}) => void): void;
    addEventListener(type: "error", listener: (event: {readonly message?: string}) => void): void;
    terminate(): void;
}

export interface WorldWorkerPageOptions {
    readonly name: string;
    readonly requestedRasterWorkers?: number;
    readonly onQuit?: () => void;
}

export interface WorldWorkerPage {
    readonly input: InputEventSink;
    exit(): void;
}

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const STOPPED_LINE = `${RESET}\r\nStopped. Reload the page to restart.\r\n`;

export function connectWorldWorker(terminal: PageTerminal, worker: WorldWorker, options: WorldWorkerPageOptions): WorldWorkerPage {
    const subscriptions: TerminalSubscription[] = [];
    let closed = false;
    const post = (message: PageToWorldMessage): void => {
        if (!closed) worker.postMessage(message);
    };
    const pendingInput: InputEvent[] = [];
    const flushInput = (): void => {
        if (pendingInput.length > 0) post({type: "inputEvents", events: pendingInput.splice(0)});
    };
    const input: InputEventSink = {
        enqueue(event: InputEvent): void {
            if (closed) return;
            pendingInput.push(event);
            if (pendingInput.length === 1) queueMicrotask(flushInput);
        },
    };
    const close = (): void => {
        closed = true;
        pendingInput.length = 0;
        for (const subscription of subscriptions) subscription.dispose();
        subscriptions.length = 0;
        worker.terminate();
    };
    const showError = (prefix: string, message: string): void => {
        terminal.write(`${RESET}\r\n${RED}${prefix}: ${message}${RESET}\r\n`);
    };

    worker.addEventListener("message", event => {
        const message = event.data;
        if (closed || !isWorldToPageMessage(message)) return;
        switch (message.type) {
            case "output":
                terminal.write(message.data, () => post({type: "written"}));
                break;
            case "quit":
                close();
                terminal.write(STOPPED_LINE);
                options.onQuit?.();
                break;
            case "error":
                close();
                showError(`Could not start ${options.name}`, message.message);
                break;
        }
    });
    worker.addEventListener("error", event => {
        if (!closed) showError(`Error in ${options.name}`, event.message ?? "the world worker failed");
    });

    post({type: "init", columns: terminal.cols, rows: terminal.rows, requestedRasterWorkers: options.requestedRasterWorkers});
    subscriptions.push(terminal.onResize(size => post({type: "resize", columns: size.cols, rows: size.rows})));

    return {
        input,
        exit: () => post({type: "exit"}),
    };
}
