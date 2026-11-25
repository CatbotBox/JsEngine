import {NULL_ENTITY, System, Unchanged} from "../core";
import type {Entity} from "../core";
import {Input} from "../input/input";
import type {InputEvent} from "../input/inputEvent";
import {POINTER_BUTTONS, PointerButton} from "../input/pointerButton";
import {UiBox} from "./uiBox";
import {UiEvents} from "./uiEvents";
import type {UiEventRecord, UiEventType} from "./uiEvents";
import {UiInputSystemGroup} from "./uiInputSystemGroup";
import {UiInteractable} from "./uiInteractable";
import {UiLayoutSystem} from "./uiLayoutSystem";
import {
    NO_HIT,
    NO_POINTER_FLAGS,
    POINTER_NODE_ACCEPTS_PRESS,
    POINTER_NODE_BLOCKS_GAME_INPUT,
    POINTER_NODE_DECLARES_CLICK,
    POINTER_NODE_DECLARES_DRAG,
    POINTER_NODE_DECLARES_WHEEL,
    POINTER_NODE_DISABLED,
    POINTER_NODE_HOVERABLE,
    POINTER_NODE_INTERACTIVE,
    POINTER_NODE_PRESENT,
    pointerFlagsOf,
    UiPointerNodes,
} from "./uiPointerNodes";
import {UiRect} from "./uiRect";
import {UiRoot} from "./uiRoot";
import {UiScaleSnapping} from "./uiScaleSnapping";
import {UiScroll} from "./uiScroll";
import {UI_STATE_DISABLED, UI_STATE_HOVERED, UI_STATE_PRESSED, UI_POINTER_STATE_BITS, UiState} from "./uiState";
import {UI_POINTER_PRIORITY} from "./uiSystemPriorities";
import {UiText} from "./uiText";
import {NO_PARENT_INDEX, NOT_IN_TREE, UiTreeIndex} from "./uiTreeIndex";

export const DOUBLE_CLICK_MAX_INTERVAL_MS = 500;
export const DOUBLE_CLICK_MAX_DISTANCE_UNITS = 0.5;

type PointerOwner = "none" | "ui" | "game";

const INCLUDE_DISABLED = true;
const NEVER_GATHERED = -2;
const NO_TREE_VERSION = -1;
const NO_BUTTONS = 0;
const NO_NODES = 0;
const DEFAULT_SCALE = 1;

const WATCHED_NODE_COMPONENTS = {
    rect: UiRect,
    interactable: UiInteractable,
    scroll: UiScroll,
    box: UiBox,
    text: UiText,
    root: UiRoot,
};

const GATHERED_COMPONENTS = {
    interactable: UiInteractable,
    scroll: UiScroll,
    box: UiBox,
    text: UiText,
    root: UiRoot,
};

function buttonBit(button: PointerButton): number {
    return 1 << button;
}

function carriesPosition(event: InputEvent | undefined): boolean {
    return event !== undefined && (event.type === "pointerMove" || event.type === "pointerDown" || event.type === "pointerUp" || event.type === "wheel");
}

function withinDoubleClickDistance(fromScreen: number, toScreen: number, scale: number): boolean {
    return Math.abs(toScreen - fromScreen) / scale <= DOUBLE_CLICK_MAX_DISTANCE_UNITS;
}

export class UiPointerSystem extends System {
    private readonly _nodes = this.createEntityQuery([UiRect]);
    private readonly _states = this.createEntityQuery([UiState]);
    private readonly _pointerNodes = new UiPointerNodes();
    private _gatheredVersion = NEVER_GATHERED;
    private _gatheredCount = 0;
    private _gatheredStamp = 0;

    private _events: UiEvents | undefined;
    private _tree: UiTreeIndex | undefined;
    private _snapping: UiScaleSnapping | undefined;
    private _clockMs = 0;
    private _claimed = false;
    private _gameOwnedThisFrame = false;
    private _statesDirty = true;

    private _pointerKnown = false;
    private _pointerX = 0;
    private _pointerY = 0;

