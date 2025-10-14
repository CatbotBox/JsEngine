import {performance} from "node:perf_hooks";
import {SimpleProfiler} from "./simpleProfiler";

export class Profiler extends SimpleProfiler {

    private readonly _name: string;
    private readonly _creationTime: number;
    private _children: Map<string, Profiler> = new Map<string, Profiler>();

    public get creationTime(): number {
        return this._creationTime;
    }

    public get name(): string {
        return this._name;
    }

    public get children(): Map<string, Profiler> {
        return this._children;
    }

    public constructor(name: string) {
        super();
        this._name = name;
        this._creationTime = performance.now();
    }

    public getChapter(name: string): Profiler {
        const chp = this._children.get(name);
        if (chp) return chp
        const newChapter = new Profiler(name)
        this._children.set(name, newChapter);
        return newChapter;
    }
}


