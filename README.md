# ecbytes_open

**Environmental Digital Twins** — Open-source platform for 3D modeling of
environmental monitoring sites with temporal observation data, scientific
analytics, ML-powered recognition, and blockchain-backed data integrity.

## Quick Start

```bash
npx serve
# Open http://localhost:3000
```

## What's inside

```
app/js/
  core/              # Scientific modules (30 areas)
    analytics/       # Statistics, Mann-Kendall, predictions, economics
    audit/           # Benford analysis, greenwashing detection
    crypto/          # SHA-256, ECDSA, Merkle trees, hash chains
    eis/             # EnviroTech Integrity Score (TCCCA+T framework)
    elements/        # PDPL-U element families, mesh factory
    ingestion/       # EDD/XLSX/CSV import, PDF/DOCX analysis
    interpolation/   # IDW, RBF, Kriging, terrain, isosurfaces
    io/              # ECO1 encoder/decoder, import/export
    llm/             # Multi-provider AI client (bring your own key)
    nn/              # Neural networks, training, what-if analysis
    recognition/     # ML vision, SAM, SLIC, YOLOS
    validation/      # CONAMA/CETESB compliance engine
    voxel/           # 3D subsurface modeling
  utils/             # UI and infrastructure
```

## Contributing

Issues and pull requests are welcome. See [LICENSE](LICENSE) for terms.
