import {EntityQuery} from "./entityQuery";
import {
    TokenOrCtor,
    TokensOfList,
    toTokens,
} from "../util/tokenUtils";
import {EntityManager} from "./entityManager";
import type {SystemGroup} from "./systemGroup";
import {WorldSource} from "./worldSource";
import type {OccupancyWatcher} from "./entityArchetype";
import type {Resource, ResourceCtor} from "./resource";
import type {ResourceListener} from "./resourceManager";

export type SystemCtor<T extends System> = new () => T;

const CREATE_GROUP_IF_MISSING = true;
const EXISTING_GROUP_ONLY = false;
const NONE = 0;

export abstract class System extends WorldSource {
    private _enabled = true;
    private _requiredAnyForUpdate: EntityQuery[] | undefined;
    private _requiredAllForUpdate: EntityQuery[] | undefined;
    private _requiredResources: ResourceCtor<Resource>[] | undefined;
    private _satisfiedAny = NONE;
    private _satisfiedAll = NONE;
    private _missingResources = NONE;
    private _shouldRun = true;
    private readonly _anyWatcher: OccupancyWatcher = {
        onOccupancyChanged: occupied => this.countSatisfiedAny(occupied),
    };
    private readonly _allWatcher: OccupancyWatcher = {
        onOccupancyChanged: occupied => this.countSatisfiedAll(occupied),
    };
    private readonly _resourceListener: ResourceListener = {
        onPresenceChanged: present => this.countMissingResources(present),
    };
    private readonly _ownedQueries: EntityQuery[] = [];
    private _lastUpdateStamp: number = 0;
    private _isCreated: boolean = false;
    private _updateDepth: number = 0;

    protected get lastUpdateStamp(): number {
        return this._lastUpdateStamp;
    }

    protected updateLastUpdateStamp() {
        this._lastUpdateStamp = this.world.changeStamps.advance();
    }

    public constructor() {
        super(undefined!)
    }

    public override adoptQuery(query: EntityQuery): void {
        this._ownedQueries.push(query);
    }

    private disposeOwnedQueries(): void {
        const queries = this._ownedQueries;
        for (let i = 0; i < queries.length; i++) queries[i].dispose();
        queries.length = 0;
    }

    public priority(): number {
        return 0;
    }

    protected systemGroup(): (new () => SystemGroup) | undefined {
        return undefined;
    }

    private resolveUpdateGroup(createIfMissing: boolean): SystemGroup | undefined {
        const group = this.systemGroup();
        if (group === undefined) return this.world.rootSystemGroup;
        return createIfMissing ? this.world.getOrCreateSystem(group) : this.world.tryGetSystem(group);
    }

    protected get entityManager(): EntityManager {
        return this.world.entityManager;
    }

    public get requirementsMet(): boolean {
        return (this._requiredAnyForUpdate === undefined || this._satisfiedAny > NONE) &&
            this._satisfiedAll === (this._requiredAllForUpdate?.length ?? NONE) &&
            this._missingResources === NONE;
    }

    private countSatisfiedAny(occupied: boolean): void {
        if (occupied) this._satisfiedAny++;
        else this._satisfiedAny--;
        this.refreshShouldRun();
    }

    private countSatisfiedAll(occupied: boolean): void {
        if (occupied) this._satisfiedAll++;
        else this._satisfiedAll--;
        this.refreshShouldRun();
    }

    private countMissingResources(present: boolean): void {
        if (present) this._missingResources--;
        else this._missingResources++;
        this.refreshShouldRun();
    }

    private refreshShouldRun(): void {
        const shouldRun = this._enabled && this.requirementsMet;
        if (shouldRun === this._shouldRun) return;
        this._shouldRun = shouldRun;
        const updateGroup = this.resolveUpdateGroup(EXISTING_GROUP_ONLY);
        if (updateGroup === undefined || (updateGroup as System) === this) return;
        updateGroup.setRunning(this, shouldRun);
    }

    private unwatchRequirements(): void {
        const any = this._requiredAnyForUpdate, all = this._requiredAllForUpdate, resources = this._requiredResources;
        if (any !== undefined) for (const query of any) query.removeOccupancyWatcher(this._anyWatcher);
        if (all !== undefined) for (const query of all) query.removeOccupancyWatcher(this._allWatcher);
        if (resources !== undefined) for (const ctor of resources) this.world.resources.removeListener(ctor, this._resourceListener);
        this._requiredAnyForUpdate = this._requiredAllForUpdate = undefined;
        this._requiredResources = undefined;
        this._satisfiedAny = this._satisfiedAll = this._missingResources = NONE;
        this._shouldRun = this._enabled && this.requirementsMet;
    }

    protected requireAnyForUpdate<
        IncSpec extends readonly TokenOrCtor[],
        ExcSpec extends readonly TokenOrCtor[] = readonly[],
    >(include: IncSpec, exclude?: ExcSpec): void
    protected requireAnyForUpdate<
        IncSpec extends readonly TokenOrCtor[],
        ExcSpec extends readonly TokenOrCtor[] = []
    >(query: EntityQuery<IncSpec, ExcSpec>): void
    protected requireAnyForUpdate<IncSpec extends readonly TokenOrCtor[], ExcSpec extends readonly TokenOrCtor[] = []>(input: IncSpec | EntityQuery<TokensOfList<IncSpec>, TokensOfList<ExcSpec>>, input2?: ExcSpec): void {
        let query = input as unknown as EntityQuery
        if (Array.isArray(input)) {
            const inc = toTokens(input) as TokensOfList<IncSpec>;
            const exc = toTokens(input2 ?? []) as TokensOfList<ExcSpec>;
            query = new EntityQuery(this, inc, exc) as unknown as EntityQuery;
        } else {
            this.requireOwnQuery(query, "requireAnyForUpdate");
        }
        query.addOccupancyWatcher(this._anyWatcher);
        (this._requiredAnyForUpdate ??= []).push(query);
        if (query.hasEntity()) this._satisfiedAny++;
        this.refreshShouldRun();
    }

