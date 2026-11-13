import type {Entity} from "../../engine/core";
import {sceneJsonEquals} from "../../engine/scene/sceneDocument";
import type {SceneJsonValue} from "../../engine/scene";
import type {EditorFieldValue} from "../editorProtocol";
import {eulerDegreesOfQuaternion} from "./fieldValueText";
import type {EulerDegrees} from "./fieldValueText";

interface TypedRotation {
    readonly entity: Entity;
    readonly quaternion: SceneJsonValue;
    readonly degrees: EulerDegrees;
}

function fieldKey(entity: Entity, typeName: string, key: string): string {
    return `${entity}/${typeName}/${key}`;
}

export class RotationEulerCache {
    private readonly typed = new Map<string, TypedRotation>();

    public get size(): number {
        return this.typed.size;
    }

    public remember(entity: Entity, typeName: string, key: string, quaternion: SceneJsonValue, degrees: EulerDegrees): void {
        this.typed.set(fieldKey(entity, typeName, key), {entity, quaternion, degrees});
    }

    public degreesFor(entity: Entity, typeName: string, key: string, quaternion: EditorFieldValue): EulerDegrees {
        const typed = this.typed.get(fieldKey(entity, typeName, key));
        if (typed !== undefined && sceneJsonEquals(typed.quaternion, quaternion as SceneJsonValue)) return typed.degrees;
        return eulerDegreesOfQuaternion(quaternion);
    }

    public retainEntities(live: ReadonlySet<Entity>): void {
        for (const [key, typed] of this.typed) if (!live.has(typed.entity)) this.typed.delete(key);
    }
}
