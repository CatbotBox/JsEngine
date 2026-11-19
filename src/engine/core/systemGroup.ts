import {System, SystemCtor} from "./system";
import {RunningList} from "./runningList";

const FIRST_INDEX = 0;
const NO_SYSTEM_RAN_YET = false;

export abstract class SystemGroup extends System {
    public get systems(): System[] {
        return this._systems;
    }

    private _systems: System[] = [];
    private readonly _order: System[] = [];
    private _orderChanged = false;
    private readonly _running: RunningList = new RunningList(this);

    protected get runningList(): RunningList {
        return this._running;
    }

    protected get order(): readonly System[] {
        return this._order;
    }

    private readonly runsInWalk = (system: System): boolean => system.enabled && system.requirementsMet && this.walksChild(system);

    protected blocksPresentation(): boolean {
        return false;
    }

    protected updatedByParent(): boolean {
        return true;
    }

    protected walksChild(system: System): boolean {
        return !(system instanceof SystemGroup) || system.updatedByParent();
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
        if (!this._running.walking) this.applyOrderChanges();
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
        if (running) list.insert(system, this._order);
        else list.remove(system);
    }

    public joinNow(system: System): void {
        const order = this._order;
        if (order.includes(system) || !this._systems.includes(system)) return;
        const priority = system.priority();
        let index = order.length;
        while (index > FIRST_INDEX && order[index - 1].priority() > priority) index--;
        order.splice(index, 0, system);
        this.joinedNow(system);
    }

    protected joinedNow(system: System): void {
        if (this.runsInWalk(system)) this._running.insert(system, this._order);
    }

    protected applyOrderChanges(): void {
        if (!this._orderChanged) return;
        this._orderChanged = false;
        const order = this._order;
        order.length = 0;
        for (const system of this._systems) order.push(system);
        this.rebuildRunning();
    }

    protected runningListOf(system: System): RunningList | undefined {
        return this.walksChild(system) ? this._running : undefined;
    }

    protected rebuildRunning(): void {
        this._running.rebuild(this._order, FIRST_INDEX, this._order.length, this.runsInWalk);
    }

    public addSystem(system: SystemCtor<System>): void {
        const systemInstance = this.world.createSystem(system);
        this.addSystemInstance(systemInstance);
    }

    public addSystemInstance(systemInstance: System): void {
        this._systems.push(systemInstance);
        this._systems.sort((a, b) => a.priority() - b.priority());
        this._orderChanged = true;
    }

    public removeSystem(system: SystemCtor<System>): void {
        const instance = this.world.tryGetSystem(system)
        if (!instance) throw new Error("Can't remove system instance because it doesnt exist in world");
        this.removeSystemInstance(instance);
    }

    public removeSystemInstance(systemInstance: System): void {
        const index = this._systems.findIndex((t) => t === systemInstance);
        if (index == -1) throw new Error("Can't remove system instance because it does not exist in System Group");
        this._systems.splice(index, 1);
        this._orderChanged = true;

        systemInstance.destroy();
    }
}
