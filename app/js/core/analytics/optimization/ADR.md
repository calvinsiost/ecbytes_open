# ADR-023: Budget-Constrained Prescriptive Spatial Optimization

**Status**: Accepted
**Date**: 2026-02-27
**Atualizado:** 2026-03-26
**Author**: Calvin Stefan Iost
**Project**: ECBT — Environmental & Occupational Core Byte Tools

---

## Context

O módulo de interpolação do ECBT (`core/interpolation/`, ADR-002) é restrito
à análise descritiva — gera mapas de concentração estimada, mas não responde
à pergunta prescritiva: **onde alocar a próxima rodada de sondagens para
maximizar a certeza investigativa sem estourar o orçamento?**

Planejadores ambientais necessitam de uma ferramenta que:

1. Respeite restrições orçamentárias (CAPEX + OPEX) como hard constraints.
2. Evite alocações em Zonas de Proteção Ambiental (APPs).
3. Maximize a redução de incerteza geoestatística.
4. Seja agnóstica à família de elementos (poços, sondagens, pontos superficiais).
5. Rode inteiramente client-side, < 30 segundos.

---

## Decision

### 1. Framework de Custos — Nível 2 (Elements) e Nível 3 (Project Roll-up)

#### Nível 2 — Cost per Element (anual, por fiscal year)

Cada `element` recebe `data.costs[]` — array de registros anuais com
estrutura genérica e customizável:

```javascript
element.data.costs = [
    {
        fiscalYear: 2025,
        items: [
            { categoryId: 'capex', itemId: 'drilling', amount: 5250.0, note: '15m × R$350/m' },
            { categoryId: 'capex', itemId: 'installation', amount: 2500.0 },
            { categoryId: 'opex', itemId: 'analytical', amount: 7200.0, note: 'auto-soma readings' },
            { categoryId: 'opex', itemId: 'sampling', amount: 3600.0 },
            { categoryId: 'opex', itemId: 'maintenance', amount: 1200.0 },
            { categoryId: 'opex', itemId: 'travel', amount: 2400.0 },
        ],
        currency: 'BRL',
        basis: 'estimate|budget|actual',
        capexTotal: 7750.0,
        opexTotal: 14400.0,
        total: 22150.0,
    },
];
```

**Agnosticismo de Famílias**: o custo é adaptado dinamicamente por
`element.family`:

- **Poços (well)**: CAPEX completo (perfuração + instalação) + OPEX prolongado
  (analítico + coleta + manutenção + mobilização).
- **Sondagens de solo**: CAPEX focado apenas em trado/sondagem, OPEX futuro
  pode ser zero (amostragem pontual).
- **Águas superficiais (lake/river/spring)**: CAPEX basal sem perfuração,
  topologia exige snap forçado em malha hidrográfica (reverte punição de APPs).
- **Customizável**: categorias e itens de custo são extensíveis pelo usuário
  via `costCatalog.js` (compartilhado com ADR-022, padrão `fieldManager.js`).

#### Nível 3 — Project Roll-up

Agregador global (`core/analytics/economics/costRollup.js`) atrelado ao
`DataTensor` (ADR-005):

- Compila CAPEX projetado + OPEX de campanhas futuras + custos de PMO (gestão)
  contra o Budget Cap do projeto.
- Visualização por Ano Fiscal no Dashboard.
- Suporta escalation rate opcional para projeção OPEX multi-ano:
  `OPEX_year_n = OPEX_base × (1 + escalationRate)^n`.
- Moeda-base global (Single Currency Rule do ADR-022).

### 2. Algoritmo Genético (GA) em Web Worker

#### Rationale: GA vs PSO

GA é preferido para este problema porque:

- **Problema combinatório discreto**: placement de N pontos em grid com
  restrições geométricas é naturalmente codificado como cromossomo de
  comprimento variável.
- **Repair operators**: GA permite operadores de reparo geométrico (snap de
  ponto inválido para dentro do polígono) de forma mais natural que PSO.
- **Penalização de constraints**: tournament selection com penalidades fatais
  é bem estabelecido na literatura de GA constrained.

PSO seria mais adequado para otimização contínua sem restrições geométricas
rígidas.

#### Encoding

Cromossomo: array de `N` genes, cada gene = `{x, z, familyId, depth}`:

