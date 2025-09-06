// import {Component, ComponentCtor, ComponentType} from "../core/component";
//
// type AnyCT = ComponentType<any>;
// type CtorSpec = Record<string, ComponentCtor<Component>>;
//
// // Map ctor-spec labels to their ComponentType tokens
// export type SpecFromCtors<C extends CtorSpec> = {
//   [K in keyof C]: ComponentType<InstanceType<C[K]>>;
// };
//
// // Build the token spec at runtime, with type preserved
// export function specFromCtors<C extends CtorSpec>(ctors: C): SpecFromCtors<C> {
//   const out: any = {};
//   for (const k of Object.keys(ctors) as (keyof C)[]) {
//     out[k] = ComponentType.of(ctors[k] as any);
//   }
//   return out as SpecFromCtors<C>;
// }
