/**
 * Test Case: Storage Restore Using Custom Storage Adapters
 * 
 * This test demonstrates how to backup and restore an OrbitDB database
 * using ONLY the OrbitDB API and custom storage adapters, WITHOUT
 * direct filesystem access to LevelDB.
 * 
 * Approach:
 * 1. Extract heads using db.log.heads() API
 * 2. Extract index by iterating entries with db.log.values()
 * 3. Use custom RestorableStorage adapters pre-populated with this data
 * 4. Pass custom storage to orbitdb.open()
 */

import { strictEqual, notStrictEqual } from 'assert'
import { rimraf } from 'rimraf'
import { CID } from 'multiformats/cid'
import OrbitDB from '../src/orbitdb.js'
import createHelia from './utils/create-helia.js'
import RestorableStorage from './utils/restorable-storage.js'

const dbPath1 = './orbitdb/tests/storage-restore-custom/alice-1'
const dbPath2 = './orbitdb/tests/storage-restore-custom/alice-2'

describe('Storage Restore - Custom Storage Adapters (API-Only)', function () {
  this.timeout(30000)

  let ipfs1, ipfs2, orbitdb1, orbitdb2, db1
  let savedBlocks = new Map()
  let savedHeadsData = new Map()
  let savedIndexData = new Map()

  before(async () => {
    await rimraf('./orbitdb/tests/storage-restore-custom')
  })

  after(async () => {
    await rimraf('./orbitdb/tests/storage-restore-custom')
  })

  it('Alice creates database and adds entries', async () => {
    // Create Alice's first node
    ipfs1 = await createHelia({ directory: dbPath1 })
    
    orbitdb1 = await OrbitDB({ 
      ipfs: ipfs1, 
      id: 'alice',
      directory: dbPath1 + '/orbitdb'
    })

    console.log('\n  👩 Alice creates database')
    db1 = await orbitdb1.open('test-db', { type: 'events' })
    
    console.log('  ✍️  Alice adds entries')
    await db1.add('Entry 1 from Alice')
    await db1.add('Entry 2 from Alice')
    await db1.add('Entry 3 from Alice')
    await db1.add('Entry 4 from Alice')

    const entries = await db1.all()
    strictEqual(entries.length, 4, 'Alice should see 4 entries')
    console.log(`  ✅ Alice sees ${entries.length} entries`)
  })

  it('Alice backs up using OrbitDB API (no filesystem access)', async () => {
    console.log('\n  📤 Backing up using OrbitDB API')
    
    // 1. Get all log entries (for blocks)
    const logEntries = await db1.log.values()
    console.log(`  📝 Found ${logEntries.length} log entries`)
    
    // Track unique identities
    const identities = new Set()
    
    // Save each entry block
    for (const entry of logEntries) {
      const blockBytes = await db1.log.storage.get(entry.hash)
      savedBlocks.set(entry.hash, blockBytes)
      console.log(`  💾 Saved entry block: ${entry.hash.substring(0, 20)}...`)
      
      // Track the identity hash from this entry
      if (entry.identity) {
        identities.add(entry.identity)
      }
    }
    
    // Save identity blocks
    console.log(`  🆔 Found ${identities.size} unique identities`)
    for (const identityHash of identities) {
      try {
        const identityBytes = await db1.log.storage.get(identityHash)
        savedBlocks.set(identityHash, identityBytes)
        console.log(`  💾 Saved identity block: ${identityHash.substring(0, 20)}...`)
      } catch (error) {
        console.error(`  ❌ Failed to save identity: ${error.message}`)
      }
    }
    
    // Get manifest CID
    const manifestCID = db1.address.split('/').pop()
    const manifestBytes = await db1.log.storage.get(manifestCID)
    savedBlocks.set(manifestCID, manifestBytes)
    console.log(`  💾 Saved manifest: ${manifestCID.substring(0, 20)}...`)
    
    // Get access controller
    const accessController = db1.access
    if (accessController.address) {
      const acCID = accessController.address.replace('/ipfs/', '')
      const acBytes = await db1.log.storage.get(acCID)
      savedBlocks.set(acCID, acBytes)
      console.log(`  💾 Saved access controller: ${acCID.substring(0, 20)}...`)
    }

    console.log(`  ✅ Backed up ${savedBlocks.size} blocks total`)
    
    // 2. Extract heads using API
    console.log('  📥 Extracting heads using API')
    const heads = await db1.log.heads()
    console.log(`  📍 Found ${heads.length} head(s)`)
    
    // Serialize heads data (store as JSON array)
    const headsArray = heads.map(h => ({ hash: h.hash, next: h.next }))
    const headsBytes = new TextEncoder().encode(JSON.stringify(headsArray))
    savedHeadsData.set('heads', headsBytes)
    
    heads.forEach(h => console.log(`     - ${h.hash.substring(0, 20)}...`))
    
    // 3. Build index from entries
    console.log('  📥 Building index from entries')
    for (const entry of logEntries) {
      savedIndexData.set(entry.hash, true)
    }
    console.log(`  💾 Saved index: ${savedIndexData.size} entries`)
    
    notStrictEqual(savedBlocks.size, 0, 'Should have backed up blocks')
    notStrictEqual(savedHeadsData.size, 0, 'Should have backed up heads')
    notStrictEqual(savedIndexData.size, 0, 'Should have backed up index')
  })

  it('Alice stops her node and cleans up directories', async () => {
    console.log('\n  🛑 Stopping Alice\'s first node')
    const dbAddress = db1.address
    
    await db1.close()
    await orbitdb1.stop()
    await ipfs1.stop()
    
    console.log('  🗑️  Cleaning Alice\'s directories')
    await rimraf(dbPath1)
    
    console.log('  ✅ Alice\'s first node completely removed')
    
    // Store address for later
    this.dbAddress = dbAddress
  })

  it('Alice creates a NEW OrbitDB instance with same identity', async () => {
    console.log('\n  🆕 Creating Alice\'s second node (fresh start)')
    
    ipfs2 = await createHelia({ directory: dbPath2 })
    
    // IMPORTANT: Using same identity ID 'alice'
    orbitdb2 = await OrbitDB({ 
      ipfs: ipfs2, 
      id: 'alice',  // Same identity as before
      directory: dbPath2 + '/orbitdb'
    })
    
    console.log('  ✅ Alice\'s second node created')
    console.log(`  🆔 Identity: ${orbitdb2.identity.id}`)
  })

  it('Alice restores blocks to blockstore', async () => {
    console.log('\n  📥 Restoring blocks to Alice\'s new node')
    
    for (const [cidString, bytes] of savedBlocks.entries()) {
      const cid = CID.parse(cidString)
      await ipfs2.blockstore.put(cid, bytes)
      console.log(`  ✅ Restored block: ${cidString.substring(0, 20)}...`)
    }
    
    console.log(`  ✅ Restored ${savedBlocks.size} blocks`)
  })

  it('Alice opens database with custom storage containing heads and index', async () => {
    console.log('\n  📂 Alice opens database with custom storage')
    
    // Create custom storage adapters pre-populated with saved data
    console.log('  🔧 Creating custom storage adapters')
    const headsStorage = await RestorableStorage({ initialData: savedHeadsData })
    const indexStorage = await RestorableStorage({ initialData: savedIndexData })
    
    console.log(`  ✅ Pre-populated heads storage with ${savedHeadsData.size} item(s)`)
    console.log(`  ✅ Pre-populated index storage with ${savedIndexData.size} entries`)
    
    // Open database with custom storage
    db1 = await orbitdb2.open(this.dbAddress, {
      headsStorage,
      indexStorage
    })
    console.log(`  📍 Opened: ${db1.address}`)
    
    // Wait a bit for entries to load
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    const entries = await db1.all()
    console.log(`  👁️  Alice sees ${entries.length} entries`)
    
    if (entries.length > 0) {
      entries.forEach((entry, i) => {
        console.log(`  ${i + 1}. ${entry.value}`)
      })
    }
    
    strictEqual(entries.length, 4, '✅ Alice should see all 4 original entries')
    console.log('  ✅ SUCCESS: All entries loaded using custom storage!')
    
    await db1.close()
    await orbitdb2.stop()
    await ipfs2.stop()
  })
})
