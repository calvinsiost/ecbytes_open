# ADR — Well Family Module (Perfil Construtivo e Litológico)

## Status

Accepted (2026-02-27)
**Atualizado:** 2026-03-26

## Context

O ECBT precisa de visualização avançada de perfis de poço de monitoramento — incluindo perfil construtivo (revestimento, filtro, selo de bentonita, pré-filtro), perfil litológico (camadas de solo com padrões ABGE), leituras de VOC e nível d'água. O projeto de referência WellProfile-main (React/Vite/Tailwind) foi usado como fonte de regras de negócio.

## Decisions

### D1: SVG over Canvas

**Escolha**: SVG manipulado via JS (document.createElementNS).
**Razão**: Qualidade vetorial para impressão/PDF, DOM acessível para leitores de tela e automação, padrões `<defs>` nativos para hachuras geológicas, sem scaling de pixel density. Canvas descartado por não ser inspecionável e dificultar export PDF.

### D2: Data Model — `element.data.profile`

**Escolha**: Dados do perfil vivem em `element.data.profile`, opaco para o core ECBT.
**Estrutura**:

```js
{
    constructive: {
        totalDepth: number,         // Profundidade total do poço (m)
        drillingDepth: number,      // Profundidade da sondagem (m)
        boreholeDiameter: number,   // Diâmetro do furo (pol)
        casingDiameter: number,     // Diâmetro do revestimento (pol)
        drillingMethod: string,     // Método de perfuração
        elements: [{                // Elementos construtivos
            type: string,           // surface_completion | cement_seal | bentonite_seal | ...
            topDepth: number,
            bottomDepth: number,
            properties: {}
        }]
    },
    lithologic: [{
        from: number,               // Profundidade topo (m)
        to: number,                 // Profundidade base (m)
        soilType: string,           // clay | sand | silt | gravel | rock | ...
        description: string,        // Descrição livre
        classification: string,     // SUCS ou ABGE
        color: string,              // Cor do solo
        moisture: string,           // dry | moist | saturated | ...
        observations: string
    }],
    waterLevel: {
        depth: number,              // Profundidade do NA (m)
        date: string                // Data da medição (ISO-8601)
    } | null,
    vocReadings: [{
        depth: number,              // Profundidade (m)
        value: number               // PPM
    }]
}
```

### D3: Migration from Legacy Format

**Escolha**: `migrateData()` detecta `element.data.lithology` (formato de `normalizeBoreholeToWell()` em `core/validation/borehole.js`) e converte automaticamente para `element.data.profile` na primeira abertura. Migração é não-destrutiva — dados legados permanecem intactos.

### D4: Validation Compatibility

**Escolha**: `validation.js` implementa regras compatíveis com `borehole.js` (`_validateIntervals`, `_validatePoints`). Tolerância de gaps: EPSILON = 1e-6 (float comparison). Regras: profundidade do poço ≤ sondagem, camadas contínuas sem gaps, filtro dentro da profundidade, pré-filtro envelopa filtro.

### D5: CSS Isolation via Namespace

**Escolha**: Prefixo `.ecbt-fm-well` para todos os seletores. CSS injetado via `<style id="ecbt-fm-well-styles">` no `<head>` (idempotente). Usa CSS variables globais (`--neutral-*`, `--radius-sm`) para consistência visual.

### D6: Rendering Scale

**Escolha**: 10 pixels por metro (`SCALE_PX_PER_METER = 10`). Layout SVG: VOC (80px) | Escala de Profundidade (40px) | Litologia (120px) | Construtivo (200px). ViewBox dinâmico baseado na profundidade total. Zoom via manipulação de viewBox (sem re-render).

### D7: Soil Pattern Standard

**Escolha**: 20+ padrões SVG seguindo norma ABGE (Associação Brasileira de Geologia de Engenharia). Padrões definidos como strings no `constants.js`, injetados como `<defs>` em cada SVG criado. Não são arquivos externos (evita requests extras no zero-build setup).

### D8: UI Trigger — Button + Picker + Modal (not inline)

**Escolha**: Sub-módulo NÃO é montado inline no details panel. Em vez disso:

1. Botão "layers" aparece no element card (ao lado de eye/x) para famílias com módulos registrados
2. Clique abre um picker popover listando sub-módulos disponíveis (se >1; se =1 abre direto)
3. Sub-módulo monta dentro de um modal dedicado (900px max-width, 90vh max-height)
4. Modal usa `modal-overlay.active` pattern existente do ECBT
   **Razão**: Sub-módulos precisam de espaço significativo (SVG com múltiplas colunas). Inline no sidebar é estreito demais. Modal dá espaço e foco ao usuário. Picker permite múltiplos sub-módulos por família (ex: perfil geológico, inspeção fotográfica).

## Consequences

- Primeiro módulo plugável — estabelece o padrão para todas as futuras famílias
- SVG exportável nativamente para relatórios PDF (via `exportSVG()`)
- Dados do perfil preservados no ECO1 export/import sem mudanças no encoder
- Memory leaks prevenidos pelo AbortController da classe base FamilyModule
- Uma família pode ter N sub-módulos independentes (registry aceita múltiplos descriptors por familyId)
