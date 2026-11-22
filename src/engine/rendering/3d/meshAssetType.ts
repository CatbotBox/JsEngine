import {Vec} from "../../math/types/vec";
import type {AssetType} from "../../scene/assetTypes";
import {BUILT_IN_MESH_PATHS, isBuiltInAssetPath, MESH_ASSET_TYPE_NAME, UNIT_CUBE_MESH_PATH} from "../../scene/fieldSchema";
import {Mesh, MeshBuilder} from "./mesh";
import type {MeshLoadOptions} from "./mesh";

type Axis = readonly [number, number, number];

interface CubeFace {
    readonly normal: Axis;
    readonly tangent: Axis;
    readonly bitangent: Axis;
}

const MESH_FILE_SUFFIXES: readonly string[] = [".obj"];
const UNIT_CUBE_HALF_EXTENT = 0.5;
const UV_PER_SIGN = 0.5;
const UV_AT_CENTRE = 0.5;
const X_AXIS = 0;
const Y_AXIS = 1;
const Z_AXIS = 2;

const CUBE_FACES: readonly CubeFace[] = [
    {normal: [1, 0, 0], tangent: [0, 1, 0], bitangent: [0, 0, 1]},
    {normal: [-1, 0, 0], tangent: [0, 0, 1], bitangent: [0, 1, 0]},
    {normal: [0, 1, 0], tangent: [0, 0, 1], bitangent: [1, 0, 0]},
    {normal: [0, -1, 0], tangent: [1, 0, 0], bitangent: [0, 0, 1]},
    {normal: [0, 0, 1], tangent: [1, 0, 0], bitangent: [0, 1, 0]},
    {normal: [0, 0, -1], tangent: [0, 1, 0], bitangent: [1, 0, 0]},
];
const FACE_CORNER_SIGNS: readonly (readonly [number, number])[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const FACE_TRIANGLE_CORNERS: readonly (readonly [number, number, number])[] = [[0, 1, 2], [0, 2, 3]];

function cubeCorner(face: CubeFace, tangentSign: number, bitangentSign: number, axis: number): number {
    return (face.normal[axis] + face.tangent[axis] * tangentSign + face.bitangent[axis] * bitangentSign) * UNIT_CUBE_HALF_EXTENT;
}

function uvOfSign(sign: number): number {
    return sign * UV_PER_SIGN + UV_AT_CENTRE;
}

export function createUnitCubeMesh(): Mesh {
    const builder = new MeshBuilder();
    for (const face of CUBE_FACES) {
        const firstCorner = builder.vertices.length;
        for (const [tangentSign, bitangentSign] of FACE_CORNER_SIGNS) {
            builder.vertices.push(Vec.alloc3(
                cubeCorner(face, tangentSign, bitangentSign, X_AXIS),
                cubeCorner(face, tangentSign, bitangentSign, Y_AXIS),
                cubeCorner(face, tangentSign, bitangentSign, Z_AXIS),
            ));
            builder.normals.push(Vec.alloc3(face.normal[X_AXIS], face.normal[Y_AXIS], face.normal[Z_AXIS]));
            builder.uvs.push(Vec.alloc2(uvOfSign(tangentSign), uvOfSign(bitangentSign)));
        }
        for (const [a, b, c] of FACE_TRIANGLE_CORNERS) builder.triangles.push(Vec.alloc3(firstCorner + a, firstCorner + b, firstCorner + c));
    }
    return new Mesh(builder, UNIT_CUBE_MESH_PATH);
}

const BUILT_IN_MESH_FACTORIES: ReadonlyMap<string, () => Mesh> = new Map([[UNIT_CUBE_MESH_PATH, createUnitCubeMesh]]);

export function createBuiltInMesh(path: string): Mesh {
    const create = BUILT_IN_MESH_FACTORIES.get(path);
    if (create === undefined) throw new Error(`"${path}" names no built-in mesh; the built-in meshes are ${BUILT_IN_MESH_PATHS.join(", ")}`);
    return create();
}

function loadMesh(path: string, options: MeshLoadOptions): Mesh {
    return isBuiltInAssetPath(path) ? createBuiltInMesh(path) : Mesh.fromFile(path, options);
}

export const MESH_ASSET_TYPE: AssetType<Mesh> = {
    name: MESH_ASSET_TYPE_NAME,
    valueName: "Mesh",
    fileSuffixes: MESH_FILE_SUFFIXES,
    builtInPaths: BUILT_IN_MESH_PATHS,
    isAsset: (value): value is Mesh => value instanceof Mesh,
    load: (path, loader) => loader.loadCached(MESH_ASSET_TYPE_NAME, path, () => loadMesh(path, loader.loadOptions)),
    pathOf: mesh => mesh.sourcePath,
};
