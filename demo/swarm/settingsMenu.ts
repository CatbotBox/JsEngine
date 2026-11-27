import {System} from "@jsengine/engine/core";
import type {Entity, EntityCommandBuffer} from "@jsengine/engine/core";
import {Input, PointerButton} from "@jsengine/engine/input";
import {DataAssets, dataAssetPathOf, PrefabSpawner} from "@jsengine/engine/scene";
import {Children, Parent} from "@jsengine/engine/translation";
import {UiEvents, UiText} from "@jsengine/engine/ui";
import type {UiClickEvent} from "@jsengine/engine/ui";
import {swarmActionsOf} from "./actions";
import type {SwarmActions} from "./actions";
import {SwarmSetting, SwarmSettingAction, SwarmSettingButton, SwarmSettingKind, SwarmSettingsMenu, SwarmSettingValue} from "./components";
import {SETTINGS_MENU_PRIORITY} from "./frameOrder";
import {SwarmPhase, SwarmState} from "./resources";
import {commandBufferOf, requirePrefab} from "./simulation";
import {SWARM_CONFIG_FILE, SwarmConfig} from "./config";
import {readSetting, steppedSetting, writeSetting} from "./settingPath";
import type {SettingValue} from "./settingPath";

const CONFIG_NAME = "SwarmConfig";
const SETTINGS_PREFAB_FIELD = "menu.settingsPrefab";
const TOGGLED_ON_TEXT = "ON";
const TOGGLED_OFF_TEXT = "OFF";
const UNSET_TEXT = "-";
const NO_CLICKS: readonly UiClickEvent[] = [];
const NO_CHILDREN: readonly Entity[] = [];

function formatSetting(setting: Readonly<SwarmSetting>, value: SettingValue): string {
    if (setting.kind === SwarmSettingKind.Toggle) return value === undefined ? TOGGLED_OFF_TEXT : TOGGLED_ON_TEXT;
    return value === undefined ? UNSET_TEXT : value.toFixed(setting.decimals);
}

function changedSetting(setting: Readonly<SwarmSetting>, action: SwarmSettingAction, value: SettingValue): SettingValue {
    const current = value ?? setting.min;
    switch (action) {
        case SwarmSettingAction.Decrease:
            return steppedSetting(current, -setting.step, setting.min, setting.max, setting.decimals);
        case SwarmSettingAction.Increase:
            return steppedSetting(current, setting.step, setting.min, setting.max, setting.decimals);
        case SwarmSettingAction.Toggle:
            return value === undefined ? setting.toggledOnValue : undefined;
        default:
            return value;
    }
}

export class SwarmSettingsMenuSystem extends System {
    private _menus = this.createEntityQuery([SwarmSettingsMenu]);
    private _values = this.createEntityQuery([SwarmSettingValue, UiText]);
    private _actions!: SwarmActions;
    private readonly _shownValues = new Map<Entity, SettingValue>();

    override priority(): number {
        return SETTINGS_MENU_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(SwarmState);
        this.requireResourceForUpdate(SwarmConfig);
        this._actions = swarmActionsOf(this.world);
    }

    onUpdate(): void {
        const input = this.world.resources.get(Input);
        if (!this._menus.hasEntity()) {
            if (this.opensMenu(input)) this.openMenu();
            return;
        }
        if (input.actionPressed(this._actions.OpenSettings) || input.actionPressed(this._actions.CloseSettings) || this.applyClicks()) {
            this.closeMenu();
            return;
        }
        this.refreshValues();
    }

    private opensMenu(input: Input): boolean {
        if (this.world.resources.get(SwarmState).phase !== SwarmPhase.Title) return false;
        return input.actionPressed(this._actions.OpenSettings) || this.clicked(SwarmSettingAction.Open);
    }

