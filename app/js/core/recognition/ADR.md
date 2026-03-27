# ADR 10: Computer Vision and Image Recognition

**Project**: ECBT -- Environmental & Occupational Core Byte Tools
**Title**: Multi-Method Aerial Image Recognition with Vectorization Pipeline
**Author**: Calvin Stefan Iost
**Date**: 2026
**Atualizado:** 2026-03-26
**Status**: Accepted

## Context

Environmental site assessments require feature extraction from aerial and satellite
imagery to detect buildings, water bodies, vegetation, tanks, and infrastructure.
The system must support three recognition methods of increasing capability --
algorithmic color segmentation, user-trained neural classifiers, and ML/LLM vision --
all producing standardized output that feeds into a georeferenced vectorization pipeline.

## Decision

### 1. Three-Method Architecture (analyzer.js)

The analyzer orchestrates three complementary recognition methods:

- **Algorithmic** (colorAnalysis.js): Local canvas-based HSL/ExG segmentation.
  No API key required. Deterministic and fast.
- **User Classifier** (userClassifier.js): Interactive paint-to-train neural network.
  User labels pixels, the NN learns color patterns, then classifies the full image.
- **AI Vision** (visionPrompt.js): Sends imagery to vision-capable LLMs for
  natural language feature detection. Requires API key.
- **ML Detection** (segformerDetector.js): SegFormer-B0 semantic segmentation (~5 MB)
  providing per-pixel ADE20K labels via Transformers.js.

### 2. Spectral Indices for Pixel Classification (indices.js)

Pixel classification uses a priority pipeline: shadow -> vegetation (ExG) -> HSL categories.

- **Excess Green Index** (ExG = 2\*Gn - Rn - Bn): More robust than HSL hue for
  separating vegetation from shadows in satellite imagery.
- **C3 Shadow Index** (atan2(B, max(R,G))): Detects shadows via atmospheric Rayleigh
  scattering blue bias. Combined with BT.601 luminance threshold (lum < 40).
- **Sobel Edge Detection**: 3x3 gradient operator generates edge maps used to filter
  building false positives -- real structures have dense edges; shadows are smooth.
- **Otsu Thresholding**: Inter-class variance maximization for automatic binary
  threshold selection.

### 3. HSL Color Segmentation with Calibration (colorAnalysis.js)

Six HSL-based categories (water, vegetation, building_bright, building_dark,
infrastructure, soil) are defined with empirically calibrated hue/saturation/lightness
ranges. A calibration system (calibration.js) allows dynamic threshold adjustment via
slider parameters, producing a custom classifier function at runtime. Morphological
close (dilate + erode) fills 1-pixel gaps in building detections without merging
unrelated vegetation or water blobs.

### 4. Connected Component Analysis with PCA Rotation (colorAnalysis.js)

Flood-fill BFS groups same-category pixels into blobs, collecting second-order moments
(sumXX, sumYY, sumXY) during traversal. Rotation is estimated from the covariance
matrix eigenvector: `theta = 0.5 * atan2(2*Cxy, Cxx - Cyy)`. Oriented bounding box
dimensions are computed by projecting corners into the rotated frame. Elongated blobs
are reclassified: high aspect ratio buildings become road markers; elongated water
becomes rivers.

### 5. Contour Extraction and Simplification (colorAnalysis.js)

Row-scan boundary tracing extracts left/right edge pixels per scanline, forming a
closed polygon (left edge top-to-bottom, right edge bottom-to-top). The
Ramer-Douglas-Peucker algorithm (iterative stack-based implementation) simplifies
contours with ~1.5 pixel tolerance, reducing vertex count while preserving shape fidelity.

### 6. User-Trained Neural Classifier (userClassifier.js)

Wraps `SimpleNN` from the nn module with a fixed architecture:
6 inputs (R, G, B, H, S, L normalized to [0,1]) -> 16 hidden (ReLU) -> 7 outputs (softmax).
The 7 output classes map to environmental families (building, tank, lake, river, habitat,
well, marker). Users paint labeled regions on the aerial image; pixel RGB+HSL features
are extracted as training samples. After training, every pixel is classified, producing
a category grid fed into the standard blob pipeline. A 0.4 confidence threshold filters
uncertain classifications.

### 7. Feature Merging and Confidence Scoring (colorAnalysis.js)

Nearby blobs of the same family are merged using Union-Find with distance threshold
(3% of extent width, capped at 15 m). Merged features inherit confidence-weighted
average positions. Confidence scoring combines per-family base scores, fill ratio
bonus, size bonus, shape regularity bonus, and edge density boost, capped at 0.95.

### 8. Universal Vectorization Engine (vectorization/engine.js)

