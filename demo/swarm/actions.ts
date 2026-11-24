import type {World} from "@jsengine/engine/core";
import {resolveInputActions} from "@jsengine/engine/input";
import type {Input, InputAction, ResolvedInputActions} from "@jsengine/engine/input";

export const SwarmAction = {
    MoveUp: "moveUp",
    MoveDown: "moveDown",
    MoveLeft: "moveLeft",
    MoveRight: "moveRight",
    FireUp: "fireUp",
    FireDown: "fireDown",
    FireLeft: "fireLeft",
    FireRight: "fireRight",
    FireAtPointer: "fireAtPointer",
    Bomb: "bomb",
    Start: "start",
    Restart: "restart",
    Quit: "quit",
    ToggleHud: "toggleHud",
} as const;

export type SwarmActions = ResolvedInputActions<typeof SwarmAction>;

export function swarmActionsOf(world: World): SwarmActions {
    return resolveInputActions(world, SwarmAction);
}

export function axis(input: Input, positive: InputAction, negative: InputAction): number {
    return Number(input.actionHeld(positive)) - Number(input.actionHeld(negative));
}
