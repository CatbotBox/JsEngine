import {describe, expect, test} from "../../../testing/harness";
import {World} from "../../../core/world";
import {RootSystemGroup} from "../../../core/rootSystemGroup";
import {TranslationSystemGroup} from "../../../translation/translationSystemGroup";
import {LocalToWorldSystem} from "../../../translation/localToWorldSystem";
import {LocalToWorld} from "../../../translation/localToWorld";
import {LocalPosition} from "../../../translation/localPosition";
import {LocalRotation} from "../../../translation/localRotation";
import {LocalScale} from "../../../translation/localScale";
import {Quaternions} from "../../../math/quaternions";
import {Vec} from "../../../math/types/vec";
import {DirectionalLight} from "./directionalLight";
import {PointLight} from "./pointLight";
import {AmbientLight} from "./ambientLight";
import {LIGHT_KIND_DIRECTIONAL, LIGHT_KIND_POINT, SceneLights} from "./sceneLights";
import {SceneLightsGatherSystem} from "./sceneLightsGatherSystem";

function makeWorld() {
    const world = new World();
    world.getOrCreateSystem(TranslationSystemGroup);
    world.getOrCreateSystem(LocalToWorldSystem);
    world.getOrCreateSystem(SceneLightsGatherSystem);
    const root = world.getOrCreateSystem(RootSystemGroup);
    const tick = (n = 4) => {
        for (let i = 0; i < n; i++) root.update();
    };
    return {world, em: world.entityManager, tick, lights: () => world.resources.get(SceneLights)};
}

function rgbAt(array: Float32Array, index: number): number[] {
    return [array[index * 3], array[index * 3 + 1], array[index * 3 + 2]].map(v => Math.round(v * 1000) / 1000);
}

describe("Light components", () => {
    test("color is masked to 24 bits and intensity cannot go negative", () => {
        const light = new DirectionalLight(0x1FF8040, -3);
        expect(light.color).toBe(0xFF8040);
        expect(light.intensity).toBe(0);
    });

    test("writeScaledRgb unpacks the color to 0..1 scaled by intensity", () => {
        const out = new Float32Array(6);
        new PointLight(5, 0xFF8000, 0.5).writeScaledRgb(out, 3);
        expect(rgbAt(out, 1)).toEqual([0.5, 0.251, 0]);
        expect(rgbAt(out, 0)).toEqual([0, 0, 0]);
    });

    test("point light range cannot go negative and ambient defaults to a dim white", () => {
        expect(new PointLight(-1).range).toBe(0);
        const ambient = new AmbientLight();
        expect(ambient.color).toBe(0xFFFFFF);
        expect(ambient.intensity).toBeCloseTo(0.2, 6);
    });
});

describe("SceneLightsGatherSystem", () => {
    test("a world without lights gathers nothing and reports itself unlit", () => {
        const {tick, lights} = makeWorld();
        tick();
        expect(lights().count).toBe(0);
        expect(lights().hasAnyLight).toBe(false);
        expect(Array.from(lights().ambient)).toEqual([0, 0, 0]);
    });

    test("directional light direction is the entity's local +Z in world space, normalized despite scale", () => {
        const {em, tick, lights} = makeWorld();
        const e = em.createEntity("sun");
        em.addComponent(e, new LocalToWorld());
        em.addComponent(e, new LocalPosition(0, 0, 0));
        em.addComponent(e, new LocalScale(3, 3, 3));
        const quarterTurnAboutY = Quaternions.qFromAxisAngle(Vec.alloc3(0, 1, 0), Math.PI / 2);
        em.addComponent(e, new LocalRotation(Vec.x(quarterTurnAboutY), Vec.y(quarterTurnAboutY), Vec.z(quarterTurnAboutY), Vec.w(quarterTurnAboutY)));
        em.addComponent(e, new DirectionalLight(0x00FF00, 2));
        tick();

        const scene = lights();
        expect(scene.count).toBe(1);
        expect(scene.hasAnyLight).toBe(true);
        expect(scene.kind[0]).toBe(LIGHT_KIND_DIRECTIONAL);
        expect(rgbAt(scene.direction, 0)).toEqual([1, 0, 0]);
        expect(rgbAt(scene.color, 0)).toEqual([0, 2, 0]);
    });

    test("point light carries world position, scaled color and range", () => {
        const {em, tick, lights} = makeWorld();
        const e = em.createEntity("lamp");
        em.addComponent(e, new LocalToWorld());
        em.addComponent(e, new LocalPosition(1, 2, 3));
        em.addComponent(e, new PointLight(7, 0x0000FF, 0.5));
        tick();

        const scene = lights();
        expect(scene.count).toBe(1);
        expect(scene.kind[0]).toBe(LIGHT_KIND_POINT);
        expect(rgbAt(scene.position, 0)).toEqual([1, 2, 3]);
        expect(rgbAt(scene.color, 0)).toEqual([0, 0, 0.5]);
        expect(scene.range[0]).toBe(7);
    });

    test("ambient lights accumulate and count as lighting without occupying a slot", () => {
        const {em, tick, lights} = makeWorld();
        em.addComponent(em.createEntity("a"), new AmbientLight(0xFFFFFF, 0.25));
        em.addComponent(em.createEntity("b"), new AmbientLight(0xFF0000, 0.5));
        tick();

        const scene = lights();
        expect(scene.count).toBe(0);
        expect(scene.hasAnyLight).toBe(true);
        expect(rgbAt(scene.ambient, 0)).toEqual([0.75, 0.25, 0.25]);
    });

    test("the list is rebuilt every frame: removing a light shrinks it and arrays are reused", () => {
        const {em, tick, lights} = makeWorld();
        const sun = em.createEntity("sun");
        em.addComponent(sun, new LocalToWorld());
        em.addComponent(sun, new DirectionalLight());
        const lamp = em.createEntity("lamp");
        em.addComponent(lamp, new LocalToWorld());
        em.addComponent(lamp, new PointLight());
        tick();
        const scene = lights();
        expect(scene.count).toBe(2);
        const colorArray = scene.color;

        em.destroyEntity(sun);
        tick();
        expect(scene.count).toBe(1);
        expect(scene.kind[0]).toBe(LIGHT_KIND_POINT);
        expect(scene.color).toBe(colorArray);

        em.destroyEntity(lamp);
        tick();
        expect(scene.count).toBe(0);
        expect(scene.hasAnyLight).toBe(false);
    });

    test("more lights than the initial capacity grow the arrays and keep every entry", () => {
        const {em, tick, lights} = makeWorld();
        const total = 20;
        for (let i = 0; i < total; i++) {
            const e = em.createEntity("lamp" + i);
            em.addComponent(e, new LocalToWorld());
            em.addComponent(e, new LocalPosition(i, 0, 0));
            em.addComponent(e, new PointLight(i + 1));
        }
        tick();

        const scene = lights();
        expect(scene.count).toBe(total);
        expect(scene.capacity).toBeGreaterThan(total - 1);
        const xs = Array.from({length: total}, (_, i) => scene.position[i * 3]).sort((a, b) => a - b);
        expect(xs).toEqual(Array.from({length: total}, (_, i) => i));
        const ranges = Array.from(scene.range.subarray(0, total)).sort((a, b) => a - b);
        expect(ranges).toEqual(Array.from({length: total}, (_, i) => i + 1));
    });
});
