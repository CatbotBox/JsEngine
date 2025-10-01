import {RingQueue} from "./ringQueue";

export class AverageStat {
    private _arr: RingQueue<number>
    private _sum: number;

    public get sampleSize(): number {
        return this._arr.length;
    }

    public constructor(length: number) {
        this._arr = new RingQueue<number>(length);
        this._sum = 0;
    }

    public add(item: number) {
        this._sum -= this._arr.addAndOverride(item) || 0;
        this._sum += item;
    }

    public getAvg(): number
    public getAvg(requireFilledBuffer: false): number
    public getAvg(requireFilledBuffer: true): number | undefined
    public getAvg(requireFilledBuffer: boolean = false): number | undefined {
        if (requireFilledBuffer && !this._arr.isFull) return undefined;
        if (this._arr.isEmpty) return 0;

        return this._sum / this.sampleSize;
    }
}