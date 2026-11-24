import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {World} from "../../engine/core/world";
import {RootSystemGroup} from "../../engine/core/rootSystemGroup";
import type {Component, Entity} from "../../engine/core";
import {Camera} from "../../engine/rendering/camera";
import {HudElement} from "../../engine/rendering/hudElement";
import {ScreenAnchor} from "../../engine/rendering/screenAnchor";
import type {AnchorPosition} from "../../engine/rendering/screenAnchor";
import {TextColor} from "../../engine/rendering/textColor";
import {TextSprite} from "../../engine/rendering/textSprite";
import {Sprite} from "../../engine/rendering/2d/sprite";
import {SpriteImage} from "../../engine/rendering/2d/spriteImage";
import {LocalPosition, LocalToWorld} from "../../engine/translation";
import {MemoryPixelPresenter} from "../pixels/memoryPixelPresenter";
import {PixelPresenterResource} from "../pixels/pixelPresenterResource";
import {PixelFramebuffer} from "../pixels/pixelFramebuffer";
import {RGBA_BYTES_PER_PIXEL} from "../pixels/pixelFrame";
import type {PixelFrame} from "../pixels/pixelFrame";
import {PixelRenderSettings} from "../pixels/pixelRenderSettings";
import {TextSpritePixelPassSystem} from "../pixels/textSpritePixelPassSystem";
import {HudTextSpritePixelPassSystem} from "../pixels/hudTextSpritePixelPassSystem";
import {SpritePixelPassSettings} from "../pixels/2d/spritePixelPassSettings";
import {SpritePixelPassSystem} from "../pixels/2d/spritePixelPassSystem";
import {HudSpritePixelPassSystem} from "../pixels/2d/hudSpritePixelPassSystem";
import {GpuFrame} from "./gpuFrame";
import {FakeCanvas, FakeCanvasContext, FakeGpuDevice} from "./testing/fakeGpuDevice";
import type {FakeGpuTexture, RecordedTextureWrite} from "./testing/fakeGpuDevice";

const FORMAT: GPUTextureFormat = "bgra8unorm";
const SIZE = {widthPx: 320, heightPx: 192};
const RESIZED = {widthPx: 256, heightPx: 160};
const WHOLE_FRAME_BYTES = SIZE.widthPx * SIZE.heightPx * RGBA_BYTES_PER_PIXEL;
const FRAMES_PER_STEP = 2;
const WHITE_RGB = 0xFFFFFF, RED_RGB = 0xFF0000;
const OTHER_BACKGROUND_RGB = 0x102030;
const OVERLAY_LABEL = "overlay";

interface Origin {
    readonly x?: number;
    readonly y?: number;
}

interface Extent {
    readonly width: number;
    readonly height: number;
}

class OverlayMirror {
    private readonly copies = new Map<FakeGpuTexture, Uint8Array>();
    private applied = 0;

    public constructor(private readonly device: FakeGpuDevice) {
    }

    public overlayContent(): {readonly texture: FakeGpuTexture, readonly rgba: Uint8Array} {
        const writes = this.device.queue.textureWrites;
        for (; this.applied < writes.length; this.applied++) this.apply(writes[this.applied]);
        const texture = this.device.liveTextures().find(each => each.descriptor.label === OVERLAY_LABEL)!;
        return {texture, rgba: this.copyOf(texture)};
    }

    private copyOf(texture: FakeGpuTexture): Uint8Array {
        let copy = this.copies.get(texture);
        if (copy === undefined) {
            const size = texture.descriptor.size as Extent;
            copy = new Uint8Array(size.width * size.height * RGBA_BYTES_PER_PIXEL);
            this.copies.set(texture, copy);
        }
        return copy;
    }

    private apply(write: RecordedTextureWrite): void {
        const copy = this.copyOf(write.texture);
        const textureWidth = (write.texture.descriptor.size as Extent).width;
        const origin = (write.destination.origin ?? {}) as Origin;
        const size = write.size as Extent;
        const bytes = new Uint8Array(write.data.buffer, write.data.byteOffset, write.data.byteLength);
        const offset = write.layout.offset ?? 0, bytesPerRow = write.layout.bytesPerRow!;
        for (let row = 0; row < size.height; row++) {
            const source = offset + row * bytesPerRow;
            copy.set(bytes.subarray(source, source + size.width * RGBA_BYTES_PER_PIXEL), (((origin.y ?? 0) + row) * textureWidth + (origin.x ?? 0)) * RGBA_BYTES_PER_PIXEL);
        }
    }
}

function text(line: string): TextSprite {
    const sprite = new TextSprite();
    sprite.foreground = TextColor.GREEN;
    sprite.image = [line];
    return sprite;
}

function anchored(position: AnchorPosition): ScreenAnchor {
    const anchor = new ScreenAnchor();
    anchor.anchorPosition = position;
    return anchor;
}

function hudText(line: string, position: AnchorPosition): Component[] {
    return [text(line), new HudElement(), anchored(position)];
}

function worldText(line: string, x: number, y: number): Component[] {
    return [text(line), new LocalToWorld(), new LocalPosition(x, y, 0)];
}

function sprite(rgb: number, x: number, y: number): Component[] {
    return [new Sprite(SpriteImage.solid(2, 2, rgb)), new LocalToWorld(), new LocalPosition(x, y, 0)];
}

class OverlayRig {
    public readonly device = new FakeGpuDevice();
    public readonly gpuFrame: GpuFrame;
    public readonly presenter: MemoryPixelPresenter;
    public readonly mirror: OverlayMirror;
    private readonly world = new World({platform: new MemoryPlatform()});
    private readonly root: RootSystemGroup;
    private scene: Entity[] = [];

