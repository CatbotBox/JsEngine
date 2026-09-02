import {AnyCT, CompMap, RWRow, toTokens, toTokenSpec} from "../util/tokenUtils";
import {BLOCK_SHIFT, BLOCK_SIZE, ComponentStore, EntityArchetype} from "./entityArchetype";
import {EntityStreamOptions} from "./entityStreamOptions";
import type {Entity} from "./entity";

/**
 * What `consumeSpans` hands its callback: raw column access for a contiguous run
 * of rows. This is the SoA hot path — no per-entity object is ever created.
 *
 * For each key of the stream's read/write/optional spec:
 *  - `cols[key]` is the raw Float32Array column when that component type is
 *    column-backed (`static f32Width`), else undefined. Entity at row i has its
 *    floats at [i*width, (i+1)*width) — the width is the component class's
 *    static, known to the caller.
 *  - `stores[key]` is the ComponentStore (instance access via .get(i)) — the
 *    fallback for object-backed components; undefined for an absent optional.
 *
 * The object is REUSED across spans, and the column references are only valid
 * until the next structural change — never keep either beyond the callback.
 */
export type ColumnSpan<K extends string> = {
    /** first row of the span (inclusive) */
    start: number;
    /** last row of the span (exclusive) */
    end: number;
    /** dense handle array parallel to the columns: row i is entities[i] */
    entities: readonly Entity[];
    cols: Record<K, Float32Array | undefined>;
    stores: Record<K, ComponentStore<AnyCT> | undefined>;
};

/**
 * Returned from a stream callback to declare that the entity was not written, so
 * the declared `write` columns should not be stamped. See {@link EntityQueryStream}.
 */
export const Unchanged: unique symbol = Symbol("Unchanged");

interface Plan {
    arch: EntityArchetype;
    readCols: ComponentStore<AnyCT>[];
    writeCols: ComponentStore<AnyCT>[];
    optCols: (ComponentStore<AnyCT> | undefined)[];
    /**
     * Columns whose block timestamps decide whether a block is worth visiting:
     * every non-blacklisted read/write/optional column this plan touches.
     */
    watchCols: ComponentStore<AnyCT>[];
    /** Iterate everything, ignoring block timestamps. See plans(). */
    forceAll: boolean;
    /** Cached `filterLastUpdated`, so run() does not re-read options per archetype. */
    since: number;
}

