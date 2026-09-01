import {RingQueue} from "./ringQueue";

export class AverageStat {
    private _samples: RingQueue<number>
    private _sum: number;

    /** Samples currently held, not the window capacity: getAvg() divides by this. */
    public get sampleSize(): number {
        return this._samples.count;
    }

    public constructor(windowSize: number) {
        this._samples = new RingQueue<number>(windowSize);
        this._sum = 0;
    }

    public add(item: number) {
        this._sum -= this._samples.addAndOverride(item) || 0;
        this._sum += item;
    }

    public getAvg(): number
    public getAvg(requireFilledBuffer: false): number
    public getAvg(requireFilledBuffer: true): number | undefined
    public getAvg(requireFilledBuffer: boolean = false): number | undefined {
        if (requireFilledBuffer && !this._samples.isFull) return undefined;
        if (this._samples.isEmpty) return 0;

        return this._sum / this.sampleSize;
    }
}