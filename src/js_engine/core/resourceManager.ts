import {Resource, ResourceCtor} from "./resource";

export class ResourceManager {
    private _map: Map<ResourceCtor, unknown> = new Map();

    public tryGet<T extends Resource>(ctor: ResourceCtor<T>): T | undefined {
        return this._map.get(ctor) as T | undefined;
    }

    public get<T extends Resource>(ctor: ResourceCtor<T>): T {
        const result = this._map.get(ctor) as T | undefined;
        if (result) return result;
        throw new Error(`Resource ${ctor.name} not found`);
    }

    public getOrCreate<T extends Resource>(ctor: ResourceCtor<T>): T {
        const result = this._map.get(ctor) as T | undefined;
        if (result) return result;
        const newResult: T = new ctor();
        this._map.set(ctor, newResult);
        return newResult;
    }
}