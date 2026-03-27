# ADR-024: Cost Roll-up & Analysis Dashboard

**Status**: Accepted
**Date**: 2026-02-28
**Atualizado:** 2026-03-26
**Author**: Calvin Stefan Iost
**Project**: ECBT — Environmental & Occupational Core Byte Tools

---

## Context

O ECBT possui um Cost Framework em 4 níveis (ADR-022 / ADR-023):

- **L1 Reading**: `observation.cost` — preço do ensaio analítico
- **L2 Element**: `element.data.costs[]` — CAPEX+OPEX por ano fiscal
- **L3 Campaign**: `campaign.costs` — mobilização, logística, coleta
- **L4 Project**: `wbsItems[]` — WBS + EVA em `governance/wbsManager.js`

Os dados existem mas estão **dispersos** nos painéis de detalhe. Não há
agregação global que permita ao usuário visualizar o panorama financeiro
do projeto, comparar CAPEX vs OPEX por ano, ou identificar onde os custos
se concentram.

O ADR-023 §1 previu `core/analytics/economics/costRollup.js` como
agregador global atrelado ao DataTensor, mas nunca foi implementado.

---

## Decision

### 1. Agregação sob demanda (não cacheada)

`buildCostRollup()` itera sobre todos os elementos e campanhas a cada
chamada. Para o tamanho esperado dos modelos ecbyts (< 500 elementos,
< 50 campanhas), o custo computacional é negligível (< 5ms).

Cache estático introduziria complexidade de invalidação sem benefício
mensurável. Se futuramente o dataset crescer, podemos adicionar
memoização com hash de versão do modelo.

### 2. Single Currency Rule

Segue ADR-022: todos os valores são retornados na moeda-base do
`costCatalog.js` (`getCurrency()`). Não há conversão cambial.

### 3. Separação L1 vs L2

L1 (observation.cost) e L2 (element.data.costs) podem ter sobreposição
parcial (o custo analítico L1 pode estar incluído no OPEX L2). O rollup
reporta ambos separadamente e permite ao dashboard exibir a visão
que o usuário preferir.

### 4. Projeção multi-ano

`projectCosts()` usa escalação simples:
`OPEX_year_n = OPEX_base × (1 + escalationRate)^n`

A `escalationRate` vem do `costCatalog.js` (default: 0).

---

## Consequences

- **Positivo**: Dashboard consolidado com KPIs, gráficos e tabelas
- **Positivo**: Reutiliza 100% dos dados existentes (L1-L4)
- **Positivo**: Zero dependências novas (Chart.js já carregado)
- **Negativo**: Sem cache → recalcula a cada render (aceitável p/ < 500 elementos)
- **Futuro**: Se necessário, adicionar memoização baseada em model version hash
