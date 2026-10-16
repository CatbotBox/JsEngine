import {describe, expect, test} from "../testing/harness";
import {dirname, isAbsolutePath, joinPath, normalizePath} from "./paths";
import {MemoryFileSource, MemoryPlatform} from "./memoryPlatform";
import {nodePlatform} from "./nodePlatform";
import {WORKER_ENTRY_POINT} from "./platform";
import type {FileSource} from "./platform";
import {ConsoleInput} from "../input/consoleInput";
import type {KeyEvent, MouseEvent} from "../input/consoleInput";
import {Key} from "../input/key";
import {World} from "../core/world";
import {RootSystemGroup} from "../core/rootSystemGroup";
import {Camera} from "../rendering/camera";
import {ScreenSize} from "../rendering/screenSize";
import {ConsoleCameraSizingSystem} from "../rendering/console/consoleCameraSizingSystem";
import {ConsoleCellRatio} from "../rendering/consoleCellRatio";
import {RenderingSystemGroup} from "../rendering/renderingSystemGroup";
import {Console3DRenderSettings} from "../rendering/console/3d/console3DRenderSettings";
import {System} from "../core/system";
import {EntityQuery} from "../core/entityQuery";
import {Mesh} from "../rendering/3d/mesh";
import {decodeImageFile} from "../rendering/3d/image/decodedImage";
import {encodePng} from "../rendering/3d/image/png";
import {encodePpm} from "../rendering/3d/image/ppm";
import {meshCachePathFor} from "../rendering/3d/meshCache";
import {SpriteImage} from "../rendering/console/2d/spriteImage";

describe("path helpers", () => {
    test("joinPath normalizes separators, dot segments and parent references", () => {
        expect(joinPath("./demo/3d", "cube.mtl")).toBe("demo/3d/cube.mtl");
        expect(joinPath("models", "textures\\leaf.png")).toBe("models/textures/leaf.png");
        expect(joinPath("models/sub", "../tex.png")).toBe("models/tex.png");
        expect(joinPath(".", "a.png")).toBe("a.png");
        expect(joinPath("", "a.png")).toBe("a.png");
        expect(joinPath("/abs", "a.png")).toBe("/abs/a.png");
        expect(joinPath("C:\\models", "a.png")).toBe("C:/models/a.png");
        expect(joinPath("..", "a.png")).toBe("../a.png");
    });

    test("normalizePath keeps leading parent references and collapses the rest", () => {
        expect(normalizePath("a//b/./c")).toBe("a/b/c");
        expect(normalizePath("../a")).toBe("../a");
        expect(normalizePath("a/..")).toBe(".");
        expect(normalizePath("/..")).toBe("/");
        expect(normalizePath("")).toBe(".");
    });

    test("dirname takes the directory of a file path with either separator", () => {
        expect(dirname("./demo/3d/cube.obj")).toBe("./demo/3d");
        expect(dirname("cube.obj")).toBe(".");
        expect(dirname("/cube.obj")).toBe("/");
        expect(dirname("C:\\models\\cube.obj")).toBe("C:\\models");
        expect(dirname("C:\\cube.obj")).toBe("C:\\");
    });

    test("isAbsolutePath recognises root and drive paths only", () => {
        expect(isAbsolutePath("/textures/a.png")).toBe(true);
        expect(isAbsolutePath("C:/textures/a.png")).toBe(true);
        expect(isAbsolutePath("C:\\textures\\a.png")).toBe(true);
        expect(isAbsolutePath("textures/a.png")).toBe(false);
        expect(isAbsolutePath("./a.png")).toBe(false);
    });
});

