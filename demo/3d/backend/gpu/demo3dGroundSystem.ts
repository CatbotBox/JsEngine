import {NULL_ENTITY, System} from "@jsengine/engine/core";
import type {Entity} from "@jsengine/engine/core";
import {Vec} from "@jsengine/engine/math";
import {GpuRenderBackend} from "@jsengine/engine/rendering";
import {Material, Mesh, MeshBuilder, RenderMesh} from "@jsengine/engine/rendering/3d";
import {LocalPosition, LocalToWorld} from "@jsengine/engine/translation";
import {Demo3dConfig} from "../../config";
import type {GroundPlaneConfig} from "../../config";

export const GROUND_ENTITY_NAME = "ground";
const GROUND_MATERIAL_NAME = "ground";
const GROUND_PRIORITY = -15;
const GROUND_MATERIAL = 0;
const CENTRED = 0;
const FLAT = 0;
const UV_LOW = 0;
const UV_HIGH = 1;
const NEAR_LEFT = 0;
const FAR_LEFT = 1;
const NEAR_RIGHT = 2;
const FAR_RIGHT = 3;

export function groundPlaneMesh(config: GroundPlaneConfig): Mesh {
    const half = config.halfSizeUnits;
    const builder = new MeshBuilder();
    builder.vertices.push(Vec.alloc3(-half, FLAT, -half), Vec.alloc3(-half, FLAT, half), Vec.alloc3(half, FLAT, -half), Vec.alloc3(half, FLAT, half));
    builder.uvs.push(Vec.alloc2(UV_LOW, UV_LOW), Vec.alloc2(UV_LOW, UV_HIGH), Vec.alloc2(UV_HIGH, UV_LOW), Vec.alloc2(UV_HIGH, UV_HIGH));
    builder.triangles.push(Vec.alloc3(NEAR_LEFT, FAR_LEFT, NEAR_RIGHT), Vec.alloc3(FAR_LEFT, FAR_RIGHT, NEAR_RIGHT));
    builder.materials.push(new Material(GROUND_MATERIAL_NAME, config.color));
    builder.vertexMaterial.push(GROUND_MATERIAL, GROUND_MATERIAL, GROUND_MATERIAL, GROUND_MATERIAL);
    builder.generateNormals();
    return new Mesh(builder);
}

export class Demo3dGroundSystem extends System {
    private _ground: Entity = NULL_ENTITY;

    override priority(): number {
        return GROUND_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(GpuRenderBackend);
        this.requireResourceForUpdate(Demo3dConfig);
    }

    onUpdate(): void {
        if (this._ground !== NULL_ENTITY && this.entityManager.exists(this._ground)) return;
        const config = this.world.resources.get(Demo3dConfig).groundPlane;
        this._ground = this.entityManager.createEntity(GROUND_ENTITY_NAME, [
            new RenderMesh(groundPlaneMesh(config)),
            new LocalPosition(CENTRED, config.heightUnits, CENTRED),
            new LocalToWorld(),
        ]);
    }
}
