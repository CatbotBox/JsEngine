import {System} from "../../../core";
import {Camera} from "../../camera";
import {ConsoleScreenBuffer, ScreenBuffer} from "../consoleScreenBuffer";
import {LocalToWorld} from "../../../translation";
import {ScreenSize} from "../../screenSize";
import {ConsoleRenderPassSystemGroup} from "../consoleRenderPassSystemGroup";
import {Mesh} from "../../3d/mesh";
import {Ansi} from "../ansi";
import {Vec, Vec2, Vec3} from "../../../math/types/vec";
import {RenderMesh} from "../../3d/renderMesh";
import {WorldSpaceRenderBounds} from "../../worldSpaceRenderBounds";
import {FieldOfView} from "../../3d/fieldOfView";

function clamp(value: number, min: number, max: number): number {
    if (value > max) return max;
    if (value < min) return min;
    return value;
}

function perpendicular(a: Vec2): Vec2 {
    return [-a[1], a[0]]
}

function signedAreaTriangle(a: Vec2, b: Vec2, c: Vec2): number {
    const ac = Vec.sub(c, a);
    const abPerp = perpendicular(Vec.sub(b, a))
    return Vec.dot(ac, abPerp) / 2;
}

function pointInTriangle(verts: [Vec2, Vec2, Vec2], point: Vec2, outWeights: Vec3): boolean {
    const [a, b, c] = verts;
    const areaABP = signedAreaTriangle(a, b, point);
    const areaBCP = signedAreaTriangle(b, c, point);
    const areaCAP = signedAreaTriangle(c, a, point);

    const inTriangle: boolean = areaABP <= 0 && areaBCP <= 0 && areaCAP <= 0;

    const invAreaSum = 1 / (areaABP + areaBCP + areaCAP);
    outWeights[0] = areaBCP * invAreaSum;
    outWeights[1] = areaCAP * invAreaSum;
    outWeights[2] = areaABP * invAreaSum;

    return inTriangle
}

