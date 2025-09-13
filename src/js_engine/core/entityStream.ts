import type {ComponentType} from "./component";
import {AnyCT} from "../util/tokenUtils";


export type ComponentFrom<T extends ComponentType<any>> =
  T extends ComponentType<infer C> ? C : never;

export type EntityStreamRow<Spec extends Record<string, AnyCT>> = {
  [K in keyof Spec]: ComponentFrom<Spec[K]>;
};

export interface EntityStreamOptions<Include extends boolean = false> {
  includeEntity: Include; // default: false
  includeDisabled?: boolean; // default: false
}

// export class EntityStream<
//   Spec extends Record<string, AnyCT>,
//   Include extends boolean = false
// > {
//   private query: EntityQuery<readonly AnyCT[], readonly AnyCT[]>;
//   private keys: (keyof Spec)[];
//   private includeEntity: Include;
//
//   constructor(
//     world: World,
//     private spec: Spec,
//     exclude?: readonly AnyCT[],
//     options?: EntityStreamOptions<Include>
//   ) {
//     const include = Object.values(spec) as readonly AnyCT[];
//     this.query = new EntityQuery(world, include, exclude ?? []);
//     this.keys = Object.keys(spec) as (keyof Spec)[];
//     // default: false
//     this.includeEntity = (options?.includeEntity ?? (false as Include)) as Include;
//   }
//
//   public forEach(
//     cb: (row: EntityStreamRow<Spec> & (Include extends true ? { entity: Entity } : {})) => void
//   ): void {
//     for (const arch of this.query.archtypes as EntityArchtype<AnyCT>[]) {
//       const n = arch.entityCount;
//       for (let i = 0; i < n; i++) {
//         const data = arch.getDataAtIndex(i) as Map<AnyCT, ComponentOf<AnyCT>>;
//         const row: any = {};
//
//         if (this.includeEntity) row.entity = arch.getEntityAtIndex(i);
//
//         for (const k of this.keys) {
//           const token = this.spec[k] as AnyCT;
//           row[k as string] = data.get(token);
//         }
//         cb(row);
//       }
//     }
//   }
// }
