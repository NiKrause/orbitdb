# Understanding `joinEntry` in OrbitDB

## 🎯 What is `joinEntry`?

`joinEntry` is OrbitDB's mechanism for merging external entries into a log. It's originally designed for **log replication** between peers, but it also works perfectly for **restoring databases from backups**!

## 🔄 Original Purpose: Log Replication

When two OrbitDB peers sync, they use `joinEntry` to merge each other's updates:

```
Peer A                          Peer B
┌─────────┐                    ┌─────────┐
│ Entry 1 │                    │ Entry 1 │
│ Entry 2 │ ──────────────────>│ Entry 2 │
│ Entry 3 │  joinEntry(entry3) │ Entry 3 │ ✅
└─────────┘                    └─────────┘
```

## 🎨 How `joinEntry` Works (Step-by-Step)

Let's trace through what happens when you call `db.log.joinEntry(entry)`:

### Step 1: Check for Duplicates
```javascript
// Line 241-244
const isAlreadyInTheLog = await has(entry.hash)
if (isAlreadyInTheLog) {
  return false  // Already have this entry, skip
}
```

**Purpose**: Avoid processing the same entry twice.

### Step 2: Verify the Entry
```javascript
// Line 246-261
const verifyEntry = async (entry) => {
  // A. Check database ID matches
  if (entry.id !== id) {
    throw new Error(`Entry's id doesn't match`)
  }
  
  // B. Check access control
  const canAppend = await access.canAppend(entry)
  if (!canAppend) {
    throw new Error(`Key not allowed to write`)
  }
  
  // C. Verify cryptographic signature
  const isValid = await Entry.verify(identity, entry)
  if (!isValid) {
    throw new Error(`Could not validate signature`)
  }
}
```

**Purpose**: Security! Ensures:
- Entry belongs to this database (same ID)
- Author is authorized (access control)
- Entry hasn't been tampered with (signature verification)

### Step 3: Find Missing Dependencies
```javascript
// Line 266-299
const headsHashes = (await heads()).map(e => e.hash)
const hashesToAdd = new Set([entry.hash])
const hashesToGet = new Set([...entry.next, ...entry.refs])

const traverseAndVerify = async () => {
  // Get all entries referenced by this entry
  const getEntries = Array.from(hashesToGet.values())
    .filter(has)
    .map(get)
  const entries = await Promise.all(getEntries)
  
  for (const e of entries) {
    await verifyEntry(e)  // Verify each dependency
    hashesToAdd.add(e.hash)
    
    // Follow the chain backwards
    for (const hash of [...e.next, ...e.refs]) {
      if (!isInTheLog && !hashesToAdd.has(hash)) {
        hashesToGet.add(hash)  // Need to fetch this too
      }
    }
  }
  
  if (hashesToGet.size > 0) {
    await traverseAndVerify()  // Recursively get all deps
  }
}
```

**Purpose**: OrbitDB entries form a DAG (Directed Acyclic Graph). Each entry points to previous entries via `next` and `refs` fields. This step walks backwards through the chain to find ALL related entries.

**Visual Example**:
```
Joining Entry 4:

Entry 4 ───next───> Entry 3 ───next───> Entry 2 ───next───> Entry 1
   │                   │
   └─refs─────────────┘

When you join Entry 4, it:
1. Sees Entry 3 in "next"
2. Fetches Entry 3 from blockstore
3. Verifies Entry 3
4. Follows Entry 3's "next" to Entry 2
5. Continues until all dependencies are found
```

### Step 4: Update the Log
```javascript
// Line 301-306
/* 4. Add missing entries to the oplog store (=to the log) */
await oplogStore.addVerified(hashesToAdd.values())

/* 5. Remove heads which new entries are connected to */
await oplogStore.removeHeads(connectedHeads.values())

/* 6. Add the new entry to heads (=union with current heads) */
await oplogStore.addHead(entry)
```

**Purpose**: Update three things:
1. **Index**: Mark all entries as "in the log" (so `has()` returns true)
2. **Heads**: Remove old heads that are now superseded
3. **Heads**: Add the new entry as a head

**Visual Example**:
```
Before:                    After joinEntry(Entry 4):

Heads: [Entry 3]          Heads: [Entry 4]
Index: {E1, E2, E3}       Index: {E1, E2, E3, E4}

Entry 3 (head)            Entry 4 (new head!)
   ↓                         ↓
Entry 2                   Entry 3
   ↓                         ↓
Entry 1                   Entry 2
                             ↓
                          Entry 1
```

## 🔍 Your Test Output Explained

Let's trace through what happened in your test:

```
📂 Opening empty database
📍 Opened: /orbitdb/zdpuAmWPxgGm2GtiFuhpEU8qHV9gfrcQSa1upTs432oTNimk5
👁️  Initial entries: 0
```
**State**: Database is open but empty (no heads, no index)

