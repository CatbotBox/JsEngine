import {describe, expect, test} from "../../engine/testing/harness";
import type {Entity} from "../../engine/core";
import {eulerDegreesOfQuaternion, quaternionOfEulerDegrees} from "./fieldValueText";
import type {EulerDegrees} from "./fieldValueText";
import {RotationEulerCache} from "./rotationEulerCache";

const ENTITY = 3 as Entity;
const OTHER_ENTITY = 4 as Entity;
const TYPE_NAME = "LocalRotation";
const KEY = "xyzw";
const PAST_A_TURN: EulerDegrees = [370, 0, 0];
const ANGLE_DIGITS = 3;

describe("RotationEulerCache", () => {
    test("without a typed rotation the degrees come from the quaternion", () => {
        const cache = new RotationEulerCache();
        const quaternion = quaternionOfEulerDegrees(PAST_A_TURN);
        expect(cache.degreesFor(ENTITY, TYPE_NAME, KEY, quaternion)).toEqual(eulerDegreesOfQuaternion(quaternion));
        expect(eulerDegreesOfQuaternion(quaternion)[0]).toBeCloseTo(10, ANGLE_DIGITS);
    });

    test("the typed degrees are shown while the stored quaternion is the one they produced, so they do not drift", () => {
        const cache = new RotationEulerCache();
        const stored = quaternionOfEulerDegrees(PAST_A_TURN);
        cache.remember(ENTITY, TYPE_NAME, KEY, stored, PAST_A_TURN);
        expect(cache.degreesFor(ENTITY, TYPE_NAME, KEY, JSON.parse(JSON.stringify(stored)))).toEqual(PAST_A_TURN);
    });

    test("a different quaternion, field or entity falls back to converting the quaternion", () => {
        const cache = new RotationEulerCache();
        cache.remember(ENTITY, TYPE_NAME, KEY, quaternionOfEulerDegrees(PAST_A_TURN), PAST_A_TURN);
        const moved = quaternionOfEulerDegrees([0, 45, 0]);
        expect(cache.degreesFor(ENTITY, TYPE_NAME, KEY, moved)).toEqual(eulerDegreesOfQuaternion(moved));
        const same = quaternionOfEulerDegrees(PAST_A_TURN);
        expect(cache.degreesFor(OTHER_ENTITY, TYPE_NAME, KEY, same)).toEqual(eulerDegreesOfQuaternion(same));
        expect(cache.degreesFor(ENTITY, "OtherRotation", KEY, same)).toEqual(eulerDegreesOfQuaternion(same));
    });

    test("retaining live entities forgets the typed degrees of the others", () => {
        const cache = new RotationEulerCache();
        cache.remember(ENTITY, TYPE_NAME, KEY, quaternionOfEulerDegrees(PAST_A_TURN), PAST_A_TURN);
        cache.remember(OTHER_ENTITY, TYPE_NAME, KEY, quaternionOfEulerDegrees(PAST_A_TURN), PAST_A_TURN);
        cache.retainEntities(new Set([OTHER_ENTITY]));
        expect(cache.size).toBe(1);
        expect(cache.degreesFor(OTHER_ENTITY, TYPE_NAME, KEY, quaternionOfEulerDegrees(PAST_A_TURN))).toEqual(PAST_A_TURN);
    });
});
