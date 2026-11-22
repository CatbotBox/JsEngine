import {describe, expect, test} from "../../testing/harness";
import {MemoryPlatform} from "../../testing/memoryPlatform";
import {World} from "../../core";
import {Vec} from "../../math/types/vec";
import {LocalPosition} from "../../translation/localPosition";
import {ComponentSchemaRegistry} from "../../scene/componentSchemaRegistry";
import {registerEngineComponentSchemas} from "../../scene/engineComponentSchemas";
import {BUILT_IN_MESH_PATHS, UNIT_CUBE_MESH_PATH} from "../../scene/fieldSchema";
import {platformSceneAssetLoader, sceneAssetPaths} from "../../scene/sceneAssets";
import {deserializeInto, serializeWorld} from "../../scene/sceneSerialization";
import {parseSceneDocument} from "../../scene/sceneDocument";
import {createBuiltInMesh, createUnitCubeMesh, MESH_ASSET_TYPE} from "./meshAssetType";
import {RenderMesh} from "./renderMesh";

const CUBE_FACES = 6;
const CORNERS_PER_FACE = 4;
const TRIANGLES_PER_FACE = 2;
const HALF_EXTENT = 0.5;
const UNIT_LENGTH = 1;
const TOLERANCE_DIGITS = 6;

function corner(mesh: ReturnType<typeof createUnitCubeMesh>, index: number): readonly number[] {
    return Vec.toArray(mesh.vertices.at(index));
}

function subtract(a: readonly number[], b: readonly number[]): number[] {
    return a.map((value, axis) => value - b[axis]);
}

function cross(a: readonly number[], b: readonly number[]): number[] {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: readonly number[], b: readonly number[]): number {
    return a.reduce((sum, value, axis) => sum + value * b[axis], 0);
}

describe("built-in meshes", () => {
    test("the unit cube spans -0.5..0.5 with four corners and two triangles per face", () => {
        const cube = createUnitCubeMesh();
        expect([cube.vertCount, cube.triangleCount]).toEqual([CUBE_FACES * CORNERS_PER_FACE, CUBE_FACES * TRIANGLES_PER_FACE]);
        expect([...cube.bounds]).toEqual([-HALF_EXTENT, -HALF_EXTENT, -HALF_EXTENT, HALF_EXTENT, HALF_EXTENT, HALF_EXTENT]);
        expect(cube.sourcePath).toBe(UNIT_CUBE_MESH_PATH);
    });

    test("every triangle winds counter-clockwise seen from outside, like the OBJ meshes, along its corners' unit normals", () => {
        const cube = createUnitCubeMesh();
        for (let triangle = 0; triangle < cube.triangleCount; triangle++) {
            const [a, b, c] = Vec.toArray(cube.triangles.at(triangle));
            const facing = cross(subtract(corner(cube, b), corner(cube, a)), subtract(corner(cube, c), corner(cube, a)));
            const centroid = [0, 1, 2].map(axis => (corner(cube, a)[axis] + corner(cube, b)[axis] + corner(cube, c)[axis]) / 3);
            expect(dot(facing, centroid)).toBeGreaterThan(0);
            for (const index of [a, b, c]) {
                const normal = Vec.toArray(cube.normals.at(index));
                expect(dot(normal, normal)).toBeCloseTo(UNIT_LENGTH, TOLERANCE_DIGITS);
                expect(dot(normal, facing)).toBeGreaterThan(0);
            }
        }
    });

    test("the mesh asset type loads a built-in path without reading a file, once per loader, and offers every built-in", () => {
        const loader = platformSceneAssetLoader(new MemoryPlatform());
        const first = MESH_ASSET_TYPE.load(UNIT_CUBE_MESH_PATH, loader);
        expect(MESH_ASSET_TYPE.load(UNIT_CUBE_MESH_PATH, loader)).toBe(first);
        expect(MESH_ASSET_TYPE.pathOf(first)).toBe(UNIT_CUBE_MESH_PATH);
        expect(MESH_ASSET_TYPE.builtInPaths).toEqual(BUILT_IN_MESH_PATHS);
        for (const path of BUILT_IN_MESH_PATHS) expect(createBuiltInMesh(path).sourcePath).toBe(path);
        expect(() => createBuiltInMesh("builtin:teapot")).toThrow('"builtin:teapot" names no built-in mesh; the built-in meshes are builtin:cube');
    });

    test("a scene holding the cube saves its path, lists no file to preload and loads it back", () => {
        const registry = new ComponentSchemaRegistry();
        registerEngineComponentSchemas(registry);
        const platform = new MemoryPlatform();
        const source = new World({platform});
        const loader = platformSceneAssetLoader(platform);
        source.entityManager.createEntity("cube", [new LocalPosition(), new RenderMesh(MESH_ASSET_TYPE.load(UNIT_CUBE_MESH_PATH, loader))]);
        const saved = serializeWorld(source, registry);
        expect(saved.document.entities[0].components.RenderMesh.mesh).toEqual({path: UNIT_CUBE_MESH_PATH});
        expect(saved.report.unsavedAssets).toEqual([]);
        expect(sceneAssetPaths(saved.document, registry)).toEqual([]);
        const target = new World({platform});
        const loaded = deserializeInto(target, registry, parseSceneDocument(JSON.stringify(saved.document)), {assets: platformSceneAssetLoader(platform)});
        const mesh = target.entityManager.getComponent<RenderMesh>(loaded.entities[0], RenderMesh)!.mesh;
        expect(mesh?.sourcePath).toBe(UNIT_CUBE_MESH_PATH);
        expect(serializeWorld(target, registry).document).toEqual(saved.document);
    });
});
