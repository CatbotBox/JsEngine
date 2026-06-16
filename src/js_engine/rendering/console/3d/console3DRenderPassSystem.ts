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
import {TextureProvider} from "../../textureProvider";
import {ConsoleCellRatio} from "../../consoleCellRatio";
//
// // Terminal Settings
// const LINE_HEIGHT = 0.6;
// const CELL_WIDTH = 0.6;
// // Constants
// const CONSOLE_ASPECT_RATIO = LINE_HEIGHT / CELL_WIDTH; // Console chars are usually twice as tall as they are wide
const MAX_DEPTH_FADE = 15;      // Depth at which objects fade to black

function clamp(value: number, min: number, max: number): number {
    if (value > max) return max;
    if (value < min) return min;
    return value;
}

/**
 * Calculates the signed area of a 2D triangle using the 2D cross product.
 * Avoids array allocations for performance in tight loops.
 */
function signedAreaTriangle(a: Vec2, b: Vec2, c: Vec2): number {
    return ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
}

function pointInTriangle(verts: Vec2Array<3>, point: Vec2, outWeights: Vec3): boolean {
    const [a, b, c] = verts;

    // Calculate total area of the triangle once
    const areaABC = signedAreaTriangle(a, b, c);
    if (areaABC === 0) return false; // Cull degenerate triangles

    const areaABP = signedAreaTriangle(a, b, point);
    const areaBCP = signedAreaTriangle(b, c, point);
    const areaCAP = signedAreaTriangle(c, a, point);

    // Assuming a specific winding order (adjust signs if your faces are culled backwards)
    const inTriangle = areaABP <= 0 && areaBCP <= 0 && areaCAP <= 0;
    if (!inTriangle) return false;

    // Use the actual area of the triangle for mathematically correct barycentric weights
    const invArea = 1 / areaABC;
    outWeights[0] = areaBCP * invArea;
    outWeights[1] = areaCAP * invArea;
    outWeights[2] = areaABP * invArea;

    return true;
}