export class Console3DRenderPassSystem extends System {

    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize, LocalToWorld]);
    // always render these objects (no render bounds)
    private _alwaysRenderQuery = this.createEntityQuery([RenderMesh, LocalToWorld], [WorldSpaceRenderBounds]);
    // only render if visible
    private _selectiveRenderQuery = this.createEntityQuery([RenderMesh, LocalToWorld, WorldSpaceRenderBounds]);
    // private _octTree = new TrackedOctree<{
    //     consoleImage: ConsoleImage;
    //     zHeight: number;
    // }, EntityArchetype>();
    // private tracked: Set<EntityArchetype> = new Set();

    override systemGroup() {
        return ConsoleRenderPassSystemGroup;
    }

    override priority(): number {
        return 0;
    }

    protected onCreate() {
        // always require a camera
        this.requireAllForUpdate(this._cameraQuery)
        // and require at least one renderer object from either query
        this.requireAnyForUpdate(this._alwaysRenderQuery);
        this.requireAnyForUpdate(this._selectiveRenderQuery);
    }


    onUpdate() {
        const cameraEntity = this._cameraQuery.getSingleton({
            camera: Camera,
            screenSize: ScreenSize,
            localToWorld: LocalToWorld,
            fov: FieldOfView,
        });
        const screenSize = cameraEntity.screenSize;

        // Prepare current buffer
        const dualScreenBuffer = this.world.resources.tryGet(ConsoleScreenBuffer);
        if (!dualScreenBuffer) return
        const screenBuffer = dualScreenBuffer.screenBuffer;


        this._alwaysRenderQuery.stream({
            renderMesh: RenderMesh,
            localToWorld: LocalToWorld,
        }).collect()
            .filter(e => e.renderMesh.mesh !== undefined)
            .forEach(({renderMesh, localToWorld}) => {
                Console3DRenderPassSystem.DrawMesh(screenBuffer, renderMesh.mesh!, localToWorld, cameraEntity.localToWorld, cameraEntity.fov, screenSize)
            })
    }

    private static DrawMesh(screenBuffer: ScreenBuffer, mesh: Mesh, localToWorld: LocalToWorld, cameraLocalToWorld: LocalToWorld, fieldOfView: FieldOfView | undefined, screenSize: ScreenSize): void {

        const triangles = mesh.triangles;
        const vertices = mesh.vertices;

        const vertBuffer: [Vec3, Vec3, Vec3] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
        const readonlyVertBuffer: [Vec3, Vec3, Vec3] = [undefined, undefined, undefined] as any;
        // const AABB
        for (const triangle of triangles) {
            const currentTri = triangle;
            readonlyVertBuffer[0] = vertices.at(currentTri[0]);
            readonlyVertBuffer[1] = vertices.at(currentTri[1]);
            readonlyVertBuffer[2] = vertices.at(currentTri[2]);

            this.localSpaceToWorldSpace(readonlyVertBuffer, localToWorld, cameraLocalToWorld, vertBuffer);

            const screenSpacePoints = [
                this.worldSpaceToScreenSpace(vertBuffer[0], fieldOfView, screenSize),
                this.worldSpaceToScreenSpace(vertBuffer[1], fieldOfView, screenSize),
                this.worldSpaceToScreenSpace(vertBuffer[2], fieldOfView, screenSize)
            ] as [Vec2, Vec2, Vec2]

            // const uv1 = vertices.at(currentTri[0]);
            // const uv2 = vertices.at(currentTri[1]);
            // const uv3 = vertices.at(currentTri[2]);

            this.drawTriangleScreenSpace(screenBuffer, screenSize, screenSpacePoints, [vertBuffer[0][2], vertBuffer[1][2], vertBuffer[2][2]])
        }
    }

    //world space relative to the camera

    private static localSpaceToWorldSpace(point: [Vec3, Vec3, Vec3], localToWorld: LocalToWorld, cameraLocalToWorld: LocalToWorld, vec3Buffer: [Vec3, Vec3, Vec3]): [Vec3, Vec3, Vec3] {
        const relativeLocalToWorld = LocalToWorld.mul(LocalToWorld.invertAffine(cameraLocalToWorld.matrix), localToWorld.matrix);
        LocalToWorld.transformPoint(relativeLocalToWorld, point[0], vec3Buffer[0]);
        LocalToWorld.transformPoint(relativeLocalToWorld, point[1], vec3Buffer[1]);
        LocalToWorld.transformPoint(relativeLocalToWorld, point[2], vec3Buffer[2]);

        return vec3Buffer;
    }

    private static worldSpaceToScreenSpace(worldSpaceVert: Vec3, fieldOfView: FieldOfView | undefined, screenSize: ScreenSize): Vec2 {
        let pixelsPerWorldUnit = 1;
        if (fieldOfView !== undefined) {
            //this value in world space maps to the top of the screen
            // const fov = fieldOfView ? fieldOfView.radians : 0;
            // const screenHeightWorld = 5;
            const screenHeightWorld = Math.tan(fieldOfView.radians / 2) * 2;


            pixelsPerWorldUnit = screenSize.y / screenHeightWorld / worldSpaceVert[2];
        }
        const screenOffset = Vec.div(screenSize.vec, [2, 2] as Vec2);
        const pixelOffset = [worldSpaceVert[0] * pixelsPerWorldUnit, worldSpaceVert[1] * pixelsPerWorldUnit] as Vec2

        //ignore z for now
        // return [worldSpaceVert[0], worldSpaceVert[1]] as Vec2;
        // console.log(vert[2])
        // return [vert[0] / vert[2], vert[1] / vert[2]] as Vec2;
        return Vec.add(screenOffset, pixelOffset);
    }


    private static drawTriangleScreenSpace(screenBuffer: ScreenBuffer, screenSize: ScreenSize, screenspacePoints: [Vec2, Vec2, Vec2], depthData: Vec3) {
        //triangle on screen space

        const min = Vec.min(...screenspacePoints);
        const max = Vec.max(...screenspacePoints);


        const renderStartX = clamp(Math.floor(min[0]), 0, screenSize.x)
        const renderStartY = clamp(Math.floor(min[1]), 0, screenSize.y)
        const renderEndX = clamp(Math.ceil(max[0]), 0, screenSize.x)
        const renderEndY = clamp(Math.ceil(max[1]), 0, screenSize.y)
        // const triColor = Ansi.bgRGB(Math.ceil(Math.random() * 255), Math.ceil(Math.random() * 255), Math.ceil(Math.random() * 255));

        for (let y = renderStartY; y < renderEndY; y++) {
            for (let x = renderStartX; x < renderEndX; x++) {
                const screenPoint: Vec2 = [x, y];
                const weights: Vec3 = [0, 0, 0];
                if (!pointInTriangle(screenspacePoints, screenPoint, weights)) continue;
                const depths: Vec3 = [depthData[0], depthData[1], depthData[2]]
                const depth = Vec.dot(depths, weights);
                if (depth < 0) continue; //cull parts that are behind the camera
                const color = Math.ceil(255 - ((depth / 10) * 255));
                const depthColor = Ansi.bgRGB(color, color, color);
                screenBuffer.setPixels(depthColor + " " + Ansi.control.reset, x, y, depth);

            }
        }
    }


    override onEnable(): void {
        console.info("Enabled 3D render pass")
    }

    override onDisable(): void {
        console.info("Disabled 3D render pass")
    }
}
