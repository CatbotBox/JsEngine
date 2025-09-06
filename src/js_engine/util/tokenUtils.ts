// Helper types (put near your System/EntityManager helpers)
import {Component, type ComponentCtor, ComponentType as CT, ComponentType} from "../core/component";

export type AnyCT = ComponentType<any>;
export type AnyCtor = abstract new (...args: any[]) => any;   // <- broad ctor
type CtorOfToken<T> = T extends ComponentType<infer C> ? (abstract new (...a: any[]) => C) : never;
type ExcCtors<Exc extends readonly AnyCT[]> = CtorOfToken<ExcU<Exc>>;
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
export type ExcU<Exc extends readonly AnyCT[]> = Exc[number];
export type DisallowExcludedByToken<S, ExcUnion> = {
  [K in keyof S]: Tokenize<S[K]> extends ExcUnion ? never : S[K];
};
export type DisallowExcluded<S, Exc extends readonly AnyCT[]> = {
  [K in keyof S]:
  S[K] extends AnyCtor
    ? (S[K] extends ExcCtors<Exc> ? never : S[K])
    : S[K] extends AnyCT
      ? (S[K] extends ExcU<Exc> ? never : S[K])
      : never;
};
// compile-time block: if any label’s token is in Exc, make its property export type `never` → causes error
export type NotExcludedTokens<SpecTokens extends TokenSpec, ExcUnion> = {
  [K in keyof SpecTokens]: SpecTokens[K] extends ExcUnion ? never : SpecTokens[K]
};

type MapToComponentTypes<T extends readonly CT[]> = {
  [K in keyof T]: ComponentType<T[K]>;
};
//todo not working
export type RowFromSpec<
  S,                // ctor/token spec provided to stream(...)
  IncludeUnion     // union of included tokens from the query
> =
// required keys
  {
    [K in keyof S as Tokenize<S[K]> extends IncludeUnion ? K : never]:
    Tokenize<S[K]> extends ComponentType<infer C> ? C : never
  } &
  // optional keys
  {
    [K in keyof S as Tokenize<S[K]> extends IncludeUnion ? never : K]?:
    Tokenize<S[K]> extends ComponentType<infer C> ? C : never
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