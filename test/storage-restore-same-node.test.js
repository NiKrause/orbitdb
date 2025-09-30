/**
 * Test Case A: Storage Restore - Same Node (WORKING)
 * 
 * This test demonstrates the WORKING scenario:
 * - Alice creates a database and adds entries
 * - Alice backs up all blocks to external storage
 * - Alice's OrbitDB instance is stopped and directories cleaned
 * - Alice creates a NEW OrbitDB instance
 * - Alice restores blocks from external storage
 * - Alice opens the database
 * - ✅ RESULT: Alice can see all her original entries
 * 
 * This works because Alice is using the same identity.
 */

import { strictEqual, notStrictEqual } from 'assert'
import { rimraf } from 'rimraf'
import { mkdir } from 'fs/promises'
import { CID } from 'multiformats/cid'
import OrbitDB from '../src/orbitdb.js'
import createHelia from './utils/create-helia.js'

const dbPath1 = './orbitdb/tests/storage-restore-same-node/alice-1'
const dbPath2 = './orbitdb/tests/storage-restore-same-node/alice-2'
const externalStoragePath = './orbitdb/tests/storage-restore-same-node/backup'

describe('Storage Restore - Same Node (Working Case)', function () {
  this.timeout(30000)

  let ipfs1, ipfs2, orbitdb1, orbitdb2, db1
  let savedBlocks = new Map()

  before(async () => {
    await rimraf('./orbitdb/tests/storage-restore-same-node')
    await mkdir(externalStoragePath, { recursive: true })
  })

  after(async () => {
    await rimraf('./orbitdb/tests/storage-restore-same-node')
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

  it('Alice backs up all blocks to external storage', async () => {
    console.log('\n  📤 Backing up blocks from Alice\'s database')
    
    // Get all log entries
    const logEntries = await db1.log.values()
    console.log(`  📝 Found ${logEntries.length} log entries`)
    
    // Save each entry block
    for (const entry of logEntries) {
      const blockBytes = await db1.log.storage.get(entry.hash)
      savedBlocks.set(entry.hash, blockBytes)
      console.log(`  💾 Saved block: ${entry.hash.substring(0, 20)}...`)
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

    console.log(`  ✅ Backed up ${savedBlocks.size} blocks`)
    notStrictEqual(savedBlocks.size, 0, 'Should have backed up blocks')
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

  it('Alice restores blocks from external storage', async () => {
    console.log('\n  📥 Restoring blocks to Alice\'s new node')
    
    for (const [cidString, bytes] of savedBlocks.entries()) {
      const cid = CID.parse(cidString)
      await ipfs2.blockstore.put(cid, bytes)
      console.log(`  ✅ Restored block: ${cidString.substring(0, 20)}...`)
    }
    
    console.log(`  ✅ Restored ${savedBlocks.size} blocks`)
  })

  it('Alice opens the restored database and sees all entries', async () => {
    console.log('\n  📂 Alice opens restored database')
    
    db1 = await orbitdb2.open(this.dbAddress)
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
    console.log('  ✅ SUCCESS: All entries loaded!')
    
    await db1.close()
    await orbitdb2.stop()
    await ipfs2.stop()
  })
})
