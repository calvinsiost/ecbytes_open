# ADR-022: Cost-Aware Neuro-Symbolic Document Ingestion

**Status**: Accepted
**Date**: 2026-02-27
**Atualizado:** 2026-03-26
**Author**: Calvin Stefan Iost
**Project**: ECBT — Environmental & Occupational Core Byte Tools

---

## Context

O ECBT possui um pipeline maduro para dados estruturados (`core/ingestion/`,
ADR-018) — EDD, CSV, XLSX — mas não suporta relatórios laboratoriais
não-estruturados (PDF/DOCX), que são o formato predominante entregue por
laboratórios ambientais no Brasil e na América Latina.

Adicionalmente, o ecossistema carece de um modelo de custos associado aos dados
analíticos. Consultorias e órgãos reguladores necessitam rastrear o custo por
ensaio para orçamentação de campanhas, auditoria financeira e alimentação do
módulo de otimização espacial (ADR-023).

### Restrições Inegociáveis

1. **Zero Server** — todo o processamento roda no navegador.
2. **Zero Build Step** — sem webpack, bundlers ou scripts de geração.
3. **LLMs Generativos Banidos** — para extração de dados numéricos. Risco
   inaceitável de alucinação em dados ambientais regulados.
4. **Human-in-the-Loop Obrigatório** — leituras com confiança < 100% exigem
   revisão humana antes de ingressar no modelo.

---

## Decision

### 1. Cost Framework — Nível 1 (Readings)

Cada `observation` recebe um campo `cost`:

```javascript
observation.cost = {
    items: [
        { categoryId: 'opex', itemId: 'analytical', amount: 150.0 },
        { categoryId: 'opex', itemId: 'sampling', amount: 45.0 },
    ],
    total: 195.0,
    currency: 'BRL', // Moeda-base global do projeto
    source: 'catalog|document|user',
    catalogRef: 'benzene', // Ref no catálogo (se source=catalog)
    invoiceRef: null, // Ref de NF (se source=document|user)
};
```

**Single Currency Rule**: o sistema impõe uma moeda-base global no projeto. Se
o documento extraído contiver moeda divergente, o usuário deve converter
manualmente — protege cálculos agregados do Nível 3 (Roll-up Financeiro,
ADR-023).

**Cost Catalog** (`costCatalog.js`): tabela offline de preços de referência por
parâmetro/ensaio. Segue o padrão `fieldManager.js` — defaults estáticos +
overrides do usuário em `localStorage('ecbyts_cost_catalog')` (Category B,
preservado em version changes). O catálogo é totalmente customizável:
categorias, itens, preços, moeda.

### 2. Pipeline de Ingestão — 4 Camadas

O pipeline inteiro roda dentro de um **Web Worker** (`documentWorker.js`) para
não bloquear o Event Loop da UI.

#### Camada 1 — Raw Extraction

**PDF** (`pdfjs-dist` via CDN, lazy-loaded):

- Extrai text items com bounding boxes `(x, y, width, height, page)`.
- Clustering espacial **adaptativo** para reconstrução de tabelas:
    - Calcula `meanLineSpacing` = espaçamento médio entre linhas de texto na página.
    - Threshold de agrupamento por linha = `meanLineSpacing × 0.3`.
    - Agrupa itens por Y (linhas), ordena por X (colunas).
    - Se `meanLineSpacing` não calculável (poucos itens), fallback para 3 user-space
      units como default.
- **Table Reconstruction Confidence Score**: métrica 0.0–1.0 baseada em
  regularidade da grade, coerência de alinhamento e completude de células.
  Se < 0.6 → bloco marcado para **quarentena manual** (não tenta adivinhar).

**DOCX** (`mammoth.js` via CDN, lazy-loaded):

- mammoth.js converte OOXML → HTML limpo.
- **Workaround Web Worker**: Workers não têm `DOMParser`. O HTML gerado pelo
  Mammoth é analisado via Regex pura para extrair `<table>`, `<tr>`, `<td>`.
  Regex é suficiente porque o output do Mammoth é HTML sanitizado e previsível
  (sem atributos arbitrários, sem nesting complexo).
- Se mammoth.js indisponível → fallback para parser XML manual simplificado
  (só tabelas `<w:tbl>` simples, sem merge cells).

**SLA**: < 15 segundos para PDF de 50 páginas (**pós-cache** de bibliotecas).
Primeiro uso: progress bar com estimativa de download.

#### Camada 2 — Deterministic Anchoring (Name-First + Regex)

**Âncora primária: NOME do parâmetro** — relatórios laboratoriais brasileiros
raramente incluem CAS numbers.

Dicionário offline `paramAliases.js`:

- ~200 substâncias ambientais comuns com nomes PT-BR, EN, ES + sinônimos +
  abreviações + nomes comerciais.
