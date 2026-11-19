import type {System} from "./system";
import type {PresentationBarriers} from "./presentationBarriers";

const NOT_FOUND = -1;
const FIRST_INDEX = 0;

export type RunsInWalk = (system: System) => boolean;

export class RunningList {
    private readonly _systems: System[] = [];
    private _cursor = FIRST_INDEX;
    private _lastWalked: System | undefined;
    private _walking = false;

    public constructor(private readonly owner: System) {
    }

    public get systems(): readonly System[] {
        return this._systems;
    }

    public get walking(): boolean {
        return this._walking;
    }

    public insert(system: System, order: readonly System[]): void {
        const running = this._systems;
        let index = FIRST_INDEX;
        for (let orderIndex = FIRST_INDEX; orderIndex < order.length; orderIndex++) {
            const other = order[orderIndex];
            if (other === system) {
                if (running[index] !== system) this.insertAt(index, system, order);
                return;
            }
            if (running[index] === other) index++;
        }
    }

    public remove(system: System): void {
        const index = this._systems.indexOf(system);
        if (index === NOT_FOUND) return;
        this._systems.splice(index, 1);
        if (index < this._cursor) this._cursor--;
    }

    public rebuild(order: readonly System[], from: number, to: number, runsInWalk: RunsInWalk): void {
        const running = this._systems;
        const lastWalkedAt = this._lastWalked === undefined ? NOT_FOUND : order.indexOf(this._lastWalked);
        let cursor = FIRST_INDEX;
        running.length = 0;
        for (let orderIndex = from; orderIndex < to; orderIndex++) {
            const system = order[orderIndex];
            if (!runsInWalk(system)) continue;
            running.push(system);
            if (orderIndex <= lastWalkedAt) cursor = running.length;
        }
        this._cursor = cursor;
    }

    public walk(barriers: PresentationBarriers, afterAnotherSystem: boolean): boolean {
        if (this._walking) throw new Error(`${this.owner.constructor.name} was updated again while it was updating its systems`);
        const running = this._systems;
        let ranAny = afterAnotherSystem;
        let boundaryPassed = false;
        this._walking = true;
        this._cursor = FIRST_INDEX;
        this._lastWalked = undefined;
        try {
            while (this._cursor < running.length) {
                if (ranAny && !boundaryPassed) {
                    boundaryPassed = true;
                    barriers.atSystemBoundary();
                    continue;
                }
                const system = running[this._cursor++];
                this._lastWalked = system;
                boundaryPassed = false;
                ranAny = true;
                system.update();
            }
        } finally {
            this._walking = false;
        }
        return ranAny;
    }

    private insertAt(index: number, system: System, order: readonly System[]): void {
        this._systems.splice(index, 0, system);
        if (!this._walking) return;
        if (index < this._cursor || (index === this._cursor && this.isWalkedPast(system, order))) this._cursor++;
    }

    private isWalkedPast(system: System, order: readonly System[]): boolean {
        const lastWalked = this._lastWalked;
        if (lastWalked === undefined) return false;
        for (let orderIndex = FIRST_INDEX; orderIndex < order.length; orderIndex++) {
            const other = order[orderIndex];
            if (other === system) return true;
            if (other === lastWalked) return false;
        }
        return false;
    }
}
