// import {type Component, type ComponentCtor, ComponentType as CT, ComponentType} from "./component";
// import { EntityArchtype } from "./entityArchtype";
// import { World } from "./world";
// import {Entity} from "./entity";
// import {EntityStreamOptions, EntityStreamRow} from "./entityStream";
//
// type AnyCT = ComponentType<any>;
// type TupleToUnion<T extends readonly any[]> = T[number];
//
// type TokenSpec = Record<string, AnyCT>;
// type CtorSpec  = Record<string, ComponentCtor<Component>>;
//
// // Map ctor-spec to token-spec (labels preserved)
// type TokensFrom<S> =
//   S extends TokenSpec ? S :
//     S extends CtorSpec  ? { [K in keyof S]: ComponentType<InstanceType<S[K]>> } :
//       never;
// type TokenOrCtor = AnyCT | ComponentCtor<Component>;
//
// function toTokens(list?: readonly TokenOrCtor[]): readonly AnyCT[] {
//   if (!list || list.length === 0) return [];
//   return list.map(item =>
//     typeof item === "function"
//       ? CT.of(item as ComponentCtor<Component>)
//       : (item as AnyCT)
//   );
// }
//
// type RowFrom<S> = EntityStreamRow<TokensFrom<S>>;
//
// // runtime converter (ctors -> tokens), tokens pass through
// function toTokenSpec<S extends TokenSpec | CtorSpec>(specOrCtors: S): TokensFrom<S> {
//   const entries = Object.entries(specOrCtors);
//   const firstVal = entries[0]?.[1];
//
//   // if first value is a function, assume ctor-spec; otherwise token-spec
//   if (typeof firstVal === "function") {
//     const out: any = {};
//     for (const [k, ctor] of entries as [string, ComponentCtor<Component>][]) {
//       out[k] = CT.of(ctor);
//     }
//     return out as TokensFrom<S>;
//   }
//   return specOrCtors as unknown as TokensFrom<S>;
// }
//
// function hasAll<CT extends AnyCT>(arch: EntityArchtype<CT>, required: readonly CT[]): boolean {
//   const have = new Set(arch.componentTypes as readonly CT[]);
//   for (const t of required) if (!have.has(t)) return false;
//   return true;
// }
// function hasNone<CT extends AnyCT>(arch: EntityArchtype<CT>, excluded: readonly CT[]): boolean {
//   const have = new Set(arch.componentTypes as readonly CT[]);
//   for (const t of excluded) if (have.has(t)) return false;
//   return true;
// }
//
// export class EntityQuery<
//   Inc extends readonly AnyCT[] = readonly AnyCT[],
//   Exc extends readonly AnyCT[] = readonly AnyCT[],
// > {
//   private _include: readonly TupleToUnion<Inc>[] = [] as const;
//   private _exclude: readonly TupleToUnion<Exc>[] = [] as const;
//   private _cachedArchtypes: EntityArchtype<AnyCT>[] = [];
//
//   constructor(private _world: World, include: Inc, exclude?: Exc) {
//     this._include = include;
//     this._exclude = exclude ?? ([] as unknown as Exc);
//     this.refreshCache();
//     this._world.archtypes.onCreateArchtype.add(this.onArchtypeCreated);
//   }
//
//   // public setInclude(next: Inc): void { this._include = next; this.refreshCache(); }
//   // public setExclude(next: Exc): void { this._exclude = next; this.refreshCache(); }
//   // public setFilters(include: Inc, exclude?: Exc): void {
//   //   this._include = include; this._exclude = exclude ?? ([] as unknown as Exc); this.refreshCache();
//   // }
//
//   public get include(): readonly TupleToUnion<Inc>[] { return this._include; }
//   public get exclude(): readonly TupleToUnion<Exc>[] { return this._exclude; }
//   public get archtypes(): readonly EntityArchtype<AnyCT>[] { return this._cachedArchtypes; }
//
//   private onArchtypeCreated = (arch: EntityArchtype<AnyCT>) => {
//     if (this.matches(arch)) this._cachedArchtypes.push(arch);
//   };
//
//   private matches(arch: EntityArchtype<AnyCT>): boolean {
//     return hasAll(arch, this._include as readonly AnyCT[]) &&
//       hasNone(arch, this._exclude as readonly AnyCT[]);
//   }
//
//   private refreshCache(): void {
//     const next: EntityArchtype<AnyCT>[] = [];
//     for (const arch of this._world.archtypes.values()) {
//       const a = arch as EntityArchtype<AnyCT>;
//       if (this.matches(a)) next.push(a);
//     }
//     this._cachedArchtypes = next;
//   }
//
//   /** Iterate all matching entity handles. */
//   public forEachEntity(cb: (entity: Entity) => void): void {
//     for (const arch of this._cachedArchtypes) {
//       const n = arch.entityCount;
//       for (let i = 0; i < n; i++) cb(arch.getEntityAtIndex(i));
//     }
//   }
//
//   /** for..of over entities */
//   public *[Symbol.iterator](): IterableIterator<Entity> {
//     for (const arch of this._cachedArchtypes) {
//       const n = arch.entityCount;
//       for (let i = 0; i < n; i++) yield arch.getEntityAtIndex(i);
//     }
//   }
//
//   public stream<
//     S extends TokenSpec | CtorSpec,
//     Include extends boolean = false
//   >(
//     specOrCtors: S,
//     options?: EntityStreamOptions<Include>
//   ): EntityQueryStream<TokensFrom<S>, Include> {
//     const spec = toTokenSpec(specOrCtors) as TokensFrom<S>;
//     const includeEntity = (options?.includeEntity ?? (false as Include)) as Include;
//     return new EntityQueryStream<TokensFrom<S>, Include>(
//       this._cachedArchtypes,
//       spec,
//       includeEntity
//     );
//   }
// }
//
// export class EntityQueryStream<
//   Spec extends Record<string, AnyCT>,
//   Include extends boolean = false
// > {
//   private keys: (keyof Spec)[];
//
//   constructor(
//     private arches: readonly EntityArchtype<AnyCT>[],
//     private spec: Spec,
//     private includeEntity: Include
//   ) {
//     this.keys = Object.keys(spec) as (keyof Spec)[];
//   }
//
//   public forEach(
//     cb: (row: EntityStreamRow<Spec> & (Include extends true ? { entity: Entity } : {})) => void
//   ): void {
//     for (const arch of this.arches as EntityArchtype<AnyCT>[]) {
//       const n = arch.entityCount;
//       for (let i = 0; i < n; i++) {
//         const data = arch.getDataAtIndex(i) as Map<AnyCT, Component>;
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


