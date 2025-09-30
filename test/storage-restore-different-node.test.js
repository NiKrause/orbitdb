/**
 * Test Case B: Storage Restore - Different Node (FAILING)
 * 
 * This test demonstrates the FAILING scenario:
 * - Alice creates a database with write access for both Alice AND Bob
 * - Alice adds entries
 * - Alice backs up all blocks to external storage
 * - Alice's OrbitDB instance is stopped
 * - Bob creates a NEW OrbitDB instance (different identity)
 * - Bob restores blocks from external storage to his blockstore
 * - Bob opens the database at Alice's address
 * - ❌ RESULT: Bob sees 0 entries (even though he has write access!)
 * 
 * EXPECTED: Bob should see Alice's entries since:
 * 1. Bob is in the write access list
 * 2. All blocks are in Bob's blockstore
 * 3. Bob can verify Alice's signatures
 * 4. Bob CAN write new entries (proving he has access)
 * 
 * ACTUAL: Bob sees 0 entries - the log doesn't load existing entries
 */

import { strictEqual, notStrictEqual } from 'assert'
import { rimraf } from 'rimraf'
import { mkdir } from 'fs/promises'
import { CID } from 'multiformats/cid'
import OrbitDB from '../src/orbitdb.js'
import { Identities } from '../src/identities/index.js'
import { IPFSAccessController } from '../src/access-controllers/index.js'
import createHelia from './utils/create-helia.js'

const dbPathAlice = './orbitdb/tests/storage-restore-different-node/alice'
const dbPathBob = './orbitdb/tests/storage-restore-different-node/bob'
const sharedIdentitiesPath = './orbitdb/tests/storage-restore-different-node/identities'
const externalStoragePath = './orbitdb/tests/storage-restore-different-node/backup'