```javascript
chromosome = [
    { x: 120.5, z: 340.2, familyId: 'well', depth: 15 },
    { x: 85.0, z: 210.7, familyId: 'well', depth: 12 },
    // ... N pontos candidatos
];
```

`N` é definido pelo usuário (1–20 pontos candidatos).

#### Operadores

- **Selection**: Tournament selection (k=3).
- **Crossover**: Uniforme — cada gene herdado de pai ou mãe com p=0.5.
- **Mutation**: Gaussiana — `x += N(0, σ)`, `z += N(0, σ)`, onde σ decai
  com as gerações (simulated annealing híbrido).
- **Repair**: se ponto mutado cair fora do polígono válido → snap para
  ponto mais próximo na borda (via `turf.nearestPointOnLine` ou projection).
- **Elitism**: top 5% preservados sem alteração.

#### Fitness Function

```
f(chromosome) =
  IF budget_violated OR app_violated → -Infinity
  ELSE → w1 × Cp_improvement + w2 × uncertainty_reduction
```

**Hard Constraints (fatal penalty = -Infinity)**:

1. **Budget Cap**:
   `Σ(CAPEX_i + OPEX_i × horizonYears × (1 + escalationRate)^avg) <= maxBudget`
    - Custos calculados a partir do `costCatalog.js` por família.
    - User define: `maxBudget`, `horizonYears`, `escalationRate`.

