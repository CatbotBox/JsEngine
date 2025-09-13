import {AnyCT, IncU, RowFromSpec} from "../util/tokenUtils";
import {EntityArchetype} from "./entityArchetype";
import {EntityStreamOptions} from "./entityStream";
import type {Component} from "./component";
import {Entity} from "./entity";

export class EntityQueryStream<
  SpecTokens extends Record<string, AnyCT>,
  IncludeEntity extends boolean,
  Inc extends readonly AnyCT[],
  Exc extends readonly AnyCT[],
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
  private _plans:
    | {
    arch: EntityArchetype;
    cols: readonly (readonly Component[])[];
    colIndexes: number[]
  }[]
    | null = null;

  private _compilePlans(): void {
    if (this._plans) return;
    const plans: { arch: EntityArchetype; cols: readonly (Component[])[], colIndexes: number[] }[] = [];
    for (const arch of this.arches) {
      const colIndexes: number[] = [];
      const cols = this.keys.map((k, index) => {
        const token = this.spec[k as string] as AnyCT;
        const col = arch.getColumn(token)
        if (col !== undefined) {
          colIndexes.push(index)
        }
        return col as Component[];
      });
      plans.push({arch, cols, colIndexes});
    }
    this._plans = plans;
  }

  // private getIter(): Iterable<(RowFromSpec<SpecTokens, IncU<Inc>> & (IncludeEntity extends true ? {
  //   entity: Entity
  // } : {}))> {
  //   const self = this;
  //   return {
  //     * [Symbol.iterator]() {
  //       const includeEntity = !!self.options?.includeEntity;
  //       for (const arch of self.arches) {
  //         const body = {}
  //         self.keys.forEach((k, index) => {
  //           const token = self.spec[k as string] as AnyCT;
  //           const col = arch.getColumn(token)
  //         });
  //       }
  //     }
  //   }
  // }

  public forEach(
    cb: (
      row: RowFromSpec<SpecTokens, IncU<Inc>> &
        (IncludeEntity extends true ? { entity: Entity } : {})
    ) => void
  ): void {
    this._compilePlans();

    const includeEntity = this.options?.includeEntity;

    for (const {arch, cols, colIndexes} of this._plans!) {
      const n = this.options?.includeDisabled ? arch.entityCountUnfiltered : arch.entityCount;

      // Reuse one object per archetype to avoid allocations per entity.
      const row: any = {};

      for (let i = 0; i < n; i++) {
        if (includeEntity) row.entity = arch.getEntityAtIndex(i);

        // Fill fields straight from compiled columns

        colIndexes.forEach(k => {
          row[this.keys[k] as string] = cols[k][i];
        })

        cb(row);
      }
    }
  }

  // public collect(): (RowFromSpec<SpecTokens, IncU<Inc>> & (IncludeEntity extends true ? { entity: Entity } : {}))[] {
  //   const result: (RowFromSpec<SpecTokens, IncU<Inc>> & (IncludeEntity extends true ? {
  //     entity: Entity
  //   } : {}))[] = [];
  //   this.forEach(data => result.push(data));
  //   return result;
  // }

  /** A tiny lazy sequence wrapper over the fast forEach loop */
  private _rowsIterable(): Iterable<RowFromSpec<SpecTokens, IncU<Inc>> & (IncludeEntity extends true ? {
    entity: Entity
  } : {})> {
    const self = this;
    self._compilePlans();

    // Use a generator; rows are copied out as small plain objects to keep safety.
    // (If you need absolute zero per-yield alloc, prefer a dedicated consume(cb) API.)
    return {
      * [Symbol.iterator]() {
        const includeEntity = !!self.options?.includeEntity;
        for (const {arch, cols, colIndexes} of self._plans!) {
          const n = self.options?.includeDisabled ? arch.entityCountUnfiltered : arch.entityCount;
          for (let i = 0; i < n; i++) {
            const out: any = {};
            if (includeEntity) out.entity = arch.getEntityAtIndex(i);
            colIndexes.forEach(k => {
              out[self.keys[k] as string] = cols[k][i];
            });
            yield out;
          }
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
  toArray(): T[];
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

    toArray(): T[] {
      return Array.from(iterable);
    },

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