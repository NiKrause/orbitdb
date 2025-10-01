/**
 * RestorableStorage - A storage adapter that can be pre-populated with data
 * 
 * This allows restoring OrbitDB databases without directly accessing LevelDB files.
 * Instead, you can pass initial data when creating the storage instance.
 * 
 * Usage:
 * ```javascript
 * // Backup
 * const headsData = new Map()
 * for await (const [key, value] of db.log.headsStorage.iterator()) {
 *   headsData.set(key, value)
 * }
 * 
 * // Restore
 * const headsStorage = await RestorableStorage({ initialData: headsData })
 * const db = await orbitdb.open(address, { headsStorage })
 * ```
 */

const RestorableStorage = async ({ initialData, backend } = {}) => {
  // Use a Map for in-memory storage
  let storage = new Map()
  
  // Pre-populate with initial data if provided
  if (initialData) {
    if (initialData instanceof Map) {
      storage = new Map(initialData)
    } else if (typeof initialData === 'object') {
      storage = new Map(Object.entries(initialData))
    }
  }

  /**
   * Puts data to storage.
   * @param {string} key The key to store under
   * @param {*} value The data to store
   */
  const put = async (key, value) => {
    storage.set(key, value)
    // Also put to backend if provided
    if (backend && backend.put) {
      await backend.put(key, value)
    }
  }

  /**
   * Deletes data from storage.
   * @param {string} key The key to delete
   */
  const del = async (key) => {
    storage.delete(key)
    if (backend && backend.del) {
      await backend.del(key)
    }
  }

  /**
   * Gets data from storage.
   * @param {string} key The key to retrieve
   * @returns {*} The stored value or undefined
   */
  const get = async (key) => {
    return storage.get(key)
  }

  /**
   * Iterates over all records in storage.
   * @yields {Array} [key, value] pairs
   */
  const iterator = async function * () {
    for (const [key, value] of storage.entries()) {
      yield [key, value]
    }
  }

  /**
   * Merges data from another storage into this one.
   * @param {Object} other Another storage instance with an iterator
   */
  const merge = async (other) => {
    if (other && other.iterator) {
      for await (const [key, value] of other.iterator()) {
        await put(key, value)
      }
    }
  }

  /**
   * Clears all data from storage.
   */
  const clear = async () => {
    storage.clear()
    if (backend && backend.clear) {
      await backend.clear()
    }
  }

  /**
   * Closes the storage (cleanup).
   */
  const close = async () => {
    if (backend && backend.close) {
      await backend.close()
    }
  }

  return {
    put,
    del,
    get,
    iterator,
    merge,
    clear,
    close
  }
}

export default RestorableStorage
