# OrbitDB Restore: Comparison of Approaches

## Summary

We've discovered THREE working approaches to restore OrbitDB databases. Here's a comparison:

## 🥇 Approach 1: Using `joinEntry` API (SIMPLEST!)

### ✅ Pros:
- **Uses existing OrbitDB API** - `db.log.joinEntry(entry)`
- **No custom code needed** - Just call the API
- **Simplest implementation** - Fewest lines of code
- **Works everywhere** - Browser, Node.js, React Native
- **Future-proof** - Uses stable public API

### How it works:

```javascript
// 1. Backup: Extract entries
const entries = await db.log.values()
const savedEntries = entries.map(e => ({ ...e }))

// 2. Restore: Open empty DB and join entries
const db = await orbitdb.open(address)
for (const entry of savedEntries) {
  await db.log.joinEntry(entry)
}

// ✅ All entries now loaded!
```

### ⚠️ Consideration:
- Needs to serialize/deserialize entry objects (including hash, next, refs, etc.)
- Must preserve exact entry structure

### Test:
`test/storage-restore-joinentry.test.js` - **6/6 passing** ✅

---

## 🥈 Approach 2: Custom Storage Adapters

### ✅ Pros:
- **Automatic loading** - Entries load immediately on open
- **No manual joining** - OrbitDB handles everything
- **Flexible** - Can add caching, compression, etc.
- **Composable** - Easy to wrap/extend

### ⚠️ Cons:
- Requires custom storage implementation
- More complex setup
- Need to understand storage interface

### How it works:

```javascript
// 1. Backup: Extract heads and index
const heads = await db.log.heads()
const entries = await db.log.values()

const headsData = serializeHeads(heads)
const indexData = buildIndex(entries)

// 2. Restore: Create custom storage
const headsStorage = await RestorableStorage({ 
  initialData: headsData 
})

const indexStorage = await RestorableStorage({ 
  initialData: indexData 
})

// 3. Open with custom storage
const db = await orbitdb.open(address, {
  headsStorage,
  indexStorage
})

// ✅ All entries already loaded!
```

### Test:
`test/storage-restore-custom-storage.test.js` - **6/6 passing** ✅

---

## 🥉 Approach 3: Direct LevelDB Access (AVOID!)

### ✅ Pros:
- Most direct
- Byte-for-byte accurate

### ❌ Cons:
- **Requires filesystem access** - No browser support
- **Node.js only** - Not portable
- **Tightly coupled** - Depends on OrbitDB internals
- **Not future-proof** - May break with OrbitDB updates
- **Requires additional library** - Need `level` package

### How it works:

```javascript
// 1. Backup: Read LevelDB files directly
const headsDb = new Level(`${dir}/log/_heads`)
const headsBytes = await headsDb.get('heads')

const indexDb = new Level(`${dir}/log/_index`)
// ... read all index entries

// 2. Restore: Write LevelDB files BEFORE opening DB
await mkdir(`${newDir}/log/_heads`)
const headsDb = new Level(`${newDir}/log/_heads`)
await headsDb.put('heads', headsBytes)

// ... write index entries

// 3. Open database
const db = await orbitdb.open(address)
```

### Test:
`test/storage-restore-same-node.test.js` - **6/6 passing** ✅

---

## 📊 Comparison Matrix

| Feature | joinEntry API | Custom Storage | LevelDB Direct |
|---------|--------------|----------------|----------------|
| **API-Only** | ✅ Yes | ✅ Yes | ❌ No |
| **Browser Support** | ✅ Yes | ✅ Yes | ❌ No |
| **Code Complexity** | ⭐ Simple | ⭐⭐ Medium | ⭐⭐⭐ Complex |
| **Custom Code Needed** | ❌ No | ✅ Yes (storage) | ✅ Yes (LevelDB) |
| **Auto-load on Open** | ❌ No (manual join) | ✅ Yes | ✅ Yes |
| **Future-Proof** | ✅ Stable API | ✅ Stable API | ⚠️ Internal API |
| **Cross-Platform** | ✅ Yes | ✅ Yes | ❌ Node.js only |
| **Serialization** | Entries | Heads + Index | Binary |
| **Setup Time** | ⚡ Instant | 🕐 Medium | 🕐🕐 Long |

## 🎯 Recommendations

### For Most Use Cases: ✅ **Use `joinEntry` API**

**Why?**
- Simplest implementation
- Uses existing OrbitDB API
- No custom code needed
- Works everywhere

**Perfect for:**
- Cloud backups (Storacha, S3, etc.)
- Cross-platform apps
- Quick prototypes
- Simple restore scenarios

**Example:**
```javascript
// Backup
const backup = {
  entries: await db.log.values(),
  blocks: await extractBlocks(db),
  address: db.address
}
await uploadToCloud(backup)

// Restore
const backup = await downloadFromCloud()
await restoreBlocks(backup.blocks)
const db = await orbitdb.open(backup.address)
for (const entry of backup.entries) {
  await db.log.joinEntry(entry)
}
```

### For Performance-Critical Apps: ⚡ **Use Custom Storage**

**Why?**
- Entries load automatically on open
- No manual iteration needed
- Can add optimizations (caching, compression)

