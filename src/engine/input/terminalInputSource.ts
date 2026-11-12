export interface TerminalInputSource {
    available(): boolean;
    start(onData: (data: string) => void): void;
    stop(): void;
    write(chunk: string): void;
}