describe("MemoryPlatform", () => {
    test("output collects every chunk in order", () => {
        const platform = new MemoryPlatform();
        platform.output.write("ab");
        platform.output.write("c");
        expect(platform.output.chunks).toEqual(["ab", "c"]);
        expect(platform.output.text()).toBe("abc");
        expect(platform.output.length).toBe(3);
        platform.output.clear();
        expect(platform.output.text()).toBe("");
        expect(platform.output.length).toBe(0);
    });

    test("scripted input waits for a reader, later input goes straight to it", () => {
        const platform = new MemoryPlatform({input: ["a", "b"]});
        platform.input.feed("c");
        const received: string[] = [];
        platform.input.start(data => received.push(data));
        expect(received).toEqual(["a", "b", "c"]);
        platform.input.feed("d");
        expect(received).toEqual(["a", "b", "c", "d"]);
        platform.input.stop();
        platform.input.feed("e");
        expect(received).toEqual(["a", "b", "c", "d"]);
        expect(platform.input.started).toBe(false);
    });

    test("input availability follows the interactive option", () => {
        expect(new MemoryPlatform().input.available()).toBe(true);
        expect(new MemoryPlatform({interactive: false}).input.available()).toBe(false);
    });

    test("resize changes the size and notifies subscribers until they unsubscribe", () => {
        const platform = new MemoryPlatform({columns: 100, rows: 30});
        expect(platform.screen.size()).toEqual({columns: 100, rows: 30});
        let notified = 0;
        const unsubscribe = platform.screen.onResize(() => notified++);
        platform.screen.resize(120, 40);
        expect(platform.screen.size()).toEqual({columns: 120, rows: 40});
        expect(notified).toBe(1);
        unsubscribe();
        platform.screen.resize(80, 24);
        expect(notified).toBe(1);
        expect(platform.screen.listenerCount).toBe(0);
    });

    test("files are keyed by normalized path and writes move the modification time forward", () => {
        const files = new MemoryFileSource({"./models\\a.txt": "hello"});
        expect(files.exists("models/a.txt")).toBe(true);
        expect(files.readText("models//./a.txt")).toBe("hello");
        expect(Array.from(files.readBytes("models/a.txt"))).toEqual([104, 101, 108, 108, 111]);
        const before = files.stat("models/a.txt");
        expect(before.size).toBe(5);
        files.write("models/a.txt", new Uint8Array([1, 2]));
        expect(files.stat("models/a.txt").size).toBe(2);
        expect(files.stat("models/a.txt").mtimeMs).toBeGreaterThan(before.mtimeMs);
        expect(files.exists("models/b.txt")).toBe(false);
        expect(() => files.readBytes("models/b.txt")).toThrow("ENOENT");
        expect(files.delete("./models/a.txt")).toBe(true);
        expect(files.paths()).toEqual([]);
    });

    test("exit runs each exit callback once; a cancelled one never runs", () => {
        const platform = new MemoryPlatform();
        let kept = 0, cancelled = 0;
        platform.onExit(() => kept++);
        const cancel = platform.onExit(() => cancelled++);
        cancel();
        platform.exit();
        platform.exit();
        expect(kept).toBe(1);
        expect(cancelled).toBe(0);
    });

    test("now, inflate and hardwareConcurrency work detached from the platform", () => {
        const platform = new MemoryPlatform({now: 5, hardwareConcurrency: 4, inflate: bytes => bytes.slice().reverse()});
        const {now, inflate, hardwareConcurrency} = platform;
        platform.advance(10);
        expect(now()).toBe(15);
        platform.setNow(2);
        expect(now()).toBe(2);
        expect(hardwareConcurrency()).toBe(4);
        expect(Array.from(inflate(new Uint8Array([1, 2, 3])))).toEqual([3, 2, 1]);
        expect(() => new MemoryPlatform().inflate(new Uint8Array(1))).toThrow("no inflate");
    });
});

