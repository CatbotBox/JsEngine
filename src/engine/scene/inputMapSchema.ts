import {INPUT_MAP_RESOURCE_NAME, InputMap, InputMapAction, KeyChord} from "../input/inputMap";
import {Key} from "../input/key";
import {PointerButton} from "../input/pointerButton";
import {resourceSchema, structFields} from "./componentSchemaBuilder";
import type {EnumFieldType, EnumMember, EnumValue, FieldSchema, ResourceSchema, StructFieldType} from "./fieldSchema";

export const KEY_TYPE_NAME = "Key";
export const POINTER_BUTTON_TYPE_NAME = "PointerButton";
export const KEY_CHORD_TYPE_NAME = "KeyChord";
export const INPUT_MAP_ACTION_TYPE_NAME = "InputMapAction";

const KEY_CHORD_KEY: keyof KeyChord & string = "key";

const POINTER_BUTTON_MEMBERS: Readonly<Record<string, PointerButton>> = {
    Left: PointerButton.Left,
    Middle: PointerButton.Middle,
    Right: PointerButton.Right,
};

function enumFieldType<V extends EnumValue>(typeName: string, members: Readonly<Record<string, V>>): EnumFieldType {
    return {kind: "enum", typeName, members: Object.keys(members).map((name): EnumMember => ({name, value: members[name]}))};
}

export const KEY_FIELD_TYPE: EnumFieldType = enumFieldType(KEY_TYPE_NAME, Key);
export const POINTER_BUTTON_FIELD_TYPE: EnumFieldType = enumFieldType(POINTER_BUTTON_TYPE_NAME, POINTER_BUTTON_MEMBERS);

const KEY_CHORD_FIELDS: readonly FieldSchema[] = [
    {key: KEY_CHORD_KEY, ...KEY_FIELD_TYPE},
    ...structFields<KeyChord>().boolean("ctrl").boolean("alt").boolean("shift").boolean("meta").build(),
];

export const KEY_CHORD_FIELD_TYPE: StructFieldType = {
    kind: "struct",
    typeName: KEY_CHORD_TYPE_NAME,
    fields: KEY_CHORD_FIELDS,
    create: () => new KeyChord(),
};

export const INPUT_MAP_ACTION_FIELD_TYPE: StructFieldType = {
    kind: "struct",
    typeName: INPUT_MAP_ACTION_TYPE_NAME,
    fields: structFields<InputMapAction>()
        .string("name")
        .list("keys", KEY_FIELD_TYPE)
        .list("chords", KEY_CHORD_FIELD_TYPE)
        .list("buttons", POINTER_BUTTON_FIELD_TYPE)
        .build(),
    create: () => new InputMapAction(),
};

export const INPUT_MAP_SCHEMA: ResourceSchema<InputMap> = resourceSchema(InputMap, INPUT_MAP_RESOURCE_NAME).list("actions", INPUT_MAP_ACTION_FIELD_TYPE).build();
