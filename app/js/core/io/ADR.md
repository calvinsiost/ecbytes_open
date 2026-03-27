# ADR 7: ECO Key Encoding Format and Multi-Format Import/Export

**Project:** Arquitetura Open-Source de Gemeos Digitais Ambientais e Ocupacionais com Blockchain e Automacao via Machine Learning e Grandes Modelos de Linguagem -- Aplicacoes em Mineracao
**Author:** Calvin Stefan Iost, 2026
**Brand:** ecbyts / ECBT (Environmental & Occupational Core Byte Tools)
**Status:** Accepted
**Date:** 2026-02-22
**Atualizado:** 2026-03-26

## Context

Environmental digital twins must be shareable as compact, URL-safe tokens
that encode the full model state -- elements, observations, campaigns,
coordinate systems, governance contracts, neural networks, and more.
The system must also interoperate with GIS tools (QGIS, Google Earth)
and accept heterogeneous field data (CSV, JSON) from laboratories and
monitoring equipment. Two tiers of trust are needed: a simple format
for casual sharing, and a blockchain-enabled format for regulatory
audit trails with digital signatures and integrity proofs.

## Decision

### ECO1 Simple Format (encoder.js, decoder.js)

A 5-segment string: `ECO{version}-{families}-{salt}-{checksum}-{payload}`

Encoding pipeline:

1. **Serialize**: Full model -> JSON string (20+ top-level sections including
   elements, campaigns, scenes, edges, contracts, WBS, SAO state, ticker,
   permissions, groups, report, libraries, neural networks, calculator,
   interpolation layers).
2. **Encode**: JSON string -> UTF-8 bytes via TextEncoder.
3. **Salt**: Generate 8 random bytes via `crypto.getRandomValues`.
4. **XOR obfuscation**: Each byte XORed with salt cyclically
   (`byte ^ salt[i % 8]`). This is explicitly not encryption -- it prevents
   casual editing, not determined attacks.
5. **Checksum**: Sum all encrypted bytes mod 65536, output as 4-char uppercase
   hex. Detects accidental corruption on import.
6. **Base64URL**: RFC 4648 URL-safe encoding (+ -> -, / -> \_, no padding).
7. **Family codes**: Single uppercase letter per element family present in the
   model, generated from the families module for quick visual identification.

Decoding reverses the pipeline: regex validate -> extract segments ->
Base64URL decode -> verify checksum -> XOR decrypt -> UTF-8 decode -> JSON parse.

### ECO1 Blockchain Format (encoder.js encodeKeyV3)

A 9-segment string adding cryptographic provenance:
`ECO1-{families}-{keyId}-{prevHash}-{merkleRoot}-{signature}-{salt}-{checksum}-{payload}`

Additional fields:

- **keyId** (8 hex chars): SHA-256 fingerprint of the signer's ECDSA public key.
- **prevHash** (12 chars Base64URL or "GENESIS"): SHA-256 hash of the previous
  key in the version chain, creating an append-only audit trail.
- **merkleRoot** (16 chars Base64URL): Root of the SHA-256 Merkle tree over
  all model elements and metadata, enabling per-element integrity proofs.
- **signature** (64 chars Base64URL): Truncated ECDSA P-256 signature over
  all other fields, proving authorship.

Decoding supports both synchronous (skip signature/Merkle verification)
and asynchronous (full cryptographic verification) modes.

### Format Auto-Detection (decoder.js)

Two regex patterns discriminate formats structurally:

- V2 (simple): 5 segments, 4-char hex checksum.
- V3 (blockchain): 9 segments, 8-char hex keyId, 16-char merkleRoot,
  64-char signature at fixed positions.
  The `parseInput` function also accepts raw JSON, enabling flexible import.

### GIS Export (formats/geojson.js, formats/kml.js)

**GeoJSON** (RFC 7946): FeatureCollection with WGS84 coordinates.
Element families map to geometry types -- Point (well, spring, tank),
Polygon (building, boundary, plume, lake), LineString (river).
Polygonal elements use ellipse approximation (32-vertex) for plumes and
lakes, or footprint rectangles for buildings. Observation summaries are
embedded as Feature properties. Bidirectional: import reconstructs elements
from FeatureCollection with family inference from geometry type.

**KML**: Google Earth compatible with family-based Folders, ABGR styled
Placemarks, HTML description tables of observations, and building extrusion
for 3D visualization. Export-only.

### Coordinate Transformation (geo/coordinates.js)

