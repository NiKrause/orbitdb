# OrbitDB Entry Loading Issue

This repository contains test cases demonstrating an issue with OrbitDB where log entries stored in the blockstore are not automatically loaded when opening an existing database.

## Issue Summary

When OrbitDB blocks (log entries, manifest, access controller) are manually placed into a blockstore and then a database is opened using that blockstore, **no entries are loaded into the log** even though all the necessary blocks are present in storage.

This affects scenarios like:
- Restoring a database from backup
- Syncing databases across different nodes
- Loading databases from external storage (e.g., via Storacha/web3.storage)

## Expected Behavior

When opening a database with `orbitdb.open(address)`, if the blockstore contains all necessary blocks (log entries, manifest, access controller), the database should:
1. Load the manifest
2. Load the access controller
3. Load all log entries from the blockstore
4. Make entries available via `db.all()` and `db.log.iterator()`

## Actual Behavior

When opening a database with blocks in the blockstore:
1. The database opens successfully
2. The manifest is found and loaded
3. The access controller is found and loaded
4. **BUT: No log entries are loaded** - `db.all()` returns an empty array and `db.log.iterator()` yields nothing

## Test Cases

This repository contains three test files demonstrating the issue:

### 1. `test/identity-access-minimal-repro.test.js` (Minimal Reproduction)

**Status**: ❌ FAILS - Demonstrates the core issue

This is the simplest test case that demonstrates the problem:

```javascript
1. Alice creates a database and adds 3 entries
2. All blocks are extracted (3 log entries + manifest + access controller) = 5 blocks
3. All blocks are stored in a second blockstore
4. A second OrbitDB instance opens the database using the second blockstore
5. Result: 0 entries loaded (expected: 3)
```

**Output**:
```
✅ 5 blocks extracted
✅ 5 blocks stored
❌ 0 entries loaded (expected 3)
```

### 2. `test/storage-restore-same-node.test.js` (Working Case)

**Status**: ⚠️ ALSO FAILS - Even this "working" case doesn't work

This test was expected to work because it uses the same identity:

```javascript
1. Alice creates database with identity 'alice' and adds 4 entries
2. Blocks are backed up
3. Alice's node is completely stopped and deleted
4. Alice creates a NEW node with same identity 'alice'
5. Blocks are restored to the new blockstore
6. Alice opens the database
7. Expected: All 4 entries visible
8. Actual: 0 entries loaded
```

### 3. `test/storage-restore-different-node.test.js` (Different Identity Case)

**Status**: ❌ FAILS - As expected

This test demonstrates the case with a different identity:

```javascript
1. Alice creates database and adds entries
2. Blocks are backed up
3. Bob creates a new node with different identity
4. Blocks are restored to Bob's blockstore
5. Bob opens the database
6. Result: 0 entries loaded
```

## Root Cause Analysis

After investigating the OrbitDB source code and the `orbitdb-storacha-bridge` library, the issue is clear:

**OrbitDB does not automatically load log entries from the blockstore when opening a database.**

The blocks need to be explicitly loaded or replayed into the log. Simply having blocks in the blockstore is not sufficient.

### Key Finding: Heads Storage

OrbitDB stores the log heads **separately** from the entry blocks:
- **Entry blocks** are stored in the blockstore (IPFS/Helia)
- **Heads** (the tips of the log DAG) are stored in LevelDB at `${directory}/log/_heads/`
- **Entry index** (which entries exist) is stored in LevelDB at `${directory}/log/_index/`

When opening a database, OrbitDB:
1. Loads the heads from LevelDB
2. Uses the heads to know which entries are the current state
3. Does NOT scan the blockstore for all entries

If the heads storage is empty (as in a fresh restore), OrbitDB has no starting point to traverse the log DAG, even if all blocks are present in the blockstore.

### Evidence from Source Code

Looking at `orbitdb-storacha-bridge/lib/orbitdb-storacha-bridge.js`, the `restoreDatabaseFromSpace` function does much more than just putting blocks in storage:

```javascript
async function restoreDatabaseFromSpace(storachaCID, orbitdb, config) {
  // 1. Downloads all blocks from Storacha
  const downloadedBlocks = await downloadBlocksWithProgress(...);
  
  // 2. Analyzes blocks to identify log entries
  const analysis = await analyzeBlocks(orbitdb.ipfs, downloadedBlocks);
  
  // 3. Reconstructs the database
  if (analysis.manifest) {
    // Uses manifest to properly reconstruct
    const result = await reconstructWithManifest(orbitdb, analysis, ...);
  } else {
    // Falls back to manual reconstruction
    const result = await reconstructWithoutManifest(orbitdb, downloadedBlocks, ...);
  }
  
  // 4. Opens the database with proper entry loading
  const db = await orbitdb.open(dbAddress);
  
  return db; // Entries are now loaded
}
```

The key insight is that `reconstructWithoutManifest` explicitly decodes log entry blocks and adds them to the database, rather than relying on OrbitDB to auto-load them.

## What's Missing in OrbitDB

When `orbitdb.open(address)` is called, OrbitDB:

1. ✅ Loads the manifest from blockstore
2. ✅ Loads the access controller from blockstore
3. ❌ **Does NOT scan the blockstore for log entries**
4. ❌ **Does NOT load existing log entries into the log**

There appears to be no mechanism in OrbitDB to:
- Scan the blockstore for blocks belonging to this database
- Load those blocks as log entries
- Replay the log from storage

## Workaround

To properly load entries from a blockstore, you need to:

1. **Option A**: Use the manifest to find head entries, then traverse backwards through the DAG, loading each entry
2. **Option B**: Scan all blocks, identify log entries by structure, and explicitly load them into the log
3. **Option C**: Use a higher-level library like `orbitdb-storacha-bridge` that handles this for you

## Questions for OrbitDB Maintainers

1. Is this the intended behavior? Should blocks in the blockstore automatically be loaded when opening a database?

2. If not, what is the recommended way to load an existing database from blocks in storage?

3. Should there be a `db.load()` or `db.sync()` method that scans the blockstore and loads entries?

4. How is database persistence/restoration supposed to work in OrbitDB?

## Running the Tests

```bash
# Run the minimal reproduction test
npm test -- test/identity-access-minimal-repro.test.js

# Run the same-identity test
npm test -- test/storage-restore-same-node.test.js

# Run the different-identity test  
npm test -- test/storage-restore-different-node.test.js
```

## Expected Test Results

All three tests currently **FAIL** with the same issue: 0 entries loaded despite all blocks being present in the blockstore.

## Environment

- OrbitDB version: 3.0.2
- Node.js version: 22.x
- Helia version: (as specified in package.json)

## Related Issues

This issue affects:
- Database backup and restoration
- Database replication across nodes
- Integration with decentralized storage (IPFS, Storacha, etc.)
- Any scenario where blocks are moved between blockstores

## Proposed Solutions

### Solution 1: Auto-load on open
When `orbitdb.open(address)` is called, scan the blockstore for entries belonging to this database and load them.

### Solution 2: Explicit load method
Add a `db.loadFromStorage()` method that scans and loads entries from the blockstore.

### Solution 3: Document the intended workflow
If the current behavior is intentional, document the proper way to restore/load databases from storage.

---

**Author**: Nico Krause ([@NiKrause](https://github.com/NiKrause))  
**Date**: January 2025  
**Repository**: https://github.com/NiKrause/orbitdb