**Perfect for:**
- High-performance apps
- Large databases
- Frequently restored databases
- Apps needing instant access

### For Local Backups (Same Machine): 💾 **Use LevelDB Direct**

**Why?**
- Most direct approach
- Byte-for-byte accurate
- Can just copy directories

**Perfect for:**
- Local machine backups
- Development/testing
- When you control the environment

## 💡 What Would Be Needed from OrbitDB Core?

### Current State: ✅ **NOTHING! APIs are complete!**

OrbitDB already provides everything needed:

1. ✅ `db.log.heads()` - Extract heads
2. ✅ `db.log.values()` - Extract entries
3. ✅ `db.log.joinEntry(entry)` - Add entries
4. ✅ Custom storage support - Pass `headsStorage`, `indexStorage` to `open()`
5. ✅ `db.log.storage.get(hash)` - Extract blocks

**No changes to OrbitDB core are required!** 🎉

### Optional Nice-to-Have Enhancements:

#### 1. Convenience Methods:

```javascript
// Proposed API additions (NOT required, just nice-to-have):

// Export complete state
const state = await db.export()
// Returns: { entries, heads, index, blocks, address }

// Import from state
await db.import(state)
// Automatically calls joinEntry for all entries

// Bulk join
await db.log.joinEntries(entries)
// Joins multiple entries efficiently
```

#### 2. Documentation Improvements:

- Add backup/restore guide to official docs
- Document `joinEntry` for restore use case
- Add examples for custom storage adapters
- Clarify heads/index storage architecture

#### 3. Helper Utilities (optional):

```javascript
// Could be separate package
import { backup, restore } from '@orbitdb/backup-utils'

const data = await backup(db)
const db = await restore(orbitdb, data)
```

## 📝 Implementation Guide for Your orbitdb-storacha-bridge

Using the **joinEntry approach** (recommended):

```javascript
// orbitdb-storacha-bridge.js

export async function uploadDatabaseToStoracha(db, storacha) {
  console.log('📤 Backing up database to Storacha...')
  
  // 1. Extract all data using API
  const entries = await db.log.values()
  const blocks = new Map()
  
  // Extract entry blocks
  for (const entry of entries) {
    const bytes = await db.log.storage.get(entry.hash)
    blocks.set(entry.hash, Array.from(bytes))
    
    // Also extract identity
    if (entry.identity) {
      const identityBytes = await db.log.storage.get(entry.identity)
      blocks.set(entry.identity, Array.from(identityBytes))
    }
  }
  
  // Extract manifest
  const manifestCID = db.address.split('/').pop()
  const manifestBytes = await db.log.storage.get(manifestCID)
  blocks.set(manifestCID, Array.from(manifestBytes))
  
  // Extract access controller
  if (db.access.address) {
    const acCID = db.access.address.replace('/ipfs/', '')
    const acBytes = await db.log.storage.get(acCID)
    blocks.set(acCID, Array.from(acBytes))
  }
  
  // 2. Create backup package
  const backup = {
    version: '1.0.0',
    address: db.address,
    entries: entries.map(e => ({
      id: e.id,
      payload: e.payload,
      next: e.next,
      refs: e.refs,
      clock: e.clock,
      v: e.v,
      key: e.key,
      identity: e.identity,
      sig: e.sig,
      hash: e.hash
    })),
    blocks: Array.from(blocks.entries())
  }
  
  // 3. Upload to Storacha
  const cid = await storacha.uploadJSON(backup)
  console.log(`✅ Uploaded to Storacha: ${cid}`)
  return cid
}

export async function restoreDatabaseFromStoracha(storachaCID, orbitdb, storacha) {
  console.log('📥 Restoring database from Storacha...')
  
  // 1. Download backup
  const backup = await storacha.downloadJSON(storachaCID)
  console.log(`📦 Downloaded backup: ${backup.entries.length} entries`)
  
  // 2. Restore blocks to IPFS
  const blocks = new Map(backup.blocks)
  for (const [cidString, bytesArray] of blocks) {
    const cid = CID.parse(cidString)
    const bytes = Uint8Array.from(bytesArray)
    await orbitdb.ipfs.blockstore.put(cid, bytes)
  }
  console.log(`✅ Restored ${blocks.size} blocks`)
  
  // 3. Open database (will be empty)
  const db = await orbitdb.open(backup.address)
  console.log(`📂 Opened database: ${db.address}`)
  
  // 4. Join all entries
  console.log('🔄 Joining entries...')
  for (const entry of backup.entries) {
    await db.log.joinEntry(entry)
  }
  
  console.log(`✅ Restored ${backup.entries.length} entries`)
  return db
}
```

## 🎓 Complete Examples

All three approaches have working tests:

1. **joinEntry API**: `test/storage-restore-joinentry.test.js` ⭐ **Recommended**
2. **Custom Storage**: `test/storage-restore-custom-storage.test.js`
3. **LevelDB Direct**: `test/storage-restore-same-node.test.js`

Run any test:
```bash
npm test -- test/storage-restore-joinentry.test.js
```

---

**Author**: Nico Krause ([@NiKrause](https://github.com/NiKrause))  
**Date**: January 2025  
**Repository**: https://github.com/NiKrause/orbitdb
