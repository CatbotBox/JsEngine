import {describe, expect, test} from "../testing/harness";
import {dirname, isAbsolutePath, joinPath, normalizePath} from "./paths";
import {MemoryFileSource, MemoryPlatform, MemoryTerminal} from "../testing/memoryPlatform";
import {deflateStored} from "../testing/storedDeflate";
import type {FileSource} from "./platform";
import {ConsoleInput} from "../input/consoleInput";
import type {KeyEvent, MouseEvent} from "../input/consoleInput";
import {Key} from "../input/key";
import {Mesh} from "../rendering/3d/mesh";
import {decodeImageFile} from "../assets/image/decodedImage";
import {inflate} from "../assets/image/inflate";
import {encodePng} from "../assets/image/png";
import {encodePpm} from "../assets/image/ppm";
import {meshCachePathFor} from "../assets/meshCache";
import {SpriteImage} from "../rendering/2d/spriteImage";

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

describe("MemoryTerminal", () => {
    test("writes collect every chunk in order", () => {
        const terminal = new MemoryTerminal();
        terminal.write("ab");
        terminal.write("c");
        expect(terminal.chunks).toEqual(["ab", "c"]);
        expect(terminal.text()).toBe("abc");
        expect(terminal.length).toBe(3);
        terminal.clear();
        expect(terminal.text()).toBe("");
        expect(terminal.length).toBe(0);
    });

    test("scripted input waits for a reader, later input goes straight to it", () => {
        const terminal = new MemoryTerminal({input: ["a", "b"]});
        terminal.feed("c");
        const received: string[] = [];
        terminal.start(data => received.push(data));
        expect(received).toEqual(["a", "b", "c"]);
        terminal.feed("d");
        expect(received).toEqual(["a", "b", "c", "d"]);
        terminal.stop();
        terminal.feed("e");
        expect(received).toEqual(["a", "b", "c", "d"]);
        expect(terminal.started).toBe(false);
    });

    test("input availability follows the interactive option", () => {
        expect(new MemoryTerminal().available()).toBe(true);
        expect(new MemoryTerminal({interactive: false}).available()).toBe(false);
    });

    test("resize changes the size and notifies subscribers until they unsubscribe", () => {
        const terminal = new MemoryTerminal({columns: 100, rows: 30});
        expect(terminal.size()).toEqual({columns: 100, rows: 30});
        let notified = 0;
        const unsubscribe = terminal.onResize(() => notified++);
        terminal.resize(120, 40);
        expect(terminal.size()).toEqual({columns: 120, rows: 40});
        expect(notified).toBe(1);
        unsubscribe();
        terminal.resize(80, 24);
        expect(notified).toBe(1);
        expect(terminal.resizeListenerCount).toBe(0);
    });
});

