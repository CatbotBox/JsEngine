import type {FrameCallback, FramePacing, FrameScheduler, PresentationBacklog} from "../platform/platform";

export class ManualFrameScheduler implements FrameScheduler {
    public starts = 0;
    private _pacing: FramePacing | undefined;
    private _onFrame: FrameCallback | undefined;
    private _backlog: PresentationBacklog | undefined;

    public get pacing(): FramePacing | undefined {
        return this._pacing;
    }

    public get backlog(): PresentationBacklog | undefined {
        return this._backlog;
    }

    public get running(): boolean {
        return this._onFrame !== undefined;
    }

    public start(pacing: FramePacing, onFrame: FrameCallback, backlog?: PresentationBacklog): () => void {
        this.starts++;
        this._pacing = pacing;
        this._onFrame = onFrame;
        this._backlog = backlog;
        return () => {
            if (this._onFrame !== onFrame) return;
            this._onFrame = undefined;
            this._pacing = undefined;
            this._backlog = undefined;
        };
    }

    public frame(frameTimeMs: number): void {
        const onFrame = this._onFrame;
        if (onFrame === undefined) throw new Error("ManualFrameScheduler.frame: no frame loop is running on this scheduler");
        onFrame(frameTimeMs);
    }
}
