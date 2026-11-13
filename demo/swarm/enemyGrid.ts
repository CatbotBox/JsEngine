import {Resource} from "../../src/engine/core";
import type {Entity} from "../../src/engine/core";
import type {Sprite} from "../../src/engine/rendering/2d";
import type {Enemy} from "./components";

const INITIAL_ENEMY_CAPACITY = 1024;
const INITIAL_CELL_CAPACITY = 1024;
const CAPACITY_GROWTH_FACTOR = 2;
const PREFIX_SLOT = 1;
const MIN_CELLS_PER_AXIS = 1;
const UNSET_CELL_SIZE = 1;

function grownCapacity(current: number, required: number): number {
    let capacity = current;
    while (capacity < required) capacity *= CAPACITY_GROWTH_FACTOR;
    return capacity;
}

export class EnemyGrid extends Resource {
    public count = 0;
    public x = new Float32Array(INITIAL_ENEMY_CAPACITY);
    public y = new Float32Array(INITIAL_ENEMY_CAPACITY);
    public entities = new Uint32Array(INITIAL_ENEMY_CAPACITY);
    public readonly enemies: Enemy[] = [];
    public readonly sprites: Sprite[] = [];
    public candidates = new Int32Array(INITIAL_ENEMY_CAPACITY);

    private cellOfEnemy = new Int32Array(INITIAL_ENEMY_CAPACITY);
    private enemiesByCell = new Int32Array(INITIAL_ENEMY_CAPACITY);
    private cellStart = new Int32Array(INITIAL_CELL_CAPACITY + PREFIX_SLOT);
    private cellCursor = new Int32Array(INITIAL_CELL_CAPACITY);
    private columns = MIN_CELLS_PER_AXIS;
    private rows = MIN_CELLS_PER_AXIS;
    private originX = 0;
    private originY = 0;
    private cellSize = UNSET_CELL_SIZE;

    public begin(originX: number, originY: number, width: number, height: number, cellSize: number, expectedCount: number): void {
        this.originX = originX;
        this.originY = originY;
        this.cellSize = cellSize;
        this.columns = Math.max(MIN_CELLS_PER_AXIS, Math.ceil(width / cellSize));
        this.rows = Math.max(MIN_CELLS_PER_AXIS, Math.ceil(height / cellSize));
        this.ensureCellCapacity(this.columns * this.rows);
        this.ensureEnemyCapacity(expectedCount);
        this.count = 0;
    }

    public add(x: number, y: number, entity: Entity, enemy: Enemy, sprite: Sprite): void {
        const index = this.count;
        if (index >= this.x.length) this.ensureEnemyCapacity(index + 1);
        this.x[index] = x;
        this.y[index] = y;
        this.entities[index] = entity;
        this.enemies[index] = enemy;
        this.sprites[index] = sprite;
        this.cellOfEnemy[index] = this.rowOf(y) * this.columns + this.columnOf(x);
        this.count = index + 1;
    }

    public finish(): void {
        const cells = this.columns * this.rows;
        const cellStart = this.cellStart, cellCursor = this.cellCursor, cellOfEnemy = this.cellOfEnemy;
        cellStart.fill(0, 0, cells + PREFIX_SLOT);
        for (let i = 0; i < this.count; i++) cellStart[cellOfEnemy[i] + PREFIX_SLOT]++;
        for (let cell = 0; cell < cells; cell++) {
            cellStart[cell + PREFIX_SLOT] += cellStart[cell];
            cellCursor[cell] = cellStart[cell];
        }
        for (let i = 0; i < this.count; i++) this.enemiesByCell[cellCursor[cellOfEnemy[i]]++] = i;
    }

    public gatherNear(x: number, y: number, radius: number): number {
        const firstColumn = this.columnOf(x - radius), lastColumn = this.columnOf(x + radius);
        const firstRow = this.rowOf(y - radius), lastRow = this.rowOf(y + radius);
        const cellStart = this.cellStart, enemiesByCell = this.enemiesByCell, candidates = this.candidates;
        let found = 0;
        for (let row = firstRow; row <= lastRow; row++) {
            const rowCell = row * this.columns;
            for (let column = firstColumn; column <= lastColumn; column++) {
                const cell = rowCell + column;
                const end = cellStart[cell + PREFIX_SLOT];
                for (let k = cellStart[cell]; k < end; k++) candidates[found++] = enemiesByCell[k];
            }
        }
        return found;
    }

    private columnOf(x: number): number {
        const column = Math.floor((x - this.originX) / this.cellSize);
        return column < 0 ? 0 : column >= this.columns ? this.columns - 1 : column;
    }

    private rowOf(y: number): number {
        const row = Math.floor((y - this.originY) / this.cellSize);
        return row < 0 ? 0 : row >= this.rows ? this.rows - 1 : row;
    }

    private ensureCellCapacity(cells: number): void {
        if (cells <= this.cellCursor.length) return;
        const capacity = grownCapacity(this.cellCursor.length, cells);
        this.cellStart = new Int32Array(capacity + PREFIX_SLOT);
        this.cellCursor = new Int32Array(capacity);
    }

    private ensureEnemyCapacity(required: number): void {
        if (required <= this.x.length) return;
        const capacity = grownCapacity(this.x.length, required);
        this.x = grownCopy(this.x, new Float32Array(capacity));
        this.y = grownCopy(this.y, new Float32Array(capacity));
        this.entities = grownCopy(this.entities, new Uint32Array(capacity));
        this.cellOfEnemy = grownCopy(this.cellOfEnemy, new Int32Array(capacity));
        this.enemiesByCell = new Int32Array(capacity);
        this.candidates = new Int32Array(capacity);
    }
}

function grownCopy<T extends Float32Array | Uint32Array | Int32Array>(from: T, to: T): T {
    to.set(from);
    return to;
}