    private openMenu(): void {
        const prefab = requirePrefab(this.world.resources.get(SwarmConfig).menu.settingsPrefab, SETTINGS_PREFAB_FIELD);
        const spawner = this.world.resources.get(PrefabSpawner);
        if (spawner.templateOf(prefab).rootComponentDefaults(SwarmSettingsMenu) === undefined) {
            throw new Error(`Prefab "${prefab.sourcePath}" (SwarmConfig.${SETTINGS_PREFAB_FIELD}) needs a SwarmSettingsMenu on its root entity`);
        }
        spawner.spawn(commandBufferOf(this.world), prefab);
    }

    private closeMenu(): void {
        const buffer = commandBufferOf(this.world);
        this._menus.stream({read: {menu: SwarmSettingsMenu}}, {includeEntity: true}).consume(({entity}) => this.destroyHierarchy(buffer, entity));
        this._shownValues.clear();
    }

    private destroyHierarchy(buffer: EntityCommandBuffer, entity: Entity): void {
        const children = this.world.entityManager.getComponent<Children>(entity, Children)?.children ?? NO_CHILDREN;
        for (const child of children) this.destroyHierarchy(buffer, child);
        buffer.destroyEntity(entity);
    }

    private clicked(action: SwarmSettingAction): boolean {
        const clicks = this.clicks();
        for (let i = 0; i < clicks.length; i++) {
            if (this.buttonActionOf(clicks[i]) === action) return true;
        }
        return false;
    }

    private applyClicks(): boolean {
        const clicks = this.clicks();
        for (let i = 0; i < clicks.length; i++) {
            const action = this.buttonActionOf(clicks[i]);
            if (action === SwarmSettingAction.Close) return true;
            if (action === SwarmSettingAction.Reset) this.resetConfig();
            else if (action !== undefined && action !== SwarmSettingAction.Open) this.changeSetting(clicks[i].target, action);
        }
        return false;
    }

    private clicks(): readonly UiClickEvent[] {
        return this.world.resources.tryGet(UiEvents)?.of("click") ?? NO_CLICKS;
    }

    private buttonActionOf(click: UiClickEvent): SwarmSettingAction | undefined {
        if (click.button !== PointerButton.Left) return undefined;
        return this.world.entityManager.getComponent<SwarmSettingButton>(click.target, SwarmSettingButton)?.action;
    }

    private resetConfig(): void {
        const path = dataAssetPathOf(this.world.resources.get(SwarmConfig));
        if (path === undefined || this.world.resources.get(DataAssets).reload(path) === undefined) {
            throw new Error(`SwarmConfig has no asset values to reset to: load it from ${SWARM_CONFIG_FILE} through "resources" in jsengine.project.json`);
        }
    }

    private changeSetting(button: Entity, action: SwarmSettingAction): void {
        const setting = this.requireSettingOf(button);
        const config = this.world.resources.get(SwarmConfig);
        writeSetting(config, setting.field, CONFIG_NAME, changedSetting(setting, action, readSetting(config, setting.field, CONFIG_NAME)));
    }

    private refreshValues(): void {
        const config = this.world.resources.get(SwarmConfig);
        this._values.stream({read: {value: SwarmSettingValue}}, {includeEntity: true}).consume(({entity}) => {
            const setting = this.requireSettingOf(entity);
            const value = readSetting(config, setting.field, CONFIG_NAME);
            if (this._shownValues.has(entity) && this._shownValues.get(entity) === value) return;
            this._shownValues.set(entity, value);
            this.world.entityManager.getComponent<UiText>(entity, UiText)!.text = formatSetting(setting, value);
        });
    }

    private requireSettingOf(entity: Entity): SwarmSetting {
        const entityManager = this.world.entityManager;
        for (let node: Entity | undefined = entity; node !== undefined; node = entityManager.getComponent<Parent>(node, Parent)?.entity) {
            const setting = entityManager.getComponent<SwarmSetting>(node, SwarmSetting);
            if (setting !== undefined) return setting;
        }
        throw new Error(`"${entityManager.nameOf(entity) ?? entity}" in the settings menu sits in no SwarmSetting row`);
    }
}
