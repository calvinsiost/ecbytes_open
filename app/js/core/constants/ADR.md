# ADR — User Constants Module

**Status:** Accepted
**Date:** 2026-03-12
**Atualizado:** 2026-03-26
**Module:** `core/constants/`

---

## Contexto

Engenheiros ambientais aplicam frequentemente fatores fixos nos seus cálculos:
fatores de emissão, incertezas de equipamento, limites de detecção, coeficientes
de conversão, etc. Sem um registro centralizado, esses valores são inseridos
manualmente cada vez, sem rastreabilidade e sem vinculação às métricas da calculadora.

---

## Decisão

Criar um módulo `core/constants/manager.js` com:

1. **Registro de constantes** com campos: `name`, `symbol`, `value`, `unitId`,
   `category`, `description`, `source`, `isDemo`.
2. **Persistência Category B** (`ecbyts_user_constants`) — dados criados pelo usuário,
   equivalentes a `ecbyts_custom_parameters` e `ecbyts_custom_units`.
3. **Integração com ECO1** — campo `userConstants` no topo do modelo ECO1 v2+.
4. **Integração com calculadora** — campo `postProcessing` (array de ops) nos itens
   de métrica do `core/calculator/engine.js`.
5. **Validação rigorosa** em `validateConstant()` antes de qualquer escrita.

---

## Schema da Constante

```js
{
  id: string,           // UUID gerado por generateId()
  name: string,         // max 120 chars
  symbol: string,       // /^[A-Za-z_][A-Za-z0-9_]*$/, max 32 chars, único
  value: number,        // Number.isFinite(v) obrigatório
  unitId: string,       // de CONFIG.UNITS — pode ser "" para adimensional
  category: string,     // emission | uncertainty | equipment | conversion | custom
  description: string,  // texto livre, max 500 chars
  source: string,       // referência bibliográfica, max 200 chars
  isDemo: boolean,      // true se gerado por generateRandomConstants()
  createdAt: string,    // ISO 8601
  updatedAt: string     // ISO 8601
}
```

---

## Regras de Validação

| Campo    | Regra                                             |
| -------- | ------------------------------------------------- |
| `name`   | Obrigatório, trim, max 120 chars                  |
| `symbol` | Obrigatório, `/^[A-Za-z_][A-Za-z0-9_]*$/`, max 32 |
| `symbol` | Único no registro — **case-sensitive**            |
| `value`  | Obrigatório, `Number.isFinite()` — sem NaN/Inf    |

**Decisão: `symbol` case-sensitive.**
Símbolos científicos e de engenharia são case-sensitive por convenção:
`CO2` ≠ `co2`, `EF_CO2` ≠ `EF_co2`. Padronização lowercase ou uppercase é
responsabilidade do engenheiro.

---

## Integração com Calculadora

Campo `postProcessing` (array) adicionado aos itens de métrica:

```js
// Exemplo em um item da calculadora:
{
  type: 'metric',
  calculation: 'sum',
  filters: [...],
  postProcessing: [
    { op: 'multiply', constantId: 'abc123' },
    { op: 'divide',   constantId: 'def456' }
  ]
}
```

**Ops disponíveis:** `multiply`, `divide`, `add`, `subtract`

**Ordem de execução:** sequencial, na ordem do array. Sem precedência de
operador — é responsabilidade do usuário ordenar as operações.

**Edge cases:**

- `divide` com `c.value === 0`: preserva valor anterior, emite `console.warn`
- `constantId` não encontrado: step ignorado com `console.warn`
- `postProcessing` vazio ou ausente: sem efeito no resultado

---

## Limitações Conhecidas da Fase 1

1. **Uma cadeia por métrica:** `postProcessing` é por item da calculadora,
   não por observação ou filtro individual. Aplicação mais granular fica para Fase 2.
2. **Sem binding:** constantes não são acessíveis pelo sistema de field bindings
   (`core/bindings/resolver.js`). O Fase 2 deverá adicionar `targetType: "constant"`.
3. **Sem histórico de versões da constante:** se o valor de uma constante mudar,
   não há registro de qual valor foi usado em cálculos anteriores.

---

## Fase 1.5 — Campos de Incerteza (2026-03-22)

### Decisao

Adicionar `uncertainty` (number|null), `uncertaintyType` ('absolute'|'relative'|null)
e `coverageFactor` (number|null) ao schema de constantes E ao schema de observacoes.
SCHEMA_VERSION: 1 -> 2 com migracao idempotente (defaults null).

### Justificativa

- ISO/IEC 17025 exige rastreabilidade de incerteza em medicoes ambientais
- GUM (Guide to the Expression of Uncertainty in Measurement) define dois tipos:
  absoluta (mesma unidade do valor) e relativa (percentual)
- coverageFactor (k) registra nivel de confianca: k=2 = 95% (padrao)

### Regras de validacao

- Campos opcionais — ausencia de incerteza nao bloqueia criacao
- Se `uncertainty` fornecido, `uncertaintyType` obrigatorio (e vice-versa)
- `uncertainty` deve ser >= 0 e Number.isFinite
- `coverageFactor` deve ser > 0 e Number.isFinite (soft warn k>3)

### Limitacao: migration race condition

Se dois tabs carregam simultaneamente com dados v1, ambos migram e persistem.
Last-write-wins. A migracao v1->v2 e idempotente (spread + defaults null),
entao nenhum dado e perdido. Migrações futuras nao-idempotentes precisarao de lock.

### Propagacao de erros (Fase 2)

Fase 1.5 apenas armazena e exibe. Fase 2 implementara propagacao de incerteza
na cadeia `postProcessing` do calculator/engine.js seguindo regras GUM:

- Soma/subtracao: u_combined = sqrt(u_a^2 + u_b^2)
- Multiplicacao/divisao: u_rel_combined = sqrt(u_rel_a^2 + u_rel_b^2)

---

## Roadmap Fase 2

- Adicionar `targetType: "constant"` ao `bindings/resolver.js` para que qualquer
  campo bindável possa referenciar uma constante por `symbol`.
- Histórico de versões (`valueHistory: [{ value, date }]`) para auditoria.
- Migração para Supabase junto com `ecbyts_custom_parameters` e `ecbyts_custom_units`.

---

## Alternativas Descartadas

| Alternativa                               | Razão para descartar                                                  |
| ----------------------------------------- | --------------------------------------------------------------------- |
| Adicionar constantes ao CONFIG.PARAMETERS | CONFIG é read-only em runtime; constantes do usuário são mutáveis     |
| Usar bindings para referenciar constantes | Complexidade alta para Fase 1; bindings operam em nível de observação |
| Armazenar em IndexedDB                    | Category B é leve (< 50 itens típicos); localStorage suficiente       |
| Symbol case-insensitive                   | Quebraria convenção científica (CO2 ≠ co2)                            |
