import {Resource} from "../core/resource";
import {randomSourceFor} from "./randomSource";
import type {RandomSource} from "./randomSource";

export class Random extends Resource implements RandomSource {
    private currentSeed: number | undefined;
    private source: RandomSource;

    public constructor(seed?: number) {
        super();
        this.currentSeed = seed;
        this.source = randomSourceFor(seed);
    }

    public get seed(): number | undefined {
        return this.currentSeed;
    }

    public set seed(seed: number | undefined) {
        this.reseedIfChanged(seed);
    }

    public reseedIfChanged(seed: number | undefined): void {
        if (seed === this.currentSeed) return;
        this.currentSeed = seed;
        this.source = randomSourceFor(seed);
    }

    public next(): number {
        return this.source.next();
    }

    public between(min: number, max: number): number {
        return min + (max - min) * this.next();
    }

    public indexBelow(length: number): number {
        return Math.floor(this.next() * length);
    }
}
