const UNFOCUSED_CLASS = "terminal-unfocused";
const STATUS_ELEMENT_ID = "status";
const ERROR_CLASS = "error";
const IN_TAB_ORDER = 0;
const FALLBACK_DEVICE_PIXEL_RATIO = 1;
const OPAQUE_CANVAS: CanvasRenderingContext2DSettings = {alpha: false};
const DISPLAYED = "";
const NOT_DISPLAYED = "none";
const VISIBLE = true;
const RESIZE_EVENT = "resize";
const CLICK_EVENT = "click";
const CHANGE_EVENT = "change";
const ONCE: AddEventListenerOptions = {once: true};

type DisplayWindow = Window & typeof globalThis;

export function devicePixelRatioOf(window: Window): number {
    const ratio = window.devicePixelRatio;
    return ratio > 0 ? ratio : FALLBACK_DEVICE_PIXEL_RATIO;
}

export function currentDevicePixelRatio(): number {
    return devicePixelRatioOf(window);
}

function stopNothing(): void {
}

export class CanvasDisplayShell<Frame> {
    public readonly canvas = document.createElement("canvas");
    private context: CanvasRenderingContext2D | undefined;
    private readonly status = document.createElement("div");
    private readonly pendingAcknowledgements: (() => void)[] = [];
    private pendingFrame: Frame | undefined;
    private drawRequestedIn: Window | undefined;
    private showingError = false;
    private visible = VISIBLE;
    private disposed = false;
    private fit: (() => void) | undefined;
    private followedWindow: Window | undefined;
    private stopFollowingWindow: () => void = stopNothing;

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
        this.followWindow();
        fit();
        this.container.addEventListener(RESIZE_EVENT, this.containerResized);
        this.container.addEventListener(CLICK_EVENT, this.focusCanvas);
        if (visible) this.canvas.focus();
        this.trackFocus(visible);
    }

    public devicePixelRatio(): number {
        return devicePixelRatioOf(this.window());
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
        this.stopFollowingWindow();
        this.stopFollowingWindow = stopNothing;
        this.container.removeEventListener(RESIZE_EVENT, this.containerResized);
        this.container.removeEventListener(CLICK_EVENT, this.focusCanvas);
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
        this.requestDraw();
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

    private window(): DisplayWindow {
        return this.canvas.ownerDocument.defaultView ?? window;
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

    private readonly containerResized = (): void => {
        if (this.disposed) return;
        this.followWindow();
        this.fit?.();
    };

    private followWindow(): void {
        const fit = this.fit;
        const current = this.window();
        if (fit === undefined || current === this.followedWindow) return;
        this.stopFollowingWindow();
        this.followedWindow = current;
        current.addEventListener(RESIZE_EVENT, fit);
        const stopWatchingRatio = this.watchDevicePixelRatio(current, fit);
        this.stopFollowingWindow = () => {
            current.removeEventListener(RESIZE_EVENT, fit);
            stopWatchingRatio();
        };
        if (this.drawRequestedIn !== undefined) this.requestDraw();
    }

    private requestDraw(): void {
        const current = this.window();
        if (this.drawRequestedIn === current) return;
        this.drawRequestedIn = current;
        current.requestAnimationFrame(this.drawPendingFrame);
    }

    private readonly drawPendingFrame = (): void => {
        this.drawRequestedIn = undefined;
        const frame = this.pendingFrame;
        this.pendingFrame = undefined;
        if (frame !== undefined) this.draw(frame);
        for (const acknowledge of this.pendingAcknowledgements.splice(0)) acknowledge();
    };

    private watchDevicePixelRatio(window: Window, fit: () => void): () => void {
        let query: MediaQueryList | undefined;
        const changed = (): void => {
            if (this.disposed) return;
            fit();
            watch();
        };
        const watch = (): void => {
            query = window.matchMedia(`(resolution: ${devicePixelRatioOf(window)}dppx)`);
            query.addEventListener(CHANGE_EVENT, changed, ONCE);
        };
        watch();
        return () => query?.removeEventListener(CHANGE_EVENT, changed);
    }

    private trackFocus(showFocusNow: boolean): void {
        const update = (): void => {
            const document = this.canvas.ownerDocument;
            document.body.classList.toggle(UNFOCUSED_CLASS, document.activeElement !== this.canvas);
        };
        this.canvas.addEventListener("focus", update);
        this.canvas.addEventListener("blur", update);
        if (showFocusNow) update();
    }
}
