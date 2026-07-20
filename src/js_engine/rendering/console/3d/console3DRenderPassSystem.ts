import {System} from "../../../core";
import {Camera} from "../../camera";
import {ConsoleScreenBuffer, ScreenBuffer} from "../consoleScreenBuffer";
import {LocalToWorld} from "../../../translation";
import {ScreenSize} from "../../screenSize";
import {ConsoleRenderPassSystemGroup} from "../consoleRenderPassSystemGroup";
import {Mesh} from "../../3d/mesh";
import {Vec16} from "../../../math/types/vec";
import {RenderMesh} from "../../3d/renderMesh";
import {WorldSpaceRenderBounds} from "../../worldSpaceRenderBounds";
import {FieldOfView} from "../../3d/fieldOfView";
import {ConsoleCellRatio} from "../../consoleCellRatio";
import {MeshRasterizer, MeshRasterizerConfig} from "./meshRasterizer";
import {RenderMeshBoundsSystem} from "../../3d/renderMeshBoundsSystem";

function defaultWorkerCount(): number {
    const env = typeof process !== "undefined" ? process.env.JSENGINE_RASTER_THREADS : undefined;
    if (env !== undefined) {
        const parsed = Number.parseInt(env, 10);
        if (Number.isFinite(parsed)) return Math.max(0, Math.min(15, parsed));
    }
    try {
        const os = require("os") as typeof import("os");
        const cores: number = os.availableParallelism?.() ?? os.cpus().length;
        return Math.max(0, Math.min(7, cores - 1));
    } catch {
        return 0;
    }
}

