import {Resource} from "../core/resource";

const NOTHING_SUBMITTED = 0;

export class PresentationStats extends Resource {
    private _submittedFrames = NOTHING_SUBMITTED;
    private _uploadedBytes = NOTHING_SUBMITTED;

    public get submittedFrames(): number {
        return this._submittedFrames;
    }

    public get uploadedBytes(): number {
        return this._uploadedBytes;
    }

    public recordSubmittedFrame(uploadedBytes: number): void {
        this._submittedFrames++;
        this._uploadedBytes += uploadedBytes;
    }
}