    protected requireAllForUpdate<
        IncSpec extends readonly TokenOrCtor[],
        ExcSpec extends readonly TokenOrCtor[] = []
    >(include: IncSpec, exclude?: ExcSpec): void
    protected requireAllForUpdate<
        IncSpec extends readonly TokenOrCtor[],
        ExcSpec extends readonly TokenOrCtor[] = []
    >(query: EntityQuery<IncSpec, ExcSpec>): void
    protected requireAllForUpdate<IncSpec extends readonly TokenOrCtor[], ExcSpec extends readonly TokenOrCtor[] = []>(input: IncSpec | EntityQuery<TokensOfList<IncSpec>, TokensOfList<ExcSpec>>, input2?: ExcSpec): void {
        let query = input as unknown as EntityQuery
        if (Array.isArray(input)) {
            const inc = toTokens(input) as TokensOfList<IncSpec>;
            const exc = toTokens(input2 ?? []) as TokensOfList<ExcSpec>;
            query = new EntityQuery(this, inc, exc) as unknown as EntityQuery;
        } else {
            this.requireOwnQuery(query, "requireAllForUpdate");
        }
        query.addOccupancyWatcher(this._allWatcher);
        (this._requiredAllForUpdate ??= []).push(query);
        if (query.hasEntity()) this._satisfiedAll++;
        this.refreshShouldRun();
    }

    private requireOwnQuery(query: EntityQuery, requirement: string): void {
        if (query.source === this) return;
        throw new Error(`${this.constructor.name}.${requirement}: the query (${query.describeTypes()}) was created by ${query.source.constructor.name}, not by this system; pass its component types to ${requirement} instead`);
    }

    protected requireResourceForUpdate<T extends Resource>(ctor: ResourceCtor<T>): void {
        const resources = this.world.resources;
        resources.addListener(ctor, this._resourceListener);
        (this._requiredResources ??= []).push(ctor);
        if (resources.tryGet(ctor) === undefined) this._missingResources++;
        this.refreshShouldRun();
    }

    public create(): void {
        if (this._isCreated) return;
        const updateGroup = this.resolveUpdateGroup(CREATE_GROUP_IF_MISSING);
        const isRootGroupCreatingItself = updateGroup === undefined || (updateGroup as System) === this;
        if (!isRootGroupCreatingItself) updateGroup.addSystemInstance(this);
        this._isCreated = true;
        this.onCreate();
        if (this.isEnabledInHierarchy()) this.onEnable();
    }

    public joinGroupNow(): void {
        const updateGroup = this.resolveUpdateGroup(EXISTING_GROUP_ONLY);
        if (updateGroup === undefined || (updateGroup as System) === this) return;
        updateGroup.joinNow(this);
    }

    protected onCreate(): void {
    }

    public destroy(): void {
        if (!this._isCreated) return;
        if (this.isEnabledInHierarchy()) this.onDisable();
        this._isCreated = false;
        this.onDestroy();
        this.unwatchRequirements();
        if (this._updateDepth === 0) this.disposeOwnedQueries();
        const updateGroup = this.resolveUpdateGroup(EXISTING_GROUP_ONLY);
        if (!updateGroup) return;
        updateGroup.removeSystemInstance(this);
        this.world.removeSystem(this.constructor as SystemCtor<this>);
    }

    private isEnabledInHierarchy(): boolean {
        return this._enabled && this.isGroupEnabledInHierarchy();
    }

    private isGroupEnabledInHierarchy(): boolean {
        const updateGroup = this.resolveUpdateGroup(EXISTING_GROUP_ONLY);
        if (updateGroup === undefined || (updateGroup as System) === this) return true;
        return (updateGroup as System).isEnabledInHierarchy();
    }

    protected onDestroy(): void {
    }

    public abstract onUpdate(): void;

    public update(): void {
        if (!this._shouldRun || !this._isCreated) return;
        this._updateDepth++;
        try {
            this.onUpdate();
        } finally {
            this._updateDepth--;
            if (!this._isCreated && this._updateDepth === 0) this.disposeOwnedQueries();
        }
        this._lastUpdateStamp = this.world.changeStamps.advance();
    }

    public get enabled(): boolean {
        return this._enabled;
    }

    public set enabled(v: boolean) {
        if (v === this.enabled) return;
        const groupEnabled = this.isGroupEnabledInHierarchy();
        if (v) {
            this._enabled = true;
            this.refreshShouldRun();
            if (groupEnabled) this.onEnable();
        } else {
            if (groupEnabled) this.onDisable();
            this._enabled = false;
            this.refreshShouldRun();
        }
    }

    public onEnable(): void {

    }

    public onDisable(): void {

    }

    protected createEntityQuery<
        IncSpec extends readonly TokenOrCtor[],
        ExcSpec extends readonly TokenOrCtor[] = []
    >(
        include: IncSpec,
        exclude?: ExcSpec
    ): EntityQuery<IncSpec, ExcSpec> {
        return new EntityQuery(this, include, exclude);
    }
}
