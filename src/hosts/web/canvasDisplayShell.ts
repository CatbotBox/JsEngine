const UNFOCUSED_CLASS = "terminal-unfocused";
const STATUS_ELEMENT_ID = "status";
const ERROR_CLASS = "error";
const IN_TAB_ORDER = 0;
const FALLBACK_DEVICE_PIXEL_RATIO = 1;
const OPAQUE_CANVAS: CanvasRenderingContext2DSettings = {alpha: false};

export function currentDevicePixelRatio(): number {
    const ratio = window.devicePixelRatio;
    return ratio > 0 ? ratio : FALLBACK_DEVICE_PIXEL_RATIO;
}

export class CanvasDisplayShell<Frame> {
    public readonly canvas = document.createElement("canvas");
    public readonly context: CanvasRenderingContext2D;
    private readonly status = document.createElement("div");
    private readonly pendingAcknowledgements: (() => void)[] = [];
    private pendingFrame: Frame | undefined;
    private drawRequested = false;
    private showingError = false;

    public constructor(private readonly container: HTMLElement, private readonly draw: (frame: Frame) => void) {
        const context = this.canvas.getContext("2d", OPAQUE_CANVAS);
        if (context === null) throw new Error("This browser cannot draw on a 2D canvas");
        this.context = context;
    }

    public mount(fit: () => void): void {
        this.canvas.tabIndex = IN_TAB_ORDER;
        this.status.id = STATUS_ELEMENT_ID;
        this.status.hidden = true;
        this.container.append(this.canvas, this.status);
        fit();
        window.addEventListener("resize", fit);
        this.watchDevicePixelRatio(fit);
        this.container.addEventListener("click", () => this.canvas.focus());
        this.canvas.focus();
        this.trackFocus();
    }

    public containerBounds(): DOMRect {
        return this.container.getBoundingClientRect();
    }

    public present(frame: Frame, onPresented: () => void): void {
        if (!this.showingError) this.status.hidden = true;
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
            fit();
            this.watchDevicePixelRatio(fit);
        }, {once: true});
    }

    private trackFocus(): void {
        const update = () => document.body.classList.toggle(UNFOCUSED_CLASS, document.activeElement !== this.canvas);
        this.canvas.addEventListener("focus", update);
        this.canvas.addEventListener("blur", update);
        update();
    }
}
