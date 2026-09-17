/** AsyncStorage, in memory, for the Node tests. Same shape, no phone. */
const mem = new Map();

const AsyncStorage = {
  async getItem(k) {
    return mem.has(k) ? mem.get(k) : null;
  },
  async setItem(k, v) {
    mem.set(k, String(v));
  },
  async removeItem(k) {
    mem.delete(k);
  },
  async clear() {
    mem.clear();
  },
};

export default AsyncStorage;
