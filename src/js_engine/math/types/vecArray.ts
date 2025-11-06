import {Vec} from "./vec";

export class VecArraySelector<factor extends number, length extends number = number> {
    public constructor(private rawData: VecArray<factor, length>, factor: factor, private index: number) {
        if (index >= factor) throw new RangeError("Index must be lesser than Vector Size")
        if (factor < 0) throw new RangeError("Index must be a positive number");
    }

    public at(index: number): number {
        if (index >= this.rawData.length) throw new RangeError("Index is greater than the size of array");
        if (index < 0) throw new RangeError("Index is less than 0");

        return this.rawData.at(index)[this.index];
    }

    public copyTo(vec: Vec<length>) {
        for (let i = 0; i < this.rawData.length; i++) {
            vec[i] = this.rawData.at(i)[this.index];
        }
    }

    public copyFrom(vec: Vec<length>) {
        for (let i = 0; i < this.rawData.length; i++) {
            this.rawData.at(i)[this.index] = vec[i];
        }
    }

    * [Symbol.iterator](): Iterator<number> {
        for (let i = 0; i < this.rawData.length; i++) {
            yield this.at(i);
        }

    }
}

export class VecArray<factor extends number, length extends number = number> {
    private rawData: Float32Array

    public readonly length: length;

    public constructor(length: length, factor: factor)
    public constructor(array: ArrayLike<Vec<factor>>, factor: factor, startIndex?: number, endIndex?: number)

    public constructor(array: VecArray<factor>, factor: factor, startIndex?: number, endIndex?: number)

    public constructor(flexArg: VecArray<factor> | ArrayLike<Vec<factor>> | length, private factor: factor, startIndex: number = 0, endIndex?: number) {
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
        this.length = (endIndex - startIndex) as length;

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

    public select(index: number): VecArraySelector<factor, length> {
        return new VecArraySelector<factor, length>(this, this.factor, index)
    }

    public subarray(startIndex: number, endIndex: number): VecArray<factor> {
        return new VecArray<factor>(this, this.factor, startIndex, endIndex);
    }


    public set(array: Vec<factor>, offset?: number): void
    public set(array: ArrayLike<Vec<factor>>, offset?: number): void
    public set(array: VecArray<factor>, offset?: number): void
    public set(array: ArrayLike<Vec<factor>> | VecArray<factor> | Vec<factor>, offset: number = 0): void {
        if (array.length <= 0) return;
        const absoluteOffset = offset * this.factor;
        // vecArray
        if (VecArray.isVecArray(array)) {
            this.rawData.set(array.rawData, absoluteOffset);
            return;
        }
        //array of Vec or Vec
        const firstElement = array[0];
        if (Array.isArray(firstElement)) {
            // Array of Vec
            array = array as ArrayLike<Vec<factor>>;
            this.rawData.set(firstElement, absoluteOffset);
            for (let i = 1; i < array.length; i++) {
                this.rawData.set(array[i], absoluteOffset + (i * this.factor));
            }
            return;
        }
        //Vec
        array = array as Vec<factor>;
        this.rawData.set(array, absoluteOffset);

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

export type Vec2Array<length extends number = number> = VecArray<2, length>
export type Vec3Array<length extends number = number> = VecArray<3, length>
