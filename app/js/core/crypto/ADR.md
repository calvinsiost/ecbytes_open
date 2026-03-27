# ADR 8: Client-Side Blockchain Cryptography with Web Crypto API

**Project:** Arquitetura Open-Source de Gemeos Digitais Ambientais e Ocupacionais com Blockchain e Automacao via Machine Learning e Grandes Modelos de Linguagem -- Aplicacoes em Mineracao
**Author:** Calvin Stefan Iost, 2026
**Brand:** ecbyts / ECBT (Environmental & Occupational Core Byte Tools)
**Status:** Accepted
**Date:** 2026-02-22
**Atualizado:** 2026-03-26

## Context

Environmental monitoring for mining operations requires regulatory-grade
audit trails. When an engineer submits a contamination report to CETESB
or IBAMA, the data must be traceable to its author, tamper-evident, and
verifiable without relying on a central server. Traditional blockchain
solutions (Ethereum, Hyperledger) impose infrastructure costs and latency
incompatible with a zero-backend, browser-first architecture. The crypto
module must provide authorship proof, version chaining, and per-element
integrity verification using only browser-native APIs.

## Decision

Implement a four-component cryptographic subsystem entirely in the browser
using the Web Crypto API (`crypto.subtle`), with key persistence in IndexedDB.

### 1. SHA-256 Hash Chain (hashChain.js)

Each ECO1 blockchain key embeds the hash of its predecessor, forming an
append-only chain analogous to a simplified blockchain:

- **Genesis**: First version sets `prevHash = "GENESIS"` (literal string).
- **Subsequent versions**: `prevHash = Base64URL(SHA-256(previousKey))[0:12]`.
  The full 64-char hex hash is truncated to 12 Base64URL characters for
  compactness in the key string.
- **Chain verification**: `verifyChain(keys[])` iterates chronologically,
  recomputing SHA-256 of each key and comparing against the next key's
  embedded prevHash. A break reports the exact index and expected vs found
  hash values.

Utility functions: `sha256(data)` wraps `crypto.subtle.digest('SHA-256', ...)`,
accepting strings or objects (JSON-serialized). `hashToBase64URL` and
`base64URLToHex` handle encoding conversions.

### 2. ECDSA P-256 Digital Signatures (signer.js)

Authorship is proven via Elliptic Curve Digital Signature Algorithm:

- **Algorithm**: ECDSA with curve P-256 (NIST standard) and SHA-256 hash.
- **Signing**: `signData(keyId, data)` retrieves the private key from
  IndexedDB, imports it via `crypto.subtle.importKey('jwk', ...)`, and
  signs with `crypto.subtle.sign('ECDSA', ...)`. Output is Base64URL-encoded.
- **Truncation**: `signDataTruncated(keyId, data, 64)` produces a 64-character
  signature for embedding in the ECO1 blockchain key format. The truncation
  is applied to the Base64URL representation, not the raw signature bytes.
- **Verification**: `verifySignature(keyId, data, signature)` imports the
  public key and calls `crypto.subtle.verify()`. Also supports direct
  public key JWK input via `verifySignatureWithKey()` for verifying keys
  from third parties without importing them into IndexedDB.
- **Signable data construction**: `buildSignableData()` concatenates all
  key fields except the signature itself in deterministic order, ensuring
  the signed content matches exactly what the verifier reconstructs.

### 3. Merkle Tree Integrity (merkle.js)

A binary hash tree provides O(log n) integrity proofs for individual elements:

- **Construction**: `buildMerkleTree(model)` hashes each element independently
  via SHA-256, then builds a binary tree bottom-up by concatenating and
  re-hashing sibling pairs. Odd-count levels duplicate the last node.
  Metadata (project, campaigns, coordinate system, families) is hashed
  separately and combined with the element tree root for the final root.
  The root is truncated to 16 Base64URL characters for the key format.
- **Inclusion proof**: `generateProof(model, elementIndex)` collects sibling
  hashes along the path from leaf to root, producing a compact proof array
  of `{ hash, position: 'left'|'right' }` steps. The metadata hash is
  appended as the final proof step.
- **Proof verification**: `verifyProof(elementData, proof, expectedRoot)`
  recomputes the hash from leaf to root using the proof path and compares
  against the expected Merkle root.
- **Model comparison**: `compareModels(original, modified)` computes both
  Merkle trees and reports modified, added, and removed element indices
  by comparing per-element hashes, enabling differential audit.
- **Full integrity check**: `verifyModelIntegrity(model, expectedRoot)`
  rebuilds the entire tree and compares the computed root against the
  embedded root from the ECO1 blockchain key.

### 4. Key Management (keyManager.js)

ECDSA key pairs are managed client-side with IndexedDB persistence:

- **Storage**: Database `ECOKeyStore`, object store `keys`, keyed by
  `id` (8 hex chars derived from SHA-256 of the public key JWK).
- **Generation**: `generateKeyPair(name)` calls
  `crypto.subtle.generateKey('ECDSA', P-256, true, ['sign','verify'])`,
  exports both keys to JWK format, computes the keyId fingerprint, and
  stores the full record `{ id, name, publicKey, privateKey, createdAt }`.
- **Public key sharing**: `exportPublicKey(keyId)` returns the JWK without
  the private component. `importPublicKey(data)` validates the key via
  trial import before storing (privateKey = null, imported = true).
- **Listing**: `listKeys()` returns metadata only (id, name, createdAt,
  hasPrivateKey flag) -- never exposes private keys through the listing API.
- **Capability check**: `isSupported()` tests for `crypto.subtle` and
  `indexedDB` availability, enabling graceful degradation on unsupported
  browsers.

### Module Entry Point (index.js)

Re-exports all public functions from the four submodules, providing a
unified import surface: `import { sha256, generateKeyPair, signData,
buildMerkleTree } from './crypto/index.js'`.

## Rationale

- **Web Crypto API over libraries**: Native browser implementation is
  FIPS 140-2 validated on most platforms, avoids supply-chain risk from
  third-party crypto libraries, and provides hardware-backed key generation.
- **ECDSA P-256 over RSA**: 256-bit ECC provides equivalent security to
  3072-bit RSA with much smaller key and signature sizes -- critical when
  signatures are embedded in URL-safe key strings.
- **IndexedDB over localStorage**: Structured storage supports the key
  record schema, is not subject to the 5MB localStorage limit, and
  provides transactional guarantees for key operations.
- **Merkle tree over full-model hash**: Per-element integrity proofs allow
  selective verification (e.g., verify a single well's observations without
  reprocessing the entire model), and `compareModels` enables precise
  differential auditing between versions.
- **Truncated hashes and signatures in key format**: The key string must
  remain practical for URL sharing. 12-char prevHash (72 bits), 16-char
  merkleRoot (96 bits), and 64-char signature provide sufficient collision
  resistance for the application's trust model while keeping keys compact.
- **Client-side only**: No server is needed for key generation, signing,
  or verification. This aligns with the project's zero-backend architecture
  and enables offline operation in remote mining sites.

## Consequences

- Regulatory submissions can include cryptographically signed ECO keys that
  prove authorship and detect tampering, without requiring a blockchain node.
- Version chains provide auditable history of model modifications over time.
- Per-element Merkle proofs enable selective disclosure: share proof that
  a specific well's data is unmodified without revealing the full model.
- Key loss is catastrophic: if the browser's IndexedDB is cleared, the
  private key is irrecoverable. Users should export and back up public keys.
- Signature truncation means verification requires the original signer's
  full-length signature internally; truncated signatures embedded in keys
  serve as integrity tokens, not standalone cryptographic proofs.
