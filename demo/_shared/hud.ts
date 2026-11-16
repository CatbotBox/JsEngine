import {ComponentType, persistentTrackComponent} from "../../src/engine/core";
import type {Entity, World} from "../../src/engine/core";
import {TextSprite} from "../../src/engine/rendering";
import {untrackedComponentOf} from "../../src/engine/scene";

const PLACEHOLDER = /\{(\w+)\}/g;

export type HudValues = Readonly<Record<string, string | number>>;

export function formatHudText(template: string, values: HudValues): string {
    return template.replace(PLACEHOLDER, (placeholder: string, name: string) =>
        Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder);
}

export function formatHudLines(lines: readonly string[], values: HudValues): string[] {
    return lines.map(line => formatHudText(line, values));
}

export class HudLabel {
    private source: TextSprite | undefined;
    private label: TextSprite | undefined;
    private lines: string[] | undefined;

    public bindTo(world: World, entity: Entity): void {
        const source = untrackedComponentOf<TextSprite>(world, entity, ComponentType.of(TextSprite));
        if (source === this.source) return;
        this.source = source;
        this.label = source === undefined ? undefined : persistentTrackComponent(entity, source);
        if (this.lines !== undefined) this.show(this.lines);
    }

    public show(lines: string[]): void {
        this.lines = lines;
        if (this.label !== undefined) this.label.image = lines;
    }
}
