import {AnyCT, IncU, RowFromSpec, toTokens} from "../util/tokenUtils";
import {ComponentStore, EntityArchetype} from "./entityArchetype";
import {EntityStreamOptions} from "./entityStream";
import {Entity} from "./entity";
import {Component} from "./component";

export class EntityQueryStream<
    SpecTokens extends Record<string, AnyCT>,
    IncludeEntity extends boolean,
    Inc extends readonly AnyCT[],
> {
    private readonly keys: (keyof SpecTokens)[];

    constructor(
        private arches: IterableIterator<EntityArchetype<AnyCT>>,
        private spec: SpecTokens,
        private options?: EntityStreamOptions<IncludeEntity>
    ) {
        this.keys = Object.keys(spec) as (keyof SpecTokens)[];
    }


    /** Compiled, per-arch pointers to the concrete columns you need */
    private _streamResult:
        | {
        arch: EntityArchetype;
        cols: readonly ComponentStore<AnyCT>[];
        colIndexes: number[]
    }[]
        | null = null;

    private prepStreamResult(): {
        arch: EntityArchetype;
        cols: readonly ComponentStore<AnyCT>[];
        colIndexes: number[]
    }[] {
        if (this._streamResult) return this._streamResult;
        const plans: { arch: EntityArchetype; cols: readonly ComponentStore<AnyCT>[], colIndexes: number[] }[] = [];

        const lastUpdatedTimeRequirement = this.options?.filterLastUpdated as number;
        const blackList = this.options?.filterBlackList ? new Set<AnyCT>(toTokens(this.options.filterBlackList)) : undefined;

        for (const arch of this.arches) {
            const colIndexes: number[] = [];
            // only attempt to skip if specified in options
            let skipped = this.options?.filterLastUpdated !== undefined;

            // dont skip if structural change detected
            if (skipped && arch.lastStructuralChangeTime >= lastUpdatedTimeRequirement) {
                skipped = false
            }

            const cols = this.keys.map((k, index) => {
                const token = this.spec[k as string] as AnyCT;
                const col = arch.getColumn(token)
                if (col !== undefined) {
                    colIndexes.push(index)

                    // don't skip if component store has a change
                    if (skipped && !(blackList && blackList.has(token)) && col.lastUpdatedTime >= lastUpdatedTimeRequirement) {
                        skipped = false
                    }
                }
                return col!;
            });
            if (!skipped) plans.push({arch, cols, colIndexes});
        }
        this._streamResult = plans;
        return this._streamResult;
    }

    public count() {
        const data = this.prepStreamResult()
        let count = 0;
        for (const {arch} of data) {
            count += this.options?.includeDisabled ? arch.entityCountUnfiltered : arch.entityCount;
        }
        return count;
    }

    public forEach(
        cb: (
            row: RowFromSpec<SpecTokens, IncU<Inc>> &
                (IncludeEntity extends true ? { entity: Entity } : {})
        ) => void
    ): void {
        const base = this._rowsIterable();
        for (const row of base) {
            cb(row);
        }
    }

    /** A tiny lazy sequence wrapper over the fast forEach loop */
    private _rowsIterable(): Iterable<RowFromSpec<SpecTokens, IncU<Inc>> & (IncludeEntity extends true ? {
        entity: Entity
    } : {})> {
        const self = this;
        const streamResults = self.prepStreamResult();

        const updatedColFlags: boolean[] = new Array(this.keys.length);
        const callbacks = this.keys.map((_, k) => (() => updatedColFlags[k] = true))

        // Use a generator; rows are copied out as small plain objects to keep safety.
        // (If you need absolute zero per-yield alloc, prefer a dedicated consume(cb) API.)
        return {
            * [Symbol.iterator]() {
                const includeEntity = !!self.options?.includeEntity;
                for (const {arch, cols, colIndexes} of streamResults) {
                    const n = self.options?.includeDisabled ? arch.entityCountUnfiltered : arch.entityCount;
                    // get time in the middle in case another system runs in the middle of this one (unlikely)
                    const time = performance.now();
                    for (let i = 0; i < n; i++) {
                        const out: any = {};
                        if (includeEntity) out.entity = arch.getEntityAtIndex(i);
                        colIndexes.forEach(k => {
                            out[self.keys[k] as string] = Component.track(cols[k].get(i), callbacks[k]);
                        })

                        yield out;
                    }

                    // set respective columns to dirty
                    updatedColFlags.forEach((value, index) => {
                        if (!value) return;
                        cols[index].lastUpdatedTime = time;
                    })

                    // reset flags
                    updatedColFlags.fill(false)
                }
            },
        };
    }

    /** Lazy sequence with array-like ops; does not need to return an Array */
    public collect(): LazySeq<RowFromSpec<SpecTokens, IncU<Inc>> & (IncludeEntity extends true ? {
        entity: Entity
    } : {})> {
        // NB: If _rowsIterable() returns a one-shot generator, multiple passes will consume it.
        // That matches your original behavior. If you need multi-pass safety, wrap with Array.from().
        const base = this._rowsIterable();

        // Build the root LazySeq from the base iterable
        return fromIterable(base);
    }
}

