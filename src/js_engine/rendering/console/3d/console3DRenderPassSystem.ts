import {System} from "../../../core";
import {Camera} from "../../camera";
import {ConsoleScreenBuffer, ScreenBuffer} from "../consoleScreenBuffer";
import {LocalToWorld} from "../../../translation";
import {ScreenSize} from "../../screenSize";
import {ConsoleRenderPassSystemGroup} from "../consoleRenderPassSystemGroup";
import {Mesh} from "../../3d/mesh";
import {Ansi} from "../ansi";
import {Vec, Vec16, Vec2, Vec3} from "../../../math/types/vec";
import {RenderMesh} from "../../3d/renderMesh";
import {WorldSpaceRenderBounds} from "../../worldSpaceRenderBounds";
import {FieldOfView} from "../../3d/fieldOfView";
import {Vec2Array, Vec3Array, VecArray} from "../../../math/types/vecArray";

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

function pointInTriangle(verts: Vec2Array<3>, point: Vec2, outWeights: Vec3): boolean {
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

        const invertedCameraMatrix = LocalToWorld.invertAffine(cameraEntity.localToWorld.matrix)

        this._alwaysRenderQuery.stream({
            renderMesh: RenderMesh,
            localToWorld: LocalToWorld,
        }).collect()
            .filter(e => e.renderMesh.mesh !== undefined)
            .forEach(({renderMesh, localToWorld}) => {
                Console3DRenderPassSystem.drawMesh(screenBuffer, renderMesh.mesh!, localToWorld, invertedCameraMatrix, cameraEntity.fov, screenSize)
            })
    }

    private static drawMeshPreAllocations = {
        vertBuffer: new VecArray(3, 3),
        screenSpacePointsBuffer: new VecArray(3, 2),
        depthBuffer: [0, 0, 0] as Vec3,
    };

    private static drawMesh(screenBuffer: ScreenBuffer, mesh: Mesh, localToWorld: LocalToWorld, invertedCameraMatrix: Vec16, fieldOfView: FieldOfView | undefined, screenSize: ScreenSize): void {

        const triangles = mesh.triangles;

        const vertBuffer = this.drawMeshPreAllocations.vertBuffer;
        const screenSpacePointsBuffer = this.drawMeshPreAllocations.screenSpacePointsBuffer;
        const worldSpaceVertices = this.localSpaceToWorldSpace(mesh.vertices, localToWorld, invertedCameraMatrix);


        // const AABB
        for (const triangle of triangles) {
            const currentTri = triangle;
            vertBuffer.set(worldSpaceVertices.at(currentTri[0]), 0);
            vertBuffer.set(worldSpaceVertices.at(currentTri[1]), 1);
            vertBuffer.set(worldSpaceVertices.at(currentTri[2]), 2);

            screenSpacePointsBuffer.set(this.worldSpaceToScreenSpace(vertBuffer.at(0), fieldOfView, screenSize), 0);
            screenSpacePointsBuffer.set(this.worldSpaceToScreenSpace(vertBuffer.at(1), fieldOfView, screenSize), 1);
            screenSpacePointsBuffer.set(this.worldSpaceToScreenSpace(vertBuffer.at(2), fieldOfView, screenSize), 2);


            // if (this.triangleLevelBackfaceCulling(screenSpacePointsBuffer)) return;

            // const uv1 = vertices.at(currentTri[0]);
            // const uv2 = vertices.at(currentTri[1]);
            // const uv3 = vertices.at(currentTri[2]);

            const depthBuffer = this.drawMeshPreAllocations.depthBuffer;
            depthBuffer[0] = vertBuffer.at(0)[2];
            depthBuffer[1] = vertBuffer.at(1)[2];
            depthBuffer[2] = vertBuffer.at(2)[2];

            this.drawTriangleScreenSpace(screenBuffer, screenSize, screenSpacePointsBuffer, depthBuffer)

        }
    }

    // private static triangleLevelBackfaceCulling(points: Vec2Array<3>): boolean {
    //     const x0 = points.at(0)[0];
    //     const x1 = points.at(1)[0];
    //     const x2 = points.at(2)[0];
    //     const y0 = points.at(0)[1];
    //     const y1 = points.at(1)[1];
    //     const y2 = points.at(2)[1];
    //     const value = (((x1 - x0) * (y2 - y0)) - ((x2 - x0) * (y1 - y0)));
    //     // if (value > 0) {
    //     //     this.triCullDebug[2] = true;
    //     // } else if (value < 0) {
    //     //     this.triCullDebug[0] = true
    //     // } else if (value == 0) {
    //     //     this.triCullDebug[1] = true
    //     // }
    //
    //     return value > 0;
    // }

    //world space relative to the camera

    private static localSpaceToWorldSpace(points: Vec3Array, localToWorld: LocalToWorld, invertedCamMatrix: Vec16, vec3Buffer: Vec3Array = new VecArray(points.length, 3)): Vec3Array {
        const relativeLocalToWorld = LocalToWorld.mul(invertedCamMatrix, localToWorld.matrix);
        for (let index = 0; index < points.length; index++) {
            const point = points.at(index);
            LocalToWorld.transformPoint(relativeLocalToWorld, point, vec3Buffer.at(index));
        }
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
        const pixelOffset = [worldSpaceVert[0] * pixelsPerWorldUnit * 2, worldSpaceVert[1] * pixelsPerWorldUnit] as Vec2

        //ignore z for now
        // return [worldSpaceVert[0], worldSpaceVert[1]] as Vec2;
        // console.log(vert[2])
        // return [vert[0] / vert[2], vert[1] / vert[2]] as Vec2;
        return Vec.add(screenOffset, pixelOffset);
    }

    static drawTriangleScreenSpacePreAllocations = {
        screenPoint: [0, 0] as Vec2,
        weights: [0, 0, 0] as Vec3,
    }

    private static drawTriangleScreenSpace(screenBuffer: ScreenBuffer, screenSize: ScreenSize, screenspacePoints: Vec2Array<3>, depthData: Vec3) {
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
                const screenPoint = this.drawTriangleScreenSpacePreAllocations.screenPoint;
                screenPoint[0] = x;
                screenPoint[1] = y;
                const weights = this.drawTriangleScreenSpacePreAllocations.weights
                if (!pointInTriangle(screenspacePoints, screenPoint, weights)) {
                    // this.triangleLevelBackfaceCulling(screenspacePoints);
                    // screenBuffer.setPixels(Ansi.colors.bg.red + " " + Ansi.control.reset, x, y, Number.POSITIVE_INFINITY / 2);
                    continue;
                }
                // if (this.triangleLevelBackfaceCulling(screenspacePoints)) return;

                const depth = Vec.dot(depthData, weights);
                if (depth < 0) continue; //cull parts that are behind the camera
                const color = Math.ceil(255 - ((depth / 15) * 255));
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
