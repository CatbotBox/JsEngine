import type {CellFrame} from "../../backends/cells/cellFrame";
import type {PixelFrame} from "../../backends/pixels/pixelFrame";
import type {InputEventSink} from "../../engine/input/inputEvent";
import {cellCanvasDisplayFromQuery} from "../../hosts/web/cellCanvasDisplay";
import type {CellCanvasDisplay} from "../../hosts/web/cellCanvasDisplay";
import type {CellArea} from "../../hosts/web/domInput";
import {GpuCanvasDisplay} from "../../hosts/web/gpuCanvasDisplay";
import {pixelCanvasDisplayFromQuery, pixelCanvasDisplayOptionsFromQuery} from "../../hosts/web/pixelCanvasDisplay";
import type {PixelCanvasDisplay} from "../../hosts/web/pixelCanvasDisplay";
import type {CellWorldDisplay, GpuWorldDisplay, PixelWorldDisplay} from "../../hosts/web/worldWorkerPage";
import type {CellSurfaceSize, PixelSurfaceSize} from "../../hosts/web/worldWorkerProtocol";
import type {GameTarget, SimulatedTarget} from "../project/editorSettings";
import {TerminalInputEncoder} from "./terminalInputEncoder";
import type {TerminalBytesSink} from "./terminalInputEncoder";

export const NO_CELL_AREA: CellArea = {left: 0, top: 0, width: 0, height: 0, columns: 0, rows: 0};

const TERMINAL_TARGET: SimulatedTarget = "terminal";
const VISIBLE = true;

export interface SessionDisplayEvents {
    firstFrame(): void;
    failed(text: string): void;
}

export interface SessionDisplayControls {
    show(): void;
    hide(): void;
    dispose(): void;
}

export type EditorSessionDisplay = (CellWorldDisplay | PixelWorldDisplay | GpuWorldDisplay) & SessionDisplayControls;

export interface SessionInputPorts {
    readonly events: InputEventSink;
    readonly terminalBytes: TerminalBytesSink;
}

export interface EditorViewport {
    readonly gameTarget: GameTarget;

    sessionDisplay(visible: boolean, events: SessionDisplayEvents): EditorSessionDisplay;

    sessionInput(ports: SessionInputPorts): InputEventSink;

    cellArea(): CellArea;

    showError(text: string): void;

    dispose(): void;
}

interface SharedDisplay<Surface> {
    surfaceSize(): Surface;
    onResize(listener: () => void): () => void;
    showStatus(text: string): void;
    showError(text: string): void;
    cellArea(): CellArea;
    show(): void;
    dispose(): void;
}

export type SharedPixelDisplay = Pick<PixelCanvasDisplay, "surfaceSize" | "onResize" | "presentPixels" | "showStatus" | "showError" | "cellArea" | "show" | "dispose">;
export type SharedCellDisplay = Pick<CellCanvasDisplay, "surfaceSize" | "onResize" | "presentCells" | "showStatus" | "showError" | "cellArea" | "show" | "dispose">;

abstract class SharedSessionDisplay<Surface> implements SessionDisplayControls {
    private firstFrameSeen = false;

    protected constructor(private readonly shared: SharedDisplay<Surface>, private visible: boolean, private readonly events: SessionDisplayEvents) {
    }

    public show(): void {
        this.visible = true;
        this.shared.show();
    }

    public hide(): void {
        this.visible = false;
    }

    public dispose(): void {
    }

    public surfaceSize(): Surface {
        return this.shared.surfaceSize();
    }

    public onResize(listener: () => void): () => void {
        return this.shared.onResize(listener);
    }

    public showStatus(text: string): void {
        if (this.visible) this.shared.showStatus(text);
    }

    public showError(text: string): void {
        if (this.visible) this.shared.showError(text);
        this.events.failed(text);
    }

    protected presentWhenVisible(draw: () => void, onPresented: () => void): void {
        if (this.visible) draw();
        else onPresented();
        if (this.firstFrameSeen) return;
        this.firstFrameSeen = true;
        this.events.firstFrame();
    }
}

export class PixelSessionDisplay extends SharedSessionDisplay<PixelSurfaceSize> implements PixelWorldDisplay {
    public constructor(private readonly display: SharedPixelDisplay, visible: boolean, events: SessionDisplayEvents) {
        super(display, visible, events);
    }

    public presentPixels(frame: PixelFrame, onPresented: () => void): void {
        this.presentWhenVisible(() => this.display.presentPixels(frame, onPresented), onPresented);
    }
}

export class CellSessionDisplay extends SharedSessionDisplay<CellSurfaceSize> implements CellWorldDisplay {
    public constructor(private readonly display: SharedCellDisplay, visible: boolean, events: SessionDisplayEvents) {
        super(display, visible, events);
    }

    public presentCells(frame: CellFrame, onPresented: () => void): void {
        this.presentWhenVisible(() => this.display.presentCells(frame, onPresented), onPresented);
    }
}

export class PixelEditorViewport implements EditorViewport {
    public constructor(private readonly display: SharedPixelDisplay, public readonly gameTarget: GameTarget) {
    }