A full OpenCV.js pipeline converts semantic masks to georeferenced GeoJSON
(RFC 7946, EPSG:4326). Per-category CV strategies dispatch to family-specific
processing (watershed, Canny, morphological operations). Hierarchy assignment
via RETR_TREE distinguishes outer polygons from holes. Georeferencing converts
pixel coordinates to WGS84 with CCW exterior / CW interior ring winding order
per RFC 7946. A BFS fallback pipeline activates when OpenCV.js is unavailable.

### 9. SLIC Superpixel Segmentation (classicSegmentation.js)

Classic segmentation engine using SLIC (Simple Linear Iterative Clustering).
Unlike colorAnalysis.js which classifies pixels individually by HSL thresholds,
SLIC groups spatially coherent neighborhoods in CIELAB color space before
classification. This produces smoother, less noisy regions — especially effective
for large biomes (forests, water bodies).

- **Algorithm**: SLIC in pure JS — CIELAB conversion, K-means on 2S×2S windows,
  BFS connectivity enforcement. 10 iterations, ~300ms on 512×512.
- **Parameters**: `numSuperpixels` (50-800, default 200), `compactness` (1-40, default 10)
- **Output**: `Uint8Array` category grid compatible with existing `findBlobs`/`blobToFeature` pipeline
- **Alternative considered**: Felzenszwalb — rejected (graph-based, less predictable cluster count)

### 10. YOLOS Object Detection (objectDetector.js)

Lightweight bounding-box detector using YOLOS-tiny (~25 MB) via Transformers.js v3.
Detects discrete isolated objects (vehicles, containers, boats) that semantic
segmentation engines miss or under-segment.

- **Model choice**: YOLOS-tiny (25 MB) over DETR-resnet-50 (160 MB) — 6x smaller, COCO 80 classes
- **Limitation**: COCO does not include "building" — this engine complements SegFormer/SLIC
- **Transformers.js v3**: New engines use `@huggingface/transformers@3` (WebGPU, better SAM support).
  Existing SegFormer remains on v2 (`@xenova/transformers@2.17.2`) — both coexist without conflict.
- **Alternative considered**: OWL-ViT (existing mlDetector.js, 155 MB) — too heavy, deprecated

### 11. SAM Interactive Segmentation (samInteractive.js)

Zero-shot click-to-segment using SlimSAM via Transformers.js v3. User clicks on
an object in the aerial image and receives the precise mask for that object only.

- **Model**: Xenova/slimsam-77-uniform (~50 MB quantized) — smallest SAM variant available
- **Two-phase API**: `setImage()` encodes embeddings once (~2-3s), then `segmentAtPoint()`
  decodes per click (~200ms). Multiple clicks reuse cached embeddings.
- **Multi-point prompts**: Supports positive (include) and negative (exclude) clicks
- **Caching**: Transformers.js Cache API handles model persistence automatically
- **Warning**: 50 MB download on first use — UI displays size warning before loading

### 12. Anti-Ameba Post-Processing Pipeline (postprocess/)

AI-generated masks are organic ("melted amoebas"). Engineering and WebGL require
mathematical geometry. The Anti-Ameba protocol transforms masks into clean polygons.

**Pipeline per family**:

- Building: Marching Squares → RDP(ε=3.0) → Orthogonalize → Georeference
- Vegetation/Water: Marching Squares → RDP(ε=1.0-1.5) → Gaussian Smooth → Georeference
- Roads: Marching Squares → RDP(ε=2.0) → Georeference

**Orthogonalization algorithm** (postprocess/orthogonalize.js):
Global axis-aligned regularization — fundamentally different from the local
vertex-by-vertex `regularizePolygon` in simplify.js. Detects the polygon's
dominant edge orientation via weighted histogram, then forces ALL edges to align
to that axis or its perpendicular. Supports L/T/U shaped buildings via
`contourRectFillRatio` decision: ratio > 0.85 → collapse to MBR, otherwise keep
multi-edge orthogonal shape.

**Marching Squares** (postprocess/marchingSquares.js):
Pure-JS contour extraction as fallback when OpenCV.js is not loaded. 16-case
lookup table with sub-pixel interpolation on cell edges. O(W×H) full scan,
< 50ms for 512×512.

### 13. SAM Automatic Mask Generation (samAutoMask.js)

Browser-native implementation of SamAutomaticMaskGenerator inspired by
segment-geospatial (samgeo) by Qiusheng Wu. Generates a uniform NxN grid of
point prompts, runs SAM on each, applies IoU-based NMS to deduplicate.

- **Provenance**: Kirillov et al. 2023 "Segment Anything" (arXiv:2304.02643),
  grid-point strategy from segment-geospatial (Wu 2023, MIT license)
