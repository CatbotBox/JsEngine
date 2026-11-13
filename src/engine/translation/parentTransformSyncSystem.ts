import {ComponentType, System} from "../core";
import {ParentTransform} from "./parent";
import {LocalToWorld} from "./localToWorld";
import {getOwnerInferred} from "../core/ownership";

import {HierarchySyncSystem} from "./hierarchySyncSystem";
import {LocalToWorldSystem} from "./localToWorldSystem";
import {TranslationSystemGroup} from "./translationSystemGroup";
import {Children} from "./children";
import {MAT4_FLOATS, MAT4_FLOATS_SHIFT} from "../math/mat4Layout";


export class ParentTransformSyncSystem extends System {
    private _parentQuery = this.createEntityQuery([Children, LocalToWorld])
    private _parentTransformToken = ComponentType.of(ParentTransform);

    override systemGroup() {
        return TranslationSystemGroup;
    }

    priority(): number {
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
            .consumeSpans(({start, end, cols, stores}) => {
                const l2w = cols.localToWorld!;
                const childrenStore = stores.children!;
                for (let i = start; i < end; i++) {
                    const children = (childrenStore.get(i) as Children).children;
                    const pOff = i << MAT4_FLOATS_SHIFT;
                    for (let c = 0; c < children.length; c++) {
                        const arch = getOwnerInferred(children[c]);
                        if (arch === undefined) continue;
                        const ptStore = arch.getColumn(token);
                        if (ptStore === undefined) continue;
                        const row = arch.getIndexOfEntity(children[c]);
                        if (row === undefined) continue;
                        const pt = ptStore.f32Data;
                        if (pt === undefined) continue;
                        const cOff = row << MAT4_FLOATS_SHIFT;
                        let same = true;
                        for (let k = 0; k < MAT4_FLOATS; k++) {
                            if (pt[cOff + k] !== l2w[pOff + k]) {
                                same = false;
                                break;
                            }
                        }
                        if (same) continue;
                        for (let k = 0; k < MAT4_FLOATS; k++) pt[cOff + k] = l2w[pOff + k];
                        ptStore.markBlockAt(row, now);
                    }
                }
            })
    }
}