import type {Entity, World} from "../../engine/core";
import {NULL_ENTITY} from "../../engine/core/entity";
import {serializeWorld} from "../../engine/scene";
import type {ComponentSchemaRegistry, SceneDocument, SceneSnapshot} from "../../engine/scene";
import type {EditorMode, ExportSnapshotResult} from "../editorProtocol";

export const MISSING_SNAPSHOT_RECORD = -1;

export interface EditorSessionState {
    readonly mode: EditorMode;
    readonly gameplayTicks: number;
    readonly editSnapshot: SceneSnapshot | undefined;
}

export function exportWorldSnapshot(world: World, registry: ComponentSchemaRegistry, state: EditorSessionState): ExportSnapshotResult {
    const saved = serializeWorld(world, registry);
    const exported = {
        documentText: JSON.stringify(saved.document),
        mode: state.mode,
        gameplayTicks: state.gameplayTicks,
        entities: saved.entities,
    };
    if (state.mode === "edit" || state.editSnapshot === undefined) return exported;
    const recordByEntity = new Map<Entity, number>();
    saved.entities.forEach((entity, index) => recordByEntity.set(entity, index));
    return {
        ...exported,
        editSnapshotText: JSON.stringify(state.editSnapshot.document),
        editSnapshotRecords: state.editSnapshot.entities.map(entity => recordByEntity.get(entity) ?? MISSING_SNAPSHOT_RECORD),
    };
}

export function importedEditSnapshot(document: SceneDocument, records: readonly number[] | undefined, loaded: readonly Entity[]): SceneSnapshot {
    if (records !== undefined && records.length !== document.entities.length) {
        throw new Error(`importSnapshot: editSnapshotRecords lists ${records.length} records for ${document.entities.length} edit snapshot entities`);
    }
    const used = new Set<number>();
    const entities = document.entities.map((_, index) => {
        const record = records?.[index] ?? MISSING_SNAPSHOT_RECORD;
        if (record < 0 || record >= loaded.length || used.has(record)) return NULL_ENTITY;
        used.add(record);
        return loaded[record];
    });
    return {document, entities};
}
