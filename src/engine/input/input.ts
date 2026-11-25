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
    Modifiers,
    PointerDownEvent,
    PointerPosition,
    PointerUpEvent,
} from "./inputEvent";
import type {InputMap, InputMapAction, KeyChord} from "./inputMap";

declare const inputActionBrand: unique symbol;

export type InputAction = number & {readonly [inputActionBrand]: true};

const NO_BUTTONS = 0;
const NO_WHEEL_DELTA = 0;
const NO_ACTIONS: readonly InputAction[] = [];

interface CompiledAction {
    readonly name: string;
    readonly keys: readonly Key[];
    readonly chords: readonly KeyChord[];
    readonly chordsHeld: boolean[];
    readonly buttonMask: number;
}

function buttonBit(button: PointerButton): number {
    return 1 << button;
}

function chordModifiersHeld(chord: KeyChord, modifiers: Modifiers): boolean {
    return (!chord.ctrl || modifiers.ctrl) && (!chord.alt || modifiers.alt) && (!chord.shift || modifiers.shift) && (!chord.meta || modifiers.meta);
}

function chordMatchesKeyDown(chord: KeyChord, event: KeyDownEvent): boolean {
    return chord.key === event.key && chordModifiersHeld(chord, event);
}

function copiedChord(chord: KeyChord): KeyChord {
    return {key: chord.key, ctrl: chord.ctrl, alt: chord.alt, shift: chord.shift, meta: chord.meta};
}

function refreshTransition(held: boolean[], pressed: boolean[], released: boolean[], action: InputAction, nowHeld: boolean): void {
    if (nowHeld === held[action]) return;
    held[action] = nowHeld;
    if (nowHeld) pressed[action] = true;
    else released[action] = true;
}

function buttonMaskOf(buttons: readonly PointerButton[]): number {
    let mask = NO_BUTTONS;
    for (const button of buttons) mask |= buttonBit(button);
    return mask;
}

function actionNamed(map: InputMap, name: string): InputMapAction {
    for (const action of map.actions) if (action.name === name) return action;
    const known = map.actions.map(action => JSON.stringify(action.name)).join(", ");
    throw new Error(`The InputMap has no action named "${name}"; add it to the input map (it has ${known.length > 0 ? known : "no actions"})`);
}

