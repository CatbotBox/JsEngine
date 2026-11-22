import {ComponentType} from "../../core/componentType";
import type {Entity} from "../../core/entity";
import {persistentTrackComponent} from "../../core/trackedComponent";
import type {World} from "../../core/world";
import {untrackedComponentOf} from "../../scene/sceneHierarchy";
import type {TextColor} from "../textColor";
import {TextSprite} from "../textSprite";

export class HudLabel {
    private source: TextSprite | undefined;
    private label: TextSprite | undefined;
    private lines: string[] | undefined;
    private foreground: TextColor | undefined;

    public bindTo(world: World, entity: Entity): void {
        const source = untrackedComponentOf<TextSprite>(world, entity, ComponentType.of(TextSprite));
        if (source === this.source) return;
        this.source = source;
        this.label = source === undefined ? undefined : persistentTrackComponent(entity, source);
        if (this.foreground !== undefined) this.paint(this.foreground);
        if (this.lines !== undefined) this.show(this.lines);
    }

    public paint(foreground: TextColor): void {
        this.foreground = foreground;
        if (this.label !== undefined) this.label.foreground = foreground;
    }

    public show(lines: string[]): void {
        this.lines = lines;
        if (this.label !== undefined) this.label.image = lines;
    }
}
