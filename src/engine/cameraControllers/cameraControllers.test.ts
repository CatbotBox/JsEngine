import {describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {World} from "../core";
import type {Entity} from "../core";
import {Input, inputMapOf, Key, NO_MODIFIERS, PointerButton} from "../input";
import type {InputActionDefinition, InputEvent} from "../input";
import {Quaternions} from "../math/quaternions";
import {Vec} from "../math/types/vec";
import {FieldOfView} from "../rendering/3d/fieldOfView";
import {LocalPosition} from "../translation/localPosition";
import {LocalRotation} from "../translation/localRotation";
import {PanCamera, PanCameraAction, PanCameraSystem} from "./2d";
import {FlyCamera, FlyCameraAction, FlyCameraSystem} from "./3d";

const POSITION_DIGITS = 5;
const QUARTER_TURN_RAD = Math.PI / 2;
const NO_ROLL_RAD = 0;
const PAN_STEP_X_UNITS = 2;
const PAN_STEP_Y_UNITS = 0.5;
const FLY_STEP_UNITS = 3;
const START_FOV_DEGREES = 60;
const WHEEL_TOWARD = -1;
const FAR_POINTER_UNITS = 1000;

const PAN_BINDINGS: Readonly<Record<string, InputActionDefinition>> = {
    [PanCameraAction.Up]: {keys: [Key.W]},
    [PanCameraAction.Down]: {keys: [Key.S]},
    [PanCameraAction.Left]: {keys: [Key.A]},
    [PanCameraAction.Right]: {keys: [Key.D]},
};

const FLY_BINDINGS: Readonly<Record<string, InputActionDefinition>> = {
    [FlyCameraAction.MoveForward]: {keys: [Key.W]},
    [FlyCameraAction.MoveBackward]: {keys: [Key.S]},
    [FlyCameraAction.MoveRight]: {keys: [Key.D]},
    [FlyCameraAction.MoveLeft]: {keys: [Key.A]},
    [FlyCameraAction.MoveDown]: {keys: [Key.Z]},
    [FlyCameraAction.MoveUp]: {keys: [Key.X]},
    [FlyCameraAction.ZoomIn]: {keys: [Key.Q]},
    [FlyCameraAction.ZoomOut]: {keys: [Key.E]},
    [FlyCameraAction.Look]: {buttons: [PointerButton.Left]},
};

function worldWith(bindings: Readonly<Record<string, InputActionDefinition>>): World {
    const world = new World({platform: new MemoryPlatform()});
    world.resources.insert(inputMapOf(bindings));
    return world;
}

function keyDown(key: Key): InputEvent {
    return {type: "keyDown", key, repeat: false, ...NO_MODIFIERS};
}

function stepWith(world: World, ...events: InputEvent[]): void {
    const input = world.resources.get(Input);
    for (const event of events) input.enqueue(event);
    world.step();
}

function positionOf(world: World, entity: Entity): number[] {
    return Vec.toArray(world.entityManager.getComponent<LocalPosition>(entity, LocalPosition)!.xyz);
}

function expectCloseTo(actual: readonly number[], expected: readonly number[]): void {
    expect(actual.length).toBe(expected.length);
    actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], POSITION_DIGITS));
}

function flyCamera(world: World): Entity {
    const fieldOfView = new FieldOfView();
    fieldOfView.degrees = START_FOV_DEGREES;
    const camera = new FlyCamera();
    camera.moveStepUnits = FLY_STEP_UNITS;
    return world.entityManager.createEntity("camera", [camera, new LocalPosition(), new LocalRotation(), fieldOfView]);
}