- **Model**: Reuses existing SlimSAM singleton via `getModelState()` (no download)
- **Grid**: Default 16x16 = 256 points. Adjustable 8-64 via UI slider.
- **NMS**: Bbox pre-filter + pairwise pixel IoU. O(n^2) with bbox skip ~90%.
- **Tensor disposal**: Explicit `.dispose()` after each grid point (~1 MB/call).
- **Performance**: ~50s for 256 points at 200ms/pt. Abort returns partial results.
- **Heuristic classifier**: ExG for vegetation, HSL for water, aspect ratio for
  buildings/tanks. Confidence = 0.5 (medium) to indicate uncertainty.

### 14. Text-Prompted Segmentation (clipClassifier.js)

Zero-shot text-based segmentation using CLIP + SAM auto-masks. Inspired by
segment-geospatial's LangSAM. Uses CLIP instead of GroundingDINO (no TF.js port).

- **Provenance**: Radford et al. 2021 "Learning Transferable Visual Models
  From Natural Language Supervision" (OpenAI CLIP)
- **Model**: Xenova/clip-vit-base-patch32 (~85 MB quantized, MIT — OpenAI CLIP + Xenova wrapper)
- **Strategy**: Auto-mask -> crop + zero background -> CLIP zero-shot classification
- **Pipeline API**: Primary `pipeline('zero-shot-image-classification')`, fallback to
  raw `CLIPModel` + `AutoProcessor` + manual cosine similarity
- **Fallback**: On CLIP load failure, returns heuristic-classified features with warning
- **Label mapping**: 40+ environmental terms mapped to ecbyts family IDs

### 15. Tile Map Segmentation (tileSegmentation.js)

Integration pipeline connecting map tile infrastructure with SAM auto-masking.
Inspired by segment-geospatial's `tms_to_geotiff` workflow.

- **Tile source**: Existing Sentinel-2 Cloudless by EOX via `tileStitcher.js`
- **Map picker**: `openMapPickerModal({ mode: 'bounds' })` returns viewport bounds
- **Pipeline**: MapPicker bbox -> `stitchTiles()` -> SAM auto-mask -> Anti-Ameba -> features
- **Georeferencing**: WGS84 -> meters via haversine approximation (acceptable <10km)
- **No new dependencies**: Uses existing tileStitcher + mapPicker infrastructure

## Consequences

- Ten recognition methods provide graceful degradation from AI-powered to fully offline.
- The spectral index pipeline (ExG, C3, Sobel) significantly reduces false positives
  from shadows in satellite imagery.
- PCA-based rotation estimation enables accurate oriented bounding boxes for buildings.
- The vectorization engine produces standards-compliant GeoJSON exportable to any GIS.
- User-trained classifiers leverage the same SimpleNN infrastructure as the What-If engine.
- SLIC superpixels produce smoother regions than per-pixel HSL classification for large biomes.
- YOLOS detects discrete objects that semantic segmentation misses (vehicles, containers).
- SAM enables surgical object extraction with zero training — click and get the polygon.
- SAM Auto-Mask scans entire images without user interaction — batch feature discovery.
- CLIP text prompting lets users describe what to find without training or labeling.
- Tile segmentation connects satellite imagery directly to the recognition pipeline.
- The Anti-Ameba pipeline ensures all AI outputs meet engineering geometry standards.
- Orthogonalization produces buildings with exact 90° corners — critical for 3D extrusion.
- Instance segmentation via YOLOS+SAM hybrid produces per-object masks without extra downloads.
- MaskFormer on-demand (~100 MB) provides single-pass instance segmentation for dense scenes.
- SAM dual-model architecture allows future SAM 2.1 upgrade with 3-line code change.
- Canvas-based change detection detects temporal environmental changes without ML models.
- Synthetic vNDVI provides vegetation monitoring from RGB-only imagery at ~5ms per image.
- Rule-based scene classification achieves 80-85% accuracy at 30ms without any model download.
- Handcrafted 6D embeddings enable tile similarity search with 48 bytes storage per tile.
- Super-resolution via adaptive sharpening delivers ~80% of neural SR quality at 20ms.

### 16. Change Detection (changeDetector.js)

Multi-scale spectral change detection between temporal image pairs. Computes
ExG, C3, Sobel edge density and luminance per image, then pixel-wise 4D
Euclidean distance with Otsu automatic thresholding and morphological cleanup.
Classifies change blobs by direction: vegetation gain/loss, construction,
demolition, water change. Tier 2 uses existing SegFormer-B0 for semantic mask
comparison. Tier 3 uses LLM Vision for structured analysis.

