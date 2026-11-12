import type {Component} from "./component";

export type ComponentCtor<T extends Component> = new (...args: any[]) => T;

const OBJECT_BACKED_F32_WIDTH = 0;

export class ComponentType<C extends Component = Component> {
    private static _registry = new WeakMap<Function, ComponentType<any>>();
    private static _nextId = 1;
    // noinspection JSUnusedLocalSymbols
    private readonly __brand!: C;

    public readonly id: number;

    public readonly f32Width: number;

    private constructor(public readonly ctor: ComponentCtor<C>) {
        this.f32Width = (ctor as unknown as { f32Width?: number }).f32Width ?? OBJECT_BACKED_F32_WIDTH;
        this.id = ComponentType._nextId++;
    }

    static of<T extends Component>(ctor: ComponentCtor<T>): ComponentType<T> {
        let t = this._registry.get(ctor) as ComponentType<T> | undefined;
        if (!t) {
            t = new ComponentType<T>(ctor);
            this._registry.set(ctor, t);
        }
        return t;
    }
}

export interface F32Backed {
    writeF32(dst: Float32Array, offset: number): void;

    bindF32(src: Float32Array, offset: number): void;

    detachF32(): void;
}

export type ComponentOf<T extends ComponentType<any>> =
    T extends ComponentType<infer C> ? C : never;