    public constructor() {
        const canvas = new FakeCanvas();
        this.gpuFrame = new GpuFrame(this.device, new FakeCanvasContext(canvas, FORMAT), canvas, FORMAT);
        this.mirror = new OverlayMirror(this.device);
        const gpuFrame = this.gpuFrame;
        this.presenter = Object.assign(new MemoryPixelPresenter(SIZE), {
            overlaysScene: true,
            present: (frame: PixelFrame) => gpuFrame.finish(frame),
        });
        this.world.resources.insert(new PixelPresenterResource(this.presenter));
        this.root = this.world.getOrCreateSystem(RootSystemGroup);
        const em = this.world.entityManager;
        em.createEntity("camera", [new Camera(), new LocalToWorld(), new LocalPosition()]);
        em.createEntity("settings", [new SpritePixelPassSettings()]);
        this.world.getOrCreateSystem(TextSpritePixelPassSystem);
        this.world.getOrCreateSystem(HudTextSpritePixelPassSystem);
        this.world.getOrCreateSystem(SpritePixelPassSystem);
        this.world.getOrCreateSystem(HudSpritePixelPassSystem);
    }

    public show(...entities: Component[][]): void {
        const em = this.world.entityManager;
        for (const entity of this.scene) em.destroyEntity(entity);
        this.scene = entities.map(components => em.createEntity(undefined, components));
    }

    public setBackground(rgb: number): void {
        const settings = new PixelRenderSettings();
        settings.backgroundColor = rgb;
        this.world.entityManager.createEntity("background", [settings]);
    }

    public framesMatchingTheTexture(): number[] {
        const uploads: number[] = [];
        for (let frame = 0; frame < FRAMES_PER_STEP; frame++) {
            const uploadedBefore = this.gpuFrame.stats.uploadedBytes;
            this.root.update();
            uploads.push(this.gpuFrame.stats.uploadedBytes - uploadedBefore);
            const framebuffer = this.world.resources.get(PixelFramebuffer).toPixelFrame();
            const {texture, rgba} = this.mirror.overlayContent();
            const textureSize = texture.descriptor.size as Extent;
            expect([textureSize.width, textureSize.height]).toEqual([framebuffer.widthPx, framebuffer.heightPx]);
            expect(firstDifference(rgba, framebuffer.rgba)).toBe(-1);
        }
        return uploads;
    }
}

function firstDifference(actual: Uint8Array, expected: Uint8ClampedArray): number {
    if (actual.length !== expected.length) return 0;
    for (let i = 0; i < actual.length; i++) if (actual[i] !== expected[i]) return i;
    return -1;
}

describe("GpuOverlayPass uploads", () => {
    test("the overlay texture always equals the frame while only the drawn and just-cleared tiles are uploaded", () => {
        const rig = new OverlayRig();
        expect(rig.gpuFrame.stats.uploadedBytes).toBe(WHOLE_FRAME_BYTES);
        rig.show(worldText("AB", 0, 0), hudText("FPS 1", "top-left"), sprite(WHITE_RGB, 4, 1));
        rig.framesMatchingTheTexture();

        rig.show(worldText("AB", 0, 0), hudText("FPS 22", "top-left"), sprite(WHITE_RGB, -6, 2));
        for (const upload of rig.framesMatchingTheTexture()) {
            expect(upload).toBeGreaterThan(0);
            expect(upload).toBeLessThan(WHOLE_FRAME_BYTES);
        }

        rig.show(worldText("AB", 0, 0), hudText("FPS 22", "top-left"), hudText("Z", "bottom-right"), sprite(RED_RGB, 6, -2));
        rig.framesMatchingTheTexture();

        rig.show(hudText("FPS 3", "top-left"));
        rig.framesMatchingTheTexture();
        const [unchangedUpload] = rig.framesMatchingTheTexture();
        expect(unchangedUpload).toBeLessThan(WHOLE_FRAME_BYTES / 4);

        rig.show();
        const [clearedUpload, emptyUpload] = rig.framesMatchingTheTexture();
        expect(clearedUpload).toBeGreaterThan(0);
        expect(emptyUpload).toBe(0);
    });

    test("a new background or size uploads the whole frame again", () => {
        const rig = new OverlayRig();
        rig.show(hudText("HUD", "top-left"));
        rig.framesMatchingTheTexture();
        rig.setBackground(OTHER_BACKGROUND_RGB);
        expect(rig.framesMatchingTheTexture()[0]).toBe(WHOLE_FRAME_BYTES);
        rig.presenter.resize(RESIZED.widthPx, RESIZED.heightPx);
        expect(rig.framesMatchingTheTexture()[0]).toBe(RESIZED.widthPx * RESIZED.heightPx * RGBA_BYTES_PER_PIXEL);
        rig.show(hudText("HUD", "bottom-right"), sprite(WHITE_RGB, 3, 1));
        rig.framesMatchingTheTexture();
    });

    test("a frame without drawn tiles is uploaded whole, and the next tracked frame too", () => {
        const rig = new OverlayRig();
        const untracked: PixelFrame = {widthPx: SIZE.widthPx, heightPx: SIZE.heightPx, rgba: new Uint8ClampedArray(WHOLE_FRAME_BYTES), pixelsPerScreenUnitX: 8, pixelsPerScreenUnitY: 16};
        rig.show(hudText("HUD", "top-left"));
        rig.framesMatchingTheTexture();
        const before = rig.gpuFrame.stats.uploadedBytes;
        rig.gpuFrame.finish(untracked);
        expect(rig.gpuFrame.stats.uploadedBytes - before).toBe(WHOLE_FRAME_BYTES);
        expect(rig.framesMatchingTheTexture()[0]).toBe(WHOLE_FRAME_BYTES);
    });
});
