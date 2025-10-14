import {AverageStat} from "../datatypes";
import {performance} from "node:perf_hooks";

export class SimpleProfiler {
    private avg: AverageStat = new AverageStat(20);

    private lastStartTime: number = -1;

    public get Average() {
        return this.avg.getAvg();
    }

    public start() {
        if (this.lastStartTime != -1) throw new Error("Previous Profile has not ended");
        this.lastStartTime = performance.now();

        return {
            [Symbol.dispose]: this.end,
            [Symbol.asyncDispose]: this.end,
        }
    }

    public end() {
        const timeTaken = performance.now() - this.lastStartTime;
        this.lastStartTime = -1;
        this.avg.add(timeTaken);
    }
}