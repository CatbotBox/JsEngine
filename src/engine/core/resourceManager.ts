import {Resource, ResourceCtor} from "./resource";

export interface ResourceListener {
    onPresenceChanged(present: boolean): void;
}

const PRESENT = true;
const ABSENT = false;
const NO_LISTENERS = 0;

export class ResourceManager {
    private _map: Map<ResourceCtor<Resource>, Resource> = new Map();
    private readonly _listeners: Map<ResourceCtor<Resource>, readonly ResourceListener[]> = new Map();

    public tryGet<T extends Resource>(ctor: ResourceCtor<T>): T | undefined {
        return this._map.get(ctor) as T | undefined;
    }

    public get<T extends Resource>(ctor: ResourceCtor<T>): T {
        const result = this._map.get(ctor) as T | undefined;
        if (result) return result;
        throw new Error(`The required resource ${ctor.name} was not loaded: list it under "resources" in jsengine.project.json, or insert it before a system reads it`);
    }

    public getOrCreate<T extends Resource>(ctor: ResourceCtor<T>): T {
        const result = this._map.get(ctor) as T | undefined;
        if (result) return result;
        const newResult: T = new ctor();
        this._map.set(ctor, newResult);
        this.notify(ctor, PRESENT);
        return newResult;
    }

    public insert<T extends Resource>(resource: T): T {
        const ctor = resource.constructor as ResourceCtor<T>;
        const wasPresent = this._map.has(ctor);
        this._map.set(ctor, resource);
        if (!wasPresent) this.notify(ctor, PRESENT);
        return resource;
    }

    public remove<T extends Resource>(ctor: ResourceCtor<T>): void {
        if (!this._map.delete(ctor)) return;
        this.notify(ctor, ABSENT);
    }

    public addListener<T extends Resource>(ctor: ResourceCtor<T>, listener: ResourceListener): void {
        this._listeners.set(ctor, [...(this._listeners.get(ctor) ?? []), listener]);
    }

    public removeListener<T extends Resource>(ctor: ResourceCtor<T>, listener: ResourceListener): void {
        const listeners = this._listeners.get(ctor);
        if (listeners === undefined) return;
        const remaining = listeners.filter(existing => existing !== listener);
        if (remaining.length === NO_LISTENERS) this._listeners.delete(ctor);
        else this._listeners.set(ctor, remaining);
    }

    public listenerCount<T extends Resource>(ctor: ResourceCtor<T>): number {
        return this._listeners.get(ctor)?.length ?? NO_LISTENERS;
    }

    private notify<T extends Resource>(ctor: ResourceCtor<T>, present: boolean): void {
        const listeners = this._listeners.get(ctor);
        if (listeners === undefined) return;
        for (let i = 0; i < listeners.length; i++) listeners[i].onPresenceChanged(present);
    }
}