Full UTM-to-WGS84 pipeline using the WGS84 ellipsoid (a=6378137, f=1/298.257).
Internal Three.js coordinates (X=easting offset, Y=elevation, Z=-northing offset)
are converted through configurable UTM origin. Implements the Karney-simplified
algorithm with footpoint latitude series expansion to 8th-order terms.

### Satellite Imagery — Tile Stitcher (geo/tileStitcher.js, geo/overlayUrls.js)

**Date:** 2026-03-04

Client-side tile stitching module that composes XYZ satellite tiles into
cropped images for 3D boundary overlays. Replaces the previous dependency
on Esri World Imagery (`arcgisonline.com`) which was used without a formal
license, violating Esri Terms of Service.

**Provider:** Sentinel-2 Cloudless by EOX IT Services GmbH
(`tiles.maps.eox.at`). License: contains modified Copernicus Sentinel data
(2021), available under the Copernicus Open Access Data Policy. No API key
required. CORS enabled for all origins.

**Architecture:**

- `tileStitcher.js`: Core module. Takes `{sw, ne}` WGS84 bbox + output size.
  Calculates optimal zoom (capped at 14 — Sentinel-2 native 10m/pixel),
  fetches covering tiles in parallel, composites on off-screen canvas,
  crops to exact bbox, exports as `data:image/jpeg;base64,...`.
- `overlayUrls.js`: Async wrapper. Converts relative Three.js coordinates
  to WGS84 via `coordinates.js`, calls `stitchTiles()`, returns
  `{ overlayUrl, overlayFallbackUrls: [] }`.

**Fallback chain:** Sentinel-2 2021 → Sentinel-2 2018 → OpenStreetMap tiles
(degraded — map instead of satellite, but functional).

**Design decisions:**

- **Zoom cap at 14**: Sentinel-2 is 10m/pixel natively. Tiles above zoom 14
  are server-upscaled with no additional detail. Confirmed via curl: zoom 18
  tiles are 1.4KB (interpolated) vs 4.5KB at zoom 14 (native).
- **Data URLs, not remote URLs**: Stitched images are stored as data URLs
  in `element.data.overlayUrl` (~30-50KB). This eliminates CORS issues on
  texture loading and survives ECO1 export/import. Trade-off: slightly
  larger localStorage footprint (~40KB per boundary).
- **LRU cache (20 entries)**: Avoids re-fetching tiles when boundary is
  edited repeatedly. Cache keyed on bbox + output size.
- **Custom image protection**: User-uploaded images (via boundary overlay
  upload) are detected by `data:` prefix and never replaced by automatic
  Sentinel-2 fetch on boundary resize.
- **Async migration**: `buildOverlayUrls()` changed from sync to async.
  All 6 callers (main.js, project.js, shapeEdit.js, elements.js,
  randomModel.js, fetcher.js) updated with `await`.
- **Map Picker**: Uses Sentinel-2 tiles directly as XYZ raster source
  in MapLibre GL JS / Leaflet (no stitching needed for interactive map).

**Files modified:** overlayUrls.js (rewritten), mapPicker.js (URL swap),
main.js, project.js, shapeEdit.js, elements.js, randomModel.js, fetcher.js,
manager.js (all: sync → async callers).

**Files removed (conceptually):** All references to `arcgisonline.com`,
`googleapis.com/vt`, `virtualearth.net`, and Bing quadkey generation.

### Smart Import (smartImport.js)

LLM-powered column mapping for unknown CSV/JSON files:

1. Auto-detect separator (comma, tab, semicolon).
2. Extract headers and 5 sample rows.
3. Generate prompt with ecbyts schema (families, parameters, units).
4. LLM returns confidence-scored column mappings and normalizations.
5. Apply mapping with date format detection and numeric normalization.

### Pluggable Format Registry (formats/registry.js)

Formats self-register via `registerFormat()` with capabilities
(canExport, canImport, needsOrigin, exportScopes). The UI queries the
registry dynamically. CSV, GeoJSON, KML, and glTF are registered formats.

### Model Identity (modelLink.js)

Each model gets a SHA-256 derived ID (16 hex chars) combining timestamp,
user agent, and UUID for entropy. Models can declare upstream/downstream
links to other models, enabling dependency graphs across project phases.

## Rationale

- **XOR, not AES**: The key is a sharing token, not a secrets vault. XOR
  obfuscation is sufficient to prevent casual editing while keeping the
  implementation zero-dependency and synchronous. The blockchain format
  adds real cryptographic integrity via ECDSA and Merkle trees.
