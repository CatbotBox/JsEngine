import {System, SystemCtor} from "./system";
import {AverageStat} from "../datatypes";
import {performance} from "node:perf_hooks";
import {SystemGroup} from "./systemGroup";
import {World} from "./world";
import {RootSystemGroup} from "./rootSystemGroup";
import {GcSystem} from "./gcSystem";

export class DebugWorld extends World {

    private _systemPerfStat?: Map<System, AverageStat>;// cannot be init here :(

    constructor() {
        super();
        this._rootSystemGroup.destroy(); // delete all systems and recreate them
        this._rootSystemGroup = this.createSystem(RootSystemGroup);
        this.ensureSystemExists(GcSystem)
    }


    public override getOrCreateSystem<T extends System>(systemClass: SystemCtor<T>): T {
        const existing = this.tryGetSystem(systemClass)
        if (existing !== undefined) return existing as T;
        return this.createSystem(systemClass);
    }

    public override createSystem<T extends System>(systemClass: SystemCtor<T>): T {
        const existing = this._systems.get(systemClass);
        if (existing !== undefined) throw new Error("System already exists");
        const systemInstance = new systemClass();
        const statTracker = new AverageStat(60)
        if (!this._systemPerfStat) this._systemPerfStat = new Map<System, AverageStat>()
        const world = this;
        const orig = systemInstance['onUpdate'];
        systemInstance['onUpdate'] = function (...args: any[]) {
            const start = performance.now();
            try {
                const result = (orig as any).apply(systemInstance, args);
                const end = performance.now();
                statTracker.add(end - start)
                return result;

            } catch (err) {
                const end = performance.now();
                statTracker.add(end - start);
                world.stop();
                console.error("error while running system: " + systemClass.name + " Error: " + err);
            }
        } as System['onUpdate'];

        this._systemPerfStat.set(systemInstance, statTracker)
        systemInstance.world = this;
        this._systems.set(systemClass, systemInstance);
        systemInstance.create();
        return systemInstance;
    }

    public logSystemUpdateOrder() {
        this.debug(this._rootSystemGroup, true);
    }

    private debug(systemGroup: SystemGroup, running: boolean) {
        if (!this._systemPerfStat) this._systemPerfStat = new Map<System, AverageStat>();
        const timing = this._systemPerfStat.get(systemGroup)?.getAvg(false);
        const timingString = timing === undefined ? "[-]" : `[${timing.toFixed(2)}ms]`;
        const isRunning = running && systemGroup.enabled;
        console.group("SystemGroup", systemGroup.constructor.name, isRunning ? "" : "⏸", timingString);
        for (const system of systemGroup.systems) {
            if (system instanceof SystemGroup) {
                this.debug(system, isRunning)
            } else {
                const timing = this._systemPerfStat.get(system)?.getAvg(false);
                const timingString = timing === undefined ? "[-]" : `[${timing.toFixed(2)}ms]`;
                console.log("System", system.constructor.name, isRunning && system.enabled ? "" : "⏸", timingString);
            }
        }
        console.groupEnd();
    }
}