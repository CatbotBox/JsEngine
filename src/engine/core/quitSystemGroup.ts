import {SystemGroup} from "./systemGroup";
import type {System} from "./system";

function updateLoggingErrors(system: System): void {
    try {
        system.update();
    } catch (error) {
        console.error(`${system.constructor.name} failed while the app quit:`, error);
    }
}

export class QuitSystemGroup extends SystemGroup {
    private _updating = false;

    public get updating(): boolean {
        return this._updating;
    }

    protected override updatedByParent(): boolean {
        return false;
    }

    public override onUpdate(): void {
        if (this._updating) throw new Error(`${this.constructor.name} was updated again while it was updating its systems`);
        this._updating = true;
        try {
            this.applyOrderChanges();
            for (const system of [...this.runningList.systems]) updateLoggingErrors(system);
        } finally {
            this._updating = false;
        }
    }
}