describe('Storage Restore - Different Node (Failing Case)', function () {
  this.timeout(30000)

  let ipfsAlice, ipfsBob, orbitdbAlice, orbitdbBob, dbAlice
  let savedBlocks = new Map()
  let identities, aliceIdentity, bobIdentity

  before(async () => {
    await rimraf('./orbitdb/tests/storage-restore-different-node')
    await mkdir(externalStoragePath, { recursive: true })
    await mkdir(sharedIdentitiesPath, { recursive: true })
  })

  after(async () => {
    await rimraf('./orbitdb/tests/storage-restore-different-node')
  })

  it('Create shared identities for Alice and Bob', async () => {
    console.log('\n  🔑 Creating shared identities')
    
    identities = await Identities({ path: sharedIdentitiesPath })
    
    aliceIdentity = await identities.createIdentity({ id: 'alice' })
    console.log(`  👩 Alice identity: ${aliceIdentity.id.substring(0, 20)}...`)
    
    bobIdentity = await identities.createIdentity({ id: 'bob' })
    console.log(`  👨 Bob identity: ${bobIdentity.id.substring(0, 20)}...`)
    
    notStrictEqual(aliceIdentity.id, bobIdentity.id, 'Identities should be different')
    console.log('  ✅ Both identities created')
  })

  it('Alice creates database with write access for BOTH Alice and Bob', async () => {
    console.log('\n  👩 Alice creates node and database')
    
    ipfsAlice = await createHelia({ directory: dbPathAlice })
    
    orbitdbAlice = await OrbitDB({ 
      ipfs: ipfsAlice,
      identity: aliceIdentity,
      identities: identities,
      directory: dbPathAlice + '/orbitdb'
    })

    console.log('  📊 Creating database with BOTH in write access list')
    dbAlice = await orbitdbAlice.open('test-db', { 
      type: 'events',
      AccessController: IPFSAccessController({ 
        write: [
          aliceIdentity.id,  // Alice can write
          bobIdentity.id      // Bob can ALSO write
        ] 
      })
    })
    
    console.log(`  📍 Database: ${dbAlice.address}`)
    console.log(`  🔐 Access controller: ${dbAlice.access.address}`)
    console.log(`  ✅ Write access: [Alice, Bob]`)
    
    // Store for later
    this.dbAddress = dbAlice.address
  })

  it('Alice adds entries to the database', async () => {
    console.log('\n  ✍️  Alice adds entries')
    
    await dbAlice.add('Entry 1 from Alice')
    await dbAlice.add('Entry 2 from Alice')
    await dbAlice.add('Entry 3 from Alice')
    await dbAlice.add('Entry 4 from Alice')

    const entries = await dbAlice.all()
    strictEqual(entries.length, 4, 'Alice should see 4 entries')
    console.log(`  ✅ Alice sees ${entries.length} entries`)
  })

  it('Alice backs up all blocks to external storage', async () => {
    console.log('\n  📤 Backing up blocks from Alice\'s database')
    
    // Get all log entries
    const logEntries = await dbAlice.log.values()
    console.log(`  📝 Found ${logEntries.length} log entries`)
    
    // Save each entry block
    for (const entry of logEntries) {
      const blockBytes = await dbAlice.log.storage.get(entry.hash)
      savedBlocks.set(entry.hash, blockBytes)
      console.log(`  💾 Saved entry block: ${entry.hash.substring(0, 20)}...`)
    }
    
    // Get manifest CID
    const manifestCID = dbAlice.address.split('/').pop()
    const manifestBytes = await dbAlice.log.storage.get(manifestCID)
    savedBlocks.set(manifestCID, manifestBytes)
    console.log(`  💾 Saved manifest: ${manifestCID.substring(0, 20)}...`)
    
    // Get access controller
    const accessController = dbAlice.access
    if (accessController.address) {
      const acCID = accessController.address.replace('/ipfs/', '')
      const acBytes = await dbAlice.log.storage.get(acCID)
      savedBlocks.set(acCID, acBytes)
      console.log(`  💾 Saved access controller: ${acCID.substring(0, 20)}...`)
    }

    console.log(`  ✅ Backed up ${savedBlocks.size} blocks`)
    notStrictEqual(savedBlocks.size, 0, 'Should have backed up blocks')
  })

  it('Alice stops her node', async () => {
    console.log('\n  🛑 Stopping Alice\'s node')
    
    await dbAlice.close()
    await orbitdbAlice.stop()
    await ipfsAlice.stop()
    
    console.log('  ✅ Alice\'s node stopped')
  })

  it('Bob creates a NEW OrbitDB instance with his own identity', async () => {
    console.log('\n  👨 Bob creates his node')
    
    ipfsBob = await createHelia({ directory: dbPathBob })
    
    // IMPORTANT: Bob uses his OWN identity (different from Alice)
    orbitdbBob = await OrbitDB({ 
      ipfs: ipfsBob,
      identity: bobIdentity,      // Bob's identity
      identities: identities,      // Shared identities store
      directory: dbPathBob + '/orbitdb'
    })
    
    console.log('  ✅ Bob\'s node created')
    console.log(`  🆔 Bob's identity: ${orbitdbBob.identity.id.substring(0, 20)}...`)
  })

  it('Bob restores blocks from external storage to his blockstore', async () => {
    console.log('\n  📥 Restoring blocks to Bob\'s blockstore')
    
    for (const [cidString, bytes] of savedBlocks.entries()) {
      const cid = CID.parse(cidString)
      await ipfsBob.blockstore.put(cid, bytes)
      console.log(`  ✅ Restored block: ${cidString.substring(0, 20)}...`)
    }
    
    console.log(`  ✅ Restored ${savedBlocks.size} blocks to Bob's node`)
  })

  it('Bob opens the database at Alice\'s address', async () => {
    console.log('\n  📂 Bob opens the database')
    console.log(`  📍 Opening: ${this.dbAddress}`)
    
    const dbBob = await orbitdbBob.open(this.dbAddress)
    
    console.log('  ✅ Database opened')
    console.log(`  🔐 Access controller loaded: ${dbBob.access.address}`)
    
    // Wait a bit for entries to load
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    const entries = await dbBob.all()
    console.log(`  👁️  Bob sees ${entries.length} entries`)
    
    const logEntries = await dbBob.log.values()
    console.log(`  📝 Raw log has ${logEntries.length} entries`)
    
    if (entries.length > 0) {
      entries.forEach((entry, i) => {
        console.log(`  ${i + 1}. ${entry.value}`)
      })
    }
    
    // This assertion will FAIL
    console.log('\n  ❌ PROBLEM: Bob cannot see Alice\'s entries!')
    console.log('  📊 Expected: 4 entries')
    console.log(`  📊 Actual: ${entries.length} entries`)
    console.log('  🔍 Even though:')
    console.log('     • Bob is in the write access list ✅')
    console.log('     • All blocks are in Bob\'s blockstore ✅')
    console.log('     • Bob has the shared identities (can verify signatures) ✅')
    
    // Prove Bob has access by trying to write
    console.log('\n  ✍️  Testing: Can Bob write?')
    try {
      const hash = await dbBob.add('Entry from Bob')
      console.log(`  ✅ Bob CAN write! Hash: ${hash.substring(0, 20)}...`)
      
      const entriesNow = await dbBob.all()
      console.log(`  📊 Bob now sees ${entriesNow.length} entries`)
      console.log('  👉 Bob can see his own entry but NOT Alice\'s entries!')
    } catch (error) {
      console.log(`  ❌ Bob cannot write: ${error.message}`)
    }
    
    // Document the actual vs expected behavior
    strictEqual(entries.length, 0, 'Current behavior: Bob sees 0 entries')
    console.log('\n  ⚠️  This test documents the bug:')
    console.log('     When opening a database with blocks already in storage,')
    console.log('     entries are not automatically loaded into the log.')
    
    await dbBob.close()
    await orbitdbBob.stop()
    await ipfsBob.stop()
    await identities.keystore.close()
  })
})