- Fontes: `CONFIG.PARAMETERS` existente (~80 parâmetros), normas públicas
  (CONAMA 420/2009, CETESB 2021, EPA Method Series, WHO Guidelines) — todas
  de domínio público.
- **Nota de Compliance**: a API CAS Common Chemistry foi descartada como fonte
  automatizada devido à licença CC-BY-NC 4.0, incompatível com uso comercial
  do ECBT. O dicionário é curado manualmente.
- **Extensível pelo usuário**: segue padrão `fieldManager.js` — o usuário pode
  adicionar aliases customizados via modal, persistidos em localStorage.
- Lookup: normaliza input (lowercase, trim, remove acentos) → busca exata no
  hashmap → confidence **green**.

**Âncora secundária: CAS Regex** `/\b\d{2,7}-\d{2}-\d\b/g`:

- Quando presente no documento, cross-referencia com `validateCASFormat()` e
  `CAS_TO_PARAM` do `mapper.js`.
- Confidence **green** se CAS validado e mapeado.

**Regex de Valores**:

- LQ/ND: `/(<|>|≤|≥|ND|LQ|n\.d\.|n\.a\.)\s*(\d+[.,]\d+)?/i`
- Separa operador do valor numérico.
- Trata vírgula como separador decimal (padrão brasileiro).

**Unidades**: normaliza via `UNIT_MAP` existente em `ingestion/mapper.js`.

#### Camada 3 — Semantic Matcher (Progressive Degradation)

Ativada **apenas** para nomes não resolvidos na Camada 2.

**Primary**: `@xenova/transformers` WASM com modelo `all-MiniLM-L6-v2` (~22MB):

- Cosine similarity contra embeddings pré-computados do catálogo de parâmetros.
- **Cache API nativa** do navegador para persistir o blob do modelo
  (abandonando IndexedDB — Cache API é mais eficiente para blobs grandes e
  sobrevive a clear de localStorage).
- **Consentimento explícito**: antes do primeiro download, popup informando o
  tamanho (~22MB) e pedindo opt-in. Se recusado → fallback direto, sem download.

**Fallback**: Levenshtein distance:

- Ativado se: `navigator.deviceMemory < 4`, ou WASM falhar, ou usuário recusar
  download do modelo.
- Calcula distância de edição normalizada contra todos os aliases do catálogo.
- Threshold: score ≥ 0.8 → match. 0.6–0.8 → sugestão para revisão humana.

**Confidence**: **yellow** (match semântico — sempre requer confirmação humana).

**LLMs remotos/generativos**: sumariamente banidos do pipeline de extração
numérica. Risco de alucinação em dados ambientais regulados é inaceitável.
LLMs podem ser usados apenas para classificação/sugestão de mapeamento
(não-numérico), como já faz o `mapWithAI()` do ADR-018.

#### Camada 4 — Staging + Cost

**Staging Object** (por leitura extraída):

```javascript
{
  parameterId: 'benzene',           // Resolvido nas camadas 2-3
  value: 0.05,                      // Numérico extraído na camada 1-2
  unit: 'mg/L',                     // Normalizado via UNIT_MAP
  operator: '<',                    // Operador LQ/ND extraído na camada 2
  confidence: 'green|yellow|red',   // Classificação por cor
  source: {                         // Rastreabilidade no documento
    page: 3,
    x: 120,
    y: 340,
    text: 'Benzeno < 0,05 mg/L'     // Texto original (audit trail)
  },
  cost: {                           // Nível 1 Cost Framework
    items: [
      { categoryId: 'opex', itemId: 'analytical', amount: 150.00 }
    ],
    total: 150.00,
    currency: 'BRL',
    source: 'catalog',              // 'catalog' | 'document' | 'user'
    catalogRef: 'benzene'
  },
  catalogVersionHash: 'v1.0'        // Hash do catálogo para reprodutibilidade
}
```

**Classificação por cor**:

- **Green**: match exato na tabela de-para OU CAS validado. Auto-ingestão
  permitida (mas revisável).
- **Yellow**: match semântico (transformer ou Levenshtein). Bloqueado para
  revisão humana.
- **Red**: sem match, valor inválido, unidade não reconhecida, ou Table
  Confidence < 0.6. Bloqueado para revisão humana.

**Auto-fill de custo**: se o PDF contém tabela de preços → extrai com
`source:'document'`. Senão → preenche do `costCatalog.js` com
`source:'catalog'`. Usuário pode editar qualquer valor (`source:'user'`).

### 3. File Tree

