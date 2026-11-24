import type {EntityQuery} from "./entityQuery";
import type {OccupancyWatcher} from "./entityArchetype";
import type {Resource, ResourceCtor} from "./resource";
import type {ResourceListener, ResourceManager} from "./resourceManager";

export type SatisfactionListener = (satisfied: boolean) => void;

export class QueryOrResourceRequirement {
    private _occupied = false;
    private _present = false;
    private readonly _watcher: OccupancyWatcher = {
        onOccupancyChanged: occupied => this.change(occupied, this._present),
    };
    private readonly _listener: ResourceListener = {
        onPresenceChanged: () => this.change(this._occupied, this.anyResourcePresent()),
    };

    public constructor(
        private readonly query: EntityQuery,
        private readonly resources: readonly ResourceCtor<Resource>[],
        private readonly manager: ResourceManager,
        private readonly onSatisfiedChanged: SatisfactionListener,
    ) {
    }

    public get satisfied(): boolean {
        return this._occupied || this._present;
    }

    public watch(): void {
        this.query.addOccupancyWatcher(this._watcher);
        for (const resource of this.resources) this.manager.addListener(resource, this._listener);
        this._occupied = this.query.hasEntity();
        this._present = this.anyResourcePresent();
    }

    public unwatch(): void {
        this.query.removeOccupancyWatcher(this._watcher);
        for (const resource of this.resources) this.manager.removeListener(resource, this._listener);
    }

    private anyResourcePresent(): boolean {
        return this.resources.some(resource => this.manager.tryGet(resource) !== undefined);
    }

    private change(occupied: boolean, present: boolean): void {
        const wasSatisfied = this.satisfied;
        this._occupied = occupied;
        this._present = present;
        const satisfied = this.satisfied;
        if (satisfied !== wasSatisfied) this.onSatisfiedChanged(satisfied);
    }
}
