import {Component, NULL_ENTITY} from "@jsengine/engine/core";
import type {Entity} from "@jsengine/engine/core";
import {WHITE_RGB} from "@jsengine/engine/rendering";
import type {Int, Rgb} from "@jsengine/engine/scene";

const SWARM_CATEGORY = "Swarm";
const NO_STEER_COS = 1;
const NO_STEER_SIN = 0;

export class Ship extends Component {
    public static readonly category = SWARM_CATEGORY;
}

export class Enemy extends Component {
    public static readonly category = SWARM_CATEGORY;

    public hitPoints: Int = 0;
    public radiusUnits = 0;
    public speedUnitsPerSecond = 0;
    public points: Int = 0;
    public woundedTint: Rgb = WHITE_RGB;
    public steerCos = NO_STEER_COS;
    public steerSin = NO_STEER_SIN;
}

export class Bullet extends Component {
    public static readonly category = SWARM_CATEGORY;

    public remainingDamage: Int = 0;
    public radiusUnits = 0;
}

export class Spark extends Component {
    public static readonly category = SWARM_CATEGORY;
}

export class SwarmHud extends Component {
    public static readonly category = SWARM_CATEGORY;

    public status: Entity = NULL_ENTITY;
    public stats: Entity = NULL_ENTITY;
    public banner: Entity = NULL_ENTITY;
}

export const SwarmSettingKind = {
    Number: "number",
    Toggle: "toggle",
} as const;

export type SwarmSettingKind = typeof SwarmSettingKind[keyof typeof SwarmSettingKind];

export const SwarmSettingAction = {
    Open: "open",
    Close: "close",
    Reset: "reset",
    Decrease: "decrease",
    Increase: "increase",
    Toggle: "toggle",
} as const;

export type SwarmSettingAction = typeof SwarmSettingAction[keyof typeof SwarmSettingAction];

export class SwarmSettingsMenu extends Component {
    public static readonly category = SWARM_CATEGORY;
}

export class SwarmSetting extends Component {
    public static readonly category = SWARM_CATEGORY;

    public field = "";
    public kind: SwarmSettingKind = SwarmSettingKind.Number;
    public step = 1;
    public min = 0;
    public max = 0;
    public decimals: Int = 0;
    public toggledOnValue: Int = 0;
}

export class SwarmSettingValue extends Component {
    public static readonly category = SWARM_CATEGORY;
}

export class SwarmSettingButton extends Component {
    public static readonly category = SWARM_CATEGORY;

    public action: SwarmSettingAction = SwarmSettingAction.Close;
}
