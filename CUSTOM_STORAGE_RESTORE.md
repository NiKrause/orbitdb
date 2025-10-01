# OrbitDB Restore Using Custom Storage Adapters

## ✅ The IDEAL Solution - NO Filesystem Access Required!

This guide demonstrates how to backup and restore OrbitDB databases using **ONLY the OrbitDB API** with custom storage adapters, **WITHOUT any direct filesystem access** to LevelDB files.

## 🎯 Why This Approach is Better

### vs Filesystem Access (LevelDB):

| Feature | Custom Storage ✅ | Filesystem Access ❌ |
|---------|------------------|---------------------|
| **API-Only** | ✅ Yes | ❌ No, requires `Level` library |
| **Cross-Platform** | ✅ Works everywhere | ⚠️ Node.js only |
| **Browser Support** | ✅ Yes | ❌ No |
| **Cloud Friendly** | ✅ Perfect | ⚠️ Requires file export |
| **Portable** | ✅ JSON-serializable | ⚠️ Binary LevelDB format |
| **OrbitDB Future-Proof** | ✅ Uses public API | ⚠️ Depends on internals |

## 📋 How It Works

### Architecture

OrbitDB's `open()` method accepts custom storage adapters for heads and index:

```javascript
const db = await orbitdb.open(address, {
  headsStorage,   // Custom storage for log heads
  indexStorage,   // Custom storage for entry index
  entryStorage    // Custom storage for entries (usually IPFS)
})
```

### Storage Interface

Any custom storage must implement:

```javascript
{
  put: async (key, value) => {},
  get: async (key) => {},
  del: async (key) => {},
  iterator: async function* () {},
  merge: async (other) => {},
  clear: async () => {},
  close: async () => {}
}
```

## 🔧 Implementation

### Step 1: Create Restorable Storage Adapter

See `test/utils/restorable-storage.js`:

```javascript
import RestorableStorage from './path/to/restorable-storage.js'

// Create storage pre-populated with data
const headsStorage = await RestorableStorage({ 
  initialData: savedHeadsData 
})

const indexStorage = await RestorableStorage({ 
  initialData: savedIndexData 
})
```

### Step 2: Backup Using API

```javascript
// 1. Extract heads
const heads = await db.log.heads()
const headsArray = heads.map(h => ({ hash: h.hash, next: h.next }))
const headsBytes = new TextEncoder().encode(JSON.stringify(headsArray))
const savedHeadsData = new Map([['heads', headsBytes]])

// 2. Build index from entries
const entries = await db.log.values()
const savedIndexData = new Map()
for (const entry of entries) {
  savedIndexData.set(entry.hash, true)
}

// 3. Backup blocks (identity blocks, manifest, access controller)
const savedBlocks = new Map()
for (const entry of entries) {
  const blockBytes = await db.log.storage.get(entry.hash)
  savedBlocks.set(entry.hash, blockBytes)
  
  // Also backup identity
  if (entry.identity) {
    const identityBytes = await db.log.storage.get(entry.identity)
    savedBlocks.set(entry.identity, identityBytes)
  }
}

// Backup manifest
const manifestCID = db.address.split('/').pop()
const manifestBytes = await db.log.storage.get(manifestCID)
savedBlocks.set(manifestCID, manifestBytes)

// Backup access controller
if (db.access.address) {
  const acCID = db.access.address.replace('/ipfs/', '')
  const acBytes = await db.log.storage.get(acCID)
  savedBlocks.set(acCID, acBytes)
}
```

### Step 3: Serialize and Store

```javascript
// Serialize to JSON for cloud storage
const backup = {
  blocks: Array.from(savedBlocks.entries()),
  heads: Array.from(savedHeadsData.entries()),
  index: Array.from(savedIndexData.entries()),
  address: db.address
}

// Upload to cloud storage (S3, Storacha, etc.)
await uploadToCloud(JSON.stringify(backup))
```

### Step 4: Restore

```javascript
// Download from cloud
const backup = JSON.parse(await downloadFromCloud())

// Restore blocks to IPFS
const blocksMap = new Map(backup.blocks)
for (const [cidString, bytes] of blocksMap) {
  const cid = CID.parse(cidString)
  await ipfs.blockstore.put(cid, Uint8Array.from(bytes))
}

// Create custom storage with restored data
const headsStorage = await RestorableStorage({ 
  initialData: new Map(backup.heads)
})

const indexStorage = await RestorableStorage({ 
  initialData: new Map(backup.index)
})

// Open database with custom storage
const db = await orbitdb.open(backup.address, {
  headsStorage,
  indexStorage
})

// ✅ All entries are loaded!
const entries = await db.all()
console.log(`Restored ${entries.length} entries`)
```

## 🎓 Complete Example

See the working test: `test/storage-restore-custom-storage.test.js`

Run it:
```bash
npm test -- test/storage-restore-custom-storage.test.js
```