2. **APP Exclusion**:
   `turf.booleanPointInPolygon(candidate, appZone) → fatal penalty`
    - Zonas de exclusão: `REFERENCE_ZONES` default + custom zones do usuário
      (ADR-021, `compliance.js`).
    - **Exceção**: pontos de água superficial podem ter snap forçado **dentro**
      de APPs hidrográficas (comportamento esperado para monitoramento de
      nascentes e cursos d'água).

**Objectives (weighted sum)**:

1. `w1 × Cp_improvement`: melhoria de **Completeness** (eixo Cp do EIS,
   ADR-020) usando `computeCpFromCampaigns()`. Cp sobe com preenchimento das
   "zonas de sombra" investigativas.

2. `w2 × uncertainty_reduction`: redução da incerteza geoestatística média na
   área de estudo.

### 3. Proxy de Incerteza — Proteção do Event Loop

#### O Gargalo

Calcular a Matriz de Variância de Krigagem completa (sistema linear NxN) para
cada indivíduo em cada geração esgotaria a CPU. Para pop=100 × gen=500 ×
grid=50×50 = **125 milhões** de avaliações de Kriging.

#### A Solução: Proxy Esparso durante Evolução + Kriging Final

**Durante as gerações do GA** (bulk evaluation):

- A incerteza é estimada por **proxy geométrico**: Diagrama de Voronoi dos
  pontos existentes + candidatos → células Voronoi grandes = alta incerteza.
- Alternativa: **Maximin Distance Design** — maximizar a distância mínima
  entre qualquer candidato e seus vizinhos mais próximos.
- Custo: O(N log N) por indivíduo (Voronoi) vs O(N³) (Kriging). Viabiliza
  SLA < 30s.

**Na última geração** (top-K refinement):

- Os **top 5 indivíduos** são re-avaliados com **Ordinary Kriging Variance**
  completa no grid denso (50×50).
- Implementação própria a partir dos dados de treino `(t, x, y)` — **não
  depende de internals opacos** do variogram da biblioteca CDN.
- Fórmula: `σ²(x₀) = C(0) - Σᵢ λᵢ·C(xᵢ, x₀) - μ`
    - `λᵢ` = pesos Kriging (resolvidos por sistema linear)
    - `C` = função de covariância (gaussian/exponential/spherical)
    - `μ` = multiplicador de Lagrange (Ordinary Kriging constraint)

**Fallback para IDW**: em datasets imaturos (n < 10) onde o variograma não
estabiliza:

- Substitui Kriging por **IDW Inverse Distance Weighting**.
- Fitness usa **Maximin Geometric Design** como proxy de incerteza.
- Cross-validation LOOCV como validação complementar.

### 4. Predictive EIS — Scoring de Cenários Hipotéticos

Para pontos que **ainda não existem**, os 6 eixos do EIS (ADR-020) são
estimados conservadoramente:

| Eixo                   | Estimativa                                                                 | Justificativa                                                          |
| ---------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Cp** (Completeness)  | Calculado ativamente pelo GA                                               | Direcionador master — sobe com preenchimento de lacunas investigativas |
| **T** (Transparency)   | Herda patamar médio do projeto                                             | Premissa: novos dados seguirão o mesmo protocolo de evidência          |
| **Cm** (Comparability) | Herda patamar médio do projeto                                             | Premissa: mesma taxonomia e métodos analíticos                         |
| **A** (Accuracy)       | Cruzamento paramétrico: LQ do ensaio orçado vs. limite regulatório da zona | Se LQ > limite → A rebaixado (ensaio inadequado)                       |
| **Ty** (Timeliness)    | Default: 4 (< 30 dias de latência presumida)                               | Conservador para planejamento                                          |
| **Cs** (Consistency)   | Default: 3 (Neutro)                                                        | Impossível testar outliers em série temporal incipiente (Ano 0)        |

O EIS projetado é uma **estimativa conservadora**, não uma garantia. O ADR
documenta explicitamente esta limitação.

### 5. TDD Determinístico

Algoritmos Genéticos são estocásticos (`Math.random()`). Para testes
determinísticos:

- Injetar **PRNG com seed fixa** (ex: `mulberry32` ou `xorshift128`).
- Todos os testes usam seed fixa → resultados reproduzíveis.
- **Flaky tests estritamente proibidos** na suíte do GA.

### 6. Benchmark Explícito (SLA)

| Parâmetro               | Valor                                                     |
| ----------------------- | --------------------------------------------------------- |
| Grid de avaliação       | 50 × 50 células                                           |
| População GA            | 100 indivíduos                                            |
| Gerações                | 500 (ou stagnation threshold de 50 gerações sem melhoria) |
| Candidatos              | 1–10 poços                                                |
| CPU target              | Laptop i5-1235U (ou equivalente)                          |
| SLA                     | < 30 segundos end-to-end                                  |
| Complexidade bulk       | O(pop × gen × wells × grid) com proxy Voronoi             |
| Complexidade refinement | O(top_K × N³ × grid²) com Kriging full                    |

### 7. Web Worker

- GA loop **blocking** dentro do Worker.
- Comunicação via `postMessage` com `Transferable` objects (Float64Array
  para grid de variância).
- Progress callback a cada geração: `{ generation, bestFitness, convergencePct, elapsedMs }`.
- Cancelamento: `worker.terminate()` se usuário desistir.

### 8. Output Schema

```javascript
{
  wells: [
    {
      x: 120.5, z: 340.2,
      familyId: 'well', depth: 15,
      costs: [
        { categoryId: 'capex', itemId: 'drilling', amount: 5250 },
        { categoryId: 'capex', itemId: 'installation', amount: 2500 },
        { categoryId: 'opex', itemId: 'analytical', amount: 7200 },
        { categoryId: 'opex', itemId: 'sampling', amount: 3600 },
      ],
      capexTotal: 7750,
      opexAnnual: 10800,
      uncertaintyReduction: 0.15,     // Fração de redução de variância
      predictiveEIS: { Cp: 3.8, T: 3.5, A: 4.0, Ty: 4, Cs: 3, Cm: 3.5, eis: 3.62 }
    }
  ],
  summary: {
    totalCapex: 23250,
    totalOpexAnnual: 32400,
    totalCostHorizon: 120450,         // CAPEX + OPEX × horizon × escalation
    budgetRemaining: 29550,
    horizonYears: 3,
    escalationRate: 0.05,
    cpBefore: 2.1,
    cpAfter: 3.8,
    uncertaintyReductionPct: 42,
    generations: 387,
    convergenceMs: 18400,
    proxyUsed: 'voronoi|maximin',     // Qual proxy foi usado no bulk
    krigingRefinement: true            // Se Kriging full rodou nos top-K
  }
}
```

### 9. File Tree

```
core/analytics/optimization/
  ADR.md                    # Este documento
  optimizationWorker.js     # Web Worker: GA loop completo
  geneticAlgorithm.js       # GA engine (selection, crossover, mutation, repair, elitism)
  fitnessFunction.js        # Hard constraints + weighted objective + proxy selector
  krigingVariance.js        # Ordinary Kriging variance (implementação própria)
  voronoiProxy.js           # Proxy geométrico de incerteza (Voronoi / Maximin)
  index.js                  # Public API

core/analytics/economics/
  costRollup.js             # Nível 3: agregador CAPEX+OPEX por projeto/fiscal year
```

### 10. Reuse de Módulos Existentes

| Módulo                                              | Interface Consumida                                   |
| --------------------------------------------------- | ----------------------------------------------------- |
| `core/interpolation/engine.js` (ADR-002)            | Dados de treino `(t, x, y)`, modelo do variograma     |
| `core/eis/eisCalculator.js` (ADR-020)               | `computeCpFromCampaigns()`, perfil médio de qualidade |
| `core/spatial/compliance.js` (ADR-021)              | `REFERENCE_ZONES`, `checkCompliance()`, turf.js PIP   |
| `core/analytics/dataTensor.js` (ADR-005)            | `.getBounds()`, `.byParameter()`                      |
| `core/analytics/statistics.js` (ADR-005)            | `descriptiveStats()`                                  |
| `core/elements/manager.js`                          | `getAllElements()` para rede atual                    |
| `core/ingestion/documents/costCatalog.js` (ADR-022) | Preços de referência compartilhados                   |

### 11. TDD Strategy

| Cenário                      | Validação                                                      |
| ---------------------------- | -------------------------------------------------------------- |
| Kriging variance (sintético) | Dados 2D com solução analítica conhecida → variância match     |
| LOOCV fallback               | Dataset com n < 10 → Kriging fail → IDW + LOOCV ativados       |
| Voronoi proxy                | Grid com 5 pontos → células Voronoi → área máxima identificada |
| Fitness: budget ok           | Cromossomo dentro do budget → fitness > 0                      |
| Fitness: budget violado      | CAPEX + OPEX > maxBudget → fitness = -Infinity                 |
| Fitness: APP violado         | Ponto dentro de APP → fitness = -Infinity                      |
| Repair operator              | Ponto fora do polígono → snap para borda → dentro do polígono  |
| Convergência (seed fixa)     | Problema 2D com ótimo conhecido → GA converge em < 200 gen     |
| Cost model                   | CAPEX + OPEX × horizon × escalation → valor correto            |
| Output schema                | Top indivíduo → `element.data.costs[]` populado corretamente   |
| Performance                  | Benchmark < 30s (grid 50×50, pop 100, gen 500, 5 candidatos)   |
| Determinism                  | Mesma seed → mesmo resultado em 10 execuções consecutivas      |

---

## Scientific Rationale

### Por que Voronoi como Proxy em vez de Kriging Completo?

Kriging Ordinário resolve um sistema linear NxN para cada ponto de predição.
Com N=50 pontos existentes + candidatos, cada avaliação custa O(N³) = O(125K)
operações. Multiplicado por pop=100 × gen=500 × grid=2500 = 125 bilhões de
operações — inviável em < 30s.

Voronoi Tessellation é O(N log N) e captura a noção geoestatística fundamental:
regiões com poucos pontos próximos têm maior incerteza. Na fase de refinamento
(top-K), Kriging completo garante rigor estatístico sobre o resultado final.

Esta abordagem "proxy esparso + refinamento denso" é análoga ao **surrogate-
assisted optimization** bem estabelecido na literatura de engenharia (Jones et
al., 1998 — Efficient Global Optimization).

### Por que GA com Seed Fixa para TDD?

GAs são inerentemente estocásticos (crossover, mutação, seleção). Sem seed
fixa, testes seriam **flaky** — falham intermitentemente sem causa aparente.
Injetar um PRNG determinístico (ex: `mulberry32`) com seed fixa torna o GA
completamente reproduzível para fins de teste, sem afetar a qualidade da busca
em produção (onde `Math.random()` é usado normalmente).

---

## Consequences

### Positivas

- Capacidade prescritiva inédita: recomendação otimizada de alocação de pontos
  com ROI orçamentário instantâneo.
- Agnóstico a famílias de elementos: poços, sondagens, pontos superficiais.
- Escalável: proxy Voronoi mantém SLA < 30s mesmo com grids densos.
- Cost Framework Nível 2+3 completa o ciclo financeiro iniciado no ADR-022.
- TDD determinístico elimina flaky tests.

### Negativas

- Proxy Voronoi é uma aproximação — pode divergir da variância Kriging real
  em cenários com anisotropia forte.
- Predictive EIS usa premissas conservadoras — pode subestimar ou superestimar
  a qualidade real dos dados futuros.
- Implementação própria de Kriging Variance exige validação rigorosa contra
  referências acadêmicas.

---

## Related ADRs

- **ADR-002** (Interpolation) — Kriging training data, variogram model
- **ADR-004** (Validation) — Regulatory limits for accuracy scoring
- **ADR-005** (Analytics) — DataTensor structure, statistics
- **ADR-020** (EIS) — EIS calculator, Cp computation, quality profile
- **ADR-021** (Spatial) — Compliance zones, turf.js, APP exclusion
- **ADR-022** (Document Ingestion) — Cost Framework Nível 1, costCatalog.js

---

## Implementation Status (Phase 1 — GA Foundation)

**Date**: 2026-03-02

Phase 1 implementa o escopo reduzido como stepping stone para RL (Phase 2):

| Componente                     | Status         | Notas                                                                             |
| ------------------------------ | -------------- | --------------------------------------------------------------------------------- |
| `geneticAlgorithm.js`          | Implemented    | Tournament, uniform crossover, Gaussian mutation, elitism, mulberry32 PRNG        |
| `fitnessFunction.js`           | Implemented    | Budget + APP hard constraints, uncertainty + cost soft objectives                 |
| `uncertaintyProxy.js`          | Implemented    | IDW K=5 nearest neighbor distance proxy (substitui Voronoi)                       |
| `optimizationWorker.js`        | Implemented    | Web Worker com progress callbacks e cancellation                                  |
| `index.js`                     | Implemented    | Public API: `runOptimization()`, `runOptimizationAsync()`, `cancelOptimization()` |
| Handler + UI Modal             | Implemented    | `handlers/optimization.js`, ribbon button, i18n pt/en/es                          |
| `krigingVariance.js`           | **Deferred**   | Phase 2 — Kriging variance refinement nos top-K                                   |
| `voronoiProxy.js`              | **Deferred**   | Phase 2 — IDW distance proxy é suficiente para Phase 1                            |
| Predictive EIS                 | **Deferred**   | Phase 2 — Requer integração profunda com eisCalculator                            |
| Repair operator (Voronoi snap) | **Simplified** | Usa clamp nos bounds em vez de snap no polígono                                   |

### Decisões de Phase 1

1. **IDW Distance vs Voronoi**: Média das distâncias aos K=5 vizinhos mais próximos
   normalizada pela diagonal do bbox. Captura a mesma intuição geoestatística
   (longe de pontos = alta incerteza) com complexidade O(N×K) vs O(N log N).

2. **Main thread fallback**: Se Web Worker falhar (CSP, mobile), execução degrada
   para main thread automaticamente sem perda de funcionalidade.

3. **Seed = Date.now()**: Em produção usa timestamp como seed para variação.
   Testes usam seed fixa para determinismo.

## Academic References

All optimization algorithms implemented in this module are based on published
academic literature. No proprietary algorithms (e.g., DrillGuide by C-Tech)
or commercial software code was used. Independent implementation in vanilla JS.

- **Genetic Algorithms**: Holland, J.H. (1975). "Adaptation in Natural and
  Artificial Systems." University of Michigan Press.
- **GA for optimization**: Goldberg, D.E. (1989). "Genetic Algorithms in Search,
  Optimization, and Machine Learning." Addison-Wesley. ISBN 0-201-15767-5.
- **Tournament selection**: Miller, B.L. & Goldberg, D.E. (1995). "Genetic
  Algorithms, Tournament Selection, and the Effects of Noise." Complex Systems, 9.
- **Spatial sampling optimization**: van Groenigen, J.W. & Stein, A. (1998).
  "Constrained Optimization of Spatial Sampling using Continuous Simulated
  Annealing." J. Environ. Quality, 27(5), 1078-1086.
- **Kriging variance as objective**: Brus, D.J. & Heuvelink, G.B.M. (2007).
  "Optimization of sample patterns for universal kriging." Geoderma, 138, 86-95.