- **Base64URL**: Ensures keys are valid in URLs, clipboard, and QR codes
  without encoding issues.
- **Checksum mod 65536**: Lightweight corruption detection (4 hex chars)
  that catches truncation and bit-flip errors without the overhead of CRC32.
- **Structural regex discrimination**: Avoids version bytes or magic numbers;
  the format is self-describing through segment count and field lengths.
- **LLM-powered import**: Environmental data comes in hundreds of vendor-
  specific CSV formats. AI mapping eliminates manual column configuration
  while maintaining human review before import.
- **UTM as internal coordinate system**: Mining and environmental sites in
  Brazil use UTM (SIRGAS 2000). Three.js relative coordinates avoid
  floating-point precision loss at large UTM values.

### ECO4 Compressed Format (encoder.js encodeKeyV4, decoder.js decodeKeyV4)

**Date:** 2026-03-03

A compressed variant of the 5-segment format:
`ECO4-{families}-{salt}-{crc32}-{payload}`

Encoding pipeline:

1. **Serialize**: Full model -> JSON string (same as ECO1/ECO2).
2. **Encode**: JSON string -> UTF-8 bytes via TextEncoder.
3. **Compress**: DEFLATE-raw via native `CompressionStream` API (Baseline 2023).
4. **Salt + XOR**: Same as ECO1/ECO2 but applied **after** compression.
5. **CRC-32**: IEEE 802.3 polynomial (0xEDB88320), output as 8-char uppercase
   hex. Replaces the mod-65536 checksum (4 chars) for superior corruption
   detection (collision probability: 1 in 4 billion vs 1 in 65,536).
6. **Base64URL**: Same RFC 4648 encoding as ECO1.

Key design decisions validated by empirical testing:

- **compress→XOR, not XOR→compress**: XOR destroys the repetitive patterns
  that DEFLATE relies on. Tested: XOR→compress produces output 2.7× larger.
- **No dictionary encoding or columnar optimization**: DEFLATE alone achieves
  95.6% compression on real models. Pre-compression null-stripping adds only
  1.74% extra reduction — complexity not justified.
- **CRC-32, not SHA-256 for checksum**: CRC-32 detects accidental corruption,
  not adversarial tampering. Tamper resistance uses ECDSA (blockchain/V3).
- **Version detection by numeric prefix**: `ECO4-` prefix prevents regex
  backtracking collision where V2 regex could match V4 keys when CRC-32
  contains hex patterns like `DEAD-BEEF` (confirmed via testing).
- **Async decode**: `DecompressionStream` is inherently async. All callers
  (`importFromString`, `parseInputAsync`, merge handlers) are async-compatible.
  Sync callers (`decodeKey`, `parseInput`) throw explicit error for ECO4 keys.
- **Graceful fallback**: If `CompressionStream` is unavailable (legacy browsers),
  `encodeKeyV4` falls back to `encodeKey` (ECO2). `decompressSync` throws a
  clear error message listing minimum browser versions required.

Measured results (real model, 20 elements, 730 observations):

- Original JSON: 790,448 bytes
- ECO4 key: 46,242 chars (94.1% smaller)
- Roundtrip integrity: verified (JSON.stringify match)

Files: `crc32.js` (CRC-32 lookup table), `compression.js` (CompressionStream
wrapper with fallback detection).

### NGSI-LD Export (formats/ngsild.js)

**Date:** 2026-03-03

Export-only format producing JSON-LD entities compliant with the NGSI-LD
specification (ETSI GS CIM 009) and FIWARE Smart Data Models ecosystem.

Entity type mapping from ecbyts families:

- **FIWARE types**: `WaterBody` (lake, river), `Device` (sensor),
  `WaterQualityObserved` (water obs), `AirQualityObserved` (air obs).
- **Schema.org types**: `schema:Place` (project, building),
  `schema:Person` (individual).
- **Custom ecbyts types**: `MonitoringWell`, `ContaminationPlume`,
  `StorageTank`, `StudyAreaBoundary`, `EmissionSource`, `WasteStream`,
  `EffluentPoint`, `EnvironmentalHabitat`, `SpringSource`, `SamplePoint`,
  `GeologicalStratum`. These have no FIWARE equivalents and represent
  an academic contribution (PhD) to the environmental monitoring vocabulary.

Design decisions:

- **@context embedded**: Offline operation is mandatory. The JSON-LD context
  is inline (~2KB) rather than fetched from a remote URL.
