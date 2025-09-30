import { strictEqual } from "assert";
import createHelia from "./utils/create-helia.js";
import { createOrbitDB } from "../src/index.js";
import { CID } from "multiformats/cid";
import { rimraf } from "rimraf";
import { mkdir } from "fs/promises";
import IPFSAccessController from "../src/access-controllers/ipfs.js";

/**
 * Minimal reproduction showing that OrbitDB doesn't automatically
 * load log entries from blockstore when opening an existing database.
 * 
 * This test demonstrates the issue where:
 * 1. Alice creates a DB and adds entries
 * 2. Blocks are extracted and stored in a new blockstore
 * 3. Opening the DB with those blocks doesn't show the entries
 * 
 * Expected: Entries should be loaded from blockstore
 * Actual: No entries are loaded (iterator returns empty)
 */

const dbPath1 = "./orbitdb/tests/minimal-repro/node1";
const dbPath2 = "./orbitdb/tests/minimal-repro/node2";

describe("OrbitDB Entry Loading from Blockstore", function () {
  this.timeout(30000);

  let ipfs1, ipfs2, orbitdb1, orbitdb2;

  before(async () => {
    await rimraf("./orbitdb/tests/minimal-repro");
    await mkdir(dbPath1, { recursive: true });
    await mkdir(dbPath2, { recursive: true });
    
    ipfs1 = await createHelia({ directory: dbPath1 });
    ipfs2 = await createHelia({ directory: dbPath2 });
    orbitdb1 = await createOrbitDB({ ipfs: ipfs1, directory: dbPath1 + "/orbitdb" });
    orbitdb2 = await createOrbitDB({ ipfs: ipfs2, directory: dbPath2 + "/orbitdb" });
  });

  after(async () => {
    if (orbitdb1) await orbitdb1.stop();
    if (orbitdb2) await orbitdb2.stop();
    if (ipfs1) await ipfs1.stop();
    if (ipfs2) await ipfs2.stop();
    await rimraf("./orbitdb/tests/minimal-repro");
  });

  it("should load entries from blockstore when opening existing database", async () => {
    // Step 1: Alice creates DB and adds entries
    console.log("\n📝 Step 1: Alice creates DB and adds entries");
    const db1 = await orbitdb1.open("test-db", {
      type: "events",
      AccessController: IPFSAccessController({ write: ["*"] }),
    });

    await db1.add("Entry 1");
    await db1.add("Entry 2");
    await db1.add("Entry 3");

    const entriesInDb1 = [];
    for await (const entry of db1.log.iterator()) {
      entriesInDb1.push(entry);
    }
    console.log(`   Alice added ${entriesInDb1.length} entries`);
    strictEqual(entriesInDb1.length, 3, "Alice should have 3 entries");

    // Step 2: Extract all blocks from Alice's database
    console.log("\n🔍 Step 2: Extracting all blocks from Alice's blockstore");
    const allBlocks = [];
    const dbAddress = db1.address;
    
    // Get all CIDs from the log
    for await (const entry of db1.log.iterator()) {
      try {
        const cid = CID.parse(entry.hash);
        const bytes = await ipfs1.blockstore.get(cid);
        allBlocks.push({ cid, bytes });
        console.log(`   Extracted block: ${cid.toString().slice(0, 20)}...`);
      } catch (error) {
        console.error(`   Failed to extract block: ${error.message}`);
      }
    }
    
    // Also get manifest
    const manifestCID = dbAddress.split('/').pop();
    try {
      const cid = CID.parse(manifestCID);
      const bytes = await ipfs1.blockstore.get(cid);
      allBlocks.push({ cid, bytes });
      console.log(`   Extracted manifest: ${cid.toString().slice(0, 20)}...`);
    } catch (error) {
      console.error(`   Failed to extract manifest: ${error.message}`);
    }
    
    // Get access controller
    const accessController = db1.access;
    if (accessController.address) {
      const acCID = accessController.address.replace('/ipfs/', '');
      try {
        const cid = CID.parse(acCID);
        const bytes = await ipfs1.blockstore.get(cid);
        allBlocks.push({ cid, bytes });
        console.log(`   Extracted access controller: ${cid.toString().slice(0, 20)}...`);
      } catch (error) {
        console.error(`   Failed to extract access controller: ${error.message}`);
      }
    }

    console.log(`   Total blocks extracted: ${allBlocks.length}`);
    await db1.close();

    // Step 3: Put all blocks into second blockstore
    console.log("\n💾 Step 3: Storing blocks in second blockstore");
    for (const { cid, bytes } of allBlocks) {
      await ipfs2.blockstore.put(cid, bytes);
      console.log(`   Stored block: ${cid.toString().slice(0, 20)}...`);
    }

    // Step 4: Open database with second OrbitDB instance
    console.log("\n🔓 Step 4: Opening database with second OrbitDB instance");
    const db2 = await orbitdb2.open(dbAddress);

    // Step 5: Check if entries are loaded
    console.log("\n🔎 Step 5: Checking loaded entries");
    const allEntries = await db2.all();
    
    const logEntries = [];
    for await (const entry of db2.log.iterator()) {
      logEntries.push(entry);
    }

    console.log(`   Log entries: ${logEntries.length}`);
    console.log(`   Database all() result: ${allEntries.length} events`);

    await db2.close();

    // This assertion currently FAILS - no entries are loaded
    strictEqual(
      allEntries.length,
      3,
      `Expected 3 entries to be loaded from blockstore, but got ${allEntries.length}`
    );
  });
});