import {type Component, type ComponentCtor, ComponentType as CT, ComponentType} from "./component";
import {EntityArchetype} from "./entityArchetype";
import {World} from "./world";
import {Entity} from "./entity";
import {ComponentFrom, EntityStreamOptions, EntityStreamRow} from "./entityStream";
import {
  AnyCT, DisallowExcluded, DisallowExcludedByToken, ExcU,
  IncU,
  RowFromSpec,
  TokensFrom,
  TokenSpec, toTokenSpec,
  TupleToUnion
} from "../util/tokenUtils";


// row typing driven by the query:
// - if label’s token ∈ include → required prop
// - if label’s token ∉ include (and not excluded) → optional prop
type RowFromQuery<
  SpecTokens extends TokenSpec,
  IncludeUnion,
  _ExcUnion // present for clarity; exclusion is enforced by NotExcludedTokens
> =
// required keys (in include)
  {
    [K in keyof SpecTokens as SpecTokens[K] extends IncludeUnion ? K : never]:
    ComponentFrom<SpecTokens[K]>
  } &
  // optional keys (not in include)
  {
    [K in keyof SpecTokens as SpecTokens[K] extends IncludeUnion ? never : K]?:
    ComponentFrom<SpecTokens[K]>
  };


type TokenOrCtor = AnyCT | ComponentCtor<Component>;

function toTokens(list?: readonly TokenOrCtor[]): readonly AnyCT[] {
  if (!list || list.length === 0) return [];
  return list.map(item =>
    typeof item === "function"
      ? CT.of(item as ComponentCtor<Component>)
      : (item as AnyCT)
  );
}

type RowFrom<S> = EntityStreamRow<TokensFrom<S>>;

function hasAll<CT extends AnyCT>(arch: EntityArchetype<CT>, required: readonly CT[]): boolean {
  const have = new Set(arch.componentTypes as readonly CT[]);
  for (const t of required) if (!have.has(t)) return false;
  return true;
}

