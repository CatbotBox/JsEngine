import {AnyCT, CompMap, RWRow, toTokens, toTokenSpec} from "../util/tokenUtils";
import {BLOCK_SHIFT, BLOCK_SIZE, ComponentStore, EntityArchetype} from "./entityArchetype";
import {EntityStreamOptions} from "./entityStreamOptions";
import type {Entity} from "./entity";

const FRESH_ROW_PER_ENTITY = false;
const REUSED_ROW = true;

export type ColumnSpan<K extends string> = {
    start: number;
    end: number;
    entities: readonly Entity[];
    cols: Record<K, Float32Array | undefined>;
    stores: Record<K, ComponentStore<AnyCT> | undefined>;
};

export const Unchanged: unique symbol = Symbol("Unchanged");

interface Plan {
    arch: EntityArchetype;
    readCols: ComponentStore<AnyCT>[];
    writeCols: ComponentStore<AnyCT>[];
    optCols: (ComponentStore<AnyCT> | undefined)[];
    watchCols: ComponentStore<AnyCT>[];
    visitEveryBlock: boolean;
    since: number;
}

export class EntityQueryStream<R extends CompMap, W extends CompMap, O extends CompMap, IncludeEntity extends boolean> {
    private readonly readKeys: string[];
    private readonly writeKeys: string[];
    private readonly readTokens: AnyCT[];
    private readonly writeTokens: AnyCT[];
    private readonly optionalKeys: string[];
    private readonly optionalTokens: AnyCT[];

    constructor(
        private arches: IterableIterator<EntityArchetype<AnyCT>>,
        spec: { read?: R; write?: W; optional?: O },
        private options?: EntityStreamOptions<IncludeEntity>,
    ) {
        const read = spec.read ? toTokenSpec(spec.read as Record<string, any>) : {};
        const write = spec.write ? toTokenSpec(spec.write as Record<string, any>) : {};
        this.readKeys = Object.keys(read);
        this.writeKeys = Object.keys(write);
        this.readTokens = this.readKeys.map(k => (read as any)[k]);
        this.writeTokens = this.writeKeys.map(k => (write as any)[k]);
        const optional = spec.optional ? toTokenSpec(spec.optional as Record<string, any>) : {};
        this.optionalKeys = Object.keys(optional);
        this.optionalTokens = this.optionalKeys.map(k => (optional as any)[k]);
    }

    private _plans: Plan[] | null = null;

    private plans(): Plan[] {
        if (this._plans) return this._plans;
        const plans: Plan[] = [];

        const lastUpdatedTimeRequirement = this.options?.filterLastUpdated as number;
        const filtering = this.options?.filterLastUpdated !== undefined;
        const blackList = this.options?.filterBlackList
            ? new Set<AnyCT>(toTokens(this.options.filterBlackList))
            : undefined;

        const additionsOnly = this.options?.structuralFilter === "additions";

        for (const arch of this.arches) {
            let skipped = filtering;
            let visitEveryBlock = !filtering;

            const structuralTime = additionsOnly ? arch.lastEntityAddedTime : arch.lastStructuralChangeTime;
            if (skipped && structuralTime >= lastUpdatedTimeRequirement) {
                skipped = false;
                if (!additionsOnly) visitEveryBlock = true;
            }

            const readCols: ComponentStore<AnyCT>[] = [];
            const writeCols: ComponentStore<AnyCT>[] = [];
            const watchCols: ComponentStore<AnyCT>[] = [];
            let missing = false;

            for (let k = 0; k < this.readTokens.length; k++) {
                const token = this.readTokens[k];
                const col = arch.getColumn(token);
                if (col === undefined) {
                    missing = true;
                    break;
                }
                readCols.push(col);
                if (!(blackList && blackList.has(token))) {
                    watchCols.push(col);
                    if (skipped && col.lastUpdatedTime >= lastUpdatedTimeRequirement) skipped = false;
                }
            }
            if (missing) continue;

            for (let k = 0; k < this.writeTokens.length; k++) {
                const token = this.writeTokens[k];
                const col = arch.getColumn(token);
                if (col === undefined) {
                    missing = true;
                    break;
                }
                writeCols.push(col);
                if (!(blackList && blackList.has(token))) {
                    watchCols.push(col);
                    if (skipped && col.lastUpdatedTime >= lastUpdatedTimeRequirement) skipped = false;
                }
            }
            if (missing) continue;

            const optCols: (ComponentStore<AnyCT> | undefined)[] = [];
            for (let k = 0; k < this.optionalTokens.length; k++) {
                const token = this.optionalTokens[k];
                const col = arch.getColumn(token);
                optCols.push(col);
                if (col !== undefined && !(blackList && blackList.has(token))) {
                    watchCols.push(col);
                    if (skipped && col.lastUpdatedTime >= lastUpdatedTimeRequirement) skipped = false;
                }
            }
            if (skipped) continue;

            plans.push({
                arch, readCols, writeCols, optCols, watchCols, visitEveryBlock,
                since: lastUpdatedTimeRequirement,
            });
        }
        this._plans = plans;
        return plans;
    }

    public count(): number {
        let count = 0;
        for (const {arch} of this.plans()) {
            count += this.options?.includeDisabled ? arch.entityCountIncludingDisabled : arch.enabledEntityCount;
        }
        return count;
    }