/**
 * Iterates the archetypes matching a query, handing each entity's components to a
 * callback.
 *
 * READ/WRITE IS DECLARED, NOT INTERCEPTED. The previous implementation wrapped
 * every component of every row in a `Proxy` so that property sets could mark the
 * column dirty. That cost ~0.81 ms per 30k proxies, made change-tracking a runtime
 * side effect, and broke outright on components using `#private` fields (the proxy
 * is not the target, so private access throws).
 *
 * Now the caller says what it intends:
 *
 *     query.stream({
 *         read:  {pos: LocalPosition},
 *         write: {bounds: WorldSpaceRenderBounds},
 *     })
 *
 * `read` components come back `DeepReadonly` — including their `Vec` fields, which
 * become `ReadonlyVec` so `Vec.setX(row.pos.xyz, 5)` is a compile error. `write`
 * components come back mutable, and their columns are stamped once per archetype
 * after iteration. Measured 5-11x faster than the proxy version.
 *
 * TWO DELIVERY MODES, same types:
 *   forEach  — a fresh row object per entity. Safe to keep the row.
 *   consume  — ONE row object reused for every entity. ~1.6x faster at width 1;
 *              the row must not escape the callback.
 *
 * OPTING OUT OF THE STAMP. A callback may `return Unchanged` to say "I wrote
 * nothing for this entity". If *every* entity in an archetype does, the write
 * columns are not stamped, so systems downstream of them stay skipped. Returning
 * anything else — including `undefined`, i.e. a plain `return;` or falling off the
 * end — counts as a write, so this is opt-in and the default stays conservative.
 *
 * It is a symbol rather than `false` on purpose: callbacks are routinely written as
 * concise arrows whose value is incidental (`() => n++`, `() => set.delete(k)`), and
 * a `false` sentinel would both reject the first at compile time and silently
 * swallow the second's stamp at runtime.
 *
 * This exists because derived-data systems recompute a value that is usually
 * identical to the one already stored. Stamping unconditionally turned "the fade
 * changed a pixel's colour" into a full recompute of bounds for every entity in
 * the archetype, every frame, plus everything downstream of *those* columns.
 * Granularity is still per-archetype: one entity with real work stamps the column
 * for all of them, which is conservative in the right direction.
 */
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

    /** Compiled per-archetype column pointers. Built once, on first use. */
    private _plans: Plan[] | null = null;

    private plans(): Plan[] {
        if (this._plans) return this._plans;
        const plans: Plan[] = [];

        const lastUpdatedTimeRequirement = this.options?.filterLastUpdated as number;
        const filtering = this.options?.filterLastUpdated !== undefined;
        const blackList = this.options?.filterBlackList
            ? new Set<AnyCT>(toTokens(this.options.filterBlackList))
            : undefined;

        // "additions" systems only care that an entity appeared; a removal leaves
        // every survivor's data intact (swap-remove moves all columns together).
        const additionsOnly = this.options?.structuralFilter === "additions";

        for (const arch of this.arches) {
            let skipped = filtering;
            // forceAll starts true when not filtering at all: there is nothing to
            // consult, so every block is visited.
            let forceAll = !filtering;

            const structuralTime = additionsOnly ? arch.lastEntityAddedTime : arch.lastStructuralChangeTime;
            if (skipped && structuralTime >= lastUpdatedTimeRequirement) {
                skipped = false;
                // In "any" mode a removal swap-moves a surviving entity's data down
                // into a lower index without stamping the block it landed in, so block
                // timestamps cannot be trusted for this pass. "additions" mode is safe:
                // appends stamp their own tail block via ComponentStore.add().
                if (!additionsOnly) forceAll = true;
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

            // Optional columns may legitimately be absent; the archetype still matches
            // and the row property is undefined there.
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
            // Whole-archetype reject: nothing this plan watches has moved at all.
            if (skipped) continue;

            plans.push({
                arch, readCols, writeCols, optCols, watchCols, forceAll,
                since: lastUpdatedTimeRequirement,
            });
        }
        this._plans = plans;
        return plans;
    }

    public count(): number {
        let count = 0;
        for (const {arch} of this.plans()) {
            count += this.options?.includeDisabled ? arch.entityCountUnfiltered : arch.entityCount;
        }
        return count;
    }

    /**
     * A fresh row object per entity. Rows may be kept beyond the callback.
     *
     * Return `Unchanged` to declare that this entity was not written; see the class
     * comment. Any other return value (including none) counts as a write.
     */
    public forEach(cb: (row: RWRow<R, W, O, IncludeEntity>) => unknown): void {
        this.run(cb, false);
    }

    /**
     * One row object reused for every entity — faster, but the row must not
     * escape the callback. Prefer this on per-frame paths.
     *
     * Return `Unchanged` to declare that this entity was not written; see the class
     * comment. Any other return value (including none) counts as a write.
     */
    public consume(cb: (row: RWRow<R, W, O, IncludeEntity>) => unknown): void {
        this.run(cb, true);
    }

    /**
     * The column delivery mode: instead of a
     * row per entity, the callback receives ONE reused {@link ColumnSpan} per
     * dirty block — raw Float32Array columns plus a [start, end) row range — and
     * loops over rows itself, e.g.
     *
     *     stream.consumeSpans(({start, end, cols}) => {
     *         const pos = cols.position!;             // width 3
     *         for (let i = start; i < end; i++) pos[i * 3] += 1;
     *     });
     *
     * This shape measured 4-20x the row path: columns
     * hoisted into locals, sequential access, no per-entity object anywhere.
     * Block filtering, the write stamp, and `Unchanged` all behave as in
     * consume(), except Unchanged is judged per span, not per entity: return it
     * to leave that whole span's write columns unstamped.
     */
    public consumeSpans(cb: (span: ColumnSpan<(keyof R | keyof W | keyof O) & string>) => unknown): void {
        const includeDisabled = !!this.options?.includeDisabled;
        const readKeys = this.readKeys, writeKeys = this.writeKeys, optKeys = this.optionalKeys;
        const span: ColumnSpan<string> = {
            start: 0, end: 0, entities: [],
            cols: {} as Record<string, Float32Array | undefined>,
            stores: {} as Record<string, ComponentStore<AnyCT> | undefined>,
        };
        const cols = span.cols, stores = span.stores;

        for (const {arch, readCols, writeCols, optCols, watchCols, forceAll, since} of this.plans()) {
            const n = includeDisabled ? arch.entityCountUnfiltered : arch.entityCount;
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

            // Same span/block strategy as run(); see the comments there.
            const singleSpan = forceAll && !hasWrites;
            const blocks = singleSpan ? 1 : (n + BLOCK_SIZE - 1) >> BLOCK_SHIFT;

            for (let b = 0; b < blocks; b++) {
                if (!forceAll) {
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

    private run(cb: (row: any) => unknown, reuse: boolean): void {
        const includeEntity = !!this.options?.includeEntity;
        const includeDisabled = !!this.options?.includeDisabled;
        const readKeys = this.readKeys, writeKeys = this.writeKeys, optKeys = this.optionalKeys;
        const shared: any = reuse ? {} : undefined;

        for (const {arch, readCols, writeCols, optCols, watchCols, forceAll, since} of this.plans()) {
            const n = includeDisabled ? arch.entityCountUnfiltered : arch.entityCount;
            const hasWrites = writeCols.length > 0;
            // Read once per archetype, not once per block: a 40k column is 313 blocks,
            // and stamping slightly early is safe because any consumer's own
            // lastUpdateTime is older still.
            const stampTime = hasWrites ? performance.now() : 0;

            // A pass that visits every block anyway AND has nothing to stamp can run as
            // one long loop instead of ceil(n/128) short ones.
            //
            // The `!hasWrites` half is the whole point. Collapsing *any* forceAll pass
            // was tried and reverted: forceAll is also true for a stream with no filter,
            // and a single span can only stamp whole columns, so every unfiltered write
            // woke its entire archetype next frame -- the exact problem blocks solve.
            // With no write columns there is no stamp to coarsen, so it is free.
            const singleSpan = forceAll && !hasWrites;
            const blocks = singleSpan ? 1 : (n + BLOCK_SIZE - 1) >> BLOCK_SHIFT;

            for (let b = 0; b < blocks; b++) {
                // Block-level reject. An archetype of 21k entities is ~170 blocks, so a
                // few hundred arrivals leave ~166 of them untouched and unvisited.
                if (!forceAll) {
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

                // Stays false only if every callback in this block returned `Unchanged`.
                let wrote = false;

                for (let i = start; i < end; i++) {
                    const row: any = reuse ? shared : {};
                    if (includeEntity) row.entity = arch.getEntityAtIndex(i);
                    for (let k = 0; k < readKeys.length; k++) row[readKeys[k]] = readCols[k].get(i);
                    for (let k = 0; k < writeKeys.length; k++) row[writeKeys[k]] = writeCols[k].get(i);
                    for (let k = 0; k < optKeys.length; k++) row[optKeys[k]] = optCols[k]?.get(i);
                    if (cb(row) !== Unchanged) wrote = true;
                }

                // Declarative change tracking: the caller said it would write these, so
                // stamp them -- per block, not per column, so a write here does not wake
                // the rest of the archetype next frame.
                if (wrote && hasWrites) {
                    for (let k = 0; k < writeCols.length; k++) writeCols[k].markBlockAt(start, stampTime);
                }
            }
        }
    }
}
