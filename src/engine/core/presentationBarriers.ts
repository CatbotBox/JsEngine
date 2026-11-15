export type SystemBoundaryListener = () => void;

const NO_OPEN_BARRIERS = 0;

export class PresentationBarriers {
    private _openBarriers = NO_OPEN_BARRIERS;
    private _boundaryListener: SystemBoundaryListener | undefined;

    public get blocking(): boolean {
        return this._openBarriers !== NO_OPEN_BARRIERS;
    }

    public enter(): void {
        this._openBarriers++;
    }

    public exit(): void {
        this._openBarriers--;
    }

    public atSystemBoundary(): void {
        if (this._openBarriers === NO_OPEN_BARRIERS && this._boundaryListener !== undefined) this._boundaryListener();
    }

    public listenAtSystemBoundaries(listener: SystemBoundaryListener | undefined): void {
        this._boundaryListener = listener;
    }
}
