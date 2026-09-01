// Helper types (put near your System/EntityManager helpers)
import {Component, type ComponentCtor, ComponentType} from "../core/component";
import {Entity} from "../core/entity";
import {ReadonlyVec, Vec} from "../math/types/vec";

export type AnyCT = ComponentType<any>;
export type AnyCtor = abstract new (...args: any[]) => any;   // <- broad ctor
type CtorOfToken<T> = T extends ComponentType<infer C> ? (abstract new (...a: any[]) => C) : never;
// Token spec vs ctor spec
export type TokenSpec = Record<string, AnyCT>;
export type CtorSpec = Record<string, AnyCtor>;
type Tokenize<V> =
  V extends ComponentType<infer _C> ? V :
    V extends AnyCtor ? ComponentType<InstanceType<V>> :
      never;
// Map ctors -> tokens (labels preserved)
export type TokensFrom<S> =
  S extends TokenSpec ? S :
    S extends CtorSpec ? {
        [K in keyof S]:
        S[K] extends abstract new (...a: any[]) => infer I
          ? I extends Component ? ComponentType<I> : never
          : never
      }
      : never;

export type TupleToUnion<T extends readonly any[]> = T[number];
export type TokensOfList<L extends readonly TokenOrCtor[]> = { [K in keyof L]: Tokenize<L[K]> };

// unions out of your query’s Inc/Exc tuple generics
export type IncU<Inc extends readonly AnyCT[]> = Inc[number];
// compile-time block: if any label’s token is in Exc, make its property export type `never` → causes error
export type RowFromSpec<M, Sel> = {
    [K in keyof M as M[K] extends Sel ? K : never]-?: InstanceType<CtorOfToken<M[K]>>;
} & {
    [K in keyof M as M[K] extends Sel ? never : K]?: InstanceType<CtorOfToken<M[K]>>;
};

// Runtime helpers
const isCtor = (v: unknown): v is AnyCtor => typeof v === "function";
export function toTokenSpec<S extends Record<string, TokenOrCtor>>(specOrCtors: S): TokensFrom<S> {
  const out: any = {};
  for (const k in specOrCtors) {
    const v = specOrCtors[k];
    out[k] = isCtor(v) ? ComponentType.of(v) : v;
  }
  return out as TokensFrom<S>;
}

export function toTokens(list: readonly TokenOrCtor[] = []): readonly AnyCT[] {
  return list.map(v => isCtor(v) ? ComponentType.of(v) : v);
}


export type TokenOrCtor = AnyCT | ComponentCtor<Component>;

// ---------------------------------------------------------------------------
// Read/write query specs
// ---------------------------------------------------------------------------

/** The instance type a token-or-constructor refers to. */
export type InstanceOfEntry<V> =
    V extends ComponentType<infer C> ? C :
        V extends abstract new (...a: any[]) => infer I ? I :
            never;

/**
 * Deeply readonly, with one special case: a mutable `Vec<N>` becomes a
 * `ReadonlyVec<N>`.
 *
 * Without that case a "read-only" component would still be writable through its
 * vector fields — `Vec` is opaque, so plain `Readonly<T>` cannot stop
 * `Vec.setX(row.pos.xyz, 5)`. Functions are passed through untouched so methods
 * still typecheck.
 */
export type DeepReadonly<T> =
    T extends Vec<infer N> ? ReadonlyVec<N> :
        // An Entity is a branded number — a value, immutable by nature. Without
        // this case the brand intersection falls into the object branch and maps
        // over number's method surface, which is no longer an Entity.
        T extends Entity ? T :
            T extends (...a: any[]) => any ? T :
                T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } :
                    T;

/** A query spec that declares intent: reads come back frozen, writes mutable. */
export type CompMap = Record<string, TokenOrCtor>;

export interface RWSpec<R extends CompMap = CompMap, W extends CompMap = CompMap, O extends CompMap = CompMap> {
    read?: R;
    write?: W;
    /**
     * Components that may or may not be present. Archetypes missing them still
     * match, and the row property is `undefined` there. Read-only, like `read` —
     * a component you are not sure exists is not one you should be writing.
     */
    optional?: O;
}

/**
 * The row handed to forEach/consume. R and W are inferred separately at the call
 * site rather than pulled out of one spec type — indexing an optional property
 * widens it to include `undefined`, which collapses the whole row to `{}`.
 */
export type RWRow<R extends CompMap, W extends CompMap, O extends CompMap, IncludeEntity extends boolean> =
    { readonly [K in keyof R]: DeepReadonly<InstanceOfEntry<R[K]>> }
    & { [K in keyof W]: InstanceOfEntry<W[K]> }
    & { readonly [K in keyof O]: DeepReadonly<InstanceOfEntry<O[K]>> | undefined }
    & (IncludeEntity extends true ? { entity: Entity } : {});

export type ToToken<T> =
  T extends ComponentType<infer _C> ? T :
    T extends ComponentCtor<infer C> ? ComponentType<C> :
      never;

export type ToTokens<L extends readonly TokenOrCtor[]> = { [K in keyof L]: ToToken<L[K]> };