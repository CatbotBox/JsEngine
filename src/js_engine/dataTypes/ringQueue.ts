export class RingQueue<T> {
    get headIndex(): number {
        return this._headIndex;
    }

    set headIndex(value: number) {
        this._headIndex = this.calculateIndex(value);
    }

    private readonly _queue: T[];
    private _headIndex: number = 0;
    private _count: number = 0;

    private calculateIndex(index: number) {
        return index >= this._queue.length ? index - this._queue.length : index;
    }

    private checkAndCalculateIndex(index: number) {
        if (index < 0 || index >= this._count)
            throw new Error("Index is out of bounds");
        else
            return this.calculateIndex(this.headIndex + index);
    }

    public get capacity(): number {
        return this._queue.length;
    }

    public set capacity(value: number) {
        const oldLength = this._queue.length;
        this._queue.length = value;
        this._queue.copyWithin(oldLength, 0, this.headIndex);
    }

    public get count(): number {
        return this._count;
    }

    public get isEmpty(): boolean {
        return this.count == 0;
    }

    public get isFull(): boolean {
        return this.count >= this.capacity;
    }


    constructor(public length: number) {
        this._queue = new Array(length);
    }


    public add(item: T): void {
        if (this.isFull) this.capacity = Math.max(this.capacity * 2, 2);
    }


    public addAndOverride(item: T): T | undefined {
        if (this.isFull) {
            const prev = this.getItemAt(this.headIndex);
            this._queue[this.headIndex] = item;
            this.headIndex++;
            return prev;
        }
        this._queue[this.calculateIndex(this.count)] = item
        this._count++
    }

    public peek(): T {
        if (this.isEmpty)
            throw new Error("Queue is empty");
        return this._queue[this.headIndex];
    }

    public tryPeek(): T | undefined {
        if (this.isEmpty) {
            return;
        }
        return this._queue[this.headIndex];
    }

    public dequeue(): T {
        const item = this.peek();
        this.headIndex++
        return item;
    }

    public tryDequeue(): T | undefined {
        const item = this.tryPeek();
        if (item) this.headIndex++
        return item;
    }


    public getItemAt(index: number) {
        return this._queue[this.calculateIndex(index)];
    }
}