export class Console3DRenderPassSystem extends System {
    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize, LocalToWorld, FieldOfView, ConsoleCellRatio]);
    private _alwaysRenderQuery = this.createEntityQuery([RenderMesh, LocalToWorld], [WorldSpaceRenderBounds]);
    private _selectiveRenderQuery = this.createEntityQuery([RenderMesh, LocalToWorld, WorldSpaceRenderBounds]);

    override systemGroup() {
        return ConsoleRenderPassSystemGroup;
    }

    override priority(): number {
        return 0;
    }

    protected onCreate() {
        this.requireAllForUpdate(this._cameraQuery);
        this.requireAnyForUpdate(this._alwaysRenderQuery);
        this.requireAnyForUpdate(this._selectiveRenderQuery);
    }

    onUpdate() {
        const cameraEntity = this._cameraQuery.getSingleton({
            camera: Camera,
            screenSize: ScreenSize,
            consoleCellRatio: ConsoleCellRatio,
            localToWorld: LocalToWorld,
            fov: FieldOfView,
        });

        const dualScreenBuffer = this.world.resources.tryGet(ConsoleScreenBuffer);
        if (!dualScreenBuffer) return;

        const invertedCameraMatrix = LocalToWorld.invertAffine(cameraEntity.localToWorld.matrix);

        this._alwaysRenderQuery.stream({
            renderMesh: RenderMesh,
            localToWorld: LocalToWorld,
        }).collect()
            .filter(e => e.renderMesh.mesh !== undefined)
            .forEach(({renderMesh, localToWorld}) => {
                Console3DRenderPassSystem.drawMesh(
                    dualScreenBuffer.screenBuffer,
                    renderMesh.mesh!,
                    localToWorld,
                    invertedCameraMatrix,
                    cameraEntity.fov,
                    cameraEntity.screenSize,
                    cameraEntity.consoleCellRatio
                );
            });
    }

    private static drawMeshPreAllocations = {
        vertBuffer: new VecArray(3, 3),
        uvBuffer: new VecArray(3, 3),
        screenSpacePointsBuffer: new VecArray(3, 2),
        depthBuffer: [0, 0, 0] as Vec3,
    };
    private static NEAR_PLANE_Z = 0.1;

    private static intersectPlane(p1: Vec3, p2: Vec3, uv1: Vec2, uv2: Vec2): { p: Vec3, uv: Vec2 } {
        // Calculate interpolation factor 't' along the line segment
        const t = (this.NEAR_PLANE_Z - p1[2]) / (p2[2] - p1[2]);

        const p: Vec3 = [
            p1[0] + t * (p2[0] - p1[0]),
            p1[1] + t * (p2[1] - p1[1]),
            this.NEAR_PLANE_Z
        ];

        const uv: Vec2 = [
            uv1[0] + t * (uv2[0] - uv1[0]),
            uv1[1] + t * (uv2[1] - uv1[1])
        ];

        return {p, uv};
    }

    private static clipTriangleAgainstNearPlane(
        inVerts: Vec3[],
        inUVs: Vec2[]
    ): { verts: Vec3[], uvs: Vec2[] }[] {
        const insideVerts: Vec3[] = [];
        const insideUVs: Vec2[] = [];
        const outsideVerts: Vec3[] = [];
        const outsideUVs: Vec2[] = [];

        // Sort vertices into "inside" (in front of camera) and "outside" (behind camera)
        for (let i = 0; i < 3; i++) {
            if (inVerts[i][2] >= this.NEAR_PLANE_Z) {
                insideVerts.push(inVerts[i]);
                insideUVs.push(inUVs[i]);
            } else {
                outsideVerts.push(inVerts[i]);
                outsideUVs.push(inUVs[i]);
            }
        }

        // Case 0: Entirely behind camera. Draw nothing.
        if (insideVerts.length === 0) return [];

        // Case 3: Entirely in front of camera. Draw as-is.
        if (insideVerts.length === 3) {
            return [{verts: inVerts, uvs: inUVs}];
        }

        // Case 1: One vertex inside, two outside. The triangle is clipped into a smaller triangle.
        if (insideVerts.length === 1) {
            const intersection1 = this.intersectPlane(insideVerts[0], outsideVerts[0], insideUVs[0], outsideUVs[0]);
            const intersection2 = this.intersectPlane(insideVerts[0], outsideVerts[1], insideUVs[0], outsideUVs[1]);

            return [{
                verts: [insideVerts[0], intersection1.p, intersection2.p],
                uvs: [insideUVs[0], intersection1.uv, intersection2.uv]
            }];
        }

        // Case 2: Two vertices inside, one outside. The triangle is clipped into a quad, which becomes 2 new triangles.
        if (insideVerts.length === 2) {
            const intersection1 = this.intersectPlane(insideVerts[0], outsideVerts[0], insideUVs[0], outsideUVs[0]);
            const intersection2 = this.intersectPlane(insideVerts[1], outsideVerts[0], insideUVs[1], outsideUVs[0]);

            return [
                { // Triangle 1 of the new quad
                    verts: [insideVerts[0], insideVerts[1], intersection1.p],
                    uvs: [insideUVs[0], insideUVs[1], intersection1.uv]
                },
                { // Triangle 2 of the new quad
                    verts: [insideVerts[1], intersection2.p, intersection1.p],
                    uvs: [insideUVs[1], intersection2.uv, intersection1.uv]
                }
            ];
        }

        return [];
    }

    private static drawMesh(screenBuffer: ScreenBuffer, mesh: Mesh, localToWorld: LocalToWorld, invertedCameraMatrix: Vec16, fieldOfView: FieldOfView | undefined, screenSize: ScreenSize, consoleCellRatio: ConsoleCellRatio): void {
        const {screenSpacePointsBuffer, depthBuffer} = this.drawMeshPreAllocations;
        // View space vertices (relative to camera)
        const viewSpaceVertices = this.localSpaceToWorldSpace(mesh.vertices, localToWorld, invertedCameraMatrix);

        for (const currentTri of mesh.triangles) {

            // 1. Gather view-space vertices and UVs for this triangle
            const triVerts = [
                viewSpaceVertices.at(currentTri[0]),
                viewSpaceVertices.at(currentTri[1]),
                viewSpaceVertices.at(currentTri[2])
            ];

            const triUVs = [
                mesh.uvs.at(currentTri[0]),
                mesh.uvs.at(currentTri[1]),
                mesh.uvs.at(currentTri[2])
            ];

            // 2. Clip against the near plane
            const clippedTriangles = this.clipTriangleAgainstNearPlane(triVerts, triUVs);

            // 3. Project and draw the resulting triangle(s)
            for (const clippedTri of clippedTriangles) {
                // Project to screen space
                screenSpacePointsBuffer.set(this.worldSpaceToScreenSpace(clippedTri.verts[0], fieldOfView, screenSize, consoleCellRatio), 0);
                screenSpacePointsBuffer.set(this.worldSpaceToScreenSpace(clippedTri.verts[1], fieldOfView, screenSize, consoleCellRatio), 1);
                screenSpacePointsBuffer.set(this.worldSpaceToScreenSpace(clippedTri.verts[2], fieldOfView, screenSize, consoleCellRatio), 2);

                // Set depth buffer
                depthBuffer[0] = clippedTri.verts[0][2];
                depthBuffer[1] = clippedTri.verts[1][2];
                depthBuffer[2] = clippedTri.verts[2][2];

                // Write UVs to your pre-allocated format
                const uvBuffer = new VecArray(3, 3); // Consider pre-allocating an array of these to avoid this allocation!
                uvBuffer.set([clippedTri.uvs[0][0], clippedTri.uvs[0][1], 0], 0);
                uvBuffer.set([clippedTri.uvs[1][0], clippedTri.uvs[1][1], 0], 1);
                uvBuffer.set([clippedTri.uvs[2][0], clippedTri.uvs[2][1], 0], 2);

                this.drawTriangleScreenSpace(screenBuffer, screenSize, screenSpacePointsBuffer, depthBuffer, uvBuffer, TextureProvider.defaultTexture);
            }
        }
    }

    private static localSpaceToWorldSpace(points: Vec3Array, localToWorld: LocalToWorld, invertedCamMatrix: Vec16, vec3Buffer: Vec3Array = new VecArray(points.length, 3)): Vec3Array {
        const relativeLocalToWorld = LocalToWorld.mul(invertedCamMatrix, localToWorld.matrix);
        for (let i = 0; i < points.length; i++) {
            LocalToWorld.transformPoint(relativeLocalToWorld, points.at(i), vec3Buffer.at(i));
        }
        return vec3Buffer;
    }

    private static worldSpaceToScreenSpace(worldSpaceVert: Vec3, fieldOfView: FieldOfView | undefined, screenSize: ScreenSize, consoleCellRatio: ConsoleCellRatio): Vec2 {
        let pixelsPerWorldUnit = 1;
        if (fieldOfView !== undefined) {
            const screenHeightWorld = Math.tan(fieldOfView.radians / 2) * 2;
            pixelsPerWorldUnit = screenSize.y / screenHeightWorld / worldSpaceVert[2];
        }

        const screenOffset = Vec.div(screenSize.vec, [2, 2] as Vec2);
        const pixelOffset = [
            worldSpaceVert[0] * pixelsPerWorldUnit * consoleCellRatio.value,
            worldSpaceVert[1] * pixelsPerWorldUnit
        ] as Vec2;

        return Vec.add(screenOffset, pixelOffset);
    }

    static drawTriangleScreenSpacePreAllocations = {
        screenPoint: [0, 0] as Vec2,
        weights: [0, 0, 0] as Vec3,
        // color: [218, 96, 239] as Vec3,
        color: [255, 255, 255] as Vec3,
        uv: [0, 0] as Vec2,
        // Pre-calculate 1/Z for the 3 vertices to save time in the loop
        invDepthData: [0, 0, 0] as Vec3,
    };

    private static drawTriangleScreenSpace(
        screenBuffer: ScreenBuffer,
        screenSize: ScreenSize,
        screenspacePoints: Vec2Array<3>,
        depthData: Vec3,
        uvs: Vec3Array<3>,
        textureProvider: TextureProvider
    ) {
        const min = Vec.min(...screenspacePoints);
        const max = Vec.max(...screenspacePoints);

        const renderStartX = clamp(Math.floor(min[0]), 0, screenSize.x);
        const renderStartY = clamp(Math.floor(min[1]), 0, screenSize.y);
        const renderEndX = clamp(Math.ceil(max[0]), 0, screenSize.x);
        const renderEndY = clamp(Math.ceil(max[1]), 0, screenSize.y);

        const {screenPoint, weights, color, uv, invDepthData} = this.drawTriangleScreenSpacePreAllocations;

        // Pre-compute 1/Z for perspective correction
        invDepthData[0] = 1 / depthData[0];
        invDepthData[1] = 1 / depthData[1];
        invDepthData[2] = 1 / depthData[2];

        // Pre-compute U/Z and V/Z
        const u0z = uvs.at(0)[0] * invDepthData[0];
        const v0z = uvs.at(0)[1] * invDepthData[0];
        const u1z = uvs.at(1)[0] * invDepthData[1];
        const v1z = uvs.at(1)[1] * invDepthData[1];
        const u2z = uvs.at(2)[0] * invDepthData[2];
        const v2z = uvs.at(2)[1] * invDepthData[2];

        for (let y = renderStartY; y < renderEndY; y++) {
            for (let x = renderStartX; x < renderEndX; x++) {
                screenPoint[0] = x;
                screenPoint[1] = y;

                if (!pointInTriangle(screenspacePoints, screenPoint, weights)) continue;

                // 1. Interpolate 1/Z
                const interpolatedInvZ =
                    invDepthData[0] * weights[0] +
                    invDepthData[1] * weights[1] +
                    invDepthData[2] * weights[2];

                // The true pixel depth
                const depth = 1 / interpolatedInvZ;

                // Cull parts behind the near plane (just in case clipping missed a microscopic sliver)
                if (depth < 0.1) continue;

                // 2. Interpolate U/Z and V/Z, then multiply by true depth to get final UV
                uv[0] = (u0z * weights[0] + u1z * weights[1] + u2z * weights[2]) * depth;
                uv[1] = (v0z * weights[0] + v1z * weights[1] + v2z * weights[2]) * depth;

                // --- NOW YOU CAN USE `uv` TO SAMPLE YOUR TEXTURE ---
                // color = textureProvider.getColorAt(uv);

                const depthFade = clamp(1 - (depth / MAX_DEPTH_FADE), 0, 1);
                const r = Math.ceil(depthFade * color[0]);
                const g = Math.ceil(depthFade * color[1]);
                const b = Math.ceil(depthFade * color[2]);

                const depthColor = Ansi.bgRGB(r, g, b);
                screenBuffer.setPixels(depthColor + " " + Ansi.control.reset, x, y, depth);
            }
        }
    }

    override onEnable(): void {
        console.info("Enabled 3D render pass");
    }

    override onDisable(): void {
        console.info("Disabled 3D render pass");
    }
}