function requireUniqueActionNames(map: InputMap): void {
    const seen = new Set<string>();
    for (const action of map.actions) {
        if (seen.has(action.name)) throw new Error(`The InputMap lists the action "${action.name}" more than once`);
        seen.add(action.name);
    }
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
    private _pointerClaimed = false;
    private readonly focusLossReleases = new Set<InputEvent>();

    private inputMap: InputMap | undefined;
    private boundActions: readonly InputMapAction[] | undefined;
    private readonly actionIds = new Map<string, InputAction>();
    private readonly compiledActions: CompiledAction[] = [];
    private readonly actionsHeld: boolean[] = [];
    private readonly actionsPressed: boolean[] = [];
    private readonly actionsReleased: boolean[] = [];
    private readonly keyActionsHeld: boolean[] = [];
    private readonly keyActionsPressed: boolean[] = [];
    private readonly keyActionsReleased: boolean[] = [];
    private readonly actionsByKey = new Map<Key, InputAction[]>();
    private readonly actionsByButton: InputAction[][] = POINTER_BUTTONS.map(() => []);

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
        return this._pointerClaimed ? NO_WHEEL_DELTA : this._wheelDelta;
    }

    public get focused(): boolean {
        return this._focused;
    }

    public get pointerClaimed(): boolean {
        return this._pointerClaimed;
    }

    public claimPointer(): void {
        this._pointerClaimed = true;
    }

    public releasedByFocusLoss(event: InputEvent): boolean {
        return this.focusLossReleases.has(event);
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
        return !this._pointerClaimed && (this.buttonsHeld & buttonBit(button)) !== NO_BUTTONS;
    }

    public buttonPressed(button: PointerButton): boolean {
        return !this._pointerClaimed && (this.buttonsPressed & buttonBit(button)) !== NO_BUTTONS;
    }

    public buttonReleased(button: PointerButton): boolean {
        return !this._pointerClaimed && (this.buttonsReleased & buttonBit(button)) !== NO_BUTTONS;
    }

    public useInputMap(map: InputMap | undefined): void {
        if (map === undefined || (map === this.inputMap && map.actions === this.boundActions)) return;
        requireUniqueActionNames(map);
        this.inputMap = map;
        this.boundActions = map.actions;
        this.actionsByKey.clear();
        for (const actions of this.actionsByButton) actions.length = 0;
        for (const [name, action] of this.actionIds) this.compileAction(action, actionNamed(map, name));
    }

    public action(name: string): InputAction {
        const known = this.actionIds.get(name);
        if (known !== undefined) return known;
        const map = this.inputMap;
        if (map === undefined) {
            throw new Error(`Input has no InputMap to resolve the action "${name}" from; resolve actions with resolveInputActions(world, names) once an InputMap resource is loaded`);
        }
        const definition = actionNamed(map, name);
        const action = this.compiledActions.length as InputAction;
        this.actionIds.set(name, action);
        this.compileAction(action, definition);
        return action;
    }

    public actionHeld(action: InputAction): boolean {
        const index = this.requireAction(action);
        return this._pointerClaimed ? this.keyActionsHeld[index] : this.actionsHeld[index];
    }

    public actionPressed(action: InputAction): boolean {
        const index = this.requireAction(action);
        return this._pointerClaimed ? this.keyActionsPressed[index] : this.actionsPressed[index];
    }

    public actionReleased(action: InputAction): boolean {
        const index = this.requireAction(action);
        return this._pointerClaimed ? this.keyActionsReleased[index] : this.actionsReleased[index];
    }

    public actionName(action: InputAction): string {
        return this.compiledActions[this.requireAction(action)].name;
    }

    public isActionEvent(event: InputEvent, action: InputAction): boolean {
        const compiled = this.compiledActions[this.requireAction(action)];
        switch (event.type) {
            case "keyDown":
                return compiled.keys.includes(event.key) || this.anyChordMatchesKeyDown(compiled, event);
            case "keyUp":
                return compiled.keys.includes(event.key) || this.anyChordUsesKey(compiled, event.key);
            case "pointerDown":
            case "pointerUp":
                return (compiled.buttonMask & buttonBit(event.button)) !== NO_BUTTONS;
            default:
                return false;
        }
    }

    private requireAction(action: InputAction): number {
        if (this.compiledActions[action] !== undefined) return action;
        throw new Error(`Unknown input action ${action}: resolve actions through this world's Input with resolveInputActions(world, names)`);
    }

    private compileAction(action: InputAction, definition: InputMapAction): void {
        const compiled: CompiledAction = {
            name: definition.name,
            keys: [...definition.keys],
            chords: definition.chords.map(copiedChord),
            chordsHeld: definition.chords.map(() => false),
            buttonMask: buttonMaskOf(definition.buttons),
        };
        this.compiledActions[action] = compiled;
        for (const key of compiled.keys) this.listenToKey(key, action);
        for (const chord of compiled.chords) this.listenToKey(chord.key, action);
        for (const button of POINTER_BUTTONS) {
            if ((compiled.buttonMask & buttonBit(button)) !== NO_BUTTONS) this.actionsByButton[button].push(action);
        }
        this.actionsHeld[action] = this.computeHeld(compiled);
        this.actionsPressed[action] = false;
        this.actionsReleased[action] = false;
        this.keyActionsHeld[action] = this.computeKeyHeld(compiled);
        this.keyActionsPressed[action] = false;
        this.keyActionsReleased[action] = false;
    }

    private listenToKey(key: Key, action: InputAction): void {
        const listening = this.actionsByKey.get(key);
        if (listening === undefined) this.actionsByKey.set(key, [action]);
        else if (!listening.includes(action)) listening.push(action);
    }

    private actionsUsingKey(key: Key): readonly InputAction[] {
        return this.actionsByKey.get(key) ?? NO_ACTIONS;
    }

    private anyChordMatchesKeyDown(compiled: CompiledAction, event: KeyDownEvent): boolean {
        for (let i = 0; i < compiled.chords.length; i++) if (chordMatchesKeyDown(compiled.chords[i], event)) return true;
        return false;
    }

    private anyChordUsesKey(compiled: CompiledAction, key: Key): boolean {
        for (let i = 0; i < compiled.chords.length; i++) if (compiled.chords[i].key === key) return true;
        return false;
    }

    private computeHeld(compiled: CompiledAction): boolean {
        return (compiled.buttonMask & this.buttonsHeld) !== NO_BUTTONS || this.computeKeyHeld(compiled);
    }

    private computeKeyHeld(compiled: CompiledAction): boolean {
        for (let i = 0; i < compiled.keys.length; i++) if (this.keysHeld.has(compiled.keys[i])) return true;
        for (let i = 0; i < compiled.chordsHeld.length; i++) if (compiled.chordsHeld[i]) return true;
        return false;
    }

    private refreshActions(actions: readonly InputAction[]): void {
        for (let i = 0; i < actions.length; i++) {
            const action = actions[i];
            const compiled = this.compiledActions[action];
            refreshTransition(this.actionsHeld, this.actionsPressed, this.actionsReleased, action, this.computeHeld(compiled));
            refreshTransition(this.keyActionsHeld, this.keyActionsPressed, this.keyActionsReleased, action, this.computeKeyHeld(compiled));
        }
    }

    private holdMatchingChords(actions: readonly InputAction[], event: KeyDownEvent): void {
        for (let i = 0; i < actions.length; i++) {
            const compiled = this.compiledActions[actions[i]];
            for (let c = 0; c < compiled.chords.length; c++) {
                if (chordMatchesKeyDown(compiled.chords[c], event)) compiled.chordsHeld[c] = true;
            }
        }
    }

    private releaseChordsOf(actions: readonly InputAction[], key: Key): void {
        for (let i = 0; i < actions.length; i++) {
            const compiled = this.compiledActions[actions[i]];
            for (let c = 0; c < compiled.chords.length; c++) {
                if (compiled.chords[c].key === key) compiled.chordsHeld[c] = false;
            }
        }
    }

    private clearFrame(): void {
        this.frameEvents.length = 0;
        this.keysPressed.clear();
        this.keysReleased.clear();
        this.buttonsPressed = NO_BUTTONS;
        this.buttonsReleased = NO_BUTTONS;
        this._wheelDelta = NO_WHEEL_DELTA;
        this._pointerClaimed = false;
        this.focusLossReleases.clear();
        this.actionsPressed.fill(false);
        this.actionsReleased.fill(false);
        this.keyActionsPressed.fill(false);
        this.keyActionsReleased.fill(false);
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
        if (!repeat) {
            this.keysHeld.add(event.key);
            this.keysPressed.add(event.key);
        }
        const actions = this.actionsUsingKey(event.key);
        this.holdMatchingChords(actions, event);
        this.refreshActions(actions);
        this.frameEvents.push(event.repeat === repeat ? event : {...event, repeat});
    }

    private applyKeyUp(event: KeyUpEvent): void {
        if (!this.keysHeld.has(event.key)) return;
        this.releaseKey(event.key);
        this.frameEvents.push(event);
    }

    private releaseKey(key: Key): void {
        this.keysHeld.delete(key);
        this.keysReleased.add(key);
        const actions = this.actionsUsingKey(key);
        this.releaseChordsOf(actions, key);
        this.refreshActions(actions);
    }

    private applyPointerDown(event: PointerDownEvent): void {
        this.movePointer(event);
        const bit = buttonBit(event.button);
        if ((this.buttonsHeld & bit) !== NO_BUTTONS) return;
        this.buttonsHeld |= bit;
        this.buttonsPressed |= bit;
        this.refreshActions(this.actionsByButton[event.button]);
        this.frameEvents.push(event);
    }

    private applyPointerUp(event: PointerUpEvent): void {
        this.movePointer(event);
        const bit = buttonBit(event.button);
        if ((this.buttonsHeld & bit) === NO_BUTTONS) return;
        this.releaseButton(event.button);
        this.frameEvents.push(event);
    }

    private releaseButton(button: PointerButton): void {
        const bit = buttonBit(button);
        this.buttonsHeld &= ~bit;
        this.buttonsReleased |= bit;
        this.refreshActions(this.actionsByButton[button]);
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
            this.pushFocusLossRelease({type: "keyUp", key, ...NO_MODIFIERS});
        }
        for (const button of POINTER_BUTTONS) {
            if ((this.buttonsHeld & buttonBit(button)) === NO_BUTTONS) continue;
            this.releaseButton(button);
            this.pushFocusLossRelease({type: "pointerUp", button, x: this._pointerX, y: this._pointerY, ...NO_MODIFIERS});
        }
    }

    private pushFocusLossRelease(event: InputEvent): void {
        this.focusLossReleases.add(event);
        this.frameEvents.push(event);
    }
}
