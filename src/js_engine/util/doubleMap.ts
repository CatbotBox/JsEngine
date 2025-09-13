export class DoubleMap<K, V> {
  private _keyMap: Map<K, V> = new Map();
  private _valueMap: Map<V, K> = new Map();

  public set(key: K, value: V) {
    if (this._keyMap.has(key) || this._valueMap.has(value)) {
      throw new Error("Key or value already exists");
    }
    this._keyMap.set(key, value);
    this._valueMap.set(value, key);
  }

  public swapKeys(key1: K, key2: K): void {
    const value1 = this._keyMap.get(key1);
    const value2 = this._keyMap.get(key2);
    if (value1 === undefined || value2 === undefined) {
      throw new Error("One or both keys do not exist");
    }
    this._keyMap.set(key1, value2);
    this._keyMap.set(key2, value1);
    this._valueMap.set(value1, key2);
    this._valueMap.set(value2, key1);
  }

  public swapValues(value1: V, value2: V): void {
    const key1 = this._valueMap.get(value1);
    const key2 = this._valueMap.get(value2);
    if (key1 === undefined || key2 === undefined) {
      throw new Error("One or both values do not exist");
    }
    this._valueMap.set(value1, key2);
    this._valueMap.set(value2, key1);
    this._keyMap.set(key1, value2);
    this._keyMap.set(key2, value1);
  }

  public getValue(key: K): V | undefined {
    return this._keyMap.get(key);
  }

  public getKey(value: V): K | undefined {
    return this._valueMap.get(value);
  }

  public deleteKey(key: K) {
    const value = this._keyMap.get(key);
    if (value !== undefined) {
      this._keyMap.delete(key);
      this._valueMap.delete(value);
    }
  }

  public deleteValue(value: V) {
    const key = this._valueMap.get(value);
    if (key !== undefined) {
      this._valueMap.delete(value);
      this._keyMap.delete(key);
    }
  }

  public clear(): void {
    this._keyMap.clear();
    this._valueMap.clear();
  }

  public get size(): number {
    return this._keyMap.size;
  }
}
