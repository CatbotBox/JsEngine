import type {Entity} from "../../engine/core";
import type {EditorEntityDetails, EditorMode, EditorRequest, EditorResultOf, ListEntitiesResult, PrefabOverridesResult} from "../editorProtocol";
import {EditorClientClosedError, EditorRequestError} from "./editorClient";
import type {EditorRequester} from "./undoStack";

export interface SelectionDetails {
    readonly details: readonly EditorEntityDetails[];
    readonly overrides: PrefabOverridesResult | undefined;
    readonly overridesRoot: Entity | undefined;
}

export interface EditorRefreshTarget {
    client(): EditorRequester;

    selection(): readonly Entity[];

    instanceRootOf(entity: Entity): Entity | undefined;

    showListing(listing: ListEntitiesResult): void;

    showSelectionDetails(selection: SelectionDetails): void;

    dropMissingFromSelection(missing: ReadonlySet<Entity>): void;

    reportError(error: unknown): void;

    sessionClosed(): void;
}

export const ENTITY_LIST_POLL_INTERVAL_MS = 500;
export const SELECTED_ENTITY_PLAY_POLL_INTERVAL_MS = 100;
export const MAX_INSPECTED_ENTITIES = 64;

type IntervalHandle = ReturnType<typeof setInterval>;

export class CoalescedRefresh {
    private running = false;
    private runAgain = false;

    public constructor(private readonly refresh: () => Promise<void>) {
    }

    public trigger(): void {
        if (this.running) {
            this.runAgain = true;
            return;
        }
        this.running = true;
        void this.refresh().finally(() => {
            this.running = false;
            if (!this.runAgain) return;
            this.runAgain = false;
            this.trigger();
        });
    }
}

export class EditorRefresh {
    private mode: EditorMode = "edit";
    private editsStarted = 0;
    private editsInFlight = 0;
    private stopped = false;
    private timers: IntervalHandle[] = [];
    private readonly listRefresh = new CoalescedRefresh(() => this.refreshList());
    private readonly detailsRefresh = new CoalescedRefresh(() => this.refreshSelected());

    public constructor(private readonly target: EditorRefreshTarget) {
    }

    public start(): void {
        this.stopped = false;
        if (this.timers.length > 0) return;
        this.timers = [
            setInterval(() => this.listRefresh.trigger(), ENTITY_LIST_POLL_INTERVAL_MS),
            setInterval(() => {
                if (this.mode === "play") this.detailsRefresh.trigger();
            }, SELECTED_ENTITY_PLAY_POLL_INTERVAL_MS),
        ];
        this.refreshAll();
    }

    public stop(): void {
        this.stopped = true;
        for (const timer of this.timers) clearInterval(timer);
        this.timers = [];
    }

    public setMode(mode: EditorMode): void {
        this.mode = mode;
    }

    public selectionChanged(): void {
        this.detailsRefresh.trigger();
    }

    public async edit<R extends EditorRequest>(request: R): Promise<EditorResultOf<R>> {
        this.editsStarted++;
        this.editsInFlight++;
        try {
            return await this.target.client().request(request);
        } finally {
            this.editsInFlight--;
            if (this.editsInFlight === 0) this.refreshAll();
        }
    }

    public async editing<T>(work: () => Promise<T>): Promise<T> {
        this.editsStarted++;
        this.editsInFlight++;
        try {
            return await work();
        } finally {
            this.editsInFlight--;
            if (this.editsInFlight === 0) this.refreshAll();
        }
    }

    public refreshAll(): void {
        this.listRefresh.trigger();
        this.detailsRefresh.trigger();
    }

// A read is dropped when an edit started or is in flight since it was sent: its answer predates that edit.
    private isCurrent(generation: number): boolean {
        return !this.stopped && this.editsInFlight === 0 && generation === this.editsStarted;
    }

    private async refreshList(): Promise<void> {
        if (this.stopped) return;
        const generation = this.editsStarted;
        try {
            const listing = await this.target.client().request({op: "listEntities"});
            if (!this.isCurrent(generation)) return;
            this.target.showListing(listing);
        } catch (error) {
            this.fail(error);
        }
    }

    private async detailsOf(entity: Entity): Promise<EditorEntityDetails | undefined> {
        try {
            return await this.target.client().request({op: "getEntity", entity});
        } catch (error) {
            if (error instanceof EditorRequestError) return undefined;
            throw error;
        }
    }

    private async overridesOf(root: Entity | undefined): Promise<PrefabOverridesResult | undefined> {
        if (root === undefined) return undefined;
        try {
            return await this.target.client().request({op: "getPrefabOverrides", entity: root});
        } catch (error) {
            if (error instanceof EditorRequestError) return undefined;
            throw error;
        }
    }

    private async refreshSelected(): Promise<void> {
        if (this.stopped) return;
        const selection = this.target.selection().slice(0, MAX_INSPECTED_ENTITIES);
        const generation = this.editsStarted;
        const primary = selection[selection.length - 1];
        const overridesRoot = selection.length === 1 && primary !== undefined ? this.target.instanceRootOf(primary) : undefined;
        try {
            const [found, overrides] = await Promise.all([Promise.all(selection.map(entity => this.detailsOf(entity))), this.overridesOf(overridesRoot)]);
            if (!this.isCurrent(generation) || !sameEntities(selection, this.target.selection().slice(0, MAX_INSPECTED_ENTITIES))) return;
            const missing = new Set(selection.filter((_, index) => found[index] === undefined));
            if (missing.size > 0) this.target.dropMissingFromSelection(missing);
            const details = found.filter((entry): entry is EditorEntityDetails => entry !== undefined);
            this.target.showSelectionDetails({details, overrides, overridesRoot});
        } catch (error) {
            this.fail(error);
        }
    }

    private fail(error: unknown): void {
        if (this.stopped) return;
        if (error instanceof EditorClientClosedError) {
            this.stop();
            this.target.sessionClosed();
            return;
        }
        this.target.reportError(error);
    }
}

function sameEntities(a: readonly Entity[], b: readonly Entity[]): boolean {
    return a.length === b.length && a.every((entity, index) => entity === b[index]);
}