function hasNone<CT extends AnyCT>(arch: EntityArchetype<CT>, excluded: readonly CT[]): boolean {
  const have = new Set(arch.componentTypes as readonly CT[]);
  for (const t of excluded) if (have.has(t)) return false;
  return true;
}

export class EntityQuery<
  Inc extends readonly AnyCT[] = readonly [],
  Exc extends readonly AnyCT[] = readonly [],
> {
  private _include: readonly TupleToUnion<Inc>[];
  private _exclude: readonly TupleToUnion<Exc>[];

  private _lazyLoaded: {
    world: World;
    cachedArchtypes: EntityArchetype<AnyCT>[]
  } = {
    world: undefined!,
    cachedArchtypes: []
  }

  constructor(private _source: { world: World }, include: Inc, exclude?: Exc) {
    this._include = include;
    this._exclude = exclude ?? ([] as unknown as Exc);
  }

  private ensureWorldAdded() {
    if (!this._source.world) throw new Error("World not set")
    this._lazyLoaded.world = this._source.world;
    this.getWorld = () => this._lazyLoaded.world;
    this.getCachedArchtypes = () => this._lazyLoaded.cachedArchtypes;
    this.refreshCache();
    this._lazyLoaded.world.archetypes.onCreateArchtype.add(this.onArchtypeCreated);
  }

  private getWorld() {
    this.ensureWorldAdded()
    return this._lazyLoaded.world
  }

  private getCachedArchtypes() {
    this.ensureWorldAdded()
    return this._lazyLoaded.cachedArchtypes
  }

  // public setInclude(next: Inc): void { this._include = next; this.refreshCache(); }
  // public setExclude(next: Exc): void { this._exclude = next; this.refreshCache(); }
  // public setFilters(include: Inc, exclude?: Exc): void {
  //   this._include = include; this._exclude = exclude ?? ([] as unknown as Exc); this.refreshCache();
  // }

  // public get include(): readonly TupleToUnion<Inc>[] { return this._include; }
  // public get exclude(): readonly TupleToUnion<Exc>[] { return this._exclude; }
  public get archtypes(): readonly EntityArchetype<AnyCT>[] {
    return this.getCachedArchtypes();
  }

  private onArchtypeCreated = (arch: EntityArchetype<AnyCT>) => {
    if (this.matches(arch)) this.getCachedArchtypes().push(arch);
  };

  private matches(arch: EntityArchetype<AnyCT>): boolean {
    return hasAll(arch, this._include as readonly AnyCT[]) &&
      hasNone(arch, this._exclude as readonly AnyCT[]);
  }

  private refreshCache(): void {
    const next: EntityArchetype<AnyCT>[] = [];
    for (const arch of this.getWorld().archetypes.values()) {
      const a = arch as EntityArchetype<AnyCT>;
      if (this.matches(a)) next.push(a);
    }
    this._lazyLoaded.cachedArchtypes = next;
  }

  // export class EntityQueryStream<
  //   SpecTokens extends Record<string, AnyCT>,
  //   IncludeEntity extends boolean,
  //   Inc extends readonly AnyCT[],
  //   Exc extends readonly AnyCT[],
  // > {
  // private keys: (keyof SpecTokens)[];
  //
  //   constructor(
  //     private arches: readonly EntityArchtype<AnyCT>[],
  //     private spec: SpecTokens,
  //     private includeEntity: IncludeEntity
  // ) {
  //     this.keys = Object.keys(spec) as (keyof SpecTokens)[];
  //   }
  //
  // public forEach(
  //     cb: (
  //     row: RowFromSpec<SpecTokens, IncU<Inc>> &
  //       (IncludeEntity extends true ? { entity: Entity } : {})
  //   ) => void
  // ): void {
  //     for (const arch of this.arches) {
  //     const n = arch.entityCount;
  //     for (let i = 0; i < n; i++) {
  //       const data = arch.getDataAtIndex(i) as Map<AnyCT, Component>;
  //       const row: any = {};
  //
  //       if (this.includeEntity) row.entity = arch.getEntityAtIndex(i);
  //
  //       for (const k of this.keys) {
  //         const token = this.spec[k] as AnyCT;
  //         row[k as string] = data.get(token);
  //       }
  //       cb(row);
  //     }
  //   }
  // }
  // }
  public getSingletonEntity(): Entity {
    let entity: Entity | undefined;
    for (const arch of this.getCachedArchtypes()) {
      if (arch.entityCount == 0) continue;
      if (arch.entityCount > 1) throw new Error("More than 1 singleton entity found");
      if (arch.entityCount == 1) {
        if (entity != undefined) throw new Error("More than 1 singleton entity found");
        entity = arch.getEntityAtIndex(0);
      }
    }
    if (entity) return entity;
    throw new Error("No entity found");
  }

  public getSingleton<
    S extends Record<string, TokenOrCtor>,
    IncludeEntity extends boolean = false
  >(    specOrCtors: S,
        options?: EntityStreamOptions<IncludeEntity>): RowFromSpec<TokensFrom<S>, IncU<Inc>> &
    (IncludeEntity extends true ? { entity: Entity } : {}) {
    const spec = toTokenSpec(specOrCtors);
    const keys = Object.keys(spec) as (keyof S)[];
    let rowData: any = undefined;
    for (const arch of this.getCachedArchtypes()) {
      if (arch.entityCount == 0) continue;
      if (arch.entityCount > 1) throw new Error("More than 1 singleton entity found");
      if (arch.entityCount == 1) {
        if (rowData != undefined) throw new Error("More than 1 singleton entity found");
        const data = arch.getDataAtIndex(0) as Map<AnyCT, Component>;
        rowData = {};
        rowData.entity = arch.getEntityAtIndex(0);
        for (const k of keys) {
          const token = spec[k] as AnyCT;
          rowData[k as string] = data.get(token);
        }
      }
    }
    if (rowData) return rowData;
    throw new Error("No entity found");
  }

  public hasEntity(): boolean {
    for (const arch of this.getCachedArchtypes()) {
      if (arch.entityCount > 0) return true;
    }
    return false;
  }

  public entityCount(): number {
    let count = 0;
    const archetypes = this.getCachedArchtypes();
    console.log(archetypes.length);
    for (const arch of archetypes) {
      console.log(arch.componentTypes)
      const n = arch.entityCount;
      count += n;
    }
    return count;
  }

  /** Iterate all matching entity handles. */
  public forEachEntity(cb: (entity: Entity) => void): void {
    for (const arch of this.getCachedArchtypes()) {
      const n = arch.entityCount;
      for (let i = 0; i < n; i++) cb(arch.getEntityAtIndex(i));
    }
  }

  /** for..of over entities */
  public* [Symbol.iterator](): IterableIterator<Entity> {
    for (const arch of this.getCachedArchtypes()) {
      const n = arch.entityCount;
      for (let i = 0; i < n; i++) yield arch.getEntityAtIndex(i);
    }
  }

  public stream<
    S extends Record<string, TokenOrCtor>,
    IncludeEntity extends boolean = false
  >(
    specOrCtors: S,
    options?: EntityStreamOptions<IncludeEntity>
  ): EntityQueryStream<TokensFrom<S>, IncludeEntity, Inc, Exc> {
    const spec = toTokenSpec(specOrCtors);
    const includeEntity = (options?.includeEntity ?? false) as IncludeEntity;
    return new EntityQueryStream<TokensFrom<S>, IncludeEntity, Inc, Exc>(
      this.getCachedArchtypes() as EntityArchetype<AnyCT>[],
      spec,
      includeEntity
    );
  }
}

export class EntityQueryStream<
  SpecTokens extends Record<string, AnyCT>,
  IncludeEntity extends boolean,
  Inc extends readonly AnyCT[],
  Exc extends readonly AnyCT[],
> {
  private keys: (keyof SpecTokens)[];

  constructor(
    private arches: readonly EntityArchetype<AnyCT>[],
    private spec: SpecTokens,
    private includeEntity: IncludeEntity
  ) {
    this.keys = Object.keys(spec) as (keyof SpecTokens)[];
  }

  public forEach(
    cb: (
      row: RowFromSpec<SpecTokens, IncU<Inc>> &
        (IncludeEntity extends true ? { entity: Entity } : {})
    ) => void
  ): void {
    for (const arch of this.arches) {
      const n = arch.entityCount;
      for (let i = 0; i < n; i++) {
        const data = arch.getDataAtIndex(i) as Map<AnyCT, Component>;
        const row: any = {};

        if (this.includeEntity) row.entity = arch.getEntityAtIndex(i);

        for (const k of this.keys) {
          const token = this.spec[k] as AnyCT;
          row[k as string] = data.get(token);
        }
        cb(row);
      }
    }
  }
}