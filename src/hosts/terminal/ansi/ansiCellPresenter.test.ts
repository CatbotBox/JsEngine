import {describe, expect, test} from "../../../engine/testing/harness";
import {MemoryPlatform, MemoryTerminal} from "../../../engine/testing/memoryPlatform";
import {ScreenBuffer} from "../../../backends/cells/cellGrid";
import type {CellBackgroundStyle, CellFrame} from "../../../backends/cells/cellFrame";
import {CellPresenterResource} from "../../../backends/cells/cellPresenterResource";
import {CellRenderSystemGroup} from "../../../backends/cells/cellRenderSystemGroup";
import {ScreenSize} from "../../../engine/rendering/screenSize";
import {TextColor} from "../../../engine/rendering/textColor";
import {Camera} from "../../../engine/rendering/camera";
import {World} from "../../../engine/core/world";
import {RootSystemGroup} from "../../../engine/core/rootSystemGroup";
import {System} from "../../../engine/core/system";
import {AnsiCellPresenter} from "./ansiCellPresenter";
import {AnsiCellEncoder} from "./ansiCellEncoder";

const CURSOR_HOME = "\x1b[H";
const ERASE_BELOW_CURSOR = "\x1b[J";
const CRLF = "\r\n";
const PLAIN_BACKGROUND: CellBackgroundStyle = {glyph: 0x2E, foreground: TextColor.DEFAULT, background: TextColor.DEFAULT};

function frameOf(rows: readonly string[]): CellFrame {
    const screenSize = new ScreenSize();
    screenSize.x = rows[0]?.length ?? 0;
    screenSize.y = rows.length;
    const buffer = new ScreenBuffer();
    buffer.beginFrame({screenSize}, PLAIN_BACKGROUND);
    rows.forEach((row, y) => buffer.writeText(row, 0, y, 0, TextColor.DEFAULT, TextColor.DEFAULT));
    return buffer.toCellFrame();
}

function encodedRows(frame: CellFrame): string[] {
    return new AnsiCellEncoder().encodeRows(frame);
}

describe("AnsiCellPresenter", () => {
    test("a full repaint homes the cursor, joins the rows with CRLF and erases what is below", () => {
        const terminal = new MemoryTerminal();
        const presenter = new AnsiCellPresenter(terminal);
        const frame = frameOf(["ab", "cd"]);
        presenter.present(frame, "full");
        expect(terminal.text()).toBe(CURSOR_HOME + encodedRows(frame).join(CRLF) + CRLF + ERASE_BELOW_CURSOR);
    });

    test("later frames only rewrite the rows that changed, and an unchanged frame writes nothing", () => {
        const terminal = new MemoryTerminal();
        const presenter = new AnsiCellPresenter(terminal);
        presenter.present(frameOf(["ab", "cd", "ef"]), "full");
        terminal.clear();

        presenter.present(frameOf(["ab", "cd", "ef"]), "changes");
        expect(terminal.text()).toBe("");

        const changed = frameOf(["ab", "xy", "ef"]);
        presenter.present(changed, "changes");
        expect(terminal.text()).toBe("\x1b[2;1H" + encodedRows(changed)[1]);
    });

    test("a size change or an explicit full repaint redraws everything", () => {
        const terminal = new MemoryTerminal();
        const presenter = new AnsiCellPresenter(terminal);
        presenter.present(frameOf(["ab"]), "full");
        terminal.clear();
        presenter.present(frameOf(["abc"]), "changes");
        expect(terminal.text().startsWith(CURSOR_HOME)).toBe(true);
        terminal.clear();
        presenter.present(frameOf(["abc", "def"]), "changes");
        expect(terminal.text().startsWith(CURSOR_HOME)).toBe(true);
        terminal.clear();
        presenter.present(frameOf(["abc", "def"]), "full");
        expect(terminal.text().startsWith(CURSOR_HOME)).toBe(true);
    });

    test("start and stop switch the alternate screen, cursor and autowrap", () => {
        const terminal = new MemoryTerminal();
        const presenter = new AnsiCellPresenter(terminal);
        presenter.start();
        expect(terminal.text()).toBe("\x1b[?1049h\x1b[?25l\x1b[?7l");
        terminal.clear();
        presenter.stop();
        expect(terminal.text()).toBe("\x1b[?7h\x1b[?25h\x1b[?1049l");
    });

    test("size, resizes and backlog come from the terminal", () => {
        const terminal = new MemoryTerminal({columns: 50, rows: 20});
        const presenter = new AnsiCellPresenter(terminal);
        expect(presenter.size()).toEqual({columns: 50, rows: 20});
        let resizes = 0;
        const stop = presenter.onResize(() => resizes++);
        terminal.resize(60, 25);
        stop();
        terminal.resize(70, 30);
        expect(resizes).toBe(1);
        expect(terminal.resizeListenerCount).toBe(0);
        expect(presenter.backlogged()).toBe(false);

        let backlogged = true;
        const busy = new AnsiCellPresenter({...presenterTerminal(terminal), backlogged: () => backlogged});
        expect(busy.backlogged()).toBe(true);
        backlogged = false;
        expect(busy.backlogged()).toBe(false);
    });
});

