import {Mesh} from "../rendering/3d/mesh";
import type {MeshLoadOptions} from "../rendering/3d/mesh";
import {SpriteImage} from "../rendering/2d/spriteImage";
import type {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {isSceneJsonObject} from "./sceneDocument";
import type {SceneDocument} from "./sceneDocument";

export type SceneAssetKind = "mesh" | "spriteImage";

export interface SceneAssetReference {
    readonly kind: SceneAssetKind;
    readonly path: string;
}

export interface SceneAssetLoader {
    loadMesh(path: string): Mesh;

    loadSpriteImage(path: string): SpriteImage;
}

export function platformSceneAssetLoader(options: MeshLoadOptions): SceneAssetLoader {
    const meshes = new Map<string, Mesh>();
    return {
        loadMesh(path: string): Mesh {
            let mesh = meshes.get(path);
            if (mesh === undefined) {
                mesh = Mesh.fromFile(path, options);
                meshes.set(path, mesh);
            }
            return mesh;
        },
        loadSpriteImage(path: string): SpriteImage {
            return SpriteImage.fromFile(path, options);
        },
    };
}

export function sceneAssetPaths(document: SceneDocument, registry: ComponentSchemaRegistry): SceneAssetReference[] {
    const references: SceneAssetReference[] = [];
    const seen = new Set<string>();
    for (const record of document.entities) {
        for (const componentName of Object.keys(record.components)) {
            const schema = registry.byName(componentName);
            if (schema === undefined) continue;
            const values = record.components[componentName];
            for (const field of schema.fields) {
                if (field.kind !== "mesh" && field.kind !== "spriteImage") continue;
                const value = values[field.key];
                if (!isSceneJsonObject(value) || typeof value.path !== "string") continue;
                const key = `${field.kind}:${value.path}`;
                if (seen.has(key)) continue;
                seen.add(key);
                references.push({kind: field.kind, path: value.path});
            }
        }
    }
    return references;
}