    private _hoverNode = NO_HIT;
    private _hoverOrigin: Entity = NULL_ENTITY;
    private _hoverScale = DEFAULT_SCALE;
    private _overClaimingUi = false;
    private _hoverPath: Entity[] = [];
    private _hoverEntered: boolean[] = [];
    private _nextPath: Entity[] = [];
    private _nextEntered: boolean[] = [];
    private readonly _nextNodes: number[] = [];

    private _owner: PointerOwner = "none";
    private _buttons = NO_BUTTONS;
    private readonly _pressPath: Entity[] = [];
    private readonly _pressTargets: Entity[] = POINTER_BUTTONS.map(() => NULL_ENTITY);
    private readonly _clickTargets: Entity[] = POINTER_BUTTONS.map(() => NULL_ENTITY);
    private readonly _pressTimesMs: number[] = POINTER_BUTTONS.map(() => 0);
    private readonly _pressXs: number[] = POINTER_BUTTONS.map(() => 0);
    private readonly _pressYs: number[] = POINTER_BUTTONS.map(() => 0);
    private readonly _pressScales: number[] = POINTER_BUTTONS.map(() => DEFAULT_SCALE);

    private _dragTarget: Entity = NULL_ENTITY;
    private _dragButton: PointerButton = PointerButton.Left;
    private _dragX = 0;
    private _dragY = 0;
    private _dragScale = DEFAULT_SCALE;

    private _lastClickTarget: Entity = NULL_ENTITY;
    private _lastClickButton: PointerButton = PointerButton.Left;
    private _lastClickTimeMs = 0;
    private _lastClickX = 0;
    private _lastClickY = 0;

    override systemGroup() {
        return UiInputSystemGroup;
    }

    override priority(): number {
        return UI_POINTER_PRIORITY;
    }

    protected onCreate() {
        this.world.resources.getOrCreate(Input);
        this.world.resources.getOrCreate(UiEvents);
        this.world.ensureSystemExists(UiLayoutSystem);
    }

    override onEnable(): void {
        this._gatheredVersion = NEVER_GATHERED;
        this._statesDirty = true;
        this._hoverNode = NO_HIT;
        this._hoverOrigin = NULL_ENTITY;
        this._overClaimingUi = false;
        this._hoverPath.length = 0;
        this._hoverEntered.length = 0;
        this._owner = "none";
        this._buttons = NO_BUTTONS;
        this._pressPath.length = 0;
        this._pressTargets.fill(NULL_ENTITY);
        this._clickTargets.fill(NULL_ENTITY);
        this._dragTarget = NULL_ENTITY;
        this._lastClickTarget = NULL_ENTITY;
    }

    onUpdate() {
        const resources = this.world.resources;
        const input = resources.getOrCreate(Input);
        this._events = resources.getOrCreate(UiEvents);
        this._tree = resources.tryGet(UiTreeIndex);
        this._snapping = resources.getOrCreate(UiScaleSnapping);
        this._clockMs += this.world.time.deltaTimeMs;
        this._claimed = false;
        this._gameOwnedThisFrame = this._owner === "game";
        if (this.refreshNodes() && this._pointerKnown) this.hover();
        this.applyInput(input);
        if (this._owner === "ui" || this.hoverClaims()) this._claimed = true;
        if (this._claimed) input.claimPointer();
        if (this._statesDirty) this.writeStates();
    }

    private hoverClaims(): boolean {
        return this._owner === "none" && this._overClaimingUi && !this._gameOwnedThisFrame;
    }

