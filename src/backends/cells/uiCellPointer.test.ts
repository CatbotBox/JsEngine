import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {World} from "../../engine/core/world";
import type {Entity, EntityManager} from "../../engine/core";
import {Input} from "../../engine/input/input";
import {NO_MODIFIERS} from "../../engine/input/inputEvent";
import {Camera} from "../../engine/rendering/camera";
import {TextColor} from "../../engine/rendering/textColor";
import {Children} from "../../engine/translation/children";
import {Parent} from "../../engine/translation/parent";
import {UiBox} from "../../engine/ui/uiBox";
import {UiLayout} from "../../engine/ui/uiLayout";
import {UiOffset} from "../../engine/ui/uiOffset";
import {UiRoot} from "../../engine/ui/uiRoot";
import {UiSize} from "../../engine/ui/uiSize";
import {UiState} from "../../engine/ui/uiState";
import {copyCellFrame} from "./cellFrame";
import type {CellFrame} from "./cellFrame";
import type {CellPresenter, CellPresenterSize} from "./cellPresenter";
import {installCellsBackend} from "./cellsBackend";
import {CELLS_UI_PASSES} from "./cellsUiPasses";

const COLUMNS = 30;
const ROWS = 10;
const SETTLE_STEPS = 3;
const PROBE_STEP_CELLS = 0.25;
const PROBE_TO_CELLS = 6;
const PROBE_ACROSS_X = 2.5, PROBE_ACROSS_Y = 1.5;
const REQUESTED_SCALE = 1.5;

type ProbeAxis = "x" | "y";

interface Probe {
    readonly axis: ProbeAxis;
    readonly x: number;
    readonly y: number;
    readonly hovered: boolean;
    readonly drawn: boolean;
}

class FrameKeeper implements CellPresenter {
    public lastFrame: CellFrame | undefined;

    public size(): CellPresenterSize {
        return {columns: COLUMNS, rows: ROWS};
    }

    public onResize(): () => void {
        return () => undefined;
    }

    public start(): void {
    }

    public stop(): void {
    }

    public present(frame: CellFrame): void {
        this.lastFrame = copyCellFrame(frame);
    }
}

function attach(entityManager: EntityManager, parent: Entity, children: readonly Entity[]): void {
    entityManager.addComponent(parent, new Children(...children));
    for (const child of children) entityManager.addComponent(child, new Parent(parent));
}

describe("UI pointer hits on the cells backend", () => {
    test("a box at fractional units is hit on exactly the cells it fills, fractional pointer positions included", () => {
        const presenter = new FrameKeeper();
        const world = new World({platform: new MemoryPlatform()});
        installCellsBackend(world, presenter, CELLS_UI_PASSES);
        const entityManager = world.entityManager;
        entityManager.createEntity("camera", [new Camera()]);
        const uiRoot = new UiRoot();
        uiRoot.scale = REQUESTED_SCALE;
        const root = entityManager.createEntity("root", [uiRoot, new UiLayout()]);
        const offset = new UiOffset();
        offset.x = 1.5;
        offset.y = 0.5;
        const size = new UiSize();
        size.widthMode = "fixed";
        size.width = 2.5;
        size.heightMode = "fixed";
        size.height = 1.5;
        const box = new UiBox();
        box.background = TextColor.RED;
        const target = entityManager.createEntity("box", [offset, size, box]);
        attach(entityManager, root, [target]);
        for (let step = 0; step < SETTLE_STEPS; step++) world.step();
        const input = world.resources.getOrCreate(Input);
        const probes: Probe[] = [];
        const probe = (axis: ProbeAxis, x: number, y: number): void => {
            input.enqueue({type: "pointerMove", x, y, ...NO_MODIFIERS});
            world.step();
            const frame = presenter.lastFrame!;
            const drawn = frame.background[Math.floor(y) * frame.width + Math.floor(x)] === TextColor.RED;
            probes.push({axis, x, y, hovered: entityManager.getComponent<UiState>(target, UiState)!.hovered, drawn});
        };
        for (let at = 0; at <= PROBE_TO_CELLS; at += PROBE_STEP_CELLS) {
            probe("x", at, PROBE_ACROSS_Y);
            probe("y", PROBE_ACROSS_X, at);
        }
        expect(probes.filter(each => each.hovered !== each.drawn)).toEqual([]);
        expect(probes.filter(each => each.axis === "x" && each.hovered).map(each => each.x)).toEqual([2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75]);
    });
});