describe("ConsoleInput on a platform", () => {
    test("terminal bytes from the platform become key events", () => {
        const platform = new MemoryPlatform();
        const input = new ConsoleInput();
        const events: KeyEvent[] = [];
        input.onKeyDown.add(event => events.push(event));
        let upPressed = 0;
        input.whenKeyDown(Key.Up, () => upPressed++);
        input.enable({platform, mouse: false});
        try {
            platform.input.feed("\x1b[A");
            platform.input.feed("W");
            platform.input.feed("\x1b[1;5C");
            expect(upPressed).toBe(1);
            expect(input.keyDown("up")).toBe(true);
            expect(input.keyPressed("w")).toBe(true);
            expect(events.map(event => event.id)).toEqual(["up", "w", "right"]);
            expect(events[1].shift).toBe(true);
            expect(events[2].ctrl).toBe(true);
        } finally {
            input.disable();
        }
    });

    test("scripted bytes reach listeners registered before enable", () => {
        const platform = new MemoryPlatform({input: ["\x03"]});
        const input = new ConsoleInput();
        let interrupted = false;
        input.onKeyMatch({name: "c", ctrl: true}, () => interrupted = true);
        input.enable({platform, mouse: false});
        input.disable();
        expect(interrupted).toBe(true);
    });

    test("a listener that disables input while scripted bytes arrive leaves it disabled", () => {
        const platform = new MemoryPlatform({input: ["\x03", "x"]});
        const input = new ConsoleInput();
        const seen: string[] = [];
        input.onKey.add(event => seen.push(event.id));
        input.onKeyMatch({name: "c", ctrl: true}, () => input.disable());
        input.enable({platform});
        expect(input.isEnabled).toBe(false);
        expect(platform.input.started).toBe(false);
        expect(seen).toEqual(["c"]);
        expect(platform.output.text().includes("\x1b[?1003h")).toBe(false);
        platform.exit();
        expect(input.isEnabled).toBe(false);
    });

    test("mouse reports are split from key bytes in arrival order", () => {
        const platform = new MemoryPlatform();
        const input = new ConsoleInput();
        const order: string[] = [];
        let press: MouseEvent | undefined;
        input.onKey.add(event => order.push("key " + event.id));
        input.onMouse.add(event => order.push("mouse " + event.type));
        input.onMouseDown.add(event => press = event);
        input.enable({platform});
        try {
            platform.input.feed("a\x1b[<0;10;5Mb");
            expect(order).toEqual(["key a", "mouse press", "key b"]);
            expect(press!.button).toBe("left");
            expect(press!.x).toBe(10);
            expect(press!.y).toBe(5);
        } finally {
            input.disable();
        }
    });

    test("terminal modes go to the platform's output and are undone on disable", () => {
        const platform = new MemoryPlatform();
        const input = new ConsoleInput();
        input.enable({platform, mouse: true, hideCursor: true});
        expect(platform.input.started).toBe(true);
        expect(platform.output.text()).toBe("\x1b[?1003h\x1b[?1006h\x1b[?25l");
        input.disable();
        expect(platform.input.started).toBe(false);
        expect(platform.output.text()).toBe("\x1b[?1003h\x1b[?1006h\x1b[?25l\x1b[?1003l\x1b[?1006l\x1b[?25h");
    });

    test("host exit restores the terminal through the platform's exit hook", () => {
        const platform = new MemoryPlatform();
        const input = new ConsoleInput();
        input.enable({platform, mouse: false});
        platform.exit();
        expect(input.isEnabled).toBe(false);
        expect(platform.input.started).toBe(false);
    });

    test("a non-interactive platform leaves input disabled", () => {
        const platform = new MemoryPlatform({interactive: false});
        const input = new ConsoleInput();
        input.enable({platform, noTTY: "silent"});
        expect(input.isEnabled).toBe(false);
        expect(platform.input.started).toBe(false);
        expect(platform.output.text()).toBe("");
        expect(() => input.enable({platform, noTTY: "throw"})).toThrow("not a TTY");
    });
});

describe("ConsoleCameraSizingSystem", () => {
    test("sizes the camera from the platform and follows resizes", () => {
        const platform = new MemoryPlatform({columns: 120, rows: 40});
        const world = new World({platform});
        expect(world.platform).toBe(platform);
        const sizing = world.getOrCreateSystem(ConsoleCameraSizingSystem);
        const root = world.getOrCreateSystem(RootSystemGroup);
        const em = world.entityManager;
        const camera = em.createEntity("camera");
        em.addComponent(camera, new Camera());
        root.update();
        const size = em.getComponent<ScreenSize>(camera, ScreenSize)!;
        expect(size.x).toBe(120);
        expect(size.y).toBe(39);

        platform.screen.resize(100, 30);
        root.update();
        expect(size.x).toBe(100);
        expect(size.y).toBe(29);

        sizing.destroy();
        expect(platform.screen.listenerCount).toBe(0);
    });

    test("a camera gets no ConsoleCellRatio without the console sizing system", () => {
        const world = new World({platform: new MemoryPlatform()});
        const root = world.getOrCreateSystem(RootSystemGroup);
        const em = world.entityManager;
        const camera = em.createEntity("camera");
        em.addComponent(camera, new Camera());
        root.update();
        expect(em.getComponent(camera, ConsoleCellRatio)).toBeUndefined();
    });

    test("adds exactly one ConsoleCellRatio, before the render passes of the same frame", () => {
        const world = new World({platform: new MemoryPlatform()});
        world.getOrCreateSystem(ConsoleCameraSizingSystem);
        const probe = world.getOrCreateSystem(CellRatioProbeSystem);
        const root = world.getOrCreateSystem(RootSystemGroup);
        const em = world.entityManager;
        const camera = em.createEntity("camera");
        em.addComponent(camera, new Camera());
        root.update();
        expect(probe.sawCellRatio).toBe(true);
        expect(em.getComponent<ConsoleCellRatio>(camera, ConsoleCellRatio)!.value).toBe(2);
        root.update();
        expect(new EntityQuery(world, [ConsoleCellRatio]).entityCount()).toBe(1);
    });

    test("keeps a camera's existing ConsoleCellRatio", () => {
        const world = new World({platform: new MemoryPlatform()});
        world.getOrCreateSystem(ConsoleCameraSizingSystem);
        const root = world.getOrCreateSystem(RootSystemGroup);
        const em = world.entityManager;
        const camera = em.createEntity("camera");
        em.addComponent(camera, new Camera());
        const ratio = new ConsoleCellRatio();
        ratio.value = 3;
        em.addComponent(camera, ratio);
        root.update();
        expect(em.getComponent<ConsoleCellRatio>(camera, ConsoleCellRatio)!.value).toBe(3);
        expect(new EntityQuery(world, [ConsoleCellRatio]).entityCount()).toBe(1);
    });
});

