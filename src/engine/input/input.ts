import {Resource} from "../core/resource";
import type {Key} from "./key";
import {POINTER_BUTTONS} from "./pointerButton";
import type {PointerButton} from "./pointerButton";
import {NO_MODIFIERS} from "./inputEvent";
import type {
    FocusChangeEvent,
    InputEvent,
    InputEventSink,
    KeyDownEvent,
    KeyUpEvent,
    PointerDownEvent,
    PointerPosition,
    PointerUpEvent,
} from "./inputEvent";

export type ActionBindings = Readonly<Record<string, readonly Key[]>>;

const NO_BUTTONS = 0;

function buttonBit(button: PointerButton): number {
    return 1 << button;
}

export class Input extends Resource implements InputEventSink {
    private queued: InputEvent[] = [];
    private spare: InputEvent[] = [];
    private readonly frameEvents: InputEvent[] = [];

    private readonly keysHeld = new Set<Key>();
    private readonly keysPressed = new Set<Key>();
    private readonly keysReleased = new Set<Key>();

    private buttonsHeld = NO_BUTTONS;
    private buttonsPressed = NO_BUTTONS;
    private buttonsReleased = NO_BUTTONS;
    private _pointerX = 0;
    private _pointerY = 0;
    private _wheelDelta = 0;
    private _focused = true;

    private readonly actionKeys = new Map<string, readonly Key[]>();
    private readonly actionsPressed = new Set<string>();
    private readonly actionsReleased = new Set<string>();

    public get events(): readonly InputEvent[] {
        return this.frameEvents;
    }

    public get pointerX(): number {
        return this._pointerX;
    }

    public get pointerY(): number {
        return this._pointerY;
    }

    public get wheelDelta(): number {
        return this._wheelDelta;
    }

    public get focused(): boolean {
        return this._focused;
    }

    public enqueue(event: InputEvent): void {
        this.queued.push(event);
    }

    public beginFrame(): void {
        this.clearFrame();
        const batch = this.queued;
        this.queued = this.spare;
        for (let i = 0; i < batch.length; i++) this.apply(batch[i]);
        batch.length = 0;
        this.spare = batch;
    }

    public keyHeld(key: Key): boolean {
        return this.keysHeld.has(key);
    }

    public keyPressed(key: Key): boolean {
        return this.keysPressed.has(key);
    }

    public keyReleased(key: Key): boolean {
        return this.keysReleased.has(key);
    }

    public buttonHeld(button: PointerButton): boolean {
        return (this.buttonsHeld & buttonBit(button)) !== NO_BUTTONS;
    }

    public buttonPressed(button: PointerButton): boolean {
        return (this.buttonsPressed & buttonBit(button)) !== NO_BUTTONS;
    }

    public buttonReleased(button: PointerButton): boolean {
        return (this.buttonsReleased & buttonBit(button)) !== NO_BUTTONS;
    }

    public bindAction(name: string, keys: readonly Key[]): void {
        this.actionKeys.set(name, Object.freeze([...keys]));
    }

    public bindActions(bindings: ActionBindings): void {
        for (const name of Object.keys(bindings)) this.bindAction(name, bindings[name]);
    }

    public unbindAction(name: string): void {
        this.actionKeys.delete(name);
        this.actionsPressed.delete(name);
        this.actionsReleased.delete(name);
    }

    public actionHeld(name: string): boolean {
        return this.anyKeyHeld(this.requireAction(name));
    }

    public actionPressed(name: string): boolean {
        this.requireAction(name);
        return this.actionsPressed.has(name);
    }

    public actionReleased(name: string): boolean {
        this.requireAction(name);
        return this.actionsReleased.has(name);
    }

    private requireAction(name: string): readonly Key[] {
        const keys = this.actionKeys.get(name);
        if (keys === undefined) throw new Error(`No input action named "${name}"; bind it with bindAction first`);
        return keys;
    }

