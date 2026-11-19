import {SystemGroup} from "./systemGroup";
import {System} from "./system";
import {PresentationSystemGroup} from "./presentationSystemGroup";
import {RunningList} from "./runningList";

const FIRST_INDEX = 0;
const NO_SYSTEM_RAN_YET = false;

function runsInSimulation(system: System): boolean {
    return !(system instanceof PresentationSystemGroup) && system.enabled && system.requirementsMet;
}

export class RootSystemGroup extends SystemGroup {
    private readonly _runningAfterSlot: RunningList = new RunningList(this);
    private readonly _presentationGroups: PresentationSystemGroup[] = [];

    override removeSystemInstance(systemInstance: System): void {
        if (systemInstance === this) return;
        super.removeSystemInstance(systemInstance);
    }

    public override onUpdate(): void {
        const barriers = this.world.presentationBarriers;
        const ranBeforeSlot = this.runningList.walk(barriers, NO_SYSTEM_RAN_YET);
        this.updatePresentation();
        this._runningAfterSlot.walk(barriers, ranBeforeSlot);
    }

    public updateSimulation(): void {
        if (!this.enabled) return;
        const barriers = this.world.presentationBarriers;
        const ranAfterSlot = this._runningAfterSlot.walk(barriers, NO_SYSTEM_RAN_YET);
        this.runningList.walk(barriers, ranAfterSlot);
    }

    public updatePresentation(): void {
        if (!this.enabled) return;
        const groups = this._presentationGroups;
        const barriers = this.world.presentationBarriers;
        barriers.enter();
        try {
            for (let index = FIRST_INDEX; index < groups.length; index++) groups[index].update();
        } finally {
            barriers.exit();
        }
    }

    protected override runningListOf(system: System): RunningList | undefined {
        if (system instanceof PresentationSystemGroup) return undefined;
        return this.isBeforePresentationSlot(system) ? this.runningList : this._runningAfterSlot;
    }

    protected override rebuildRunning(): void {
        const systems = this.systems;
        const groups = this._presentationGroups;
        groups.length = 0;
        for (const system of systems) {
            if (system instanceof PresentationSystemGroup) groups.push(system);
        }
        const firstGroup = groups[FIRST_INDEX];
        const slot = firstGroup === undefined ? systems.length : systems.indexOf(firstGroup);
        this.runningList.rebuild(systems, FIRST_INDEX, slot, runsInSimulation);
        this._runningAfterSlot.rebuild(systems, slot + 1, systems.length, runsInSimulation);
    }

    protected override forgetRunning(system: System, predecessor: System | undefined): void {
        super.forgetRunning(system, predecessor);
        this._runningAfterSlot.remove(system);
        this._runningAfterSlot.replaceLastWalked(system, predecessor);
        if (system instanceof PresentationSystemGroup) this.rebuildRunning();
    }

    private isBeforePresentationSlot(system: System): boolean {
        const slot = this._presentationGroups[FIRST_INDEX];
        const systems = this.systems;
        for (let index = FIRST_INDEX; index < systems.length; index++) {
            const other = systems[index];
            if (other === system) return true;
            if (other === slot) return false;
        }
        return false;
    }
}