// Define the lazy sequence interface
type LazySeq<T> = Iterable<T> & {
    [Symbol.iterator](): IterableIterator<T>;
    map<U>(fn: (item: T, idx: number) => U): LazySeq<U>;
    filter(pred: (item: T, idx: number) => boolean): LazySeq<T>;
    reduce<U>(reducer: (acc: U, item: T, idx: number) => U, init: U): U;
    forEach(cb: (item: T, idx: number) => void): void;
    // toArray(): T[];
    toString(): string;
};

function fromIterable<T>(iterable: Iterable<T>): LazySeq<T> {
    const formatVal = (v: unknown): string => {
        if (typeof v === "string") return JSON.stringify(v);
        if (v === null || v === undefined) return String(v);
        if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
        try {
            const json = JSON.stringify(v);
            return json ?? String(v);
        } catch {
            return Object.prototype.toString.call(v);
        }
    };

    return {
        [Symbol.iterator]: function* () {
            yield* iterable;
        },

        map<U>(fn: (item: T, idx: number) => U): LazySeq<U> {
            const src = iterable;
            return fromIterable<U>((function* () {
                let i = 0;
                for (const x of src) yield fn(x, i++);
            })());
        },

        filter(pred: (item: T, idx: number) => boolean): LazySeq<T> {
            const src = iterable;
            return fromIterable<T>((function* () {
                let i = 0;
                for (const x of src) if (pred(x, i++)) yield x;
            })());
        },

        reduce<U>(reducer: (acc: U, item: T, idx: number) => U, init: U): U {
            let acc = init, i = 0;
            for (const x of iterable) acc = reducer(acc, x, i++);
            return acc;
        },

        forEach(cb: (item: T, idx: number) => void): void {
            let i = 0;
            for (const x of iterable) cb(x, i++);
        },

        // toArray(): T[] {
        //   return Array.from(iterable);
        // },

        toString(): string {
            // Safely preview if the source is re-iterable (new iterator each call).
            const getIt = (iterable as any)?.[Symbol.iterator];
            const canIterate =
                typeof getIt === "function" &&
                (() => {
                    try {
                        const a = getIt.call(iterable);
                        const b = getIt.call(iterable);
                        // Re-iterable sources (Array, Set, Map, etc.) produce distinct iterators.
                        // One-shot iterators (generators) usually return themselves.
                        return a && b && a !== b && a !== iterable && b !== iterable;
                    } catch {
                        return false;
                    }
                })();

            if (!canIterate) return "LazySeq(<unpreviewable source>)";

            const PREVIEW = 10;
            const items: string[] = [];
            let i = 0;
            for (const x of iterable) {
                items.push(formatVal(x));
                if (++i >= PREVIEW) break;
            }
            const more = i >= PREVIEW ? "…" : "";
            return `LazySeq(${items.join(", ")}${more})`;
        },
    };
}