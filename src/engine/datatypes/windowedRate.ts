const MS_PER_SECOND = 1000;
const NO_DELTA = 0;

export class RateWindow {
    private _startMs: number;
    private _lengthMs = 0;

    public constructor(startMs: number) {
        this._startMs = startMs;
    }

    public get lengthMs(): number {
        return this._lengthMs;
    }

    public tryClose(nowMs: number, minimumLengthMs: number): boolean {
        const lengthMs = nowMs - this._startMs;
        if (lengthMs < minimumLengthMs) return false;
        this._lengthMs = lengthMs;
        this._startMs = nowMs;
        return true;
    }
}

export class WindowedCount {
    private _countAtWindowStart = 0;
    private _delta = NO_DELTA;
    private _perSecond = 0;

    public get delta(): number {
        return this._delta;
    }

    public get perSecond(): number {
        return this._perSecond;
    }

    public closeWindow(count: number, windowLengthMs: number): void {
        this._delta = count - this._countAtWindowStart;
        this._perSecond = this._delta * MS_PER_SECOND / windowLengthMs;
        this._countAtWindowStart = count;
    }

    public deltaPer(other: WindowedCount): number {
        return other.delta === NO_DELTA ? 0 : this._delta / other.delta;
    }
}
