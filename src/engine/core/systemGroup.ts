import {System, SystemCtor} from "./system";
import {RunningList} from "./runningList";

const FIRST_INDEX = 0;
const NO_SYSTEM_RAN_YET = false;

function runsInWalk(system: System): boolean {
    return system.enabled && system.requirementsMet;
}

export abstract class SystemGroup extends System {
    public get systems(): System[] {
        return this._systems;
    }

    private _systems: System[] = [];
    private readonly _running: RunningList = new RunningList(this);

    protected get runningList(): RunningList {
        return this._running;
    }

    protected blocksPresentation(): boolean {
        return false;
    }

    public override update(): void {
        if (!this.blocksPresentation()) {
            super.update();
            return;
        }
        const barriers = this.world.presentationBarriers;
        barriers.enter();
        try {
            super.update();
        } finally {
            barriers.exit();
        }
    }

    public onUpdate(): void {
        this._running.walk(this.world.presentationBarriers, NO_SYSTEM_RAN_YET);
    }

    public override destroy(): void {
        for (const system of [...this._systems]) {
            system.destroy();
        }
        super.destroy();
    }

    public onEnable(): void {
        for (const system of this._systems) {
            if (system.enabled) system.onEnable();
        }
    }

    public onDisable(): void {
        for (const system of this._systems) {
            if (system.enabled) system.onDisable();
        }
    }

    public setRunning(system: System, running: boolean): void {
        const list = this.runningListOf(system);
        if (list === undefined) return;
        if (running) list.insert(system, this._systems);
        else list.remove(system);
    }

    protected runningListOf(system: System): RunningList | undefined {
        return this._running;
    }

    protected rebuildRunning(): void {
        this._running.rebuild(this._systems, FIRST_INDEX, this._systems.length, runsInWalk);
    }

    protected forgetRunning(system: System, predecessor: System | undefined): void {
        this._running.remove(system);
        this._running.replaceLastWalked(system, predecessor);
    }

    public addSystem(system: SystemCtor<System>): void {
        const systemInstance = this.world.createSystem(system);
        this.addSystemInstance(systemInstance);
    }

    public addSystemInstance(systemInstance: System): void {
        this._systems.push(systemInstance);
        this._systems.sort((a, b) => a.priority() - b.priority());
        this.rebuildRunning();
    }

    public removeSystem(system: SystemCtor<System>): void {
        const instance = this.world.tryGetSystem(system)
        if (!instance) throw new Error("Can't remove system instance because it doesnt exist in world");
        this.removeSystemInstance(instance);
    }

    public removeSystemInstance(systemInstance: System): void {
        const index = this._systems.findIndex((t) => t === systemInstance);
        if (index == -1) throw new Error("Can't remove system instance because it does not exist in System Group");
        const predecessor = index === FIRST_INDEX ? undefined : this._systems[index - 1];
        this._systems.splice(index, 1);
        this.forgetRunning(systemInstance, predecessor);

        systemInstance.destroy();
    }
}
