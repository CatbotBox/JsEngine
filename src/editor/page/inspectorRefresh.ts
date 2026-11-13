import type {Entity} from "../../engine/core";
import type {EditorEntityDetails, EditorEntitySummary, EditorMode, EditorRequest, EditorResultOf} from "../editorProtocol";
import {EditorClientClosedError, EditorRequestError} from "./editorClient";

export interface EditorRequester {
    request<R extends EditorRequest>(request: R): Promise<EditorResultOf<R>>;
}

export interface InspectorRefreshViews {
    showEntities(entities: readonly EditorEntitySummary[]): void;

    showSelection(entity: Entity | undefined): void;

    showSelectedEntity(details: EditorEntityDetails | undefined): void;

    reportError(error: unknown): void;
}

export const ENTITY_LIST_POLL_INTERVAL_MS = 500;
export const SELECTED_ENTITY_PLAY_POLL_INTERVAL_MS = 100;

type IntervalHandle = ReturnType<typeof setInterval>;

class CoalescedRefresh {
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

export class InspectorRefresh {
    private mode: EditorMode = "edit";
    private selectedEntity: Entity | undefined;
    private editsStarted = 0;
    private editsInFlight = 0;
    private stopped = false;
    private timers: IntervalHandle[] = [];
    private readonly listRefresh = new CoalescedRefresh(() => this.refreshList());
    private readonly entityRefresh = new CoalescedRefresh(() => this.refreshSelected());

    public constructor(private readonly client: EditorRequester, private readonly views: InspectorRefreshViews) {
    }

    public get selected(): Entity | undefined {
        return this.selectedEntity;
    }

    public start(): void {
        if (this.stopped || this.timers.length > 0) return;
        this.timers = [
            setInterval(() => this.listRefresh.trigger(), ENTITY_LIST_POLL_INTERVAL_MS),
            setInterval(() => {
                if (this.mode === "play") this.entityRefresh.trigger();
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

    public select(entity: Entity | undefined): void {
        if (entity === this.selectedEntity) return;
        this.selectedEntity = entity;
        this.views.showSelection(entity);
        if (entity === undefined) this.views.showSelectedEntity(undefined);
        else this.entityRefresh.trigger();
    }

    public async edit<R extends EditorRequest>(request: R): Promise<EditorResultOf<R>> {
        this.editsStarted++;
        this.editsInFlight++;
        try {
            return await this.client.request(request);
        } finally {
            this.editsInFlight--;
            if (this.editsInFlight === 0) this.refreshAll();
        }
    }

    public refreshAll(): void {
        this.listRefresh.trigger();
        this.entityRefresh.trigger();
    }

    private isCurrent(generation: number): boolean {
        return !this.stopped && this.editsInFlight === 0 && generation === this.editsStarted;
    }

    private async refreshList(): Promise<void> {
        if (this.stopped) return;
        const generation = this.editsStarted;
        try {
            const {entities} = await this.client.request({op: "listEntities"});
            if (!this.isCurrent(generation)) return;
            this.views.showEntities(entities);
            const selected = this.selectedEntity;
            if (selected !== undefined && !entities.some(summary => summary.entity === selected)) this.select(undefined);
        } catch (error) {
            this.fail(error);
        }
    }

    private async refreshSelected(): Promise<void> {
        const entity = this.selectedEntity;
        if (this.stopped || entity === undefined) return;
        const generation = this.editsStarted;
        try {
            const details = await this.client.request({op: "getEntity", entity});
            if (this.isCurrent(generation) && entity === this.selectedEntity) this.views.showSelectedEntity(details);
        } catch (error) {
            if (!(error instanceof EditorRequestError)) this.fail(error);
            else if (this.isCurrent(generation) && entity === this.selectedEntity) this.select(undefined);
        }
    }

    private fail(error: unknown): void {
        if (this.stopped) return;
        if (error instanceof EditorClientClosedError) this.stop();
        this.views.reportError(error);
    }
}
