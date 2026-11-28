import {System} from "@jsengine/engine/core";
import {Input} from "@jsengine/engine/input";
import {pointerWorldPositionInto} from "@jsengine/engine/rendering";
import type {WorldPosition} from "@jsengine/engine/rendering";
import {Sprite} from "@jsengine/engine/rendering/2d";
import {LocalPosition} from "@jsengine/engine/translation";
import {PrefabSpawner} from "@jsengine/engine/scene";
import {Velocity} from "@jsengine/engine/motion";
import {axis, swarmActionsOf} from "./actions";
import type {SwarmActions} from "./actions";
import {Ship} from "./components";
import {SHIP_PRIORITY, WEAPON_PRIORITY} from "./frameOrder";
import {SwarmPhase, SwarmState} from "./resources";
import {
    commandBufferOf,
    HALF,
    HIDDEN_OPACITY,
    NO_EXTENT,
    requirePrefab,
    simulationStepMs,
    SwarmArena,
    VISIBLE_OPACITY,
} from "./simulation";
import {MS_PER_SECOND, SwarmConfig} from "./config";
import type {ShipConfig} from "./config";

const BLINK_PHASES = 2;

export class ShipSystem extends System {
    private _ship = this.createEntityQuery([Ship, LocalPosition, Sprite]);
    private _actions!: SwarmActions;

    override priority(): number {
        return SHIP_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(SwarmState);
        this.requireResourceForUpdate(SwarmConfig);
        this.requireResourceForUpdate(SwarmArena);
        this.requireAnyForUpdate(this._ship);
        this._actions = swarmActionsOf(this.world);
    }

    onUpdate(): void {
        const state = this.world.resources.get(SwarmState);
        const ship = this.world.resources.get(SwarmConfig).ship;
        if (state.phase === SwarmPhase.Playing) {
            const stepMs = simulationStepMs(this.world);
            state.invulnerableRemainingMs = Math.max(0, state.invulnerableRemainingMs - stepMs);
            this.steer(state, ship, this.world.resources.get(Input), stepMs);
        }
        const x = state.shipX, y = state.shipY, opacity = this.opacityOf(state, ship);
        this._ship.stream({write: {position: LocalPosition, sprite: Sprite}}).consume(({position, sprite}) => {
            position.x = x;
            position.y = y;
            sprite.opacity = opacity;
        });
    }

    private steer(state: SwarmState, ship: ShipConfig, input: Input, stepMs: number): void {
        const right = axis(input, this._actions.MoveRight, this._actions.MoveLeft);
        const down = axis(input, this._actions.MoveDown, this._actions.MoveUp);
        if (right !== 0 || down !== 0) {
            const distance = ship.speedUnitsPerSecond * stepMs / MS_PER_SECOND / Math.hypot(right, down);
            state.shipX += right * distance;
            state.shipY += down * distance;
        }
        const arena = this.world.resources.get(SwarmArena);
        const image = this._ship.tryGetSingleton({sprite: Sprite})?.sprite.image;
        const halfWidth = (image?.sizeX ?? NO_EXTENT) * HALF;
        const halfHeight = (image?.sizeY ?? NO_EXTENT) * HALF;
        const limitX = Math.max(0, arena.halfWidthUnits - halfWidth);
        const limitY = Math.max(0, arena.halfHeightUnits - halfHeight);
        state.shipX = Math.min(limitX, Math.max(-limitX, state.shipX));
        state.shipY = Math.min(limitY, Math.max(-limitY, state.shipY));
    }

    private opacityOf(state: SwarmState, ship: ShipConfig): number {
        if (state.phase !== SwarmPhase.Playing) return HIDDEN_OPACITY;
        if (state.invulnerableRemainingMs <= 0) return VISIBLE_OPACITY;
        return Math.floor(state.invulnerableRemainingMs / ship.blinkIntervalMs) % BLINK_PHASES === 0 ? VISIBLE_OPACITY : HIDDEN_OPACITY;
    }
}

export class ShipWeaponSystem extends System {
    private _actions!: SwarmActions;
    private _pointer: WorldPosition = {x: 0, y: 0};

    override priority(): number {
        return WEAPON_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(SwarmState);
        this.requireResourceForUpdate(SwarmConfig);
        this.requireResourceForUpdate(SwarmArena);
        this._actions = swarmActionsOf(this.world);
    }

    onUpdate(): void {
        const state = this.world.resources.get(SwarmState);
        if (state.phase !== SwarmPhase.Playing) return;
        const input = this.world.resources.get(Input);
        let right = axis(input, this._actions.FireRight, this._actions.FireLeft);
        let down = axis(input, this._actions.FireDown, this._actions.FireUp);
        if (input.actionHeld(this._actions.FireAtPointer)) {
            const pointer = pointerWorldPositionInto(this._pointer, this.world.resources.get(SwarmArena).view, input.pointerX, input.pointerY);
            right = pointer.x - state.shipX;
            down = pointer.y - state.shipY;
        }
        state.fireCooldownMs -= simulationStepMs(this.world);
        if (right === 0 && down === 0) {
            state.fireCooldownMs = Math.max(0, state.fireCooldownMs);
            return;
        }
        if (state.fireCooldownMs > 0) return;
        const weapon = this.world.resources.get(SwarmConfig).weapon;
        // Carry the overshoot into the next interval so the fire rate does not depend on frame timing.
        state.fireCooldownMs = Math.max(0, state.fireCooldownMs + MS_PER_SECOND / weapon.fireRateShotsPerSecond);

        const speed = weapon.bulletSpeedUnitsPerSecond / Math.hypot(right, down);
        const bullet = this.world.resources.get(PrefabSpawner).spawn(commandBufferOf(this.world), requirePrefab(weapon.bullet, "weapon.bullet"));
        const velocity = bullet.rootComponent(Velocity);
        velocity.xUnitsPerSecond = right * speed;
        velocity.yUnitsPerSecond = down * speed;
        const position = bullet.rootComponent(LocalPosition);
        position.x = state.shipX;
        position.y = state.shipY;
    }
}
