import {SystemGroup} from "./systemGroup";
import {System} from "./system";
import {PresentationSystemGroup} from "./presentationSystemGroup";

const FIRST_INDEX = 0;
const TO_THE_END = Number.POSITIVE_INFINITY;
const NO_SYSTEM_RAN_YET = false;

export class RootSystemGroup extends SystemGroup {
    override removeSystemInstance(systemInstance: System): void {
        if (systemInstance === this) return;
        super.removeSystemInstance(systemInstance);
    }

    public override onUpdate(): void {
        const presentationSlot = this.presentationSlot();
        const ranBeforeSlot = this.updateSimulationRange(FIRST_INDEX, presentationSlot, NO_SYSTEM_RAN_YET);
        this.updatePresentation();
        this.updateSimulationRange(presentationSlot + 1, TO_THE_END, ranBeforeSlot);
    }

    public updateSimulation(): void {
        if (!this.enabled) return;
        const presentationSlot = this.presentationSlot();
        const ranAfterSlot = this.updateSimulationRange(presentationSlot + 1, TO_THE_END, NO_SYSTEM_RAN_YET);
        this.updateSimulationRange(FIRST_INDEX, presentationSlot, ranAfterSlot);
    }

    public updatePresentation(): void {
        if (!this.enabled) return;
        const systems = this.systems;
        const barriers = this.world.presentationBarriers;
        barriers.enter();
        try {
            for (let index = FIRST_INDEX; index < systems.length; index++) {
                const system = systems[index];
                if (system instanceof PresentationSystemGroup) system.update();
            }
        } finally {
            barriers.exit();
        }
    }

    private presentationSlot(): number {
        const systems = this.systems;
        for (let index = FIRST_INDEX; index < systems.length; index++) {
            if (systems[index] instanceof PresentationSystemGroup) return index;
        }
        return systems.length;
    }

    private updateSimulationRange(from: number, to: number, afterAnotherSystem: boolean): boolean {
        const systems = this.systems;
        const barriers = this.world.presentationBarriers;
        let ranAny = afterAnotherSystem;
        for (let index = from; index < to && index < systems.length; index++) {
            const system = systems[index];
            if (system instanceof PresentationSystemGroup) continue;
            if (ranAny) barriers.atSystemBoundary();
            ranAny = true;
            system.update();
        }
        return ranAny;
    }
}
