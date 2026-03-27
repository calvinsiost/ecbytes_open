# ADR — Pipeline Automation Module

**Module**: `core/pipelines/`
**Date**: 2026-03-10
**Atualizado:** 2026-03-26
**Status**: Implemented (v0.1-beta)

---

## Context

O ecbyts precisava de um mecanismo de automação tipo Zapier/n8n: fluxos de
ações encadeadas (gerar modelo, executar interpolação, exportar relatório etc.)
disparadas manualmente ou por evento, editáveis visualmente e persistidas
localmente.

---

## Decision 1 — bpmn-js como upgrade progressivo (bpmn.io license)

**Decisão**: Usar bpmn-js como editor visual quando CDN disponível; fallback
para editor linear vanilla JS quando offline.

**Licença bpmn.io**: Permite uso comercial. **Proíbe remoção do watermark
"Powered by bpmn.io"**. O watermark é exibido no rodapé do editor e não pode
ser removido ou ocultado.

**CDN**: `https://unpkg.com/bpmn-js@18.13.1/dist/bpmn-modeler.production.min.js`

**Alternativas rejeitadas**:

- react-flow: requer React, incompatível com arquitetura vanilla JS
- draw.io embed: iFrame complexo, sem controle de XML
- Editor linear apenas: funcional mas experiência visual inferior

---

## Decision 2 — Allowlist obrigatória para \_executeAction (sem window[])

**Decisão**: `executor.js` usa `_actionRegistry` Map privado. Ações só são
executáveis após registro explícito via `registerPipelineAction(name, fn)`.

```js
// NUNCA:
const fn = window[node.config.action]; // vetor de RCE

// SEMPRE:
const fn = _actionRegistry.get(node.config.action);
if (!fn) throw new Error(`Action not allowed: "${actionName}"`);
```

**Subconjunto registrado** em `handlers/index.js`: apenas handlers ambientais
e de modelo — excluídos auth, admin, storage clear.

---

## Decision 3 — localStorage como source-of-truth (client-only)

**Contexto**: Bluehost shared hosting não tem server-side persistence para
dados de usuário além de Supabase (que requer auth).

**Decisão**:

- `ecbyts-pipelines`: Map de pipelines (key=id, value={name, xml, updatedAt})
- `ecbyts-pipeline-logs`: runs finalizados, máximo 50 (FIFO)
- Categoria: USER_CONTENT_KEYS (sobrevivem a clearWorkspace)
- Todos os writes via `safeSetItem()` — toast warning em quota exceeded
- Mitigação de perda: botões Export/Import .bpmn no manager

**Limitações documentadas**:

- Limite ~5 MB localStorage
- Sem sync entre dispositivos
- Sem versionamento de pipelines

---

## Decision 4 — Condition DSL via ALLOWED_PATHS (sem eval)

**Decisão**: Condições resolvidas contra Map pré-definido, operador via
switch statement. Zero uso de `eval()` ou `new Function()`.

```js
const ALLOWED_PATHS = {
    'elements.length': ctx => ctx.elements.length,
    'elements[familyId=well].length': ctx => ctx.elements.filter(...),
    // ...
};
```

Subjects não listados: `throw new Error('Condition path não permitido')`.

---

## Decision 5 — Tab fechada = run perdido (Fase 1 aceita)

**Limitação**: O executor roda inteiramente no browser (main thread). Se a
aba for fechada durante execução, o run é perdido sem possibilidade de retry.

**Mitigação fase 1**: Log persistido ao finalizar. Run em andamento não é
persistido em tempo real.

**Fase 2+**: Mover executor para api-server.js como runner persistente com
SSE/WebSocket para progress streaming.

---

## Decision 6 — API call timeout configurável (cap 120s)

Nós `api_call` aceitam `timeoutMs` na config (default: 30000, cap: 120000).
Implementado via `AbortController` + `Promise.race`.

---

## Arquivos do módulo

| Arquivo                  | Responsabilidade                                                      |
| ------------------------ | --------------------------------------------------------------------- |
| `schema.js`              | Tipos, parseBpmnXml, serializeToBpmn, validatePipeline, BPMN_TEMPLATE |
| `registry.js`            | Persistência localStorage, CRUD, logs                                 |
| `executor.js`            | runPipeline, registerPipelineAction, allowlist, DSL                   |
| `index.js`               | Barrel + loadFromStorage() na inicialização                           |
| `ADR.md`                 | Este arquivo                                                          |
| `tests/schema.test.js`   | Testes de parse/serialize/validate                                    |
| `tests/registry.test.js` | Testes CRUD + FIFO logs                                               |
| `tests/executor.test.js` | Testes allowlist, DSL, delay, abort                                   |
