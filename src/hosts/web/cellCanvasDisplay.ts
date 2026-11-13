import {CanvasCellPresenter} from "../../backends/cells/canvas";
import type {CellFrame} from "../../backends/cells/cellFrame";
import {CanvasDisplayShell, currentDevicePixelRatio} from "./canvasDisplayShell";
import type {CellArea} from "./domInput";
import type {CellWorldDisplay} from "./worldWorkerPage";
import {FIXED_TERMINAL_LIMITS, fixedTerminalSizeFromQuery} from "./worldWorkerProtocol";
import type {CellSurfaceSize, FixedTerminalSize} from "./worldWorkerProtocol";

function fittedCells(availableDevicePx: number, cellDevicePx: number, min: number): number {
    return Math.min(FIXED_TERMINAL_LIMITS.max, Math.max(min, Math.floor(availableDevicePx / cellDevicePx)));
}

export class CellCanvasDisplay implements CellWorldDisplay {
    private readonly shell: CanvasDisplayShell<CellFrame>;
    private readonly presenter: CanvasCellPresenter<HTMLCanvasElement>;

    public constructor(container: HTMLElement, private readonly fixed: FixedTerminalSize = {}) {
        this.shell = new CanvasDisplayShell<CellFrame>(container, frame => this.presenter.present(frame));
        this.presenter = new CanvasCellPresenter<HTMLCanvasElement>({
            canvas: this.shell.canvas,
            context: this.shell.context,
            atlasCanvas: document.createElement("canvas"),
            devicePixelRatio: currentDevicePixelRatio(),
        });
        this.shell.mount(this.fit);
    }

    public surfaceSize(): CellSurfaceSize {
        const {columns, rows} = this.presenter.size();
        return {kind: "cells", columns, rows};
    }

    public onResize(listener: () => void): () => void {
        return this.presenter.onResize(listener);
    }

    public presentCells(frame: CellFrame, onPresented: () => void): void {
        this.shell.present(frame, onPresented);
    }

    public showStatus(text: string): void {
        this.shell.showStatus(text);
    }

    public showError(text: string): void {
        this.shell.showError(text);
    }

    public cellArea(): CellArea {
        const bounds = this.shell.canvas.getBoundingClientRect();
        const {columns, rows} = this.presenter.size();
        return {left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, columns, rows};
    }

    private readonly fit = (): void => {
        const presenter = this.presenter;
        presenter.setDevicePixelRatio(currentDevicePixelRatio());
        const ratio = presenter.devicePixelRatio;
        const bounds = this.shell.containerBounds();
        presenter.resize(
            this.fixed.columns ?? fittedCells(bounds.width * ratio, presenter.cellWidthDevicePx, FIXED_TERMINAL_LIMITS.minColumns),
            this.fixed.rows ?? fittedCells(bounds.height * ratio, presenter.cellHeightDevicePx, FIXED_TERMINAL_LIMITS.minRows),
        );
        const canvas = this.shell.canvas;
        canvas.style.width = `${canvas.width / ratio}px`;
        canvas.style.height = `${canvas.height / ratio}px`;
    };
}

export function cellCanvasDisplayFromQuery(container: HTMLElement, search: string): CellCanvasDisplay {
    return new CellCanvasDisplay(container, fixedTerminalSizeFromQuery(search));
}
