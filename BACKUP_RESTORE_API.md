# OrbitDB Backup and Restore: API vs Filesystem

This document explains the different approaches for backing up and restoring OrbitDB databases.

## Summary

### ✅ What CAN be done with OrbitDB API:

1. **Extract heads** - `await db.log.heads()` returns array of head entries
2. **Check if entry exists** - `await db.log.has(hash)` checks index
3. **Get all entries** - `await db.log.values()` returns all log entries
4. **Extract blocks** - blocks are in IPFS/Helia blockstore

### ❌ What CANNOT be done with OrbitDB API:

1. **Restore heads to LevelDB** - No API to set heads before opening database
2. **Restore index to LevelDB** - No API to populate index before opening database
3. **Direct access to headsStorage/indexStorage** - These are internal to OplogStore

## Current Architecture

OrbitDB stores database state in THREE locations:

```
OrbitDB Database
├── Blockstore (IPFS/Helia)          ← Accessible via API ✅
│   ├── Entry blocks
│   ├── Identity blocks
│   ├── Manifest
│   └── Access controller
│
├── LevelDB: _heads/                  ← NOT accessible via API ❌
│   └── 'heads' → JSON array of {hash, next}
│
└── LevelDB: _index/                  ← NOT accessible via API ❌
    └── hash → boolean (entry exists)
```

## Backup Strategies

### Option 1: API-Based Extraction (Partial)

```javascript
// ✅ Can extract using API
const heads = await db.log.heads()
const entries = await db.log.values()

// Save heads data
const headsData = heads.map(h => ({ hash: h.hash, next: h.next }))

// Build index data
const indexData = {}
for (const entry of entries) {
  indexData[entry.hash] = true
}

// ❌ But you still need filesystem access to restore!
```

**Pros:**
- Uses official API
- More portable (doesn't depend on LevelDB internals)

**Cons:**
- Still requires filesystem access for restoration
- More complex (need to serialize/deserialize)

### Option 2: Direct Filesystem Access (Current Implementation)

```javascript
import { Level } from 'level'

// Backup heads
const headsPath = `${directory}/orbitdb/${address}/log/_heads`
const headsDb = new Level(headsPath, { valueEncoding: 'view' })
await headsDb.open()
const headsBytes = await headsDb.get('heads')
await headsDb.close()

// Backup index
const indexPath = `${directory}/orbitdb/${address}/log/_index`
const indexDb = new Level(indexPath, { valueEncoding: 'view' })
await indexDb.open()
const indexData = new Map()
for await (const [key, value] of indexDb.iterator()) {
  indexData.set(key, value)
}
await indexDb.close()

// Restore (before opening database!)
// ... restore headsBytes and indexData to new LevelDB
```

**Pros:**
- Direct, efficient
- Byte-for-byte accurate
- Simpler code

**Cons:**
- Depends on LevelDB storage format
- Requires filesystem access
- Tightly coupled to OrbitDB internals

## Restoration Challenge

The fundamental problem is that **OrbitDB has no API to set heads and index before opening a database**.

When you call `orbitdb.open(address)`:
1. It creates the database instance
2. It initializes the log with OplogStore
3. OplogStore loads heads from LevelDB
4. If heads are empty → log is empty → no entries are traversed

There's no way to say "here are the heads, please use these when initializing."

## Possible Solutions

### Solution 1: Add API to OrbitDB (Ideal)

```javascript
// Proposed API
const db = await orbitdb.open(address, {
  restore: {
    heads: [...],        // Array of head entries
    index: new Map(...), // Entry hash → boolean
  }
})
```

This would require changes to OrbitDB core.

### Solution 2: Custom Storage Adapter

```javascript
// Implement custom headsStorage that can be pre-populated
const headsStorage = await CustomHeadsStorage({ 
  initialHeads: savedHeadsData 
})

const db = await orbitdb.open(address, {
  headsStorage,
  indexStorage: customIndexStorage
})
```

This is possible but complex.

### Solution 3: Filesystem Access (Current)

Use filesystem access to write LevelDB files before opening database. This is what we currently do and it works reliably.

## Recommendations

### For Local Backups (Same Machine)

✅ **Use filesystem access** - Most efficient, straightforward

```javascript
// Just copy the entire directory
cp -r ${directory}/orbitdb/${address}/ ${backup_location}/
```

### For Remote Backups (Cross-Machine/Cloud)

🟡 **Hybrid approach recommended**:

1. **Extract using API** for portability:
   ```javascript
   const heads = await db.log.heads()
   const entries = await db.log.values()
   ```

2. **Serialize and upload** to cloud storage

3. **Restore using filesystem** when recreating:
   ```javascript
   // Download serialized data
   // Write to LevelDB before opening database
   ```

### For OrbitDB-Storacha Bridge

Your `orbitdb-storacha-bridge` should:

1. ✅ Upload all blocks to Storacha (already doing this)
2. ✅ Upload heads data (serialize from `db.log.heads()`)
3. ✅ Upload index data (can build from `db.log.values()`)
4. On restore:
   - Download blocks to blockstore
   - **Write heads/index to LevelDB before opening database**

## Future Improvements

Ideal OrbitDB enhancements:

1. **Export API**: `await db.export()` → returns complete state
2. **Import API**: `await orbitdb.import(state)` → restores database
3. **Heads/Index Access**: Expose headsStorage/indexStorage for custom implementations

## Example: Complete Backup/Restore

See `test/storage-restore-same-node.test.js` for a working implementation using the filesystem approach.

---

**Author**: Nico Krause ([@NiKrause](https://github.com/NiKrause))  
**Date**: January 2025  
**Repository**: https://github.com/NiKrause/orbitdb