```
core/ingestion/documents/
  ADR.md                  # Este documento
  documentWorker.js       # Web Worker: PDF/DOCX extraction + clustering
  spatialCluster.js       # Clustering adaptativo para reconstrução de tabelas
  paramAliases.js         # De-para curado: nomes PT/EN/ES + sinônimos → parameterId
  regexAnchors.js         # CAS, LQ/ND, unit regex engines
  semanticMatcher.js      # Transformer (consent-gated) + Levenshtein fallback
  costCatalog.js          # Catálogo genérico de custos (defaults + user overrides)
  staging.js              # Builder de staging objects + confidence classifier
  index.js                # Public API
```

### 4. Reuse de Módulos Existentes

| Módulo                               | Interface Consumida                              |
| ------------------------------------ | ------------------------------------------------ |
| `core/validation/rules.js` (ADR-004) | `validateCASFormat()`, `getSubstanceInfo()`      |
| `core/ingestion/mapper.js` (ADR-018) | `CAS_TO_PARAM`, `resolveUnit()`, `UNIT_MAP`      |
| `core/units/converter.js` (ADR-006)  | `convert()`, `getConversionFactor()`             |
| `config.js`                          | `CONFIG.PARAMETERS` (catálogo de ~80 parâmetros) |
| `utils/storage/storageMonitor.js`    | Padrão localStorage Category B                   |

### 5. TDD Strategy

| Cenário                | Validação                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `paramAliases` lookup  | Nome PT-BR ("Benzeno"), EN ("Benzene"), sinônimo ("Xilenos Totais"), abreviação ("TCE") → `parameterId` correto                        |
| User alias extension   | Alias adicionado pelo usuário via localStorage → funciona no lookup                                                                    |
| CAS regex              | CAS válido (`71-43-2`), inválido (`999-99-9`), sem checksum → resultado correto                                                        |
| LQ/ND regex            | `<0,05`, `>10.5`, `ND`, `n.d.`, `LQ 0,01`, `≤0.5` → operador + valor separados                                                         |
| Clustering adaptativo  | Threshold auto-calculado a partir de `meanLineSpacing`; tabela 3×3, rotacionada, multi-coluna                                          |
| Table Confidence Score | Score < 0.6 → quarentena; Score ≥ 0.8 → auto-parse                                                                                     |
| Semantic degradation   | Force WASM fail → Levenshtein path; user recusa download → skip transformer                                                            |
| Cost auto-fill         | Reading sem preço no PDF → preenche do catálogo (`source:'catalog'`); com preço → `source:'document'`; user override → `source:'user'` |
| DOCX Regex parser      | HTML output do Mammoth com tabelas simples e mescladas → extração correta                                                              |
| Performance            | < 15s com PDF 50 páginas (pós-cache)                                                                                                   |

---

## Scientific Rationale

### Por que Name-First em vez de CAS-First?

Relatórios laboratoriais brasileiros seguem formatos da ABNT e INMETRO que
priorizam nome do analito, não CAS number. Em amostra de 50 relatórios reais
(CETESB, CONAMA, ALS, Eurofins), < 15% incluem CAS na tabela de resultados.
A estratégia CAS-first teria recall < 20%.

### Por que Transformer antes de Levenshtein?

Sentence-BERT (all-MiniLM-L6-v2) captura semântica: "Xilenos Totais" ↔
"Total Xylenes" ↔ "xylenes" mesmo sem overlap lexical. Levenshtein falha
nesses casos (distância alta). Porém, o modelo de 22MB é pesado para
dispositivos de campo — daí a progressive degradation com consent gate.

### Por que Cache API em vez de IndexedDB?

Cache API é otimizada para blobs grandes (model weights), opera com
`Request`/`Response` objects eficientes em memória, e é a API nativa usada
por Service Workers para caching de assets. IndexedDB exige serialização
adicional para blobs e tem overhead de transações.

---

## Consequences

### Positivas

- Ingestão autônoma de relatórios laboratoriais com rastreabilidade de custos.
- Pipeline determinístico (camadas 1-2) cobre ~85% dos parâmetros sem rede.
- Cost Framework Nível 1 alimenta diretamente o ADR-023 (otimização espacial).
- SLA de < 15s viável com caching agressivo.

### Negativas

- Exige curadoria manual contínua do `paramAliases.js` (sem API automatizada).
- Primeiro uso tem latência alta (~22MB download se transformer aceito).
- Regex parser para DOCX no Worker é limitado a tabelas simples do Mammoth
  (não cobre edge cases de OOXML complexo como tabelas aninhadas).

---

## Related ADRs

- **ADR-004** (Validation) — CAS format validation, regulatory limits
- **ADR-006** (Units) — Unit conversion consumed by the pipeline
- **ADR-018** (Ingestion) — Existing structured pipeline, mapper, UNIT_MAP
- **ADR-023** (Optimization) — Consumes Cost Framework Nível 1 for budget constraints
