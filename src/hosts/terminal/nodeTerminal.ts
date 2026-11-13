import type {CellSurface, CellSurfaceSize} from "../../backends/cells/cellSurface";
import type {TerminalInputSource} from "./terminalInputSource";

export type NodeTerminal = CellSurface & TerminalInputSource;

interface NodeTtyReadStream {
    readonly isTTY?: boolean;
    setRawMode(raw: boolean): void;
    setEncoding(encoding: "utf8"): void;
    resume(): void;
    pause(): void;
    on(event: "data", listener: (chunk: string) => void): void;
    removeListener(event: "data", listener: (chunk: string) => void): void;
}

interface NodeTtyWriteStream {
    readonly isTTY?: boolean;
    readonly columns: number;
    readonly rows: number;
    write(chunk: string): unknown;
    on(event: "resize", listener: () => void): void;
    removeListener(event: "resize", listener: () => void): void;
    _refreshSize?(): void;
}

interface NodeStdio {
    readonly stdin: NodeTtyReadStream;
    readonly stdout: NodeTtyWriteStream;
    readonly stderr: NodeTtyWriteStream;
    readonly env: Readonly<Record<string, string | undefined>>;
}

function nodeStdio(): NodeStdio {
    return process as unknown as NodeStdio;
}

const FALLBACK_SIZE: CellSurfaceSize = {columns: 80, rows: 24};
const BUN_RESIZE_POLL_MS = 50;

let sharedTerminal: NodeTerminal | undefined;

export function nodeTerminal(): NodeTerminal {
    return sharedTerminal ??= createNodeTerminal();
}

function createNodeTerminal(): NodeTerminal {
    const onBun = typeof (globalThis as {Bun?: unknown}).Bun !== "undefined";
    return {
        write(chunk: string): void {
            nodeStdio().stdout.write(chunk);
        },
        ...createTerminalInput(),
        ...createTerminalScreen(onBun),
    };
}

function createTerminalInput(): Omit<TerminalInputSource, "write"> {
    let listener: ((chunk: string) => void) | undefined;
    const stop = (): void => {
        if (listener === undefined) return;
        const stdin = nodeStdio().stdin;
        stdin.removeListener("data", listener);
        listener = undefined;
        if (stdin.isTTY) stdin.setRawMode(false);
        stdin.pause();
    };
    return {
        available: () => nodeStdio().stdin.isTTY === true,
        start(onData: (data: string) => void): void {
            stop();
            const stdin = nodeStdio().stdin;
            listener = chunk => onData(String(chunk));
            if (stdin.isTTY) stdin.setRawMode(true);
            stdin.resume();
            stdin.setEncoding("utf8");
            stdin.on("data", listener);
        },
        stop,
    };
}

function createTerminalScreen(onBun: boolean): Pick<CellSurface, "size" | "onResize"> {
    const size = (): CellSurfaceSize => {
        const {stdout, stderr, env} = nodeStdio();
        if (onBun) stdout._refreshSize?.();
        if (stdout?.isTTY) return {columns: stdout.columns, rows: stdout.rows};
        if (stderr?.isTTY) return {columns: stderr.columns, rows: stderr.rows};
        const columns = Number(env.COLUMNS);
        const rows = Number(env.LINES || env.ROWS);
        return {
            columns: Number.isFinite(columns) ? columns : FALLBACK_SIZE.columns,
            rows: Number.isFinite(rows) ? rows : FALLBACK_SIZE.rows,
        };
    };

    const onResize = (callback: () => void): () => void => {
        if (onBun) {
            let last = size();
            const timer = setInterval(() => {
                const next = size();
                if (next.columns === last.columns && next.rows === last.rows) return;
                last = next;
                callback();
            }, BUN_RESIZE_POLL_MS);
            (timer as {unref?: () => void}).unref?.();
            return () => clearInterval(timer);
        }
        const stdout = nodeStdio().stdout;
        if (!stdout.isTTY) return () => {};
        stdout.on("resize", callback);
        return () => {
            stdout.removeListener("resize", callback);
        };
    };

    return {size, onResize};
}