Expected output:
```
✅ Alice sees 4 entries
✅ Backed up 7 blocks total
✅ Pre-populated heads storage with 1 item(s)
✅ Pre-populated index storage with 4 entries
👁️  Alice sees 4 entries
  1. Entry 1 from Alice
  2. Entry 2 from Alice
  3. Entry 3 from Alice
  4. Entry 4 from Alice
✅ SUCCESS: All entries loaded using custom storage!

6 passing (1s)
```

## 🚀 Use Cases

### 1. Cloud Backups (Storacha, S3, etc.)

```javascript
// Your orbitdb-storacha-bridge can use this approach!
async function backupToStoracha(db, storachaClient) {
  const heads = await db.log.heads()
  const entries = await db.log.values()
  
  // Build backup data
  const backup = {
    heads: serializeHeads(heads),
    index: buildIndex(entries),
    blocks: await extractBlocks(db)
  }
  
  // Upload to Storacha
  const cid = await storachaClient.uploadJSON(backup)
  return cid
}

async function restoreFromStoracha(storachaCID, orbitdb) {
  // Download backup
  const backup = await storachaClient.downloadJSON(storachaCID)
  
  // Restore using custom storage
  const headsStorage = await RestorableStorage({ 
    initialData: deserializeHeads(backup.heads)
  })
  
  const indexStorage = await RestorableStorage({ 
    initialData: deserializeIndex(backup.index)
  })
  
  return await orbitdb.open(backup.address, {
    headsStorage,
    indexStorage
  })
}
```

### 2. Browser Applications

No filesystem access needed! Everything works in the browser:

```javascript
// Store in IndexedDB, localStorage, or memory
const backup = {
  heads: Array.from(savedHeadsData),
  index: Array.from(savedIndexData)
}

localStorage.setItem('db-backup', JSON.stringify(backup))

// Restore later
const backup = JSON.parse(localStorage.getItem('db-backup'))
const headsStorage = await RestorableStorage({ 
  initialData: new Map(backup.heads)
})
```

### 3. Cross-Platform Replication

Works seamlessly across Node.js, browser, React Native, etc.

## 📊 Comparison Matrix

| Requirement | Filesystem | Custom Storage |
|------------|-----------|----------------|
| Extract heads | Direct Level access | `db.log.heads()` ✅ |
| Extract index | Direct Level access | `db.log.values()` ✅ |
| Extract blocks | `db.log.storage.get()` ✅ | `db.log.storage.get()` ✅ |
| Restore heads | Write Level files | Custom storage ✅ |
| Restore index | Write Level files | Custom storage ✅ |
| Restore blocks | `ipfs.blockstore.put()` ✅ | `ipfs.blockstore.put()` ✅ |
| **Total API-Only?** | ❌ No | ✅ **Yes!** |

## 🎁 Benefits

1. **✅ API-Only** - Uses only public OrbitDB APIs
2. **✅ Portable** - JSON-serializable data structures
3. **✅ Cross-Platform** - Works in Node.js, browser, React Native
4. **✅ Cloud-Friendly** - Easy to upload/download
5. **✅ Future-Proof** - Not dependent on OrbitDB internals
6. **✅ Flexible** - Can add compression, encryption, etc.
7. **✅ Composable** - Can wrap with caching layers

## 🔮 Next Steps for Your orbitdb-storacha-bridge

Update your bridge to use this approach:

```javascript
// In orbitdb-storacha-bridge.js

export async function uploadDatabaseToStoracha(db, storacha) {
  // Extract using API
  const heads = await db.log.heads()
  const entries = await db.log.values()
  
  // Build exportable state
  const state = {
    heads: heads.map(h => ({ hash: h.hash, next: h.next })),
    index: entries.map(e => e.hash),
    blocks: await extractAllBlocks(db),
    address: db.address
  }
  
  // Upload to Storacha
  return await storacha.upload(state)
}

export async function restoreDatabaseFromStoracha(storachaCID, orbitdb) {
  // Download state
  const state = await storacha.download(storachaCID)
  
  // Restore blocks
  for (const [cid, bytes] of state.blocks) {
    await orbitdb.ipfs.blockstore.put(CID.parse(cid), bytes)
  }
  
  // Create custom storage
  const headsData = new Map([['heads', encodeHeads(state.heads)]])
  const indexData = new Map(state.index.map(h => [h, true]))
  
  const headsStorage = await RestorableStorage({ initialData: headsData })
  const indexStorage = await RestorableStorage({ initialData: indexData })
  
  // Open with custom storage
  return await orbitdb.open(state.address, {
    headsStorage,
    indexStorage
  })
}
```

## 📚 References

- Working test: `test/storage-restore-custom-storage.test.js`
- Custom storage: `test/utils/restorable-storage.js`
- Storage interface: `src/storage/memory.js`
- OrbitDB docs: https://github.com/orbitdb/orbitdb

---

**Author**: Nico Krause ([@NiKrause](https://github.com/NiKrause))  
**Date**: January 2025  
**Repository**: https://github.com/NiKrause/orbitdb
