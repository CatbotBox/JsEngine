import {describe, expect, test} from "../testing/harness";
import {DATA_ASSET_FORMAT, DATA_ASSET_VERSION, parseDataAssetDocument} from "./dataAssetDocument";
import {migrateDocumentJson, oldestMigratedVersion, withRenamedKey} from "./documentMigrations";
import type {DocumentMigration, DocumentMigrations} from "./documentMigrations";
import {migrateSceneJson, parseSceneDocument, SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION} from "./sceneDocument";

const LABEL = "Test document";
const FIRST_VERSION = 1;
const SECOND_VERSION = 2;
const THIRD_VERSION = 3;
const LATEST_VERSION = 4;
const TOO_OLD_VERSION = 0;
const EVICT_AFTER_FRAMES = 600;
const ASSET_PATH = "assets/tuning.asset.json";
const SCENE_PATH = "scenes/main.scene.json";

function appendingStep(fromVersion: number): DocumentMigration {
    return {
        fromVersion,
        migrate: document => {
            const trail = Array.isArray(document.trail) ? document.trail : [];
            return {...document, trail: [...trail, fromVersion]};
        },
    };
}

const CHAIN: DocumentMigrations = {
    currentVersion: LATEST_VERSION,
    steps: [appendingStep(THIRD_VERSION), appendingStep(FIRST_VERSION), appendingStep(SECOND_VERSION)],
};

const GAPPED: DocumentMigrations = {
    currentVersion: LATEST_VERSION,
    steps: [appendingStep(FIRST_VERSION), appendingStep(THIRD_VERSION)],
};

