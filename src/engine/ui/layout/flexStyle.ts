export type UiDirection = "row" | "column";
export type UiJustify = "start" | "center" | "end" | "spaceBetween";
export type UiAlign = "start" | "center" | "end" | "stretch";
export type UiSizeMode = "fixed" | "fit" | "fill";
export type UiTextWrap = "none" | "word";
export type UiTextOverflow = "clip" | "ellipsis";
export type UiTextAlign = "start" | "center" | "end";
export type UiScrollAxes = "vertical" | "horizontal" | "both";
export type UiBorderStyle = "none" | "single" | "double" | "thick";

export const UI_BORDER_INSET_UNITS = 1;
const NO_BORDER_INSET_UNITS = 0;

export interface FlexContainerStyle {
    readonly direction: UiDirection;
    readonly paddingLeft: number;
    readonly paddingTop: number;
    readonly paddingRight: number;
    readonly paddingBottom: number;
    readonly gap: number;
    readonly justify: UiJustify;
    readonly align: UiAlign;
    readonly clip: boolean;
}

export interface FlexSizeStyle {
    readonly widthMode: UiSizeMode;
    readonly heightMode: UiSizeMode;
    readonly width: number;
    readonly height: number;
    readonly minWidth: number;
    readonly maxWidth: number;
    readonly minHeight: number;
    readonly maxHeight: number;
}

export interface FlexOffsetStyle {
    readonly x: number;
    readonly y: number;
    readonly anchorX: number;
    readonly anchorY: number;
}

export interface FlexTextContent {
    readonly text: string;
    readonly wrap: UiTextWrap;
}

export interface FlexBoxStyle {
    readonly border: UiBorderStyle;
}

export interface FlexScrollStyle {
    readonly scrollX: number;
    readonly scrollY: number;
    readonly axes: UiScrollAxes;
}

export const UI_DIRECTIONS: Readonly<Record<UiDirection, UiDirection>> = {row: "row", column: "column"};
export const UI_JUSTIFIES: Readonly<Record<UiJustify, UiJustify>> = {start: "start", center: "center", end: "end", spaceBetween: "spaceBetween"};
export const UI_ALIGNS: Readonly<Record<UiAlign, UiAlign>> = {start: "start", center: "center", end: "end", stretch: "stretch"};
export const UI_SIZE_MODES: Readonly<Record<UiSizeMode, UiSizeMode>> = {fixed: "fixed", fit: "fit", fill: "fill"};
export const UI_TEXT_WRAPS: Readonly<Record<UiTextWrap, UiTextWrap>> = {none: "none", word: "word"};
export const UI_TEXT_OVERFLOWS: Readonly<Record<UiTextOverflow, UiTextOverflow>> = {clip: "clip", ellipsis: "ellipsis"};
export const UI_TEXT_ALIGNS: Readonly<Record<UiTextAlign, UiTextAlign>> = {start: "start", center: "center", end: "end"};
export const UI_SCROLL_AXES: Readonly<Record<UiScrollAxes, UiScrollAxes>> = {vertical: "vertical", horizontal: "horizontal", both: "both"};
export const UI_BORDER_STYLES: Readonly<Record<UiBorderStyle, UiBorderStyle>> = {none: "none", single: "single", double: "double", thick: "thick"};

export function borderInsetOf(box: FlexBoxStyle | undefined): number {
    return box === undefined || box.border === "none" ? NO_BORDER_INSET_UNITS : UI_BORDER_INSET_UNITS;
}