class CellRatioProbeSystem extends System {
    private _cameraQuery = this.createEntityQuery([Camera, ConsoleCellRatio]);
    public sawCellRatio = false;

    override systemGroup() {
        return RenderingSystemGroup;
    }

    override priority(): number {
        return 100;
    }

    onUpdate() {
        this.sawCellRatio = this._cameraQuery.hasEntity();
    }
}

describe("Console3DRenderSettings worker count", () => {
    const resolve = (platform: MemoryPlatform, workerCount: number | "auto" = "auto") => {
        const settings = new Console3DRenderSettings();
        settings.workerCount = workerCount;
        return settings.toRasterizerConfig(platform).workerCount;
    };

    test("auto leaves one core to the main thread, up to 7 workers", () => {
        expect(resolve(new MemoryPlatform({hardwareConcurrency: 1}))).toBe(0);
        expect(resolve(new MemoryPlatform({hardwareConcurrency: 4}))).toBe(3);
        expect(resolve(new MemoryPlatform({hardwareConcurrency: 32}))).toBe(7);
        expect(resolve(new MemoryPlatform({hardwareConcurrency: 0}))).toBe(0);
    });

    test("auto takes the host's requested count, clamped to [0, 15]", () => {
        expect(resolve(new MemoryPlatform({hardwareConcurrency: 32, requestedRasterWorkers: 2}))).toBe(2);
        expect(resolve(new MemoryPlatform({hardwareConcurrency: 1, requestedRasterWorkers: 12}))).toBe(12);
        expect(resolve(new MemoryPlatform({requestedRasterWorkers: 64}))).toBe(15);
        expect(resolve(new MemoryPlatform({hardwareConcurrency: 8, requestedRasterWorkers: -3}))).toBe(0);
    });

    test("an explicit count passes through", () => {
        expect(resolve(new MemoryPlatform({hardwareConcurrency: 32}), 0)).toBe(0);
        expect(resolve(new MemoryPlatform({hardwareConcurrency: 1, requestedRasterWorkers: 9}), 3)).toBe(3);
    });
});

const TRIANGLE_OBJ = `mtllib tri.mtl
v 0 0 0
v 1 0 0
v 0 1 0
vt 0 0
vt 1 0
vt 0 1
usemtl Checker
f 1/1 2/2 3/3
`;

function checkerRgba(): Uint8Array {
    return new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
}

function triangleFiles(texture: "ppm" | "png"): Record<string, string | Uint8Array> {
    const texturePath = texture === "ppm" ? "models/textures/checker.ppm" : "models/textures/checker.png";
    return {
        "models/tri.obj": TRIANGLE_OBJ,
        "models/tri.mtl": `newmtl Checker\nKd 1 0 0\nmap_Kd textures\\checker.${texture}\n`,
        [texturePath]: texture === "ppm" ? encodePpm(2, 2, checkerRgba()) : encodePng(2, 2, checkerRgba()),
    };
}

