# ADR: Metering — Sistema Freemium por Volume (Fase 1)

**Módulo**: `app/js/core/metering/`
**Data**: 2026-03
**Atualizado:** 2026-03-26
**Status**: Implementado

---

## 1. Contexto

O ecbyts adota modelo freemium por volume: usuários free têm cotas mensais para
observações, exportações ECO1 e modelos salvos. A Fase 1 implementa a infraestrutura
de medição sem bloquear operações — enforcement hard fica para Fase 2.

---

## 2. Enforcement Soft (otimista)

**Decisão**: operações nunca bloqueiam por quota; overrun é registrado.

**Justificativa**: dados ambientais de campo não podem ser perdidos por latência
de billing. O modelo soft aceita overrun marginal, recuperado no ciclo de cobrança
seguinte (Fase 4). A alternativa hard-blocking é tecnicamente mais simples mas
cria risco operacional inaceitável para o domínio.

---

## 3. Período UTC (`YYYY-MM`)

**Decisão**: reset na virada do mês UTC.

**Comportamento GMT-3**: reset ocorre às 21h00 (horário de Brasília) do último dia
do mês. Documentado explicitamente no UI ("Cota reinicia no início de cada mês (UTC)").

---

## 4. service_role Only — Sem INSERT Policy no Cliente

**Decisão**: tabelas `usage_monthly` e `metering_events` não têm INSERT policy
para usuários autenticados. Apenas a Edge Function (service_role) escreve.

**Justificativa**: evita que clientes manipulem contadores diretamente, seja por
erro ou intencionalmente. A Edge Function valida o JWT antes de qualquer escrita.

---

## 5. Cache de Sessão Ephemeral

**Decisão**: `_usageCache` vive apenas na memória da aba, não em localStorage.

**Comportamento**:

- Inicializado via `initMeteringCache()` após login
- Limpo via `clearMeteringState()` no logout (via dynamic import em `session.js`)
- Graceful degradation: cache vazio → `checkQuota` retorna `allowed: true`
- Servidor é a fonte da verdade; cache serve apenas para alertas locais

---

## 6. Multi-Tab: Caches Independentes

**Decisão**: cada aba mantém seu próprio `_usageCache`; sem sincronização entre abas.

**Consequência aceitável**: usuário com 2 abas abertas pode ter overrun duplicado
para a mesma operação (ex: exportar ECO1 nas duas). Tolerado no modelo soft —
servidor registra ambos; overrun cobrado na Fase 4.

---

## 7. Delta de Observações (não snapshot)

**Decisão**: `observations` conta apenas observações novas desde o último save,
não o total do modelo.

**Justificativa**: snapshot penalizaria saves frequentes — salvar o mesmo modelo
10 vezes contaria 10× as mesmas observações. Delta requer buscar `model_data`
anterior (1 query extra por save), custo aceitável com `.limit(1)`.

**Edge case**: primeiro save de um modelo sem versão anterior — conta tudo como novo.

---

## 8. Limite de Modelos: Soft na Fase 1

**Decisão**: criar modelo acima do limite registra o evento mas não bloqueia.

**Justificativa**: enforcement hard requer UI de bloqueio, mensagem de upgrade
contextual, e testes E2E dedicados — escopo da Fase 2.

---

## 9. Advisory Lock no SQL

**Decisão**: `pg_advisory_xact_lock(hash(user_id || period || metric))` antes do
SELECT/INSERT em `check_and_increment_usage`.

**Problema resolvido**: `FOR UPDATE` não adquire lock em linha inexistente.
Na primeira chamada do período, dois requests simultâneos criariam duas linhas
violando a constraint UNIQUE. O advisory lock serializa essa operação por chave.

---

## 10. CASE Estático no SQL (não SQL Dinâmico)

**Decisão**: usar `CASE p_metric WHEN 'observations' THEN t.observations ...`
em vez de `EXECUTE format('SELECT %I FROM ...', p_metric)`.

**Justificativa**: função usa `SECURITY DEFINER`. SQL dinâmico + SECURITY DEFINER
é um smell de segurança — abre superfície para SQL injection se `p_metric` não
for validado. CASE estático é mais seguro e mais performático (plano fixo).
Métrica desconhecida retorna `limit=-1` (permitido sem contar).

---

## 11. Dynamic Import em `encoder.js`

**Decisão**: `import('../metering/quota.js').then(m => m.recordUsage(...)).catch(() => {})`

**Problema resolvido**: `encoder.js` é importado por `export.js`, que é importado
por `session.js`. Se `quota.js` importasse `session.js` estaticamente, formaria
ciclo: `encoder → quota → session → export → encoder`.

Dynamic import quebra o ciclo — a resolução ocorre em runtime, não em parse time.

---

## 12. Métricas Fase 1

| Métrica        | Status             | Entry point                                                  |
| -------------- | ------------------ | ------------------------------------------------------------ |
| `observations` | **Ativa**          | `cloud/manager.js` `saveModelToCloud` + `updateModelInCloud` |
| `eco1_exports` | **Ativa**          | `core/io/encoder.js` `encodeKey` + `encodeKeyV3`             |
| `models`       | **Ativa (soft)**   | `cloud/manager.js` `saveModelToCloud`                        |
| `eis_runs`     | Reservada — Fase 2 | —                                                            |
| `llm_tokens`   | Reservada — Fase 2 | —                                                            |
| `mcp_calls`    | Reservada — Fase 2 | —                                                            |
| `elements`     | Reservada — Fase 2 | —                                                            |

`encodeKeyAuto` **não** tem interceptação — chamaria `recordUsage` em duplicata
pois `encodeKeyAuto` delega para `encodeKey` ou `encodeKeyV3` que já registram.