- **Provenance**: Spectral distance in multi-index space (standard remote sensing)
- **Otsu**: Otsu 1979 "A Threshold Selection Method from Gray-Level Histograms"
- **Morphology**: Serra 1982 "Image Analysis and Mathematical Morphology"

### 17. Scene Classification (sceneClassifier.js)

Image-level land cover classification into 9 environmental categories.
Tier 1 uses a decision tree on aggregated spectral indices (ExG, C3, edge
density, brightness statistics). Tier 2 uses EfficientNet-lite0 (~4MB q8)
via Transformers.js v3 pipeline('image-classification').

- **Provenance**: EfficientNet (Tan & Le 2019, ICML)
- **Model**: Xenova/efficientnet-lite0, Apache-2.0 weights, MIT wrapper
- **Categories**: forest, grassland, cropland, water, wetland, urban, industrial, barren, mixed

### 18. Super-Resolution (superResolution.js)

Image enhancement for low-resolution aerial/satellite imagery.
Tier 1 uses canvas bicubic upscale + adaptive unsharp mask guided by
Sobel edge map (stronger sharpening near edges, weaker in flat areas).
Tier 2 uses Swin2SR neural 2x upscale via Transformers.js v3.

- **Provenance**: Unsharp mask (Schreiber 1970), Sobel (Sobel & Feldman 1968)
- **Swin2SR**: Conde et al. 2022 "Swin2SR: SwinV2 Transformer for Compressed Image SR" (ECCV)
- **Model**: Xenova/swin2SR-classical-sr-x2-64, Apache-2.0 weights

### 19. Spectral Regression (spectralRegression.js)

Vegetation index estimation from RGB-only imagery. Tier 1 computes synthetic
vNDVI = (2G - R - B) / (2G + R + B), proven to correlate ~0.85 with true NDVI.
SAVI proxy and water index also available. Tier 2 trains a SimpleNN regression
network (6->16->8->1, mode:'regression') from user calibration patches.

- **vNDVI**: Zheng et al. 2018 (DOI: 10.1016/j.compag.2019.105083)
- **SAVI**: Huete 1988 (DOI: 10.1016/0034-4257(88)90106-X)
- **Regression**: SimpleNN from core/nn/network.js (existing infrastructure)

### 20. Image Embeddings (imageEmbeddings.js)

Satellite tile similarity search via feature embeddings. Tier 1 computes a
6D handcrafted vector [mean_ExG, mean_C3, entropy_HSL, edge_density,
water_fraction, brightness_std] stored in IndexedDB (~48 bytes/tile).
Tier 2 reuses existing CLIP model for 512D semantic embeddings.

- **Provenance**: Cosine similarity (standard IR metric)
- **CLIP**: Radford et al. 2021 (OpenAI, arXiv:2103.00020)
- **Storage**: IndexedDB via idbStore.js (existing infrastructure)

## External Dependencies — License Audit

| Dependency                         | Version | License                   | AGPL-3.0 Compatible | File                                                    |
| ---------------------------------- | ------- | ------------------------- | ------------------- | ------------------------------------------------------- |
| Transformers.js (Xenova)           | 2.17.2  | MIT                       | Yes                 | segformerDetector.js, mlDetector.js                     |
| Transformers.js (HuggingFace)      | 3.3.3   | MIT                       | Yes                 | samInteractive.js, clipClassifier.js, objectDetector.js |
| SlimSAM (model weights)            | latest  | Apache-2.0 (weights=data) | Yes                 | samInteractive.js                                       |
| CLIP (model weights)               | latest  | MIT (OpenAI)              | Yes                 | clipClassifier.js                                       |
| SegFormer-B0 (model weights)       | latest  | MIT (NVIDIA)              | Yes                 | segformerDetector.js                                    |
| YOLOS-tiny (model weights)         | latest  | Apache-2.0 (weights=data) | Yes                 | objectDetector.js                                       |
| OWL-ViT (model weights)            | latest  | Apache-2.0 (weights=data) | Yes                 | mlDetector.js                                           |
| OpenCV.js                          | 4.9.0   | Apache-2.0                | Yes (permissive)    | vectorization/loader.js                                 |
| Swin2SR (model weights)            | latest  | Apache-2.0 (weights=data) | Yes                 | superResolution.js                                      |
| EfficientNet-lite0 (model weights) | latest  | Apache-2.0 (weights=data) | Yes                 | sceneClassifier.js                                      |

All code wrappers (Transformers.js) are MIT. Model weights are data assets, not
covered by software copyright — Apache-2.0/MIT weights are compatible with AGPL-3.0-only.
segment-geospatial (samgeo) inspired the approach but code is independently implemented.