describe("PanCameraSystem", () => {
    test("steps every pan camera by its own step per key press", () => {
        const world = worldWith(PAN_BINDINGS);
        world.getOrCreateSystem(PanCameraSystem);
        const pan = new PanCamera();
        pan.stepXUnits = PAN_STEP_X_UNITS;
        pan.stepYUnits = PAN_STEP_Y_UNITS;
        const camera = world.entityManager.createEntity("camera", [pan, new LocalPosition()]);
        const other = world.entityManager.createEntity("other", [new LocalPosition()]);
        stepWith(world, keyDown(Key.D), keyDown(Key.D), keyDown(Key.W));
        expect(positionOf(world, camera)).toEqual([2 * PAN_STEP_X_UNITS, -PAN_STEP_Y_UNITS, 0]);
        stepWith(world, keyDown(Key.A), keyDown(Key.S));
        expect(positionOf(world, camera)).toEqual([PAN_STEP_X_UNITS, 0, 0]);
        expect(positionOf(world, other)).toEqual([0, 0, 0]);
    });
});

describe("FlyCameraSystem", () => {
    test("moves along the camera's facing and raises along world up", () => {
        const world = worldWith(FLY_BINDINGS);
        world.getOrCreateSystem(FlyCameraSystem);
        const camera = flyCamera(world);
        world.entityManager.getComponent<FlyCamera>(camera, FlyCamera)!.yawRad = QUARTER_TURN_RAD;
        stepWith(world, keyDown(Key.W), keyDown(Key.X));
        expectCloseTo(positionOf(world, camera), [FLY_STEP_UNITS, FLY_STEP_UNITS, 0]);
    });

    test("looks while the look action is held and stops pitch short of straight up", () => {
        const world = worldWith(FLY_BINDINGS);
        world.getOrCreateSystem(FlyCameraSystem);
        const camera = flyCamera(world);
        const fly = world.entityManager.getComponent<FlyCamera>(camera, FlyCamera)!;
        stepWith(world, {type: "pointerMove", x: FAR_POINTER_UNITS, y: FAR_POINTER_UNITS, ...NO_MODIFIERS});
        expect([fly.yawRad, fly.pitchRad]).toEqual([0, 0]);
        stepWith(world,
            {type: "pointerDown", button: PointerButton.Left, x: 0, y: 0, ...NO_MODIFIERS},
            {type: "pointerMove", x: 1, y: FAR_POINTER_UNITS, ...NO_MODIFIERS},
        );
        const pitchLimit = QUARTER_TURN_RAD - fly.pitchMarginRad;
        expect(fly.yawRad).toBeCloseTo(fly.lookRadPerUnit, POSITION_DIGITS);
        expect(fly.pitchRad).toBe(pitchLimit);
        const rotation = world.entityManager.getComponent<LocalRotation>(camera, LocalRotation)!;
        expectCloseTo(Vec.toArray(rotation.xyzw), Vec.toArray(Quaternions.eulerToQuat(Vec.alloc3(pitchLimit, fly.yawRad, NO_ROLL_RAD))));
    });

    test("zooms by its key step and clamps wheel zoom to its field of view range", () => {
        const world = worldWith(FLY_BINDINGS);
        world.getOrCreateSystem(FlyCameraSystem);
        const camera = flyCamera(world);
        const fly = world.entityManager.getComponent<FlyCamera>(camera, FlyCamera)!;
        const fieldOfView = world.entityManager.getComponent<FieldOfView>(camera, FieldOfView)!;
        stepWith(world, keyDown(Key.E));
        expect(fieldOfView.degrees).toBeCloseTo(START_FOV_DEGREES * fly.fovKeyStep, POSITION_DIGITS);
        stepWith(world, keyDown(Key.Q));
        expect(fieldOfView.degrees).toBeCloseTo(START_FOV_DEGREES, POSITION_DIGITS);
        stepWith(world, {type: "wheel", delta: FAR_POINTER_UNITS * WHEEL_TOWARD, x: 0, y: 0, ...NO_MODIFIERS});
        expect(fieldOfView.degrees).toBeCloseTo(fly.maxFovDegrees, POSITION_DIGITS);
        stepWith(world, {type: "wheel", delta: FAR_POINTER_UNITS, x: 0, y: 0, ...NO_MODIFIERS});
        expect(fieldOfView.degrees).toBeCloseTo(fly.minFovDegrees, POSITION_DIGITS);
    });
});
