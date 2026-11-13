import {isInputEvent} from "../../engine/input/inputEvent";
import type {InputEvent} from "../../engine/input/inputEvent";
import {isCellFrame} from "../../backends/cells/cellFrame";
import type {CellFrame} from "../../backends/cells/cellFrame";
import {isPixelFrame} from "../../backends/pixels/pixelFrame";
import type {PixelFrame} from "../../backends/pixels/pixelFrame";

export type RenderBackend = "cells" | "pixels";

export const DEFAULT_RENDER_BACKEND: RenderBackend = "cells";

const RENDER_BACKENDS: readonly RenderBackend[] = ["cells", "pixels"];

function isRenderBackend(value: string | undefined): value is RenderBackend {
    return RENDER_BACKENDS.some(backend => backend === value);
}

export interface CellSurfaceSize {
    readonly kind: "cells";
    readonly columns: number;
    readonly rows: number;
}

export interface PixelSurfaceSize {
    readonly kind: "pixels";
    readonly widthPx: number;
    readonly heightPx: number;
}

export type SurfaceSize = CellSurfaceSize | PixelSurfaceSize;

export interface InitMessage {
    readonly type: "init";
    readonly surface: SurfaceSize;
    readonly requestedRasterWorkers?: number;
}

export interface ResizeMessage {
    readonly type: "resize";
    readonly surface: SurfaceSize;
}

export interface InputEventsMessage {
    readonly type: "inputEvents";
    readonly events: readonly InputEvent[];
}

export type PageToWorldMessage =
    | InitMessage
    | InputEventsMessage
    | ResizeMessage
    | {readonly type: "presented"}
    | {readonly type: "exit"};

export interface FrameMessage {
    readonly type: "frame";
    readonly frame: CellFrame;
}

export interface PixelFrameMessage {
    readonly type: "pixelFrame";
    readonly frame: PixelFrame;
}

export interface StatusMessage {
    readonly type: "status";
    readonly text: string;
}

export type WorldToPageMessage =
    | FrameMessage
    | PixelFrameMessage
    | StatusMessage
    | {readonly type: "quit"}
    | {readonly type: "error", readonly message: string};

const PAGE_TO_WORLD_TYPES: ReadonlySet<string> = new Set(["init", "inputEvents", "resize", "presented", "exit"]);
const WORLD_TO_PAGE_TYPES: ReadonlySet<string> = new Set(["frame", "pixelFrame", "status", "quit", "error"]);

function hasType(message: unknown, types: ReadonlySet<string>): boolean {
    return typeof message === "object" && message !== null && types.has((message as {type?: unknown}).type as string);
}

function isWholeCount(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isSurfaceSize(value: unknown): value is SurfaceSize {
    if (typeof value !== "object" || value === null) return false;
    const surface = value as {kind?: unknown, columns?: unknown, rows?: unknown, widthPx?: unknown, heightPx?: unknown};
    switch (surface.kind) {
        case "cells":
            return isWholeCount(surface.columns) && isWholeCount(surface.rows);
        case "pixels":
            return isWholeCount(surface.widthPx) && isWholeCount(surface.heightPx);
        default:
            return false;
    }
}

export function isPageToWorldMessage(message: unknown): message is PageToWorldMessage {
    if (!hasType(message, PAGE_TO_WORLD_TYPES)) return false;
    const fields = message as {type: string, events?: unknown, surface?: unknown};
    switch (fields.type) {
        case "inputEvents":
            return Array.isArray(fields.events) && fields.events.every(isInputEvent);
        case "init":
        case "resize":
            return isSurfaceSize(fields.surface);
        default:
            return true;
    }
}

export function isWorldToPageMessage(message: unknown): message is WorldToPageMessage {
    if (!hasType(message, WORLD_TO_PAGE_TYPES)) return false;
    const fields = message as {type: string, frame?: unknown, text?: unknown, message?: unknown};
    switch (fields.type) {
        case "frame":
            return isCellFrame(fields.frame);
        case "pixelFrame":
            return isPixelFrame(fields.frame);
        case "status":
            return typeof fields.text === "string";
        case "error":
            return typeof fields.message === "string";
        default:
            return true;
    }
}

export function requestedRasterWorkersFromQuery(search: string): number | undefined {
    return wholeNumberFromQuery(search, "threads", 0, Number.POSITIVE_INFINITY);
}

export function renderBackendFromQuery(search: string): RenderBackend {
    const value = new URLSearchParams(search).get("backend")?.trim();
    return isRenderBackend(value) ? value : DEFAULT_RENDER_BACKEND;
}

export interface FixedTerminalSize {
    readonly columns?: number;
    readonly rows?: number;
}

export const FIXED_TERMINAL_LIMITS = {minColumns: 10, minRows: 5, max: 1000} as const;

export function fixedTerminalSizeFromQuery(search: string): FixedTerminalSize {
    const columns = wholeNumberFromQuery(search, "cols", FIXED_TERMINAL_LIMITS.minColumns, FIXED_TERMINAL_LIMITS.max);
    const rows = wholeNumberFromQuery(search, "rows", FIXED_TERMINAL_LIMITS.minRows, FIXED_TERMINAL_LIMITS.max);
    return {
        ...(columns === undefined ? {} : {columns}),
        ...(rows === undefined ? {} : {rows}),
    };
}

export const PIXEL_SCALE_LIMITS = {min: 1, max: 16} as const;

export function pixelScaleFromQuery(search: string): number | undefined {
    return wholeNumberFromQuery(search, "scale", PIXEL_SCALE_LIMITS.min, PIXEL_SCALE_LIMITS.max);
}

export interface FixedFramebufferSize {
    readonly widthPx?: number;
    readonly heightPx?: number;
}

export const FIXED_FRAMEBUFFER_LIMITS = {minPx: 64, maxPx: 4096} as const;

export function fixedFramebufferSizeFromQuery(search: string): FixedFramebufferSize {
    const widthPx = wholeNumberFromQuery(search, "width", FIXED_FRAMEBUFFER_LIMITS.minPx, FIXED_FRAMEBUFFER_LIMITS.maxPx);
    const heightPx = wholeNumberFromQuery(search, "height", FIXED_FRAMEBUFFER_LIMITS.minPx, FIXED_FRAMEBUFFER_LIMITS.maxPx);
    return {
        ...(widthPx === undefined ? {} : {widthPx}),
        ...(heightPx === undefined ? {} : {heightPx}),
    };
}

function wholeNumberFromQuery(search: string, name: string, min: number, max: number): number | undefined {
    const value = new URLSearchParams(search).get(name);
    if (value === null || !/^\d+$/.test(value.trim())) return undefined;
    const number = Number.parseInt(value, 10);
    return number >= min && number <= max ? number : undefined;
}
