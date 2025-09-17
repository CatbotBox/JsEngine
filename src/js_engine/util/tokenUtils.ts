// Helper types (put near your System/EntityManager helpers)
import {Component, type ComponentCtor, ComponentType} from "../core/component";

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

export type ToToken<T> =
  T extends ComponentType<infer _C> ? T :
    T extends ComponentCtor<infer C> ? ComponentType<C> :
      never;

export type ToTokens<L extends readonly TokenOrCtor[]> = { [K in keyof L]: ToToken<L[K]> };