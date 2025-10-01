/**
 * resources are singletons tied to each world
 */
export abstract class Resource {

}

export type ResourceCtor<T extends Resource = any> = new (...args: any[]) => T;