import {EntityArchetypeMap} from "./entityArchetypeMap";
import type {System} from "./system";
import {EntityManager} from "./entityManager";
import {Entity} from "./entity";
import {SystemGroup} from "./systemGroup";
import {RootSystemGroup} from "./rootSystemGroup";
import {GCSystem} from "./GCSystem";


class Time {
  /**
   * time from last tick (in milliseconds)
   */
  public deltaTime: number = 0;
  public elapsedTime: number = 0;
}

export class World {
  public archetypes: EntityArchetypeMap = new EntityArchetypeMap();
  public world: World = this;
  private _systems: Map<new () => System, System> = new Map();
  private _rootSystemGroup: SystemGroup = this.createSystem(RootSystemGroup);
  public entityManager: EntityManager = new EntityManager(this);
  public time: Time = new Time();

  //update loop settings
  private _timeout: unknown | null = null;
  private _targetDeltaTime: number = 1000 / 60; // default to 60 FPS

  constructor() {
    // console.log("World initialized");
    this.archetypes.onCreateArchetype.add((_archtype) => { /* hook point */
    });

    this.getOrCreateSystem(GCSystem)
  }

  public getOrCreateSystem<T extends System>(constructor: new () => T): T {
    const existing = this._systems.get(constructor);
    if (existing !== undefined) return existing as T;
    const system = new constructor();
    system.world = this;
    this._systems.set(constructor, system);
    system.create();
    return system;
  }

  public createSystem<T extends System>(systemClass: new () => T): T {
    const existing = this._systems.get(systemClass);
    if (existing !== undefined) throw new Error("System already exists");
    const systemInstance = new systemClass();
    systemInstance.world = this;
    this._systems.set(systemClass, systemInstance);
    systemInstance.create();
    return systemInstance;
  }

  public tryGetSystem<T extends System>(constructor: new () => T): T | undefined {
    const existing = this._systems.get(constructor);
    return existing as T | undefined;
  }


  public hasSystem<T extends System>(constructor: new () => T): boolean {
    return this._systems.has(constructor);
  }

  // public remove(system: System): void {
  //   // if (this._systems.delete(system)) system.dispose?.();
  // }

  public startLoop(): void {
    if (this._timeout !== null) {
      console.warn("World loop already started");
      return;
    }
    const time = this.time
    let updateInProgress = false;
    let prevCycle = performance.now();
    this._timeout = setInterval(() => {
      if (updateInProgress) {
        console.warn("Update in progress, skipping current update cycle");
        return;
      }
      updateInProgress = true
      const now = performance.now();
      const delta = now - prevCycle;
      if (delta < this._targetDeltaTime) {
        updateInProgress = false;
        return; // skip update if not enough time has passed
      }
      prevCycle = now;
      time.deltaTime = delta;
      time.elapsedTime = now;
      this.update();
      updateInProgress = false;

    }, this._targetDeltaTime / 10);
  }

  public pause(): void {
    if (this._timeout !== null) {
      clearInterval(this._timeout as any);
      // this._timeout.unref();
      this._timeout = null;
    }
  }

  public stop(): void {
    this.pause();
    this._rootSystemGroup.destroy();
  }

  public get targetDeltaTime(): number {
    return this._targetDeltaTime;
  }

  public set targetDeltaTime(value: number) {
    if (value === this._targetDeltaTime) return;
    this._targetDeltaTime = value;
    if (this._timeout !== null) {
      this.pause();
      this.startLoop();
    }
  }

  public get targetFramerate(): number {
    return 1000 / this._targetDeltaTime;
  }

  public set targetFramerate(value: number) {
    if (value <= 0) throw new Error("Framerate must be positive and non-zero");
    this.targetDeltaTime = 1000 / value;
  }


  private update(): void {
    this._rootSystemGroup.update();
  }

  public* systems(): Iterator<System> {
    return this._systems.values();
  }

  public* entities(): Iterator<Entity> {
    for (const archetype of this.archetypes.values()) {
      for (let i = 0; i < archetype.entityCount; i++) {
        const entity = archetype.getEntityAtIndex(i);
        if (entity) yield entity;
      }
    }
  }

  public get systemCount(): number {
    return this._systems.size;
  }

  public get entityCount(): number {
    let count = 0;
    for (const archetype of this.archetypes.values()) {
      count += archetype.entityCount;
    }
    return count;
  }
}
