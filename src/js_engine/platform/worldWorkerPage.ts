import type {BrowserTerminal, TerminalSubscription} from "./browserPlatform";
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
    const close = (): void => {
        closed = true;
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
    subscriptions.push(terminal.onData(data => post({type: "input", data})));
    subscriptions.push(terminal.onResize(size => post({type: "resize", columns: size.cols, rows: size.rows})));

    return {
        exit: () => post({type: "exit"}),
    };
}
