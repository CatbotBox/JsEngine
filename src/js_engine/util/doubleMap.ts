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

  public clear() : void {
    this._keyMap.clear();
    this._valueMap.clear();
  }
  public get size(): number {
    return this._keyMap.size;
  }
}
