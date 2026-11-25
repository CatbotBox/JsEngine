import {ENGINE_COMPONENT_CATEGORIES} from "../scene/componentCategories";
import {componentSchema} from "../scene/componentSchemaBuilder";
import type {NumberFieldBuildOptions} from "../scene/componentSchemaBuilder";
import type {SchemaEntry} from "../scene/schemaEntries";
import {UI_ALIGNS, UI_BORDER_STYLES, UI_DIRECTIONS, UI_JUSTIFIES, UI_SCROLL_AXES, UI_SIZE_MODES, UI_TEXT_ALIGNS, UI_TEXT_OVERFLOWS, UI_TEXT_WRAPS} from "./layout/flexStyle";
import {UiBox} from "./uiBox";
import {UiInteractable} from "./uiInteractable";
import {UiLayout} from "./uiLayout";
import {UiOffset} from "./uiOffset";
import {UiRect} from "./uiRect";
import {UiRoot} from "./uiRoot";
import {UiScroll} from "./uiScroll";
import {UiSize} from "./uiSize";
import {UiState} from "./uiState";
import {UiText} from "./uiText";

const UNCAPPED_SIZE: NumberFieldBuildOptions = {uncapped: true};

export const UI_ROOT_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(UiRoot, "UiRoot").number("scale").integer("sortOrder").boolean("blocksGameInput").category(ENGINE_COMPONENT_CATEGORIES.ui).build(),
};

export const UI_LAYOUT_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(UiLayout, "UiLayout").enum("direction", UI_DIRECTIONS)
        .number("paddingLeft").number("paddingTop").number("paddingRight").number("paddingBottom").number("gap")
        .enum("justify", UI_JUSTIFIES).enum("align", UI_ALIGNS).boolean("clip").category(ENGINE_COMPONENT_CATEGORIES.ui).build(),
};

export const UI_SIZE_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(UiSize, "UiSize").enum("widthMode", UI_SIZE_MODES).enum("heightMode", UI_SIZE_MODES)
        .number("width").number("height").number("minWidth").number("maxWidth", UNCAPPED_SIZE).number("minHeight").number("maxHeight", UNCAPPED_SIZE)
        .category(ENGINE_COMPONENT_CATEGORIES.ui).build(),
};

export const UI_OFFSET_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(UiOffset, "UiOffset").number("x").number("y").number("anchorX").number("anchorY").category(ENGINE_COMPONENT_CATEGORIES.ui).build(),
};

export const UI_TEXT_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(UiText, "UiText").string("text").textColor("foreground").enum("wrap", UI_TEXT_WRAPS)
        .enum("overflow", UI_TEXT_OVERFLOWS).enum("alignX", UI_TEXT_ALIGNS).category(ENGINE_COMPONENT_CATEGORIES.ui).build(),
};

export const UI_SCROLL_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(UiScroll, "UiScroll").number("scrollX").number("scrollY").enum("axes", UI_SCROLL_AXES)
        .category(ENGINE_COMPONENT_CATEGORIES.ui).build(),
};

export const UI_RECT_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(UiRect, "UiRect").implied().category(ENGINE_COMPONENT_CATEGORIES.ui).build(),
};

export const UI_BOX_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(UiBox, "UiBox").textColor("background").textColor("hoveredBackground").textColor("pressedBackground")
        .textColor("disabledBackground").enum("border", UI_BORDER_STYLES).textColor("borderColor").textColor("hoveredBorderColor")
        .textColor("pressedBorderColor").textColor("disabledBorderColor").category(ENGINE_COMPONENT_CATEGORIES.ui).build(),
};

export const UI_INTERACTABLE_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(UiInteractable, "UiInteractable").boolean("click").boolean("press").boolean("wheel").boolean("drag")
        .boolean("disabled").category(ENGINE_COMPONENT_CATEGORIES.ui).build(),
};

export const UI_STATE_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(UiState, "UiState").implied().category(ENGINE_COMPONENT_CATEGORIES.ui).build(),
};