```
🔄 Joining saved entries using API
📥 Joining entry: zdpuAoMeA1eNbaeVKFJC... (Entry 1)
```
**What happens**:
1. ✅ Check: Not in log yet
2. ✅ Verify: Entry belongs to this DB, signature valid, access OK
3. 🔍 Dependencies: Entry.next is empty (it's the first entry!)
4. 📝 Update:
   - Add Entry 1 to index
   - Set Entry 1 as head

**State after**: Heads: [Entry 1], Index: {Entry 1}

```
📥 Joining entry: zdpuAweVrwZnXkCBcY2t... (Entry 2)
```
**What happens**:
1. ✅ Check: Not in log yet
2. ✅ Verify: Valid
3. 🔍 Dependencies: Entry.next = [Entry 1]
   - Entry 1 already in log (from previous join) ✅
4. 📝 Update:
   - Add Entry 2 to index
   - Remove Entry 1 from heads (now superseded)
   - Set Entry 2 as head

**State after**: Heads: [Entry 2], Index: {Entry 1, Entry 2}

```
📥 Joining entry: zdpuAmWyp1vzsVVRg67r... (Entry 3)
📥 Joining entry: zdpuAkdnWmWqV8W9q2HE... (Entry 4)
```
**Same process continues...**

**Final State**: Heads: [Entry 4], Index: {Entry 1, Entry 2, Entry 3, Entry 4}

```
👁️  Final entries: 4
1. Entry 1 from Alice
2. Entry 2 from Alice
3. Entry 3 from Alice
4. Entry 4 from Alice
```
**Result**: All entries are now in the log and traversable! ✅

## 🎭 What Makes `joinEntry` Special?

### 1. **Self-Healing**
If you join entries out of order, it still works:
```javascript
// Even if you do this:
await db.log.joinEntry(entry4)  // Joins 4, then finds 3, 2, 1
await db.log.joinEntry(entry1)  // Already in log, skips
await db.log.joinEntry(entry3)  // Already in log, skips
await db.log.joinEntry(entry2)  // Already in log, skips

// Result: All 4 entries in log! ✅
```

### 2. **Security-First**
Every entry is verified:
- ✅ Cryptographic signature
- ✅ Access control
- ✅ Database ID match

### 3. **DAG-Aware**
Automatically follows the entry chain:
```
Join Entry 4 → Finds Entry 3 → Finds Entry 2 → Finds Entry 1
            ALL verified and added!
```

### 4. **Queue-Based**
Uses a queue (line 311) so multiple joins don't conflict:
```javascript
return joinQueue.add(task)  // Serialized execution
```

## 🆚 `joinEntry` vs `append`

| Feature | `append` | `joinEntry` |
|---------|----------|-------------|
| **Creates new entry** | ✅ Yes | ❌ No |
| **Uses current identity** | ✅ Yes | ❌ No |
| **Accepts existing entry** | ❌ No | ✅ Yes |
| **Verifies signature** | ❌ No (creates it) | ✅ Yes |
| **Follows DAG** | ❌ No | ✅ Yes |
| **Use case** | Add new data | Merge/restore entries |

## 💡 Why It Works for Restore

`joinEntry` was designed for **replication** (merging logs from peers), but restoration is essentially the same problem:

**Replication**:
```
Peer A's entries → joinEntry → Peer B's log
```

**Restoration**:
```
Backup entries → joinEntry → Fresh log
```

Same mechanism! 🎉

## 🚀 Practical Example

```javascript
// Backup
const entries = await db.log.values()
const backup = {
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
  }))
}

// Restore
const db = await orbitdb.open(backup.address)

for (const entry of backup.entries) {
  await db.log.joinEntry(entry)
  // Each call:
  // 1. Verifies the entry
  // 2. Finds dependencies
  // 3. Updates index and heads
  // 4. Makes entry traversable
}

// All done! ✅
const restoredEntries = await db.all()
```

## ⚡ Performance Considerations

### Sequential Joining (Current approach):
```javascript
for (const entry of entries) {
  await db.log.joinEntry(entry)  // One at a time
}
```
**Speed**: ~250ms per entry (in your test: 4 entries in ~1s)

### Could Be Optimized:
```javascript
// Hypothetical bulk API (doesn't exist yet)
await db.log.joinEntries(entries)  // Batch processing
```

But current approach works fine for most use cases!

## 🎓 Summary

**`joinEntry`** is OrbitDB's powerful mechanism for merging entries into a log:

1. ✅ **Verifies** entries (signature, access control, DB ID)
2. 🔍 **Follows** the DAG chain to find dependencies
3. 📝 **Updates** index and heads
4. 🔒 **Queues** operations to avoid conflicts
5. 🎯 **Perfect** for both replication AND restoration

**Bottom line**: It's the simplest, most robust way to restore OrbitDB databases! 🚀

---

**Author**: Nico Krause ([@NiKrause](https://github.com/NiKrause))  
**Date**: January 2025  
**Repository**: https://github.com/NiKrause/orbitdb
