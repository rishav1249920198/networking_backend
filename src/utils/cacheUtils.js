class CacheUtils {
  constructor() {
    this.cache = new Map();
  }

  /**
   * Set a key-value pair in the cache with a Time-To-Live (TTL).
   * @param {string} key - Unique identifier for the cache entry
   * @param {any} value - The data to store
   * @param {number} ttlSeconds - Time to live in seconds
   */
  set(key, value, ttlSeconds = 30) {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.cache.set(key, { value, expiresAt });
  }

  /**
   * Get a value from the cache if it exists and has not expired.
   * @param {string} key - Unique identifier
   * @returns {any|null} The cached value or null if not found/expired
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  /**
   * Delete a specific cache key (useful for triggering a flush on update).
   * @param {string} key 
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * Clear all matching keys based on a prefix.
   * @param {string} prefix 
   */
  clearPrefix(prefix) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }
}

module.exports = new CacheUtils();
