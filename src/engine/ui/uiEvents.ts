import {NULL_ENTITY, Resource} from "../core";
import type {Entity} from "../core";
import {PointerButton} from "../input/pointerButton";
import {NOT_IN_TREE} from "./uiTreeIndex";
import type {UiTreeIndex} from "./uiTreeIndex";

export type UiEventType = "pointerEnter" | "pointerLeave" | "press" | "release" | "click" | "doubleClick" | "drag" | "wheel";

export interface UiEventFields {
    readonly target: Entity;
    readonly origin: Entity;
    readonly x: number;
    readonly y: number;
}

export interface UiPointerEnterEvent extends UiEventFields {
    readonly type: "pointerEnter";
}

export interface UiPointerLeaveEvent extends UiEventFields {
    readonly type: "pointerLeave";
}

export interface UiButtonEvent<Type extends UiEventType> extends UiEventFields {
    readonly type: Type;
    readonly button: PointerButton;
}

export type UiPressEvent = UiButtonEvent<"press">;
export type UiReleaseEvent = UiButtonEvent<"release">;
export type UiClickEvent = UiButtonEvent<"click">;
export type UiDoubleClickEvent = UiButtonEvent<"doubleClick">;

export interface UiDragEvent extends UiButtonEvent<"drag"> {
    readonly dx: number;
    readonly dy: number;
}

export interface UiWheelEvent extends UiEventFields {
    readonly type: "wheel";
    readonly delta: number;
}

export type UiEvent =
    | UiPointerEnterEvent
    | UiPointerLeaveEvent
    | UiPressEvent
    | UiReleaseEvent
    | UiClickEvent
    | UiDoubleClickEvent
    | UiDragEvent
    | UiWheelEvent;

export type UiEventOfType<Type extends UiEventType> = Extract<UiEvent, {readonly type: Type}>;

const NO_EVENTS: readonly UiEvent[] = [];
const NO_DELTA = 0;

export class UiEventRecord {
    public type: UiEventType = "press";
    public target: Entity = NULL_ENTITY;
    public origin: Entity = NULL_ENTITY;
    public x = 0;
    public y = 0;
    public button: PointerButton = PointerButton.Left;
    public dx = NO_DELTA;
    public dy = NO_DELTA;
    public delta = NO_DELTA;
}

export class UiEvents extends Resource {
    private readonly _events: UiEventRecord[] = [];
    private readonly _records: UiEventRecord[] = [];
    private readonly _byType: Readonly<Record<UiEventType, UiEventRecord[]>> = {
        pointerEnter: [],
        pointerLeave: [],
        press: [],
        release: [],
        click: [],
        doubleClick: [],
        drag: [],
        wheel: [],
    };
    private readonly _typeLists: readonly UiEventRecord[][] = Object.values(this._byType);
    private _tree: UiTreeIndex | undefined;

    public get events(): readonly UiEvent[] {
        return this._events as readonly UiEventFields[] as readonly UiEvent[];
    }

    public beginFrame(tree: UiTreeIndex | undefined): void {
        this.clear();
        this._tree = tree;
    }

    public clear(): void {
        this._events.length = 0;
        for (const list of this._typeLists) list.length = 0;
    }

    public emit(type: UiEventType, target: Entity, origin: Entity, x: number, y: number): UiEventRecord {
        const index = this._events.length;
        let record = this._records[index];
        if (record === undefined) {
            record = new UiEventRecord();
            this._records.push(record);
        }
        record.type = type;
        record.target = target;
        record.origin = origin;
        record.x = x;
        record.y = y;
        record.button = PointerButton.Left;
        record.dx = NO_DELTA;
        record.dy = NO_DELTA;
        record.delta = NO_DELTA;
        this._events.push(record);
        this._byType[type].push(record);
        return record;
    }

    public of<Type extends UiEventType>(type: Type): readonly UiEventOfType<Type>[] {
        return this._byType[type] as readonly UiEventFields[] as readonly UiEventOfType<Type>[];
    }

    public clicked(entity: Entity, button: PointerButton = PointerButton.Left): boolean {
        const clicks = this._byType.click;
        for (let i = 0; i < clicks.length; i++) {
            if (clicks[i].target === entity && clicks[i].button === button) return true;
        }
        return false;
    }

    public within(entity: Entity): readonly UiEvent[] {
        let found: UiEvent[] | undefined;
        const events = this.events;
        const ancestor = this._tree?.indexOf(entity) ?? NOT_IN_TREE;
        for (let i = 0; i < events.length; i++) {
            if (this.targetsSubtree(events[i].target, entity, ancestor)) (found ??= []).push(events[i]);
        }
        return found ?? NO_EVENTS;
    }

    private targetsSubtree(target: Entity, entity: Entity, ancestor: number): boolean {
        if (target === entity) return true;
        const tree = this._tree;
        if (tree === undefined || ancestor === NOT_IN_TREE) return false;
        const node = tree.indexOf(target);
        return node > ancestor && node < tree.subtreeEnd[ancestor];
    }
}
