# ADR — Symbology Profiles

**Módulo:** `core/symbology/`
**Data:** 2026-03-12
**Atualizado:** 2026-03-26
**Status:** Aceito

---

## Contexto

O módulo de perfis de simbologia permite sobrepor configurações visuais (cor,
opacidade, wireframe, escala, labels, superfícies, cena) sem alterar os dados
do modelo. Precisou-se decidir sobre quatro aspectos arquiteturais.

---

## Decisão 1 — Snapshot diferencial vs. undo stack completo

**Escolhido:** Snapshot diferencial.

O snapshot captura o estado base **apenas dos elementos que recebem override**,
uma única vez (lazy, por elemento). Elementos novos adicionados após o primeiro
apply não entram no snapshot e ficam com estado nativo ao restaurar.

**Por que não undo stack:** Um undo stack rastrearia cada mutação individual
(O(N) entradas por apply). O snapshot diferencial é O(E_afetados) e suficiente
para o único caso de uso: "restaurar ao estado antes de qualquer perfil ativo".

**Trade-off:** Restore é O(N_afetados), não O(1). Aceitável pois o número de
elementos com override por perfil é pequeno em relação ao total.

---

## Decisão 2 — WeakMap + Set paralelo para materiais clonados

**Escolhido:** `WeakMap<Mesh, Material>` para lookup GC-safe + `Set<Mesh>`
paralelo para iteração no dispose.

`WeakMap` não é iterável — sua semântica de "referência fraca" garante que
meshes removidos do scene graph sejam coletados pelo GC sem vazamento de
memória. Porém para chamar `dispose()` em todos os materiais clonados é
necessário iterar, daí o `Set` auxiliar.

**Por que não `Map<Mesh, Material>`:** `Map` mantém referência forte ao Mesh —
meshes removidos da cena ficariam presos na memória enquanto o perfil existir.

**Regra:** ao clonar material, fazer `_clonedMeshes.add(child)`.
Ao dispor, iterar `_clonedMeshes`, restaurar material original, chamar
`child.material.dispose()`, depois limpar ambas as estruturas.

---

## Decisão 3 — localStorage vs. IndexedDB para perfis

**Escolhido:** `localStorage` com guard de tamanho (200 KB).

Perfis são arrays de objetos leves (sem geometria). Estimativa conservadora:
20 perfis × 100 elementos × 300 bytes = ~600 KB. Limite de 200 KB cobre a
maioria dos casos; um toast avisa o usuário se excedido.

Usa `safeSetItem()` de `utils/storage/storageMonitor.js` (não raw localStorage).

**Quando migrar para IDB:** Se `byElement` crescer além de 500 entradas por
perfil, ou se perfis passarem a incluir snapshots de geometria.

**Por que não IDB agora:** IDB é assíncrono — exige `await` em `initSymbology()`,
`applyProfile()`, e `persist()`. Aumenta a complexidade de tratamento de erro
sem ganho real para o volume esperado de dados.

---

## Decisão 4 — Draft state separado do perfil persistido

**Escolhido:** Pattern draft/commit com `_draft` em memória.

`openDraft(id)` clona o perfil em `_draft`. `previewDraft()` aplica visualmente
sem persistir. `commitDraft()` promove `_draft` para `_profiles[idx]` e persiste.
`discardDraft()` descarta sem gravar; restaura a cena ao estado do perfil salvo.

**Analogia:** É o equivalente de "working copy vs. committed" em controle de
versão. O usuário pode ver o efeito visual antes de confirmar.

**Por que não persistir antes de preview e desfazer no cancel:**
Exigiria versionamento de perfis no localStorage ou um segundo parse/restore
(que pode falhar em telas lentas). O draft em memória é sempre descartável.

---

## Referências

- Spec: `docs/SPEC_SYMBOLOGY_PROFILES.md`
- Storage: `utils/storage/storageMonitor.js` (`safeSetItem`, `idbSet`)
- Labels: `utils/labels/manager.js` (`getLabelConfig`, `importLabels`, `resetLabelSettings`)
- Interpolação: `core/interpolation/manager.js` (`getLayerMesh`, `getAllLayers`, `updateLayer`)
- Elementos: `core/elements/manager.js` (`getMeshByElementId`, `getAllElements`)
