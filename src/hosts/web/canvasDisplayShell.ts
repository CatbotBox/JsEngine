const UNFOCUSED_CLASS = "terminal-unfocused";
const STATUS_ELEMENT_ID = "status";
const ERROR_CLASS = "error";
const IN_TAB_ORDER = 0;
const FALLBACK_DEVICE_PIXEL_RATIO = 1;
const OPAQUE_CANVAS: CanvasRenderingContext2DSettings = {alpha: false};
const DISPLAYED = "";
const NOT_DISPLAYED = "none";
const VISIBLE = true;

export function currentDevicePixelRatio(): number {
    const ratio = window.devicePixelRatio;
    return ratio > 0 ? ratio : FALLBACK_DEVICE_PIXEL_RATIO;
}

export class CanvasDisplayShell<Frame> {
    public readonly canvas = document.createElement("canvas");
    private context: CanvasRenderingContext2D | undefined;
    private readonly status = document.createElement("div");
    private readonly pendingAcknowledgements: (() => void)[] = [];
    private pendingFrame: Frame | undefined;
    private drawRequested = false;
    private showingError = false;
    private visible = VISIBLE;
    private disposed = false;
    private fit: (() => void) | undefined;

    public constructor(private readonly container: HTMLElement, private readonly draw: (frame: Frame) => void) {
    }

    public context2d(): CanvasRenderingContext2D {
        if (this.context !== undefined) return this.context;
        const context = this.canvas.getContext("2d", OPAQUE_CANVAS);
        if (context === null) throw new Error("This browser cannot draw on a 2D canvas");
        return this.context = context;
    }

    public mount(fit: () => void, visible: boolean = VISIBLE): void {
        this.fit = fit;
        this.canvas.tabIndex = IN_TAB_ORDER;
        this.status.id = STATUS_ELEMENT_ID;
        this.status.hidden = true;
        this.setVisible(visible);
        this.container.append(this.canvas, this.status);
        fit();
        window.addEventListener("resize", fit);
        this.watchDevicePixelRatio(fit);
        this.container.addEventListener("click", this.focusCanvas);
        if (visible) this.canvas.focus();
        this.trackFocus(visible);
    }

    public show(): void {
        this.setVisible(VISIBLE);
    }

    public hide(): void {
        this.setVisible(!VISIBLE);
    }

    public hasFocus(): boolean {
        return this.canvas.ownerDocument.activeElement === this.canvas;
    }

    public focus(): void {
        this.canvas.focus();
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.fit !== undefined) window.removeEventListener("resize", this.fit);
        this.container.removeEventListener("click", this.focusCanvas);
        this.canvas.remove();
        this.status.remove();
    }

    public containerBounds(): DOMRect {
        return this.container.getBoundingClientRect();
    }

    public hideStatus(): void {
        if (!this.showingError) this.status.hidden = true;
    }

    public present(frame: Frame, onPresented: () => void): void {
        this.hideStatus();
        this.pendingFrame = frame;
        this.pendingAcknowledgements.push(onPresented);
        if (this.drawRequested) return;
        this.drawRequested = true;
        requestAnimationFrame(this.drawPendingFrame);
    }

    public showStatus(text: string): void {
        if (this.showingError) return;
        this.status.textContent = text;
        this.status.hidden = false;
    }

    public showError(text: string): void {
        this.showingError = true;
        this.status.textContent = text;
        this.status.classList.add(ERROR_CLASS);
        this.status.hidden = false;
        console.error(text);
    }

    private setVisible(visible: boolean): void {
        this.visible = visible;
        const display = visible ? DISPLAYED : NOT_DISPLAYED;
        this.canvas.style.display = display;
        this.status.style.display = display;
    }

    private readonly focusCanvas = (): void => {
        if (this.visible) this.canvas.focus();
    };

    private readonly drawPendingFrame = (): void => {
        this.drawRequested = false;
        const frame = this.pendingFrame;
        this.pendingFrame = undefined;
        if (frame !== undefined) this.draw(frame);
        for (const acknowledge of this.pendingAcknowledgements.splice(0)) acknowledge();
    };

    private watchDevicePixelRatio(fit: () => void): void {
        const query = window.matchMedia(`(resolution: ${currentDevicePixelRatio()}dppx)`);
        query.addEventListener("change", () => {
            if (this.disposed) return;
            fit();
            this.watchDevicePixelRatio(fit);
        }, {once: true});
    }

    private trackFocus(showFocusNow: boolean): void {
        const update = () => document.body.classList.toggle(UNFOCUSED_CLASS, document.activeElement !== this.canvas);
        this.canvas.addEventListener("focus", update);
        this.canvas.addEventListener("blur", update);
        if (showFocusNow) update();
    }
}
