import {ComponentType, System} from "../core";
import {ParentTransform} from "./parent";
import {LocalToWorld} from "./localToWorld";
import {getOwnerInferred} from "../core/ownership";

import {HierarchySyncSystem} from "./HierarchySyncSystem";
import {LocalToWorldSystem} from "./LocalToWorldSystem";
import {TranslationSystemGroup} from "./TranslationSystemGroup";
import {Children} from "./children";

export class ParentTransformSyncSystem extends System {
    private _parentQuery = this.createEntityQuery([Children, LocalToWorld])
    private _parentTransformToken = ComponentType.of(ParentTransform);

    override systemGroup() {
        return TranslationSystemGroup;
    }

    priority(): number {
        //update after local to world to capture changes
        return this.world.getOrCreateSystem(LocalToWorldSystem).priority() + 1;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._parentQuery);
        this.world.ensureSystemExists(HierarchySyncSystem);
    }

    onUpdate() {
        const token = this._parentTransformToken;
        const now = performance.now();

        this._parentQuery.stream({read: {children: Children, localToWorld: LocalToWorld}},
            {
                filterLastUpdated: this.lastUpdateTime,
            })
            // consumeSpans: the parent matrix is read straight off its column;
            // each child's ParentTransform is written into ITS archetype's
            // column with a block-granular stamp — the old proxy-setter path
            // stamped the child's whole column, waking every sibling.
            .consumeSpans(({start, end, cols, stores}) => {
                const l2w = cols.localToWorld!;
                const childrenStore = stores.children!;
                for (let i = start; i < end; i++) {
                    // Indexed loop, not forEach: Children is a dense array and the
                    // indexed form measured 7-15x faster than the old Set.forEach.
                    const children = (childrenStore.get(i) as Children).children;
                    const pOff = i << 4;
                    for (let c = 0; c < children.length; c++) {
                        const arch = getOwnerInferred(children[c]);
                        if (arch === undefined) continue;
                        const ptStore = arch.getColumn(token);
                        if (ptStore === undefined) continue;
                        const row = arch.getIndexOfEntity(children[c]);
                        if (row === undefined) continue;
                        // Not an assertion: this column belongs to an arbitrary child's
                        // archetype, not to the stream's plan, so f32Data is undefined for
                        // any object-backed token. Safe today only because ParentTransform
                        // happens to declare f32Width.
                        const pt = ptStore.f32Data;
                        if (pt === undefined) continue;
                        const cOff = row << 4;
                        let same = true;
                        for (let k = 0; k < 16; k++) {
                            if (pt[cOff + k] !== l2w[pOff + k]) {
                                same = false;
                                break;
                            }
                        }
                        if (same) continue;
                        for (let k = 0; k < 16; k++) pt[cOff + k] = l2w[pOff + k];
                        ptStore.markBlockAt(row, now);
                    }
                }
            })
    }
}