import {Vec} from "./vec";

export class VecArray<factor extends number> {
    private rawData: Float32Array

    public readonly length: number;

    public constructor(length: number, factor: factor)
    public constructor(array: ArrayLike<Vec<factor>>, factor: factor, startIndex?: number, endIndex?: number)

    public constructor(array: VecArray<factor>, factor: factor, startIndex?: number, endIndex?: number)

    public constructor(flexArg: VecArray<factor> | ArrayLike<Vec<factor>> | number, private factor: factor, startIndex: number = 0, endIndex?: number) {
        if (typeof flexArg === "number") {
            this.length = flexArg;
            this.rawData = new Float32Array(this.length * factor);
            return;
        }
        // arraylike + maybe vecArray
        // if (flexArg.length % factor !== 0) throw new Error("Array cannot fit into vector array");


        endIndex = endIndex ?? flexArg.length;
        const absoluteStartIndex = startIndex * factor;
        const absoluteEndIndex = endIndex * factor;
        if (absoluteEndIndex > (flexArg.length * factor)) throw new Error("Out of bounds");
        this.length = (endIndex - startIndex);

        // Vec Array share view
        if (VecArray.isVecArray(flexArg)) {
            // view into other vecArray
            this.rawData = flexArg.rawData.subarray(absoluteStartIndex, absoluteEndIndex);
            return;
        }
        // arrayLike copy view
        const arrayLike = flexArg;
        this.rawData = new Float32Array(this.length * factor);
        for (let i = startIndex; i < endIndex; i++) {
            this.rawData.set(arrayLike[i], i * factor);
        }
    }

    public at(index: number): Vec<factor> {
        return this.rawData.subarray(index * this.factor, (index + 1) * this.factor) as Vec<factor>;
    }

    public subarray(startIndex: number, endIndex: number): VecArray<factor> {
        return new VecArray<factor>(this, this.factor, startIndex, endIndex);
    }


    public set(array: ArrayLike<Vec<factor>>, offset?: number): void
    public set(array: VecArray<factor>, offset?: number): void
    public set(array: ArrayLike<Vec<factor>> | VecArray<factor>, offset: number = 0): void {
        const absoluteOffset = offset * this.factor;
        // vecArray
        if (VecArray.isVecArray(array)) {
            this.rawData.set(array.rawData, absoluteOffset);
            return;
        }
        //array like
        for (let i = 0; i < array.length; i++) {
            this.rawData.set(array[i], absoluteOffset + (i * this.factor));
        }
    }

    * [Symbol.iterator](): Iterator<Vec<factor>> {
        for (let i = 0; i < this.length; i++) {
            yield this.at(i);
        }
    }

    public static isVecArray<factor extends number = any>(object: VecArray<factor> | ArrayLike<Vec<factor>>): object is VecArray<factor>
    public static isVecArray(object: unknown): object is VecArray<any>
    public static isVecArray<factor extends number = any>(object: VecArray<factor> | ArrayLike<Vec<factor>>, factor: factor): object is VecArray<factor>
    public static isVecArray<factor extends number = any>(object: unknown, factor: factor): object is VecArray<factor>
    public static isVecArray<factor extends number = any>(object: unknown, factor?: factor): object is VecArray<factor> {
        const test = object as VecArray<factor>;

        return test !== undefined
            && test.rawData !== undefined
            && test.factor !== undefined
            && (factor === undefined || test.factor !== factor);

    }
}

export type Vec3Array = VecArray<3>
