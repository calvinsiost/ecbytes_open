# ADR-021: SpatialBlueprint — CAD/GIS Vector Ingestion Pipeline

**Status**: Accepted
**Date**: 2026-02-25
**Atualizado:** 2026-03-26
**Author**: Calvin Stefan Iost
**Project**: ECBT — Environmental & Occupational Core Byte Tools

---

## Context

Engenheiros ambientais frequentemente recebem plantas CAD (DXF) de sites contaminados,
lotes industriais e areas de preservacao. Esses arquivos contem geometrias "visuais" —
linhas soltas, polilinhas abertas, layers bagunçados — que NAO sao poligonos validos
para calculo de area ou analise de compliance.

O modulo SpatialBlueprint resolve isso com um pipeline defensivo que transforma
dados CAD amadores em geometrias topologicamente validas, calcula metricas em CRS
metrico e verifica compliance ambiental via overlay fisico.

---

## Decision

### 1. As 4 Regras de Ouro

#### Regra 1 — Defesa contra CAD Amador (A Ilusao do Poligono)

Arquitetos quase nunca desenham poligonos perfeitamente fechados no AutoCAD.
O parser DXF NAO busca apenas `LWPOLYLINE` com flag `closed`. Coleta tambem
linhas soltas (`LINE` e `LWPOLYLINE` abertas) e usa JSTS `Polygonizer` seguido
de `UnaryUnionOp` para costurar e recuperar areas reais.

#### Regra 2 — O Paradoxo da Simplificacao e Calculo de Area

NUNCA simplificar ou calcular area enquanto a geometria estiver em CRS geografico
(graus). O pipeline segue a ordem exata:

```
(A) Receber CRS original (ex: EPSG:31983)
(B) Projetar para UTM metrico local (auto-detectado)
(C) Simplificar em metros (Douglas-Peucker) e calcular area em m2
(D) Reprojetar resultado para EPSG:4326 (WGS84)
```

#### Regra 3 — Compliance Livre de Falsos-Positivos

NUNCA usar predicados booleanos como `.intersects()`. Flutuacoes milimetricas
de reprojecao geram toques de borda indesejados. Usa-se overlay fisico via
`turf.intersect()` e verifica-se a area real da intersecao contra um limiar
minimo (1 m2 default) antes de declarar nao-conformidade.

#### Regra 4 — Auto-Cura Topologica

Poligonos invalidos (auto-intersecoes, "borboletas") sao curados
automaticamente via `buffer(0)` (JSTS) antes de qualquer calculo.
A area final validada deve ser estritamente `> 0`.

### 2. Stack JavaScript (adaptado de Python)

| Necessidade   | Python original           | JS equivalente         | CDN                     |
| ------------- | ------------------------- | ---------------------- | ----------------------- |
| DXF parsing   | ezdxf                     | Parser custom (texto)  | Nenhum                  |
| Polygonize    | Shapely `polygonize`      | JSTS `Polygonizer`     | esm.sh/jsts@2.7.1       |
| Union         | Shapely `unary_union`     | JSTS `UnaryUnionOp`    | (mesmo)                 |
| make_valid    | Shapely `make_valid`      | JSTS `buffer(0)`       | (mesmo)                 |
| CRS transform | pyproj                    | proj4js                | esm.sh/proj4@2.12.1     |
| Overlay       | GeoPandas `overlay`       | turf.js `intersect`    | esm.sh/@turf/turf@7.1.0 |
| Area calc     | Shapely `.area` (metrico) | Shoelace formula       | Nenhum                  |
| Simplify      | Shapely `simplify`        | Douglas-Peucker custom | Nenhum                  |
| Validation    | Pydantic v2               | Validacao inline       | Nenhum                  |

### 3. Pipeline de Processamento (7 estagios)

```
DXF File Upload
    |
[1. PARSE]      dxfParser.js — LINE, LWPOLYLINE, POLYLINE por layer
    |
[2. POLYGONIZE] topology.js — JSTS Polygonizer + UnaryUnionOp
    |
[3. SELF-HEAL]  topology.js — buffer(0), validacao, remocao degenerados
    |
[4. PROJECT]    projection.js — CRS fonte -> UTM metrico (proj4)
    |
[5. SIMPLIFY]   projection.js — Douglas-Peucker em metros + area em m2
    |
[6. COMPLIANCE] compliance.js — Overlay fisico com zonas de referencia
    |
[7. OUTPUT]     processor.js — Reprojetar WGS84, gerar GeoJSON, criar elemento
```

### 4. Carregamento Lazy de Libs

Mesmo padrao de `core/interpolation/engine.js`:

- Libs CDN carregadas sob demanda via `import('https://esm.sh/...')`
- Cache em variavel de modulo (`let _jsts = null`)
- Fallback com mensagem de erro se conexao falhar

### 5. Compliance Zones

Zonas de referencia seguem legislacao ambiental brasileira:

- **APP** (CONAMA 303/2002): Area de Preservacao Permanente — 30m default
- **Risk** (CONAMA 420/2009): Zona de risco de contaminacao — 50m default
- **Buffer** (CONAMA 369/2006): Faixa de protecao ambiental — 100m default

### 6. Integracao com ecbyts

- Element Family `blueprint` registrada em `config.js` (code: `'U'`)
- Mesh 3D: poligono extrudado com outline (baseado em `createBoundaryMesh`)
- Import/Export: dados vivem em `element.data` (serializado automaticamente)
- Handler: `handlers/spatial.js` com modal wizard de 3 passos
- GeoJSON export: suportado via `io/formats/geojson.js`

---

## Scientific Rationale

O paradoxo da simplificacao e um problema conhecido em GIS: algoritmos como
Douglas-Peucker com tolerancia de 0.5 graus destroem geometrias (0.5 graus
= ~55 km no equador). A projecao para UTM antes da simplificacao garante que
a tolerancia seja em metros, preservando a fidelidade geometrica.

O overlay fisico vs predicado booleano e uma pratica recomendada pela OGC
(Open Geospatial Consortium) para analises de compliance, onde falsos positivos
por ruido numerico de reprojecao sao inaceitaveis.

Referencias:

- ISO 19107:2019 — Spatial schema
- OGC Simple Features Access (SFA) — Part 1: Common architecture
- CONAMA 303/2002 — Parametros de APP em corpos hidricos
- CONAMA 420/2009 — Valores orientadores para solo e agua subterranea
- RFC 7946 — The GeoJSON Format

---

## Consequences

**Habilita:**

- Importacao de plantas CAD reais (AutoCAD, QGIS) com tolerancia a erros
- Calculo de area com precisao metrica (UTM)
- Verificacao automatica de compliance com zonas ambientais
- Exportacao GeoJSON RFC 7946 para integracao com GIS externos
- Visualizacao 3D do footprint do site no digital twin

**Custo:**

- 3 libs CDN adicionais (~830 KB total, carregadas sob demanda)
- Parser DXF limitado a LINE/LWPOLYLINE/POLYLINE (sem suporte a HATCH, SPLINE, etc.)
- Compliance requer zonas de referencia GeoJSON (input do usuario)

**Nao faz:**

- Nao renderiza DXF completo (layers complexos, blocos, dimensoes)
- Nao substitui software GIS profissional (QGIS, ArcGIS)
- Nao faz geocodificacao automatica (CRS deve ser informado pelo usuario)

---

## Related ADRs

- ADR-004: Validation (CONAMA/CETESB) — compliance ambiental
- ADR-012: IO/Export (GeoJSON format) — saida padrao
- ADR-015: Interpolation — padrao de lazy loading CDN