describe("loaders on a memory file source", () => {
    test("an obj loads with its mtl and texture, and caches beside itself", () => {
        const files = new MemoryFileSource(triangleFiles("ppm"));
        const mesh = Mesh.fromFile("./models/tri.obj", {files});
        expect(mesh.triangleCount).toBe(1);
        expect(mesh.materials[0].diffuseColor).toBe(0xFF0000);
        expect(mesh.materials[0].diffuseTexture!.width).toBe(2);
        expect(files.exists(meshCachePathFor("models/tri.obj"))).toBe(true);

        // Same size and modification time: the cache is trusted and the obj text is never parsed.
        const objStat = files.stat("models/tri.obj");
        files.set("models/tri.obj", "#".repeat(objStat.size), objStat.mtimeMs);
        const fromCache = Mesh.fromFile("models/tri.obj", {files});
        expect(fromCache.triangleCount).toBe(1);
        expect(fromCache.materials[0].diffuseTexture!.width).toBe(2);
    });

    test("a source without stat or write still loads, without a cache", () => {
        const backing = new MemoryFileSource(triangleFiles("ppm"));
        const readOnly: FileSource = {
            readBytes: path => backing.readBytes(path),
            readText: path => backing.readText(path),
            exists: path => backing.exists(path),
        };
        const mesh = Mesh.fromFile("models/tri.obj", {files: readOnly});
        expect(mesh.triangleCount).toBe(1);
        expect(mesh.materials[0].diffuseTexture).toBeDefined();
        expect(backing.exists(meshCachePathFor("models/tri.obj"))).toBe(false);
    });

    test("a whole MemoryPlatform serves as loader options, PNGs inflating through it", () => {
        let inflated = 0;
        const platform = new MemoryPlatform({
            files: triangleFiles("png"),
            inflate: bytes => {
                inflated++;
                return nodePlatform().inflate(bytes);
            },
        });
        const mesh = Mesh.fromFile("models/tri.obj", platform);
        expect(inflated).toBe(1);
        expect(mesh.materials[0].diffuseTexture!.height).toBe(2);
    });

    test("decodeImageFile reads through the given files and inflate", () => {
        const files = new MemoryFileSource({"sprite.png": encodePng(2, 2, checkerRgba())});
        let inflated = 0;
        const image = decodeImageFile("sprite.png", {
            files,
            inflate: bytes => {
                inflated++;
                return nodePlatform().inflate(bytes);
            },
        });
        expect(inflated).toBe(1);
        expect(Array.from(image.rgba)).toEqual(Array.from(checkerRgba()));
    });

    test("SpriteImage.fromFile caches per file source", () => {
        const red = new MemoryFileSource({"s.ppm": encodePpm(1, 1, new Uint8Array([255, 0, 0, 255]))});
        const blue = new MemoryFileSource({"s.ppm": encodePpm(1, 1, new Uint8Array([0, 0, 255, 255]))});
        const fromRed = SpriteImage.fromFile("s.ppm", {files: red});
        const fromBlue = SpriteImage.fromFile("s.ppm", {files: blue});
        expect(SpriteImage.fromFile("s.ppm", {files: red})).toBe(fromRed);
        expect(fromBlue).not.toBe(fromRed);
        expect(fromRed.rgba[0]).toBe(255);
        expect(fromBlue.rgba[2]).toBe(255);
    });
});

describe("node worker factory", () => {
    test("runs a script that only uses its data and port", async () => {
        const workers = nodePlatform().workers!;
        const shared = new Int32Array(new SharedArrayBuffer(4));
        const worker = workers.spawn(`'use strict';
function ${WORKER_ENTRY_POINT}(data, port) {
    Atomics.store(new Int32Array(data.shared), 0, data.value);
    port.onMessage((message) => port.postMessage(message * 2));
}`, {shared: shared.buffer, value: 7});
        worker.unref?.();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            const reply = await new Promise<unknown>((resolve, reject) => {
                timeout = setTimeout(() => reject(new Error("worker did not answer")), 10_000);
                worker.onMessage(resolve);
                worker.onError(reject);
                worker.postMessage(21);
            });
            expect(reply).toBe(42);
            expect(Atomics.load(shared, 0)).toBe(7);
        } finally {
            clearTimeout(timeout);
            worker.terminate();
        }
    });
});
