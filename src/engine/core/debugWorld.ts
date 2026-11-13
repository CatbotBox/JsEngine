import {System, SystemCtor} from "./system";
import {AverageStat} from "../datatypes";
import {SystemGroup} from "./systemGroup";
import {World} from "./world";
import type {WorldOptions} from "./world";
import {RootSystemGroup} from "./rootSystemGroup";
import {GcSystem} from "./gcSystem";
import {InputSystem} from "../input/inputSystem";

const PERF_STAT_WINDOW_FRAMES = 60;
const PARTIAL_WINDOW_AVERAGE = false;
const ROOT_GROUP_RUNNING = true;

export class DebugWorld extends World {

    private _systemPerfStat?: Map<System, AverageStat>;

    constructor(options: WorldOptions) {
        super(options);
        this._rootSystemGroup.destroy();
        this._rootSystemGroup = this.createSystem(RootSystemGroup);
        this.ensureSystemExists(GcSystem)
        this.ensureSystemExists(InputSystem)
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
        const statTracker = new AverageStat(PERF_STAT_WINDOW_FRAMES)
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
        let archetypes = 0, occupied = 0, disabled = 0;
        for (const archetype of this.archetypes.values()) {
            archetypes++;
            if (archetype.entityCountIncludingDisabled > 0) occupied++;
            disabled += archetype.entityCountIncludingDisabled - archetype.enabledEntityCount;
        }
        console.log(
            `entities: ${this.enabledEntityCount} enabled` +
            (disabled > 0 ? ` (+${disabled} disabled)` : "") +
            ` | archetypes: ${occupied} occupied / ${archetypes} total` +
            ` | frame budget: ${this.targetDeltaTimeMs.toFixed(2)}ms`
        );
        this.logGroupTree(this._rootSystemGroup, ROOT_GROUP_RUNNING);
    }

    private logGroupTree(systemGroup: SystemGroup, parentRunning: boolean) {
        if (!this._systemPerfStat) this._systemPerfStat = new Map<System, AverageStat>();
        const timing = this._systemPerfStat.get(systemGroup)?.getAvg(PARTIAL_WINDOW_AVERAGE);
        const timingString = timing === undefined ? "[-]" : `[${timing.toFixed(2)}ms]`;
        const isRunning = parentRunning && systemGroup.enabled;
        console.group("SystemGroup", systemGroup.constructor.name, isRunning ? "" : "⏸", timingString);
        for (const system of systemGroup.systems) {
            if (system instanceof SystemGroup) {
                this.logGroupTree(system, isRunning)
            } else {
                const timing = this._systemPerfStat.get(system)?.getAvg(PARTIAL_WINDOW_AVERAGE);
                const timingString = timing === undefined ? "[-]" : `[${timing.toFixed(2)}ms]`;
                console.log("System", system.constructor.name, isRunning && system.enabled ? "" : "⏸", timingString);
            }
        }
        console.groupEnd();
    }
}