function presenterTerminal(terminal: MemoryTerminal) {
    return {
        write: (chunk: string) => terminal.write(chunk),
        size: () => terminal.size(),
        onResize: (listener: () => void) => terminal.onResize(listener),
    };
}

class FrameProbeSystem extends System {
    public frames = 0;

    override systemGroup() {
        return CellRenderSystemGroup;
    }

    onUpdate() {
        this.frames++;
    }
}

describe("CellRenderSystemGroup on a backlogged terminal", () => {
    test("skips whole frames while the terminal is backlogged, then repaints everything", () => {
        const terminal = new MemoryTerminal({columns: 40, rows: 10});
        let backlogged = false;
        const world = new World({platform: new MemoryPlatform()});
        world.resources.insert(new CellPresenterResource(new AnsiCellPresenter({...presenterTerminal(terminal), backlogged: () => backlogged})));
        const root = world.getOrCreateSystem(RootSystemGroup);
        world.entityManager.addComponent(world.entityManager.createEntity("camera"), new Camera());
        const group = world.getOrCreateSystem(CellRenderSystemGroup);
        const probe = world.getOrCreateSystem(FrameProbeSystem);
        try {
            root.update();
            root.update();
            terminal.clear();
            const framesBefore = probe.frames;
            root.update();
            expect(terminal.text()).toBe("");
            expect(probe.frames).toBe(framesBefore + 1);

            backlogged = true;
            root.update();
            root.update();
            expect(terminal.text()).toBe("");
            expect(probe.frames).toBe(framesBefore + 1);

            backlogged = false;
            root.update();
            expect(probe.frames).toBe(framesBefore + 2);
            expect(terminal.text().startsWith(CURSOR_HOME)).toBe(true);
            expect(terminal.text().split(CRLF).length).toBe(10);
        } finally {
            group.enabled = false;
        }
    });

    test("two cameras are reported as text in the frame instead of drawing the scene", () => {
        const terminal = new MemoryTerminal({columns: 60, rows: 5});
        const world = new World({platform: new MemoryPlatform()});
        world.resources.insert(new CellPresenterResource(new AnsiCellPresenter(terminal)));
        const em = world.entityManager;
        em.addComponent(em.createEntity("camera 1"), new Camera());
        em.addComponent(em.createEntity("camera 2"), new Camera());
        const group = world.getOrCreateSystem(CellRenderSystemGroup);
        const probe = world.getOrCreateSystem(FrameProbeSystem);
        try {
            terminal.clear();
            group.update();
            const lines = terminal.text().replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").split(CRLF);
            expect(lines[0].startsWith("ERROR: MULTIPLE CAMERA ENTITIES FOUND (2)")).toBe(true);
            expect(lines.length).toBe(5);
            expect(probe.frames).toBe(0);
        } finally {
            group.enabled = false;
        }
    });

    test("the memory terminal never reports a backlog, so it never skips a frame", () => {
        expect(new AnsiCellPresenter(new MemoryTerminal()).backlogged()).toBe(false);
    });
});
