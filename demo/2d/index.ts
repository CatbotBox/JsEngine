import {Vec} from "../../src/js_engine/math/types/vec";
import {
    Component,
    Entity,
    EntityCommandBufferSystem,
    System,
    DebugWorld
} from "../../src/js_engine";
import {consoleInput, Key} from "../../src/js_engine/input";

import {Camera, HudElement, RenderBounds, RenderingSystemGroup} from "../../src/js_engine/rendering";
import {ConsoleImageAnchor} from "../../src/js_engine/rendering/console";

import {LocalPosition, LocalToWorld, Parent} from "../../src/js_engine/translation";

import {
    Ansi,
    ConsoleHudRenderPassSystem,
} from "../../src/js_engine/rendering/console";

import {
    Console2DRenderSettings,
    ConsoleSprite,
    ConsoleSpriteHudRenderPassSystem,
    ConsoleSpriteRenderPassSystem,
    SpriteImage,
} from "../../src/js_engine/rendering/console/2d";
import {AverageStat} from "../../src/js_engine/datatypes";
import {consoleOverride} from "../../src/js_engine/debugging";
import {fileLogger} from "../../src/js_engine/debugging/fileLogger";
import {createHudLabel} from "../_shared/hud";

// The renderer owns the terminal, so console output is only readable in ./logs.
consoleOverride.addConsoleEventListener(fileLogger);

const world = new DebugWorld();

const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer()


const cameraEntity = buffer.createEntity("cameraEntity");

buffer.addComponent(cameraEntity, new Camera());
buffer.addComponent(cameraEntity, new LocalToWorld());
const cameraPosition = buffer.addTrackedComponent(cameraEntity, new LocalPosition());
buffer.addComponent(cameraEntity, new RenderBounds());

// The sprite pass only runs while a singleton Console2DRenderSettings exists;
// keep a tracked handle so keybinds can retune it live.
const settingsEntity = buffer.createEntity("2dRenderSettings");
const renderSettings = buffer.addTrackedComponent(settingsEntity, new Console2DRenderSettings());

function packRgb(r: number, g: number, b: number): number {
    return (r << 16) | (g << 8) | b;
}

// Immutable shared pixel data: every cross references CROSS_IMAGE and every
// pixel references PIXEL_IMAGE — one buffer each no matter how many entities —
// and gets its own color through the component's tint.
const CROSS_IMAGE = SpriteImage.fromPattern([
    ' # ',
    '###',
    ' # ',
], {'#': 0xFFFFFF});
const PIXEL_IMAGE = SpriteImage.solid(1, 1, 0xFFFFFF);

// Plus-shaped pixel sprite; sprite pixels are half a cell tall, so 3x3 pixels
// cover 3 cells x 1.5 cells on screen.
function createCross(position: LocalPosition, parent?: Entity, name?: string, ...additionalComponents: Component[]): [Entity, LocalPosition, Readonly<LocalToWorld>] {
    const objectEntity = buffer.createEntity(name);
    const r = Math.round(Math.random() * 255)
    const g = Math.round(Math.random() * 255)
    const b = Math.round(Math.random() * 255)
    buffer.addComponent(objectEntity, new ConsoleSprite(CROSS_IMAGE, packRgb(r, g, b)));
    const localToWorld = buffer.addComponent(objectEntity, new LocalToWorld());
    if (parent) {
        buffer.addComponent(objectEntity, new Parent(parent));
    }
    for (const additionalComponent of additionalComponents) {
        buffer.addComponent(objectEntity, additionalComponent);
    }
    const position2 = buffer.addTrackedComponent(objectEntity, position);
    return [objectEntity, position2, localToWorld];
}

class FadeToColor extends Component {
    public color: [number, number, number] = [255, 255, 255];
    public fadeTime: number = 0;
    public currentFadeTime: number = 0;
}

class OriginalColor extends Component {
    public color: [number, number, number] = [255, 255, 255];
}

function createPixel(position: LocalPosition, parent?: Entity, name?: string, ...additionalComponents: Component[]): [Entity, LocalPosition, Readonly<LocalToWorld>] {
    const objectEntity = buffer.createEntity(name);
    const r = Math.round(Math.random() * 255)
    const g = Math.round(Math.random() * 255)
    const b = Math.round(Math.random() * 255)
    const originalColor = new OriginalColor()
    originalColor.color = [r, g, b];
    buffer.addComponent(objectEntity, originalColor)
    // A shared white pixel colored through its tint: fading it is a tint
    // write, no pixel-data rebuild (the ANSI pipeline had to re-split an
    // escape string per entity per frame here).
    buffer.addComponent(objectEntity, new ConsoleSprite(PIXEL_IMAGE, packRgb(r, g, b)));
    const localToWorld = buffer.addComponent(objectEntity, new LocalToWorld());
    if (parent) {
        buffer.addComponent(objectEntity, new Parent(parent));
    }
    for (const additionalComponent of additionalComponents) {
        buffer.addComponent(objectEntity, additionalComponent);
    }
    return [objectEntity, buffer.addTrackedComponent(objectEntity, position), localToWorld];
}