export class Console3DRenderPassSystem extends System {
    /** Depth at which objects fade to black. */
    public static maxDepthFade = 15;
    /**
     * Mask ANDed onto every packed color. Dropping the low 2 bits per channel
     * (default) is visually indistinguishable in a terminal but makes adjacent
     * cells share colors far more often, which the flush encoder turns into
     * much shorter ANSI output. Set to 0xFFFFFF for exact colors.
     */
    public static colorQuantMask = 0xFCFCFC;
    /**
     * Antialiasing: cells are rasterized as supersample² subsamples and
     * averaged (2 is a good default; 1 disables AA entirely).
     */
    public static supersample = 2;
    /** Worker threads for rasterization; 0 forces single-threaded. Overridable via JSENGINE_RASTER_THREADS. */
    public static workerCount = defaultWorkerCount();
    /** Batches smaller than both thresholds rasterize on the main thread (thread wake-up isn't free). */
    public static threadTriangleThreshold = 2048;
    public static threadAreaThreshold = 50_000;

    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize, LocalToWorld, FieldOfView, ConsoleCellRatio]);
    private _alwaysRenderQuery = this.createEntityQuery([RenderMesh, LocalToWorld], [WorldSpaceRenderBounds]);
    private _selectiveRenderQuery = this.createEntityQuery([RenderMesh, LocalToWorld, WorldSpaceRenderBounds]);

    private _rasterizer = new MeshRasterizer();
    private _modelViewScratch = new Float32Array(16);
    private static _benchRasterizer?: MeshRasterizer;

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
        this.world.ensureSystemExists(RenderMeshBoundsSystem);
    }

    private static currentConfig(): MeshRasterizerConfig {
        return {
            maxDepthFade: Console3DRenderPassSystem.maxDepthFade,
            colorQuantMask: Console3DRenderPassSystem.colorQuantMask,
            supersample: Console3DRenderPassSystem.supersample,
            workerCount: Console3DRenderPassSystem.workerCount,
            threadTriangleThreshold: Console3DRenderPassSystem.threadTriangleThreshold,
            threadAreaThreshold: Console3DRenderPassSystem.threadAreaThreshold,
        };
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

        const width = cameraEntity.screenSize.x | 0;
        const height = cameraEntity.screenSize.y | 0;
        const cellRatio = cameraEntity.consoleCellRatio.value;
        const invertedCameraMatrix = LocalToWorld.invertAffine(cameraEntity.localToWorld.matrix);
        const focalLength = cameraEntity.fov !== undefined
            ? height / (Math.tan(cameraEntity.fov.radians / 2) * 2)
            : undefined;

        const rasterizer = this._rasterizer;
        rasterizer.beginFrame(dualScreenBuffer.screenBuffer, width, height, Console3DRenderPassSystem.currentConfig());

        this._alwaysRenderQuery.stream({
            renderMesh: RenderMesh,
            localToWorld: LocalToWorld,
        }).forEach(({renderMesh, localToWorld}) => {
            if (renderMesh.mesh === undefined) return;
            LocalToWorld.mul(invertedCameraMatrix, localToWorld.matrix, this._modelViewScratch as Vec16);
            rasterizer.addMesh(renderMesh.mesh, this._modelViewScratch, focalLength, cellRatio, renderMesh.color);
        });

        // Entities carrying WorldSpaceRenderBounds get a cheap conservative
        // frustum test before their triangles are even touched.
        this._selectiveRenderQuery.stream({
            renderMesh: RenderMesh,
            localToWorld: LocalToWorld,
            bounds: WorldSpaceRenderBounds,
        }).forEach(({renderMesh, localToWorld, bounds}) => {
            if (renderMesh.mesh === undefined) return;
            if (!Console3DRenderPassSystem.boundsMayBeVisible(bounds, invertedCameraMatrix, focalLength, cellRatio, width, height)) return;
            LocalToWorld.mul(invertedCameraMatrix, localToWorld.matrix, this._modelViewScratch as Vec16);
            rasterizer.addMesh(renderMesh.mesh, this._modelViewScratch, focalLength, cellRatio, renderMesh.color);
        });

        rasterizer.endFrame();
    }

    /**
     * Conservative visibility test for a world-space AABB: transform its 8
     * corners into view space; cull only when all of them are behind the near
     * plane, or the whole projected extent falls outside the screen.
     */
    private static boundsMayBeVisible(
        bounds: WorldSpaceRenderBounds,
        invertedCameraMatrix: Vec16,
        focalLength: number | undefined,
        cellRatio: number,
        width: number,
        height: number,
    ): boolean {
        const m = invertedCameraMatrix;
        const NEAR = 0.1;
        const halfW = width / 2, halfH = height / 2;

        let anyInFront = false;
        let anyDepthUncertain = false;
        let minX = Number.POSITIVE_INFINITY, maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY;

        for (let corner = 0; corner < 8; corner++) {
            const x = (corner & 1) === 0 ? bounds.xMin : bounds.xMax;
            const y = (corner & 2) === 0 ? bounds.yMin : bounds.yMax;
            const z = (corner & 4) === 0 ? bounds.zMin : bounds.zMax;

            const vx = m[0] * x + m[4] * y + m[8] * z + m[12];
            const vy = m[1] * x + m[5] * y + m[9] * z + m[13];
            const vz = m[2] * x + m[6] * y + m[10] * z + m[14];

            if (vz < NEAR) {
                // A corner behind the camera makes the projected extent
                // unbounded — don't try to screen-cull in that case.
                anyDepthUncertain = true;
                continue;
            }
            anyInFront = true;

            const ppu = focalLength !== undefined ? focalLength / vz : 1;
            const sx = halfW + vx * ppu * cellRatio;
            const sy = halfH - vy * ppu; // Y-up view space → Y-down screen rows, as in emitTriangle
            if (sx < minX) minX = sx;
            if (sx > maxX) maxX = sx;
            if (sy < minY) minY = sy;
            if (sy > maxY) maxY = sy;
        }

        if (!anyInFront) return false;
        if (anyDepthUncertain) return true;
        return maxX > 0 && minX < width && maxY > 0 && minY < height;
    }

    /**
     * Benchmark/testing entry point mirroring the old private drawMesh:
     * renders one mesh into the buffer, including composition.
     */
    public static drawMeshForBenchmark(
        screenBuffer: ScreenBuffer,
        mesh: Mesh,
        localToWorld: LocalToWorld,
        invertedCameraMatrix: Vec16,
        fieldOfView: FieldOfView | undefined,
        screenSize: ScreenSize,
        consoleCellRatio: ConsoleCellRatio,
    ): void {
        const rasterizer = (this._benchRasterizer ??= new MeshRasterizer());
        const width = screenSize.x | 0;
        const height = screenSize.y | 0;
        const focalLength = fieldOfView !== undefined
            ? height / (Math.tan(fieldOfView.radians / 2) * 2)
            : undefined;

        rasterizer.beginFrame(screenBuffer, width, height, this.currentConfig());
        const modelView = LocalToWorld.mul(invertedCameraMatrix, localToWorld.matrix) as Float32Array;
        rasterizer.addMesh(mesh, modelView, focalLength, consoleCellRatio.value, 0xFFFFFF);
        rasterizer.endFrame();
    }

    public static disposeRasterPool(): void {
        this._benchRasterizer?.dispose();
        this._benchRasterizer = undefined;
    }

    override onDestroy(): void {
        this._rasterizer.dispose();
    }

    override onEnable(): void {
        console.info("Enabled 3D render pass");
    }

    override onDisable(): void {
        console.info("Disabled 3D render pass");
    }
}
