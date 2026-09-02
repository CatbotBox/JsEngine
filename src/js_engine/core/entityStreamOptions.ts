import {AnyCT, TokenOrCtor} from "../util/tokenUtils";

export interface EntityInclusionOptions<Include extends boolean = false> {
    includeEntity?: Include; // default: false
}

export interface EntityFilterOptions {
    includeDisabled?: boolean; // default: false
    filterLastUpdated?: number
    filterBlackList?: TokenOrCtor[]

    /**
     * Which structural changes defeat `filterLastUpdated`. Default `"any"`.
     *
     * `"additions"` says: this system derives each entity's output purely from
     * that entity's own components, so a *removal* gives it nothing to do.
     * Entities are swap-removed with every column moving together, so the
     * survivors' data stays correctly paired and their derived values remain
     * valid — only entities that newly appeared need processing.
     *
     * This matters a lot. With 40k entities in one archetype, removing a single
     * one made LocalToWorldSystem recompute all 40k (0.09ms -> 4.92ms), and each
     * derived-data system paid that every frame entities were retiring.
     *
     * Do NOT use it for a system that maintains external state keyed by entity
     * (a spatial index, say) — those genuinely must react to removals.
     */
    structuralFilter?: "any" | "additions"
}

export type EntityStreamOptions<Include extends boolean = false> = EntityInclusionOptions<Include> & EntityFilterOptions;