    private applyInput(input: Input): void {
        const events = input.events;
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            switch (event.type) {
                case "pointerMove":
                    if (!carriesPosition(events[i + 1])) this.moveTo(event.x, event.y);
                    break;
                case "pointerDown":
                    this.moveTo(event.x, event.y);
                    this.press(event.button);
                    break;
                case "pointerUp":
                    this.moveTo(event.x, event.y);
                    this.release(event.button, input.releasedByFocusLoss(event));
                    break;
                case "wheel":
                    this.moveTo(event.x, event.y);
                    this.wheel(event.delta);
                    break;
            }
        }
    }

    private refreshNodes(): boolean {
        const tree = this._tree;
        if (!this.nodesChanged(tree)) return false;
        const nodes = this._pointerNodes;
        nodes.reset(tree?.count ?? NO_NODES);
        if (tree !== undefined) {
            this._nodes.stream({read: {rect: UiRect}, optional: GATHERED_COMPONENTS}, {includeEntity: true}).consume(row => {
                const node = tree.indexOf(row.entity);
                if (node !== NOT_IN_TREE) nodes.setNode(node, row.rect, pointerFlagsOf(row));
            });
        }
        this._gatheredVersion = tree?.version ?? NO_TREE_VERSION;
        this._gatheredCount = this._nodes.entityCountIncludingDisabled();
        this._gatheredStamp = this.world.changeStamps.advance();
        this._statesDirty = true;
        return true;
    }

    private nodesChanged(tree: UiTreeIndex | undefined): boolean {
        if ((tree?.version ?? NO_TREE_VERSION) !== this._gatheredVersion) return true;
        if (tree === undefined) return false;
        if (this._nodes.entityCountIncludingDisabled() !== this._gatheredCount) return true;
        const options = {filterLastUpdated: this._gatheredStamp, includeDisabled: INCLUDE_DISABLED};
        return this._nodes.stream({optional: WATCHED_NODE_COMPONENTS}, options).hasAny();
    }

    private moveTo(x: number, y: number): void {
        if (this._pointerKnown && x === this._pointerX && y === this._pointerY) return;
        this._pointerKnown = true;
        this._pointerX = x;
        this._pointerY = y;
        this.hover();
        this.dragTo();
    }

    private hover(): void {
        const tree = this._tree;
        const nodes = this._pointerNodes;
        const next = this._nextPath, nextEntered = this._nextEntered, nextNodes = this._nextNodes;
        next.length = 0;
        nextEntered.length = 0;
        nextNodes.length = 0;
        const hit = tree === undefined ? NO_HIT : nodes.hitTest(tree, this._snapping!, this._pointerX, this._pointerY);
        let scale = this._hoverScale;
        let claiming = false;
        if (tree !== undefined && hit !== NO_HIT) {
            const flags = nodes.flags, parentIndex = tree.parentIndex;
            scale = tree.rootScales[nodes.hitRoot];
            claiming = (flags[tree.roots[nodes.hitRoot]] & POINTER_NODE_BLOCKS_GAME_INPUT) !== NO_POINTER_FLAGS;
            for (let node = hit; node !== NO_PARENT_INDEX; node = parentIndex[node]) {
                if ((flags[node] & POINTER_NODE_PRESENT) === NO_POINTER_FLAGS) continue;
                next.push(tree.entities[node]);
                nextNodes.push(node);
                if ((flags[node] & POINTER_NODE_INTERACTIVE) !== NO_POINTER_FLAGS) claiming = true;
            }
            next.reverse();
            nextNodes.reverse();
        }
        this._hoverNode = hit;
        this._hoverOrigin = hit === NO_HIT ? NULL_ENTITY : tree!.entities[hit];
        this._overClaimingUi = claiming;
        this.diffHoverPaths(scale);
        this._hoverScale = scale;
    }

    private diffHoverPaths(nextScale: number): void {
        const previous = this._hoverPath, previousEntered = this._hoverEntered;
        const next = this._nextPath, nextEntered = this._nextEntered;
        let common = 0;
        while (common < previous.length && common < next.length && previous[common] === next[common]) common++;
        for (let i = previous.length - 1; i >= common; i--) {
            if (previousEntered[i]) this.emit("pointerLeave", previous[i], this._hoverScale);
        }
        for (let i = 0; i < common; i++) nextEntered.push(previousEntered[i]);
        for (let i = common - 1; i >= 0; i--) {
            if (!nextEntered[i] || this.nextAcceptsHover(i)) continue;
            this.emit("pointerLeave", next[i], nextScale);
            nextEntered[i] = false;
        }
        for (let i = 0; i < next.length; i++) {
            const stillEntered = i < common && nextEntered[i];
            const entered = stillEntered || (this.nextAcceptsHover(i) && this.emit("pointerEnter", next[i], nextScale) !== undefined);
            if (i < common) nextEntered[i] = entered;
            else nextEntered.push(entered);
        }
        if (common !== previous.length || common !== next.length) this._statesDirty = true;
        this._hoverPath = next;
        this._hoverEntered = nextEntered;
        this._nextPath = previous;
        this._nextEntered = previousEntered;
    }

    private nextAcceptsHover(pathIndex: number): boolean {
        return (this._pointerNodes.flags[this._nextNodes[pathIndex]] & POINTER_NODE_HOVERABLE) !== NO_POINTER_FLAGS;
    }

    private dragTo(): void {
        const target = this._dragTarget;
        if (target === NULL_ENTITY) return;
        const scale = this._dragScale;
        const dx = (this._pointerX - this._dragX) / scale, dy = (this._pointerY - this._dragY) / scale;
        this._dragX = this._pointerX;
        this._dragY = this._pointerY;
        const event = this.emitCaptured("drag", target, scale, this._dragButton);
        if (event === undefined) return;
        event.dx = dx;
        event.dy = dy;
    }

    private press(button: PointerButton): void {
        const bit = buttonBit(button);
        if ((this._buttons & bit) !== NO_BUTTONS) return;
        if (this._buttons === NO_BUTTONS) this.beginGesture();
        this._buttons |= bit;
        if (this._owner !== "ui") return;
        this._claimed = true;
        const pressTarget = this.acceptorOfHover(POINTER_NODE_ACCEPTS_PRESS);
        this._pressTargets[button] = pressTarget;
        this._clickTargets[button] = this.acceptorOfHover(POINTER_NODE_DECLARES_CLICK);
        this._pressTimesMs[button] = this._clockMs;
        this._pressXs[button] = this._pointerX;
        this._pressYs[button] = this._pointerY;
        this._pressScales[button] = this._hoverScale;
        if (this._dragTarget === NULL_ENTITY) this.captureDrag(button);
        const event = this.emit("press", pressTarget, this._hoverScale);
        if (event !== undefined) event.button = button;
    }

    private captureDrag(button: PointerButton): void {
        const target = this.acceptorOfHover(POINTER_NODE_DECLARES_DRAG);
        if (target === NULL_ENTITY) return;
        this._dragTarget = target;
        this._dragButton = button;
        this._dragX = this._pointerX;
        this._dragY = this._pointerY;
        this._dragScale = this._hoverScale;
    }

    private release(button: PointerButton, releasedByFocusLoss: boolean): void {
        const bit = buttonBit(button);
        if ((this._buttons & bit) === NO_BUTTONS) return;
        this._buttons &= ~bit;
        if (this._owner === "ui") {
            this._claimed = true;
            const pressTarget = this._pressTargets[button];
            this.emitCaptured("release", pressTarget, this._pressScales[button], button);
            if (this._dragTarget !== NULL_ENTITY && this._dragButton === button) {
                if (this._dragTarget !== pressTarget) this.emitCaptured("release", this._dragTarget, this._dragScale, button);
                this._dragTarget = NULL_ENTITY;
            }
            if (!releasedByFocusLoss) this.click(button);
            this._pressTargets[button] = NULL_ENTITY;
            this._clickTargets[button] = NULL_ENTITY;
        }
        if (this._buttons === NO_BUTTONS) this.endGesture();
    }

    private click(button: PointerButton): void {
        const target = this._clickTargets[button];
        if (target === NULL_ENTITY || this.acceptorOfHover(POINTER_NODE_DECLARES_CLICK) !== target) return;
        const scale = this._pressScales[button];
        const click = this.emit("click", target, scale);
        if (click === undefined) return;
        click.button = button;
        const pressTimeMs = this._pressTimesMs[button], pressX = this._pressXs[button], pressY = this._pressYs[button];
        if (this.continuesClick(target, button, pressTimeMs, pressX, pressY, scale)) {
            const doubleClick = this.emit("doubleClick", target, scale);
            if (doubleClick !== undefined) doubleClick.button = button;
            this._lastClickTarget = NULL_ENTITY;
            return;
        }
        this._lastClickTarget = target;
        this._lastClickButton = button;
        this._lastClickTimeMs = pressTimeMs;
        this._lastClickX = pressX;
        this._lastClickY = pressY;
    }

    private continuesClick(target: Entity, button: PointerButton, pressTimeMs: number, pressX: number, pressY: number, scale: number): boolean {
        return this._lastClickTarget === target && this._lastClickButton === button
            && pressTimeMs - this._lastClickTimeMs <= DOUBLE_CLICK_MAX_INTERVAL_MS
            && withinDoubleClickDistance(this._lastClickX, pressX, scale) && withinDoubleClickDistance(this._lastClickY, pressY, scale);
    }

    private wheel(delta: number): void {
        if (this._owner === "game") return;
        if (this._owner === "ui" || this.hoverClaims()) this._claimed = true;
        const event = this.emit("wheel", this.acceptorOfHover(POINTER_NODE_DECLARES_WHEEL), this._hoverScale);
        if (event !== undefined) event.delta = delta;
    }

    private beginGesture(): void {
        this._owner = this._overClaimingUi ? "ui" : "game";
        if (this._owner === "game") this._gameOwnedThisFrame = true;
        if (this._owner !== "ui") return;
        const path = this._hoverPath, pressed = this._pressPath;
        pressed.length = 0;
        for (let i = 0; i < path.length; i++) pressed.push(path[i]);
        if (pressed.length > 0) this._statesDirty = true;
    }

    private endGesture(): void {
        if (this._pressPath.length > 0) this._statesDirty = true;
        this._pressPath.length = 0;
        this._owner = "none";
        this._dragTarget = NULL_ENTITY;
    }

    private acceptorOfHover(declared: number): Entity {
        const tree = this._tree;
        if (tree === undefined) return NULL_ENTITY;
        const node = this._pointerNodes.acceptor(tree, this._hoverNode, declared);
        return node === NO_HIT ? NULL_ENTITY : tree.entities[node];
    }

    private capturedTargetDisabled(target: Entity): boolean {
        const node = this._tree?.indexOf(target) ?? NOT_IN_TREE;
        return node !== NOT_IN_TREE && (this._pointerNodes.flags[node] & POINTER_NODE_DISABLED) !== NO_POINTER_FLAGS;
    }

    private emitCaptured(type: UiEventType, target: Entity, scale: number, button: PointerButton): UiEventRecord | undefined {
        if (target === NULL_ENTITY || this.capturedTargetDisabled(target)) return undefined;
        const event = this.emit(type, target, scale);
        if (event !== undefined) event.button = button;
        return event;
    }

    private emit(type: UiEventType, target: Entity, scale: number): UiEventRecord | undefined {
        if (target === NULL_ENTITY || !this.entityManager.exists(target)) return undefined;
        return this._events!.emit(type, target, this._hoverOrigin, this._pointerX / scale, this._pointerY / scale);
    }

    private writeStates(): void {
        this._statesDirty = false;
        const hovered = this._hoverPath, pressed = this._pressPath;
        this._states.stream({write: {state: UiState}, optional: {interactable: UiInteractable}}, {includeEntity: true, includeDisabled: INCLUDE_DISABLED})
            .consume(({entity, state, interactable}) => {
                let bits = state.bits & ~UI_POINTER_STATE_BITS;
                if (hovered.includes(entity)) bits |= UI_STATE_HOVERED;
                if (pressed.includes(entity)) bits |= UI_STATE_PRESSED;
                if (interactable?.disabled === true) bits |= UI_STATE_DISABLED;
                if (bits === state.bits) return Unchanged;
                state.bits = bits;
                return undefined;
            });
    }
}