    private anyKeyHeld(keys: readonly Key[]): boolean {
        for (let i = 0; i < keys.length; i++) if (this.keysHeld.has(keys[i])) return true;
        return false;
    }

    private clearFrame(): void {
        this.frameEvents.length = 0;
        this.keysPressed.clear();
        this.keysReleased.clear();
        this.buttonsPressed = NO_BUTTONS;
        this.buttonsReleased = NO_BUTTONS;
        this._wheelDelta = 0;
        this.actionsPressed.clear();
        this.actionsReleased.clear();
    }

    private apply(event: InputEvent): void {
        switch (event.type) {
            case "keyDown":
                this.applyKeyDown(event);
                break;
            case "keyUp":
                this.applyKeyUp(event);
                break;
            case "pointerDown":
                this.applyPointerDown(event);
                break;
            case "pointerUp":
                this.applyPointerUp(event);
                break;
            case "pointerMove":
                this.movePointer(event);
                this.frameEvents.push(event);
                break;
            case "wheel":
                this.movePointer(event);
                this._wheelDelta += event.delta;
                this.frameEvents.push(event);
                break;
            case "focus":
                this.applyFocus(event);
                break;
            case "text":
                this.frameEvents.push(event);
                break;
        }
    }

    private applyKeyDown(event: KeyDownEvent): void {
        const repeat = this.keysHeld.has(event.key);
        if (!repeat) this.pressKey(event.key);
        this.frameEvents.push(event.repeat === repeat ? event : {...event, repeat});
    }

    private applyKeyUp(event: KeyUpEvent): void {
        if (!this.keysHeld.has(event.key)) return;
        this.releaseKey(event.key);
        this.frameEvents.push(event);
    }

    private pressKey(key: Key): void {
        for (const [name, keys] of this.actionKeys) {
            if (keys.includes(key) && !this.anyKeyHeld(keys)) this.actionsPressed.add(name);
        }
        this.keysHeld.add(key);
        this.keysPressed.add(key);
    }

    private releaseKey(key: Key): void {
        this.keysHeld.delete(key);
        this.keysReleased.add(key);
        for (const [name, keys] of this.actionKeys) {
            if (keys.includes(key) && !this.anyKeyHeld(keys)) this.actionsReleased.add(name);
        }
    }

    private applyPointerDown(event: PointerDownEvent): void {
        this.movePointer(event);
        const bit = buttonBit(event.button);
        if ((this.buttonsHeld & bit) !== NO_BUTTONS) return;
        this.buttonsHeld |= bit;
        this.buttonsPressed |= bit;
        this.frameEvents.push(event);
    }

    private applyPointerUp(event: PointerUpEvent): void {
        this.movePointer(event);
        const bit = buttonBit(event.button);
        if ((this.buttonsHeld & bit) === NO_BUTTONS) return;
        this.releaseButton(bit);
        this.frameEvents.push(event);
    }

    private releaseButton(bit: number): void {
        this.buttonsHeld &= ~bit;
        this.buttonsReleased |= bit;
    }

    private movePointer(position: PointerPosition): void {
        this._pointerX = position.x;
        this._pointerY = position.y;
    }

    private applyFocus(event: FocusChangeEvent): void {
        if (event.focused === this._focused) return;
        if (!event.focused) this.releaseEverything();
        this._focused = event.focused;
        this.frameEvents.push(event);
    }

    private releaseEverything(): void {
        for (const key of [...this.keysHeld]) {
            this.releaseKey(key);
            this.frameEvents.push({type: "keyUp", key, ...NO_MODIFIERS});
        }
        for (const button of POINTER_BUTTONS) {
            const bit = buttonBit(button);
            if ((this.buttonsHeld & bit) === NO_BUTTONS) continue;
            this.releaseButton(bit);
            this.frameEvents.push({type: "pointerUp", button, x: this._pointerX, y: this._pointerY, ...NO_MODIFIERS});
        }
    }
}
