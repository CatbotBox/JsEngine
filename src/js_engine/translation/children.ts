import {Component, Entity} from "../core";

/**
 * The child entities of a parent, added automatically by `Parent.setup()`.
 *
 * Backed by a dense array with swap-remove, the same idiom `EntityArchetype`
 * uses for its own storage — not a `Set`. Both sync systems walk every child
 * every frame, and iteration is what that costs: measured in
 * `bench/tier3.bench.ts`, an indexed loop beats `Set.forEach` by 7-15x across
 * every child count tested (n = 2..128).
 *
 * The trade is `has()`, which goes from O(1) to a scan. That still wins up to
 * n≈32 (2-4.6x) and reaches parity at n=128, and it is only used on the
 * child→parent reconcile path in `HierarchySyncSystem`, not per child per
 * frame. If a parent ever holds thousands of children, revisit this — the
 * benchmark is written to re-run.
 */
export class Children extends Component {
    private readonly _children: Entity[] = [];

    /** Readonly so callers iterate but cannot desync the array from addChild/removeChild. */
    public get children(): readonly Entity[] {
        return this._children;
    }

    public constructor(...childEntities: Entity[]) {
        super();
        for (const child of childEntities) this.addChild(child);
    }

    public has(entity: Entity): boolean {
        return this._children.indexOf(entity) >= 0;
    }

    public addChild(entity: Entity): void {
        if (this._children.indexOf(entity) >= 0) return; // Set semantics: no duplicates
        this._children.push(entity);
        this.notifyChanged();
    }

    public removeChild(entity: Entity): void {
        const index = this._children.indexOf(entity);
        if (index < 0) return;
        // Swap-remove: order is not meaningful here and it keeps the array dense.
        const last = this._children.length - 1;
        this._children[index] = this._children[last];
        this._children.length = last;
        this.notifyChanged();
    }
}
