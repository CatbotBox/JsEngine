import type {ComponentType} from "./component";
import {AnyCT, TokenOrCtor} from "../util/tokenUtils";


export type ComponentFrom<T extends ComponentType<any>> =
    T extends ComponentType<infer C> ? C : never;

export type EntityStreamRow<Spec extends Record<string, AnyCT>> = {
    [K in keyof Spec]: ComponentFrom<Spec[K]>;
};

export interface EntityStreamOptions<Include extends boolean = false> {
    includeEntity?: Include; // default: false
    includeDisabled?: boolean; // default: false
    filterLastUpdated?: number
    filterBlackList?: TokenOrCtor[]
}