class PlayerTag extends Component {

}

// as this entity updates at a different frequency compared to the others in the same archetype, add a component to force it to be in a different archetype
// causing only this specific entity to be updated instead of other cross entities
const [entity, position, localToWorld] = createCross(new LocalPosition(), cameraEntity, "cross1", new PlayerTag())
createCross(new LocalPosition(-5, -5), entity, "cross2")
createCross(new LocalPosition(-5, +5), entity, "cross3")
createCross(new LocalPosition(+5, -5), entity, "cross4")
createCross(new LocalPosition(+5, +5), entity, "cross5")

const entityCounterImage = createHudLabel(buffer, "entityCounter", Ansi.colors.fg.green + 'HUD element', 'bottom-left');
const fpsCounterImage = createHudLabel(buffer, "fpsCounter", Ansi.colors.fg.green + 'FPS: 0', 'top-right');

// A pixel HUD widget: the shared cross image, teal-tinted, anchored bottom-right
// and drawn through ConsoleSpriteHudRenderPassSystem in screen space.
{
    const hudSpriteEntity = buffer.createEntity("hudCross");
    buffer.addComponent(hudSpriteEntity, new ConsoleSprite(CROSS_IMAGE, 0x00FFCC));
    buffer.addComponent(hudSpriteEntity, new HudElement());
    const hudAnchor = new ConsoleImageAnchor();
    hudAnchor.anchorPosition = 'bottom-right';
    buffer.addComponent(hudSpriteEntity, hudAnchor);
}

consoleInput.enable()
// Half-block cells double the vertical resolution, so the player moves in
// half-cell steps and lands on either half of a cell.
consoleInput.whenKey(Key.Up, () => {
    position.y -= 0.5;
})
consoleInput.whenKey(Key.Down, () => {
    position.y += 0.5;
})
consoleInput.whenKey(Key.Left, () => {
    position.x -= 1;
})
consoleInput.whenKey(Key.Right, () => {
    position.x += 1;
})

consoleInput.whenKey(Key.W, () => {
    cameraPosition.y -= 1;
})
consoleInput.whenKey(Key.S, () => {
    cameraPosition.y += 1;
})
consoleInput.whenKey(Key.A, () => {
    cameraPosition.x -= 1;
})
consoleInput.whenKey(Key.D, () => {
    cameraPosition.x += 1;
})


consoleInput.whenKey(Key.Space, () => {
    for (let i = 0; i < 1_000; i++) {
        const x = (Math.random() - 0.5) * 100
        const y = (Math.random() - 0.5) * 100
        const newPos = new LocalPosition();
        newPos.x = x + Vec.x(localToWorld.position)
        newPos.y = y + Vec.y(localToWorld.position)
        // Distinct depth per pixel. Left at 0, every pixel shares a depth, and
        // the rasterizer's depth test breaks ties by blit order -- which is index
        // batch order, which changes the moment an entity changes archetype. A fade
        // completing removes two components, so the winner of a shared cell flips and
        // the pink pixel appears to hop one tile. Pixels spawn into a 100x100 area, so
        // at 100k+ entities roughly a dozen are stacked on every terminal cell and this
        // happens constantly. Must stay inside the pass's [-1000, 1000] camera z range.
        newPos.z = Math.random()
        const fadeToColor = new FadeToColor();
        fadeToColor.color = [255, 183, 206]
        fadeToColor.fadeTime = Math.random() * 5000 + 5000;
        createPixel(newPos, undefined, undefined, fadeToColor);
    }
})
consoleInput.whenKey(Key.Enter, () => {
    const renderer = world.tryGetSystem(RenderingSystemGroup);
    if (!renderer) return;
    renderer.enabled = !renderer.enabled;
})
consoleInput.whenKey(Key.Backspace, () => {
    const renderer = world.tryGetSystem(ConsoleSpriteRenderPassSystem);
    if (!renderer) return;
    renderer.enabled = !renderer.enabled;
})
consoleInput.whenKey(Key.H, () => {
    // Live retune: drop to whole-cell resolution (pixel rows averaged) and back.
    renderSettings.halfBlockCells = !renderSettings.halfBlockCells;
})
consoleInput.whenKey(Key.G, () => {
    world.logSystemUpdateOrder();
})