    public sessionDisplay(visible: boolean, events: SessionDisplayEvents): EditorSessionDisplay {
        return new PixelSessionDisplay(this.display, visible, events);
    }

    public sessionInput(ports: SessionInputPorts): InputEventSink {
        return ports.events;
    }

    public cellArea(): CellArea {
        return this.display.cellArea();
    }

    public showError(text: string): void {
        this.display.showError(text);
    }

    public dispose(): void {
        this.display.dispose();
    }
}

export class CellEditorViewport implements EditorViewport {
    public constructor(private readonly display: SharedCellDisplay, public readonly gameTarget: GameTarget) {
    }

    public sessionDisplay(visible: boolean, events: SessionDisplayEvents): EditorSessionDisplay {
        return new CellSessionDisplay(this.display, visible, events);
    }

    public sessionInput(ports: SessionInputPorts): InputEventSink {
        if (this.gameTarget.target !== TERMINAL_TARGET) return ports.events;
        return new TerminalInputEncoder(ports.terminalBytes, () => this.cellArea());
    }

    public cellArea(): CellArea {
        return this.display.cellArea();
    }

    public showError(text: string): void {
        this.display.showError(text);
    }

    public dispose(): void {
        this.display.dispose();
    }
}

export type SessionGpuCanvas = Pick<GpuCanvasDisplay,
    "surfaceSize" | "onResize" | "transferCanvas" | "showScreenUnit" | "showStatus" | "showError" | "cellArea" | "show" | "hide" | "hasFocus" | "focus" | "dispose">;

interface GpuSessionHost {
    shown(canvas: SessionGpuCanvas): void;
    hiding(canvas: SessionGpuCanvas): void;
}

export class GpuSessionDisplay implements GpuWorldDisplay, SessionDisplayControls {
    private firstFrameSeen = false;

    public constructor(
        private readonly canvas: SessionGpuCanvas,
        private visible: boolean,
        private readonly events: SessionDisplayEvents,
        private readonly host: GpuSessionHost,
    ) {
    }

    public show(): void {
        this.visible = true;
        this.canvas.show();
        this.host.shown(this.canvas);
    }

    public hide(): void {
        this.host.hiding(this.canvas);
        this.visible = false;
        this.canvas.hide();
    }

    public dispose(): void {
        this.canvas.dispose();
    }

    public surfaceSize(): PixelSurfaceSize {
        return this.canvas.surfaceSize();
    }

    public onResize(listener: () => void): () => void {
        return this.canvas.onResize(listener);
    }

    public transferCanvas(): OffscreenCanvas {
        return this.canvas.transferCanvas();
    }

    public showScreenUnit(pixelsPerScreenUnitX: number, pixelsPerScreenUnitY: number): void {
        this.canvas.showScreenUnit(pixelsPerScreenUnitX, pixelsPerScreenUnitY);
        if (this.firstFrameSeen) return;
        this.firstFrameSeen = true;
        this.events.firstFrame();
    }

    public showStatus(text: string): void {
        if (this.visible) this.canvas.showStatus(text);
    }

    public showError(text: string): void {
        if (this.visible) this.canvas.showError(text);
        this.events.failed(text);
    }
}

export class GpuEditorViewport implements EditorViewport {
    private current: SessionGpuCanvas | undefined;
    private focusHandedOver = false;

    private readonly host: GpuSessionHost = {
        shown: canvas => {
            this.current = canvas;
            if (this.focusHandedOver) canvas.focus();
            this.focusHandedOver = false;
        },
        hiding: canvas => {
            this.focusHandedOver = canvas.hasFocus();
        },
    };

    public constructor(private readonly createCanvas: (visible: boolean) => SessionGpuCanvas, public readonly gameTarget: GameTarget) {
    }

    public sessionDisplay(visible: boolean, events: SessionDisplayEvents): EditorSessionDisplay {
        const canvas = this.createCanvas(visible);
        if (visible) this.current = canvas;
        return new GpuSessionDisplay(canvas, visible, events, this.host);
    }

    public sessionInput(ports: SessionInputPorts): InputEventSink {
        return ports.events;
    }

    public cellArea(): CellArea {
        return this.current?.cellArea() ?? NO_CELL_AREA;
    }

    public showError(text: string): void {
        const canvas = this.current ??= this.createCanvas(VISIBLE);
        canvas.showError(text);
    }

    public dispose(): void {
        this.current?.dispose();
    }
}

export function editorViewportFor(gameTarget: GameTarget, container: HTMLElement, search: string, visible: boolean, pixelScale?: number): EditorViewport {
    switch (gameTarget.backend) {
        case "cells":
            return new CellEditorViewport(cellCanvasDisplayFromQuery(container, search, visible), gameTarget);
        case "pixels":
            return new PixelEditorViewport(pixelCanvasDisplayFromQuery(container, search, visible, pixelScale), gameTarget);
        case "gpu": {
            const options = pixelCanvasDisplayOptionsFromQuery(search, pixelScale);
            return new GpuEditorViewport(sessionVisible => new GpuCanvasDisplay(container, options, sessionVisible), gameTarget);
        }
    }
}
