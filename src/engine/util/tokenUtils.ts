import {Component, type ComponentCtor, ComponentType} from "../core/component";
import {Entity} from "../core/entity";
import {ReadonlyVec, Vec} from "../math/types/vec";

export type AnyCT = ComponentType<any>;
export type AnyCtor = abstract new (...args: any[]) => any;
type CtorOfToken<T> = T extends ComponentType<infer C> ? (abstract new (...a: any[]) => C) : never;
export type TokenSpec = Record<string, AnyCT>;
export type CtorSpec = Record<string, AnyCtor>;
type Tokenize<V> =
  V extends ComponentType<infer _C> ? V :
    V extends AnyCtor ? ComponentType<InstanceType<V>> :
      never;
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

export type IncU<Inc extends readonly AnyCT[]> = Inc[number];
export type RowFromSpec<M, Sel> = {
    [K in keyof M as M[K] extends Sel ? K : never]-?: InstanceType<CtorOfToken<M[K]>>;
} & {
    [K in keyof M as M[K] extends Sel ? never : K]?: InstanceType<CtorOfToken<M[K]>>;
};

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

export type InstanceOfEntry<V> =
    V extends ComponentType<infer C> ? C :
        V extends abstract new (...a: any[]) => infer I ? I :
            never;

export type DeepReadonly<T> =
    T extends Vec<infer N> ? ReadonlyVec<N> :
        T extends Entity ? T :
            T extends (...a: any[]) => any ? T :
                T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } :
                    T;

export type CompMap = Record<string, TokenOrCtor>;

export interface RWSpec<R extends CompMap = CompMap, W extends CompMap = CompMap, O extends CompMap = CompMap> {
    read?: R;
    write?: W;
    optional?: O;
}

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