consoleInput.onKeyMatch({name: 'c', ctrl: true}, () => {
    world.stop()
    process.exit(0);
})




/** Reused by FadeSystem.interpolate; never escapes the caller that reads it. */
const FADE_SCRATCH: [number, number, number] = [0, 0, 0];

class FadeSystem extends System {

    private _query = this.createEntityQuery([OriginalColor, FadeToColor, ConsoleSprite])

    protected onCreate() {
        this.requireAllForUpdate(this._query);
    }

    public count() {
        return this._query.entityCount()
    }

    /**
     * Writes into a module-scope scratch tuple rather than returning a fresh array: this runs
     * per fading entity per frame inside a consume(), and the demo spawns 1,000 at a time.
     */
    private interpolate(color1: readonly [number, number, number], color2: readonly [number, number, number], scale: number): [number, number, number] {
        const out = FADE_SCRATCH;
        if (scale >= 1) {
            out[0] = color2[0];
            out[1] = color2[1];
            out[2] = color2[2];
            return out;
        }
        if (scale <= 0) {
            out[0] = color1[0];
            out[1] = color1[1];
            out[2] = color1[2];
            return out;
        }
        out[0] = Math.round(color1[0] + (color2[0] - color1[0]) * scale);
        out[1] = Math.round(color1[1] + (color2[1] - color1[1]) * scale);
        out[2] = Math.round(color1[2] + (color2[2] - color1[2]) * scale);
        return out;

    }

    onUpdate(): void {
        const deltaTime = this.world.time.deltaTime;
        this._query.stream({
            // All three are written: the fade advances its own timer, retints the
            // sprite, and on completion snaps originalColor to the target colour.
            write: {originalColor: OriginalColor, fadeToColor: FadeToColor, sprite: ConsoleSprite},
        }, {
            includeEntity: true
        }).consume(({entity, sprite, fadeToColor, originalColor}) => {
            fadeToColor.currentFadeTime += deltaTime;

            const scale = fadeToColor.currentFadeTime / fadeToColor.fadeTime;
            const finalColor = this.interpolate(originalColor.color, fadeToColor.color, scale)
            // The pixel data stays white; the fade only moves the tint.
            sprite.tint = packRgb(finalColor[0], finalColor[1], finalColor[2]);
            if (fadeToColor.currentFadeTime >= fadeToColor.fadeTime) {
                originalColor.color = fadeToColor.color;
                // fade is done: stop touching this entity's ConsoleSprite every frame and move it
                // out of the shared "fading pixel" archetype so it no longer contributes to the
                // per-archetype change-tracking cascade (bounds recompute + octree rebatch) that
                // every other still-fading pixel triggers each frame.
                buffer.removeComponent(entity, FadeToColor);
                buffer.removeComponent(entity, OriginalColor);
            }
        })
    }
}

class DebugSystem extends System {
    private _query = this.createEntityQuery([LocalToWorld])
    private _hudQuery = this.createEntityQuery([HudElement])
    private _toggle = true;
    private _fpsCounter = new AverageStat(10)

    protected onCreate() {
        // this.requireAnyForUpdate(this._query);
        // this.enabled = false;
        consoleInput.whenKeyDown(Key.Tab, () => {
            this._toggle = !this._toggle;
            buffer.setEnabledStateForQuery(this._hudQuery, this._toggle);
        })
    }

    onUpdate() {
        if (!this._toggle) return;
        this._query.entityCount();
        this._fpsCounter.add(1000 / this.world.time.deltaTime)
        fpsCounterImage.image = [
            Ansi.colors.fg.green + 'FPS: ' + this._fpsCounter.getAvg().toFixed(2),
        ]
        const fadeSystem = this.world.tryGetSystem(FadeSystem);
        if (fadeSystem) {
            const fadeSystemCount = fadeSystem.count();
            entityCounterImage.image = [
                Ansi.colors.fg.green + 'Entities: ' +
                // (this.world.entityCount),
                fadeSystemCount.toFixed(2),
            ]
        } else {
            entityCounterImage.image = [
                Ansi.colors.fg.green + 'Fade System Not Active'
            ]
        }



    }


}


world.ensureSystemExists(ConsoleSpriteRenderPassSystem);
world.ensureSystemExists(ConsoleSpriteHudRenderPassSystem);
world.ensureSystemExists(ConsoleHudRenderPassSystem);


world.ensureSystemExists(DebugSystem)

world.ensureSystemExists(FadeSystem);

world.startLoop()