describe("MemoryPlatform", () => {
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

describe("ConsoleInput on a terminal input source", () => {
    test("terminal bytes become key events", () => {
        const platform = new MemoryPlatform();
        const terminal = new MemoryTerminal();
        const input = new ConsoleInput();
        const events: KeyEvent[] = [];
        input.onKeyDown.add(event => events.push(event));
        let upPressed = 0;
        input.whenKeyDown(Key.Up, () => upPressed++);
        input.enable({terminal, platform, mouse: false});
        try {
            terminal.feed("\x1b[A");
            terminal.feed("W");
            terminal.feed("\x1b[1;5C");
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
        const platform = new MemoryPlatform();
        const terminal = new MemoryTerminal({input: ["\x03"]});
        const input = new ConsoleInput();
        let interrupted = false;
        input.onKeyMatch({name: "c", ctrl: true}, () => interrupted = true);
        input.enable({terminal, platform, mouse: false});
        input.disable();
        expect(interrupted).toBe(true);
    });

    test("a listener that disables input while scripted bytes arrive leaves it disabled", () => {
        const platform = new MemoryPlatform();
        const terminal = new MemoryTerminal({input: ["\x03", "x"]});
        const input = new ConsoleInput();
        const seen: string[] = [];
        input.onKey.add(event => seen.push(event.id));
        input.onKeyMatch({name: "c", ctrl: true}, () => input.disable());
        input.enable({terminal, platform});
        expect(input.isEnabled).toBe(false);
        expect(terminal.started).toBe(false);
        expect(seen).toEqual(["c"]);
        expect(terminal.text().includes("\x1b[?1003h")).toBe(false);
        platform.exit();
        expect(input.isEnabled).toBe(false);
    });

    test("mouse reports are split from key bytes in arrival order", () => {
        const platform = new MemoryPlatform();
        const terminal = new MemoryTerminal();
        const input = new ConsoleInput();
        const order: string[] = [];
        let press: MouseEvent | undefined;
        input.onKey.add(event => order.push("key " + event.id));
        input.onMouse.add(event => order.push("mouse " + event.type));
        input.onMouseDown.add(event => press = event);
        input.enable({terminal, platform});
        try {
            terminal.feed("a\x1b[<0;10;5Mb");
            expect(order).toEqual(["key a", "mouse press", "key b"]);
            expect(press!.button).toBe("left");
            expect(press!.x).toBe(10);
            expect(press!.y).toBe(5);
        } finally {
            input.disable();
        }
    });

    test("terminal modes are written to the input source and undone on disable", () => {
        const platform = new MemoryPlatform();
        const terminal = new MemoryTerminal();
        const input = new ConsoleInput();
        input.enable({terminal, platform, mouse: true, hideCursor: true});
        expect(terminal.started).toBe(true);
        expect(terminal.text()).toBe("\x1b[?1003h\x1b[?1006h\x1b[?25l");
        input.disable();
        expect(terminal.started).toBe(false);
        expect(terminal.text()).toBe("\x1b[?1003h\x1b[?1006h\x1b[?25l\x1b[?1003l\x1b[?1006l\x1b[?25h");
    });

    test("host exit restores the terminal through the platform's exit hook", () => {
        const platform = new MemoryPlatform();
        const terminal = new MemoryTerminal();
        const input = new ConsoleInput();
        input.enable({terminal, platform, mouse: false});
        platform.exit();
        expect(input.isEnabled).toBe(false);
        expect(terminal.started).toBe(false);
    });

    test("a non-interactive terminal leaves input disabled", () => {
        const platform = new MemoryPlatform();
        const terminal = new MemoryTerminal({interactive: false});
        const input = new ConsoleInput();
        input.enable({terminal, platform, noTTY: "silent"});
        expect(input.isEnabled).toBe(false);
        expect(terminal.started).toBe(false);
        expect(terminal.text()).toBe("");
        expect(() => input.enable({terminal, platform, noTTY: "throw"})).toThrow("not a TTY");
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
        [texturePath]: texture === "ppm" ? encodePpm(2, 2, checkerRgba()) : encodePng(2, 2, checkerRgba(), deflateStored),
    };
}

describe("loaders on a memory file source", () => {
    test("an obj loads with its mtl and texture, and caches beside itself", () => {
        const files = new MemoryFileSource(triangleFiles("ppm"));
        const mesh = Mesh.fromFile("./models/tri.obj", {files, inflate});
        expect(mesh.triangleCount).toBe(1);
        expect(mesh.materials[0].diffuseColor).toBe(0xFF0000);
        expect(mesh.materials[0].diffuseTexture!.width).toBe(2);
        expect(files.exists(meshCachePathFor("models/tri.obj"))).toBe(true);

        const objStat = files.stat("models/tri.obj");
        files.set("models/tri.obj", "#".repeat(objStat.size), objStat.mtimeMs);
        const fromCache = Mesh.fromFile("models/tri.obj", {files, inflate});
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
        const mesh = Mesh.fromFile("models/tri.obj", {files: readOnly, inflate});
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
                return inflate(bytes);
            },
        });
        const mesh = Mesh.fromFile("models/tri.obj", platform);
        expect(inflated).toBe(1);
        expect(mesh.materials[0].diffuseTexture!.height).toBe(2);
    });

    test("decodeImageFile reads through the given files and inflate", () => {
        const files = new MemoryFileSource({"sprite.png": encodePng(2, 2, checkerRgba(), deflateStored)});
        let inflated = 0;
        const image = decodeImageFile("sprite.png", {
            files,
            inflate: bytes => {
                inflated++;
                return inflate(bytes);
            },
        });
        expect(inflated).toBe(1);
        expect(Array.from(image.rgba)).toEqual(Array.from(checkerRgba()));
    });

    test("SpriteImage.fromFile caches per file source", () => {
        const red = new MemoryFileSource({"s.ppm": encodePpm(1, 1, new Uint8Array([255, 0, 0, 255]))});
        const blue = new MemoryFileSource({"s.ppm": encodePpm(1, 1, new Uint8Array([0, 0, 255, 255]))});
        const fromRed = SpriteImage.fromFile("s.ppm", {files: red, inflate});
        const fromBlue = SpriteImage.fromFile("s.ppm", {files: blue, inflate});
        expect(SpriteImage.fromFile("s.ppm", {files: red, inflate})).toBe(fromRed);
        expect(fromBlue).not.toBe(fromRed);
        expect(fromRed.rgba[0]).toBe(255);
        expect(fromBlue.rgba[2]).toBe(255);
    });
});
