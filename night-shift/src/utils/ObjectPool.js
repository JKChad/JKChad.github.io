export class ObjectPool {
  constructor(factory, initial = 16) {
    this._factory = factory;
    this._free = [];
    this._all = [];
    for (let i = 0; i < initial; i++) {
      const item = factory();
      this._free.push(item);
      this._all.push(item);
    }
  }

  acquire() {
    const item = this._free.pop() || this._factory();
    if (!this._all.includes(item)) this._all.push(item);
    return item;
  }

  release(item) {
    this._free.push(item);
  }

  get all() {
    return this._all;
  }
}
