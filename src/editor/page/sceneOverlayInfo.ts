import type {EditorViewInfo} from "../editorProtocol";

export const VIEW_INFO_RETRY_MS = 1000;

export interface OverlayInfoRequest {
    readonly framesBefore: number;
}

export class SceneOverlayInfo {
    private shown: EditorViewInfo | undefined;
    private problemText: string | undefined;
    private frames = 0;
    private lastFrameAtMs = Number.NEGATIVE_INFINITY;
    private failedAtMs = Number.NEGATIVE_INFINITY;
    private requesting = false;

    public get info(): EditorViewInfo | undefined {
        return this.shown;
    }

    public get problem(): string | undefined {
        return this.problemText;
    }

    public forget(): void {
        this.shown = undefined;
    }

    public frameShown(info: EditorViewInfo, nowMs: number): void {
        this.frames++;
        this.lastFrameAtMs = nowMs;
        this.shown = info;
        this.problemText = undefined;
    }

    public startRequest(nowMs: number): OverlayInfoRequest | undefined {
        if (this.requesting || nowMs - this.lastFrameAtMs < VIEW_INFO_RETRY_MS || nowMs - this.failedAtMs < VIEW_INFO_RETRY_MS) return undefined;
        this.requesting = true;
        return {framesBefore: this.frames};
    }

    public requestAnswered(request: OverlayInfoRequest, info: EditorViewInfo): boolean {
        this.requesting = false;
        if (this.overtaken(request)) return false;
        this.shown = info;
        this.problemText = undefined;
        return true;
    }

    public requestFailed(request: OverlayInfoRequest, problem: string, nowMs: number): void {
        this.requesting = false;
        this.failedAtMs = nowMs;
        if (!this.overtaken(request)) this.problemText = problem;
    }

    private overtaken(request: OverlayInfoRequest): boolean {
        return request.framesBefore !== this.frames;
    }
}