describe("document migrations", () => {
    test("steps run in version order from the file's version up to the current one", () => {
        const migrated = migrateDocumentJson({version: FIRST_VERSION, name: "kept"}, FIRST_VERSION, CHAIN, LABEL);
        expect(migrated).toEqual({version: LATEST_VERSION, name: "kept", trail: [FIRST_VERSION, SECOND_VERSION, THIRD_VERSION]});
        expect(Object.keys(migrated)).toEqual(["version", "name", "trail"]);
        expect(migrateDocumentJson({version: THIRD_VERSION}, THIRD_VERSION, CHAIN, LABEL)).toEqual({version: LATEST_VERSION, trail: [THIRD_VERSION]});
    });

    test("a document at the current version comes back untouched", () => {
        const current = {version: LATEST_VERSION};
        expect(migrateDocumentJson(current, LATEST_VERSION, CHAIN, LABEL)).toBe(current);
    });

    test("a gap in the chain throws naming the missing step", () => {
        expect(() => migrateDocumentJson({version: FIRST_VERSION}, FIRST_VERSION, GAPPED, LABEL))
            .toThrow(`${LABEL}: no migration from version ${SECOND_VERSION} to ${THIRD_VERSION}`);
        expect(migrateDocumentJson({version: THIRD_VERSION}, THIRD_VERSION, GAPPED, LABEL)).toEqual({version: LATEST_VERSION, trail: [THIRD_VERSION]});
    });

    test("newer versions and versions older than the chain throw", () => {
        expect(() => migrateDocumentJson({}, LATEST_VERSION + 1, CHAIN, LABEL))
            .toThrow(`${LABEL}: version ${LATEST_VERSION + 1} is newer than the supported version ${LATEST_VERSION}`);
        expect(() => migrateDocumentJson({}, TOO_OLD_VERSION, CHAIN, LABEL))
            .toThrow(`${LABEL}: version ${TOO_OLD_VERSION} is older than the oldest version this engine migrates (${FIRST_VERSION})`);
        expect(oldestMigratedVersion({currentVersion: LATEST_VERSION, steps: []})).toBe(LATEST_VERSION);
    });

    test("withRenamedKey keeps the key's place and leaves objects without it alone", () => {
        const renamed = withRenamedKey({a: 1, old: 2, c: 3}, "old", "fresh");
        expect(Object.keys(renamed)).toEqual(["a", "fresh", "c"]);
        expect(renamed).toEqual({a: 1, fresh: 2, c: 3});
        const without = {a: 1};
        expect(withRenamedKey(without, "toString", "other")).toBe(without);
    });

    test("scene version 1 renames GpuMeshPassSettings.evictUnusedMeshAfterFrames", () => {
        const version1 = {
            format: SCENE_DOCUMENT_FORMAT,
            version: FIRST_VERSION,
            entities: [
                {id: 1, name: "settings", enabled: true, components: {GpuMeshPassSettings: {sampleCount: "single", evictUnusedMeshAfterFrames: EVICT_AFTER_FRAMES, lodTrianglesPerPixel: 1}}},
                {id: 2, name: "other", enabled: true, components: {LocalPosition: {xyz: [1, 2, 3]}}},
            ],
        };
        const migrated = migrateSceneJson(version1);
        expect(migrated.version).toBe(SCENE_DOCUMENT_VERSION);
        const document = parseSceneDocument(version1);
        const settings = document.entities[0].components.GpuMeshPassSettings;
        expect(Object.keys(settings)).toEqual(["sampleCount", "evictUnusedAfterFrames", "lodTrianglesPerPixel"]);
        expect(settings.evictUnusedAfterFrames).toBe(EVICT_AFTER_FRAMES);
        expect(document.entities[1].components).toEqual({LocalPosition: {xyz: [1, 2, 3]}});
    });

    test("scene version 1 renames prefab overrides of GpuMeshPassSettings.evictUnusedMeshAfterFrames", () => {
        const overrides = ["0/GpuMeshPassSettings.evictUnusedMeshAfterFrames", "0/GpuMeshPassSettings.sampleCount", "1/LocalPosition"];
        const version1 = {
            format: SCENE_DOCUMENT_FORMAT,
            version: FIRST_VERSION,
            entities: [{id: 1, name: "instance", enabled: true, components: {PrefabInstance: {sourcePath: "a.prefab.json", overrides}}}],
        };
        const document = parseSceneDocument(version1);
        expect(document.entities[0].components.PrefabInstance.overrides)
            .toEqual(["0/GpuMeshPassSettings.evictUnusedAfterFrames", "0/GpuMeshPassSettings.sampleCount", "1/LocalPosition"]);
    });

    test("scene version 2 moves a SpritePattern into its entity's Sprite.image as an inline pattern and drops one without a Sprite", () => {
        const ship = {rows: [" # ", "###"], palette: [{char: "#", rgb: "#40e0ff"}]};
        const version2 = {
            format: SCENE_DOCUMENT_FORMAT,
            version: SECOND_VERSION,
            entities: [
                {id: 1, name: "ship", enabled: true, components: {
                    LocalPosition: {xyz: [0, 0, 0]},
                    Sprite: {image: {path: "sprites/old.png"}, tint: "#ffffff", opacity: 1},
                    SpritePattern: ship,
                    LocalToWorld: {},
                }},
                {id: 2, name: "lamp", enabled: true, components: {PointLight: {range: 4}, SpritePattern: ship}},
                {id: 3, name: "blank", enabled: true, components: {Sprite: {image: null, tint: "#ffffff", opacity: 1}, SpritePattern: {rows: ["#"]}}},
                {id: 4, name: "plain", enabled: true, components: {Sprite: {image: null, tint: "#ffffff", opacity: 1}}},
            ],
        };
        const document = parseSceneDocument(version2);
        expect(Object.keys(document.entities[0].components)).toEqual(["LocalPosition", "Sprite", "LocalToWorld"]);
        expect(document.entities[0].components.Sprite).toEqual({image: ship, tint: "#ffffff", opacity: 1});
        expect(document.entities[1].components).toEqual({PointLight: {range: 4}});
        expect(document.entities[2].components.Sprite.image).toEqual({rows: ["#"], palette: []});
        expect(document.entities[3].components).toEqual({Sprite: {image: null, tint: "#ffffff", opacity: 1}});
    });

    test("scene version 2 points prefab overrides of a SpritePattern at Sprite.image, once per entity", () => {
        const overrides = ["/SpritePattern.rows", "/SpritePattern.palette", "0/SpritePattern", "0/Sprite.tint", "1/SpritePatternTint.rgb", "1/@name"];
        const version2 = {
            format: SCENE_DOCUMENT_FORMAT,
            version: SECOND_VERSION,
            entities: [{id: 1, name: "instance", enabled: true, components: {PrefabInstance: {sourcePath: "a.prefab.json", overrides}}}],
        };
        const document = parseSceneDocument(version2);
        expect(document.entities[0].components.PrefabInstance.overrides)
            .toEqual(["/Sprite.image", "0/Sprite.image", "0/Sprite.tint", "1/SpritePatternTint.rgb", "1/@name"]);
    });

    test("scene and data asset errors name the document path", () => {
        expect(() => parseSceneDocument({format: SCENE_DOCUMENT_FORMAT, version: TOO_OLD_VERSION, entities: []}, SCENE_PATH))
            .toThrow(`Scene document "${SCENE_PATH}": version ${TOO_OLD_VERSION} is older than the oldest version this engine migrates (${FIRST_VERSION})`);
        expect(() => parseDataAssetDocument({format: DATA_ASSET_FORMAT, version: TOO_OLD_VERSION, type: "Tuning"}, ASSET_PATH))
            .toThrow(`Data asset "${ASSET_PATH}": version ${TOO_OLD_VERSION} is older than the oldest version this engine migrates (${DATA_ASSET_VERSION})`);
        expect(() => parseSceneDocument({format: SCENE_DOCUMENT_FORMAT, version: "1", entities: []}, SCENE_PATH))
            .toThrow(`Scene document "${SCENE_PATH}": version must be a whole number, got "1"`);
    });
});
