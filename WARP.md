# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Commands

### Development Workflow
```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests with coverage (CI)
npm run test:ci

# Run browser tests
npm run test:browser

# Run linting
npm lint

# Fix linting issues
npm run lint:fix

# Build distribution files
npm run build

# Build only docs
npm run build:docs

# Build only distribution
npm run build:dist

# Build only debug version
npm run build:debug

# Run benchmarks
node benchmarks/orbitdb-events.js
```

### Testing Individual Components
```bash
# Run specific test files
npx mocha test/database.test.js --timeout 30000
npx mocha test/orbitdb.test.js --timeout 30000

# Run tests in a specific directory
npx mocha test/databases/ --timeout 30000
npx mocha test/access-controllers/ --timeout 30000
```

### WebRTC Relay for Testing
```bash
# Start WebRTC relay for peer connection tests
npm run webrtc

# Start WebRTC relay in background
npm run webrtc:background
```

### Using Makefile
```bash
# Install dependencies using Make
make deps

# Run tests using Make
make test

# Build project using Make
make build

# Clean all build artifacts
make clean

# Full rebuild
make rebuild
```

## Architecture Overview

OrbitDB is a serverless, distributed, peer-to-peer database built on IPFS and Libp2p. The architecture follows a modular design with clear separation of concerns:

### Core Components

**OrbitDB Instance** (`src/orbitdb.js`):
- Main entry point that manages database instances
- Handles identity management and keystore
- Coordinates with IPFS and Libp2p for networking
- Manages the manifest store for database metadata

**Database Layer** (`src/database.js`):
- Base database implementation that all database types extend
- Manages OpLog (operation log) for CRDT functionality
- Handles storage layers (heads, entries, index)
- Coordinates access control and encryption

**Database Types** (`src/databases/`):
- **Events**: Append-only log database (default type)
- **Documents**: JSON document database with indexing
- **KeyValue**: Simple key-value store
- **KeyValueIndexed**: Key-value with Level-based indexing

**OpLog System** (`src/oplog/`):
- Implements Merkle-CRDT (Conflict-free Replicated Data Type)
- Cryptographically verifiable operation log
- Vector clocks for causality tracking
- Conflict resolution mechanisms

**Access Controllers** (`src/access-controllers/`):
- IPFS-based access control (default)
- OrbitDB-based access control
- Pluggable access control system

**Storage Layer** (`src/storage/`):
- Multiple storage backends (IPFS blocks, Level, LRU, Memory)
- ComposedStorage for layered storage strategies
- Configurable storage for different use cases

**Identity System** (`src/identities/`):
- Public key-based identity management
- Keystore for cryptographic key management
- Pluggable identity providers

### Data Flow

1. **Database Operations**: Applications call database methods (add, put, get, etc.)
2. **OpLog Entries**: Operations are converted to OpLog entries with cryptographic signatures
3. **CRDT Merging**: Entries are merged using Merkle-CRDT conflict resolution
4. **Storage**: Data is persisted across multiple storage layers
5. **Replication**: Changes are propagated to peers via Libp2p pubsub
6. **Synchronization**: Peers sync by exchanging OpLog heads and entries

### Key Architectural Principles

- **Eventually Consistent**: Uses CRDTs for conflict-free merges
- **Cryptographically Verifiable**: All entries are signed and linked
- **Modular Design**: Pluggable components for storage, access control, identity
- **Network Agnostic**: Works across different network topologies
- **Storage Agnostic**: Supports multiple storage backends

### Testing Architecture

Tests use Mocha with a custom configuration in `test/.mocharc.json`. The test setup:
- Uses Helia instances with configurable storage
- Creates temporary keystores and identities
- Cleans up storage after each test
- Supports both Node.js and browser testing via Webpack
- 30-second timeout for async operations

### Build System

The project uses:
- **ES Modules**: Modern JavaScript module system
- **Webpack**: For browser builds and testing
- **StandardJS**: For code linting and style
- **JSDoc**: For API documentation generation
- **C8**: For test coverage reporting

### Browser Compatibility

OrbitDB works in both Node.js and browsers:
- Uses different Libp2p configurations for each environment
- Browser builds exclude Node.js-specific modules
- WebRTC support for browser-to-browser connections
- Service worker compatibility considerations

### Development Notes

- Node.js 20+ required
- All code uses ES modules (type: "module")
- Tests create temporary directories that are cleaned up automatically
- The `test/utils/create-helia.js` provides consistent IPFS setup across tests
- Benchmarks are available in the `benchmarks/` directory for performance testing
