/**
 * Test Case: Storage Restore Using joinEntry API
 * 
 * This test demonstrates restoring an OrbitDB database by:
 * 1. Extracting all entries from the original database
 * 2. Opening an empty database with the same address
 * 3. Using db.log.joinEntry() to add each entry back
 * 
 * This approach would require NO custom storage adapters,
 * just the existing joinEntry API.
 * 
 * Question: Does this work, or does it require changes to OrbitDB?
 */

import { strictEqual } from 'assert'
import { rimraf } from 'rimraf'
import { CID } from 'multiformats/cid'
import OrbitDB from '../src/orbitdb.js'
import createHelia from './utils/create-helia.js'

const dbPath1 = './orbitdb/tests/storage-restore-joinentry/alice-1'
const dbPath2 = './orbitdb/tests/storage-restore-joinentry/alice-2'

describe('Storage Restore - Using joinEntry API', function () {
  this.timeout(30000)

  let ipfs1, ipfs2, orbitdb1, orbitdb2, db1
  let savedBlocks = new Map()
  let savedEntries = []

  before(async () => {
    await rimraf('./orbitdb/tests/storage-restore-joinentry')
  })

  after(async () => {
    await rimraf('./orbitdb/tests/storage-restore-joinentry')
  })

  it('Alice creates database and adds entries', async () => {
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

  it('Alice backs up entries and blocks', async () => {
    console.log('\n  📤 Backing up entries and blocks')
    
    // Get all log entries
    const logEntries = await db1.log.values()
    console.log(`  📝 Found ${logEntries.length} log entries`)
    
    // Save complete entry objects
    for (const entry of logEntries) {
      savedEntries.push(entry)
      console.log(`  💾 Saved entry: ${entry.hash.substring(0, 20)}...`)
    }
    
    // Track unique identities
    const identities = new Set()
    
    // Save each entry block
    for (const entry of logEntries) {
      const blockBytes = await db1.log.storage.get(entry.hash)
      savedBlocks.set(entry.hash, blockBytes)
      
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
    console.log(`  ✅ Backed up ${savedEntries.length} complete entries`)
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
    
    this.dbAddress = dbAddress
  })

  it('Alice creates a NEW OrbitDB instance', async () => {
    console.log('\n  🆕 Creating Alice\'s second node (fresh start)')
    
    ipfs2 = await createHelia({ directory: dbPath2 })
    
    orbitdb2 = await OrbitDB({ 
      ipfs: ipfs2, 
      id: 'alice',
      directory: dbPath2 + '/orbitdb'
    })
    
    console.log('  ✅ Alice\'s second node created')
    console.log(`  🆔 Identity: ${orbitdb2.identity.id}`)
  })

  it('Alice restores blocks to blockstore', async () => {
    console.log('\n  📥 Restoring blocks to blockstore')
    
    for (const [cidString, bytes] of savedBlocks.entries()) {
      const cid = CID.parse(cidString)
      await ipfs2.blockstore.put(cid, bytes)
    }
    
    console.log(`  ✅ Restored ${savedBlocks.size} blocks`)
  })

  it('Alice opens empty database and joins entries using joinEntry API', async () => {
    console.log('\n  📂 Opening empty database')
    
    // Open the database (will be empty initially)
    db1 = await orbitdb2.open(this.dbAddress)
    console.log(`  📍 Opened: ${db1.address}`)
    
    // Check initial state
    let entries = await db1.all()
    console.log(`  👁️  Initial entries: ${entries.length}`)
    
    // Now use joinEntry to add all the saved entries
    console.log('\n  🔄 Joining saved entries using API')
    for (const entry of savedEntries) {
      try {
        console.log(`  📥 Joining entry: ${entry.hash.substring(0, 20)}...`)
        await db1.log.joinEntry(entry)
      } catch (error) {
        console.error(`  ❌ Failed to join entry: ${error.message}`)
      }
    }
    
    // Wait a bit for processing
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // Check final state
    entries = await db1.all()
    console.log(`\n  👁️  Final entries: ${entries.length}`)
    
    if (entries.length > 0) {
      entries.forEach((entry, i) => {
        console.log(`  ${i + 1}. ${entry.value}`)
      })
    }
    
    strictEqual(entries.length, 4, '✅ Alice should see all 4 original entries')
    console.log('  ✅ SUCCESS: All entries loaded using joinEntry API!')
    
    await db1.close()
    await orbitdb2.stop()
    await ipfs2.stop()
  })
})