    public hasAny(): boolean {
        const includeDisabled = this.options?.includeDisabled;
        for (const {arch} of this.plans()) {
            if ((includeDisabled ? arch.entityCountIncludingDisabled : arch.enabledEntityCount) > 0) return true;
        }
        return false;
    }

    public forEach(cb: (row: RWRow<R, W, O, IncludeEntity>) => unknown): void {
        this.run(cb, FRESH_ROW_PER_ENTITY);
    }

    public consume(cb: (row: RWRow<R, W, O, IncludeEntity>) => unknown): void {
        this.run(cb, REUSED_ROW);
    }

    public consumeSpans(cb: (span: ColumnSpan<(keyof R | keyof W | keyof O) & string>) => unknown): void {
        const includeDisabled = !!this.options?.includeDisabled;
        const readKeys = this.readKeys, writeKeys = this.writeKeys, optKeys = this.optionalKeys;
        const span: ColumnSpan<string> = {
            start: 0, end: 0, entities: [],
            cols: {} as Record<string, Float32Array | undefined>,
            stores: {} as Record<string, ComponentStore<AnyCT> | undefined>,
        };
        const cols = span.cols, stores = span.stores;

        for (const {arch, readCols, writeCols, optCols, watchCols, visitEveryBlock, since} of this.plans()) {
            const n = includeDisabled ? arch.entityCountIncludingDisabled : arch.enabledEntityCount;
            if (n === 0) continue;
            const hasWrites = writeCols.length > 0;
            const stampTime = hasWrites ? performance.now() : 0;

            for (let k = 0; k < readKeys.length; k++) {
                cols[readKeys[k]] = readCols[k].f32Data;
                stores[readKeys[k]] = readCols[k];
            }
            for (let k = 0; k < writeKeys.length; k++) {
                cols[writeKeys[k]] = writeCols[k].f32Data;
                stores[writeKeys[k]] = writeCols[k];
            }
            for (let k = 0; k < optKeys.length; k++) {
                cols[optKeys[k]] = optCols[k]?.f32Data;
                stores[optKeys[k]] = optCols[k];
            }
            span.entities = arch.entityHandles;

            const singleSpan = visitEveryBlock && !hasWrites;
            const blocks = singleSpan ? 1 : (n + BLOCK_SIZE - 1) >> BLOCK_SHIFT;

            for (let b = 0; b < blocks; b++) {
                if (!visitEveryBlock) {
                    let dirty = false;
                    for (let k = 0; k < watchCols.length; k++) {
                        if (watchCols[k].blockChangedSince(b, since)) {
                            dirty = true;
                            break;
                        }
                    }
                    if (!dirty) continue;
                }

                const start = singleSpan ? 0 : b << BLOCK_SHIFT;
                span.start = start;
                span.end = singleSpan ? n : Math.min(start + BLOCK_SIZE, n);

                if (cb(span as ColumnSpan<(keyof R | keyof W | keyof O) & string>) !== Unchanged && hasWrites) {
                    for (let k = 0; k < writeCols.length; k++) writeCols[k].markBlockAt(start, stampTime);
                }
            }
        }
    }

    private run(cb: (row: any) => unknown, reuseRow: boolean): void {
        const includeEntity = !!this.options?.includeEntity;
        const includeDisabled = !!this.options?.includeDisabled;
        const readKeys = this.readKeys, writeKeys = this.writeKeys, optKeys = this.optionalKeys;
        const shared: any = reuseRow ? {} : undefined;

        for (const {arch, readCols, writeCols, optCols, watchCols, visitEveryBlock, since} of this.plans()) {
            const n = includeDisabled ? arch.entityCountIncludingDisabled : arch.enabledEntityCount;
            const hasWrites = writeCols.length > 0;
            const stampTime = hasWrites ? performance.now() : 0;

            const singleSpan = visitEveryBlock && !hasWrites;
            const blocks = singleSpan ? 1 : (n + BLOCK_SIZE - 1) >> BLOCK_SHIFT;

            for (let b = 0; b < blocks; b++) {
                if (!visitEveryBlock) {
                    let dirty = false;
                    for (let k = 0; k < watchCols.length; k++) {
                        if (watchCols[k].blockChangedSince(b, since)) {
                            dirty = true;
                            break;
                        }
                    }
                    if (!dirty) continue;
                }

                const start = singleSpan ? 0 : b << BLOCK_SHIFT;
                const end = singleSpan ? n : Math.min(start + BLOCK_SIZE, n);

                let anyRowWrote = false;

                for (let i = start; i < end; i++) {
                    const row: any = reuseRow ? shared : {};
                    if (includeEntity) row.entity = arch.getEntityAtIndex(i);
                    for (let k = 0; k < readKeys.length; k++) row[readKeys[k]] = readCols[k].get(i);
                    for (let k = 0; k < writeKeys.length; k++) row[writeKeys[k]] = writeCols[k].get(i);
                    for (let k = 0; k < optKeys.length; k++) row[optKeys[k]] = optCols[k]?.get(i);
                    if (cb(row) !== Unchanged) anyRowWrote = true;
                }

                if (anyRowWrote && hasWrites) {
                    for (let k = 0; k < writeCols.length; k++) writeCols[k].markBlockAt(start, stampTime);
                }
            }
        }
    }
}