- **Property-of-Property pattern**: EDD metadata (detect_flag,
  analytical_method, detection_limit, CAS number) are modeled as
  sub-properties of the measurement Property, following NGSI-LD conventions.
- **UN/CEFACT Recommendation 20 units**: Internal unit IDs (mg_L, celsius, pH)
  are mapped to standard codes (GL, CEL, Q30) for interoperability.
- **GeoProperty with UTM→WGS84**: Reuses `geo/coordinates.js` for coordinate
  transformation. GeoJSON Point/Polygon/LineString per element geometry.
- **Edges → Relationships**: Model edges are exported as NGSI-LD Relationship
  entities linking source and target elements.

Namespace `ecbyts:` (`https://ecbyts.com/ns/environmental-twin#`) is a custom
vocabulary. For production use with FIWARE brokers, it would need to be
published as RDF/OWL and registered with the Smart Data Models initiative.
The current export serves as proof-of-concept for interoperability and
academic validation.

## Rationale

- **XOR, not AES**: The key is a sharing token, not a secrets vault. XOR
  obfuscation is sufficient to prevent casual editing while keeping the
  implementation zero-dependency and synchronous. The blockchain format
  adds real cryptographic integrity via ECDSA and Merkle trees.
- **Base64URL**: Ensures keys are valid in URLs, clipboard, and QR codes
  without encoding issues.
- **CRC-32 replaces mod-65536**: ECO4 uses CRC-32 (8 hex chars) for vastly
  superior corruption detection. ECO1/ECO2 retain mod-65536 for backward
  compatibility.
- **Structural regex discrimination**: Avoids version bytes or magic numbers;
  the format is self-describing through segment count and field lengths.
  ECO4 adds numeric prefix detection (`ECO4-`) to prevent regex collisions.
- **DEFLATE-raw, not gzip**: 18 bytes smaller (no gzip header). The model
  already has its own checksum (CRC-32), so gzip's built-in CRC is redundant.
- **LLM-powered import**: Environmental data comes in hundreds of vendor-
  specific CSV formats. AI mapping eliminates manual column configuration
  while maintaining human review before import.
- **UTM as internal coordinate system**: Mining and environmental sites in
  Brazil use UTM (SIRGAS 2000). Three.js relative coordinates avoid
  floating-point precision loss at large UTM values.
- **NGSI-LD for interoperability**: Enables environmental digital twin data
  to flow into Smart City platforms, IoT dashboards, and FIWARE context
  brokers without custom integrations.

## Consequences

- Models of any complexity serialize to a single URL-safe string.
- ECO4 keys are ~94% smaller than ECO1/ECO2 for the same model.
- Blockchain keys create a verifiable version history without a central server.
- GeoJSON export enables direct consumption by QGIS and web mapping libraries.
- NGSI-LD export enables interoperability with FIWARE Smart City ecosystem.
- Smart import reduces onboarding friction for new datasets from laboratories.
- The format registry is extensible: new formats (e.g., Shapefile, NetCDF,
  DTDL) can be added without modifying core import/export logic.
- Backward compatibility: ECO1/ECO2 keys continue to import correctly.
  Version detection uses numeric prefix first, then structural regex.

### JSON Schema (docs/ecbyts-model.schema.json)

**Date:** 2026-03-03

A formal JSON Schema (Draft 2020-12) describing the complete model object
produced by `buildModel()`. This schema serves as the contract for the
payload inside ECO keys and JSON exports.

Key definitions (`$defs`): `Project`, `CoordinateSystem`, `Families`,
`Element`, `ElementData`, `Observation` (with full EDD fields), `Edge`,
`Campaign`, `Scene`, `CameraState`, `Position3D`, `LithologyLayer`,
`NeuralNetwork`, `InterpolationLayer`, `ModelLinks`, `AreaTreeNode`.

Design decisions:

- **`additionalProperties: true`** on root and `ElementData`: The model
  evolves frequently. Strict schemas would break on every new field.
  Only `required` fields are enforced.
- **`$schema` injection**: `downloadJSONFile()` injects the schema URL
  into `.json` exports for IDE autocomplete. ECO keys do NOT include
  `$schema` to save bytes.
- **Draft 2020-12**: Latest stable draft with `$defs` support (replaces
  `definitions`). Compatible with VS Code, ajv, and SchemaStore.
- **Not submitted to SchemaStore**: The schema lives in `docs/` for now.
  Submission requires the format to stabilize across PhD milestones.
