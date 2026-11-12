import {AnyCT, TokenOrCtor} from "../util/tokenUtils";

export interface EntityInclusionOptions<Include extends boolean = false> {
    includeEntity?: Include;
}

export interface EntityFilterOptions {
    includeDisabled?: boolean;
    filterLastUpdated?: number
    filterBlackList?: TokenOrCtor[]

    structuralFilter?: "any" | "additions"
}

export type EntityStreamOptions<Include extends boolean = false> = EntityInclusionOptions<Include> & EntityFilterOptions;