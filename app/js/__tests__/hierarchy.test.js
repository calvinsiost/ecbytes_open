/* ================================================================
   SPATIAL HIERARCHY TESTS — Testes de hierarquia espacial PDPL-U
   ================================================================

   Testa o modulo core/elements/manager.js: setParent, isEffectivelyVisible,
   getElementTree, getDescendants, orphan correction no import, e round-trip ECO1.

   Execucao via API bridge (POST /api/eval no test-api-modules.js).
   Todos os testes limpam seus artefatos ao final.
   ================================================================ */

/**
 * Suite de testes de hierarquia espacial.
 * Exporta funcao para ser chamada por test-api-modules.js.
 *
 * @param {Function} POST - Funcao POST do test runner
 * @param {Function} assert - Funcao assert do test runner
 * @param {Function} section - Funcao section do test runner
 */
async function testHierarchy(POST, assert, section) {
    section('Spatial Hierarchy PDPL-U');

    // Helpers
    const eval_ = (expr) => POST('/api/eval', { expr });

    // --- Limpa estado inicial ---
    await eval_(`(async () => {
        const m = await import('/js/core/elements/manager.js');
        m.clearAllElements();
        return 'cleared';
    })()`);

    // ----------------------------------------------------------------
    // Teste 1: setParent valido — parentId atualizado no elemento
    // ----------------------------------------------------------------
    const t1 = await eval_(`(async () => {
        const { addElement, setParent, getElementById } = await import('/js/core/elements/manager.js');
        addElement('site_area', 'hier-area-1', 'Area 1', {});
        addElement('well', 'hier-well-1', 'Well 1', {});
        const ok = setParent('hier-well-1', 'hier-area-1');
        const el = getElementById('hier-well-1');
        return { ok, parentId: el?.hierarchy?.parentId };
    })()`);
    assert(t1.body.result?.ok === true, 'setParent valido retorna true');
    assert(t1.body.result?.parentId === 'hier-area-1', 'hierarchy.parentId atualizado apos setParent');

    // ----------------------------------------------------------------
    // Teste 2: arvore 3 niveis — getElementTree estrutura correta
    // ----------------------------------------------------------------
    const t2 = await eval_(`(async () => {
        const { addElement, setParent, getElementTree } = await import('/js/core/elements/manager.js');
        addElement('site_project', 'hier-proj-1', 'Projeto 1', {});
        setParent('hier-area-1', 'hier-proj-1');
        setParent('hier-well-1', 'hier-area-1');
        const tree = getElementTree();
        const proj = tree.find(n => n.element.id === 'hier-proj-1');
        const area = proj?.children?.find(n => n.element.id === 'hier-area-1');
        const well = area?.children?.find(n => n.element.id === 'hier-well-1');
        return { projFound: !!proj, areaFound: !!area, wellFound: !!well };
    })()`);
    assert(t2.body.result?.projFound, 'getElementTree: projeto na raiz');
    assert(t2.body.result?.areaFound, 'getElementTree: area filha do projeto');
    assert(t2.body.result?.wellFound, 'getElementTree: poco filho da area');

    // ----------------------------------------------------------------
    // Teste 3: getDescendants recursivo
    // ----------------------------------------------------------------
    const t3 = await eval_(`(async () => {
        const { getDescendants } = await import('/js/core/elements/manager.js');
        const desc = getDescendants('hier-proj-1');
        const ids = desc.map(d => d.id);
        return { count: desc.length, hasArea: ids.includes('hier-area-1'), hasWell: ids.includes('hier-well-1') };
    })()`);
    assert(t3.body.result?.count >= 2, 'getDescendants retorna area e poco');
    assert(t3.body.result?.hasArea, 'getDescendants inclui area');
    assert(t3.body.result?.hasWell, 'getDescendants inclui poco');

    // ----------------------------------------------------------------
    // Teste 4: rejeita ciclo — setParent(A, B) onde B descende de A
    // ----------------------------------------------------------------
    const t4 = await eval_(`(async () => {
        const { setParent, getElementById } = await import('/js/core/elements/manager.js');
        // hier-proj-1 e ancestral de hier-well-1; tentar setar proj como filho de well deve falhar
        const ok = setParent('hier-proj-1', 'hier-well-1');
        const el = getElementById('hier-proj-1');
        return { ok, parentId: el?.hierarchy?.parentId };
    })()`);
    assert(t4.body.result?.ok === false, 'setParent rejeita ciclo (retorna false)');
    assert(t4.body.result?.parentId === null, 'hierarchy.parentId permanece null apos rejeicao de ciclo');

    // ----------------------------------------------------------------
    // Teste 5: visibilidade em cascata — ocultar container
    // ----------------------------------------------------------------
    const t5 = await eval_(`(async () => {
        const { updateElement, isEffectivelyVisible } = await import('/js/core/elements/manager.js');
        updateElement('hier-proj-1', { visible: false });
        const projVis = isEffectivelyVisible('hier-proj-1');
        const areaVis = isEffectivelyVisible('hier-area-1');
        const wellVis = isEffectivelyVisible('hier-well-1');
        updateElement('hier-proj-1', { visible: true }); // restaura
        return { projVis, areaVis, wellVis };
    })()`);
    assert(t5.body.result?.projVis === false, 'projeto oculto: isEffectivelyVisible false');
    assert(t5.body.result?.areaVis === false, 'area herda invisibilidade do projeto');
    assert(t5.body.result?.wellVis === false, 'poco herda invisibilidade transitiva');

    // ----------------------------------------------------------------
    // Teste 6: orphan correction — import com parentId inexistente
    // ----------------------------------------------------------------
    const t6 = await eval_(`(async () => {
        const { validateModel } = await import('/js/core/io/validator.js');
        const model = {
            elements: [
                { id: 'orphan-el', family: 'well', name: 'Orphan',
                  hierarchy: { level: 'element', parentId: 'nonexistent-parent-xyz', order: 0 } }
            ]
        };
        const result = validateModel(model);
        // validator nao corrige parentId — ele e corrigido no importElements segunda passada
        // mas deve preservar o campo hierarchy sem crashar
        const el = result.model.elements[0];
        return { valid: result.valid, hasHierarchy: !!el?.hierarchy, parentId: el?.hierarchy?.parentId };
    })()`);
    assert(t6.body.result?.valid === true, 'validateModel nao falha com parentId invalido');
    assert(t6.body.result?.hasHierarchy === true, 'validateModel preserva campo hierarchy');

    // ----------------------------------------------------------------
    // Teste 7: delete container → filhos viram raiz
    // ----------------------------------------------------------------
    const t7 = await eval_(`(async () => {
        const { removeElement, getElementById } = await import('/js/core/elements/manager.js');
        // hier-well-1 e filho de hier-area-1 que e filho de hier-proj-1
        removeElement('hier-area-1');
        const well = getElementById('hier-well-1');
        return { wellExists: !!well, parentId: well?.hierarchy?.parentId };
    })()`);
    assert(t7.body.result?.wellExists === true, 'poco sobrevive apos delete do container pai');
    assert(
        t7.body.result?.parentId === 'hier-proj-1' || t7.body.result?.parentId === null,
        'poco reparentado para avo ou raiz apos delete do pai',
    );

    // ----------------------------------------------------------------
    // Teste 8: round-trip ECO1 — hierarchy preservada
    // ----------------------------------------------------------------
    const t8 = await eval_(`(async () => {
        const { generateKey } = await import('/js/core/io/export.js');
        const { applyModel } = await import('/js/core/io/import.js');
        const { getElementById } = await import('/js/core/elements/manager.js');
        const key = await generateKey();
        await applyModel(key);
        const well = getElementById('hier-well-1');
        return { hasHierarchy: !!well?.hierarchy, parentId: well?.hierarchy?.parentId };
    })()`);
    assert(t8.body.result?.hasHierarchy === true, 'round-trip ECO1: hierarchy presente apos import');

    // ----------------------------------------------------------------
    // Teste 9: migration v1→v2 — elemento sem hierarchy abre sem erro
    // ----------------------------------------------------------------
    const t9 = await eval_(`(async () => {
        const { validateModel } = await import('/js/core/io/validator.js');
        const model = {
            schemaVersion: 1,
            elements: [
                { id: 'legacy-el', family: 'well', name: 'Legacy Well' }
                // sem campo hierarchy — modelo v1
            ]
        };
        const result = validateModel(model);
        const el = result.model.elements[0];
        return {
            valid: result.valid,
            hasHierarchy: !!el?.hierarchy,
            parentId: el?.hierarchy?.parentId,
            order: el?.hierarchy?.order
        };
    })()`);
    assert(t9.body.result?.valid === true, 'modelo v1 sem hierarchy valida sem erros');
    assert(t9.body.result?.hasHierarchy === true, 'validateModel injeta hierarchy default em elemento v1');
    assert(t9.body.result?.parentId === null, 'hierarchy.parentId default = null');
    assert(t9.body.result?.order === 0, 'hierarchy.order default = 0');

    // --- Limpeza ---
    await eval_(`(async () => {
        const m = await import('/js/core/elements/manager.js');
        m.clearAllElements();
        return 'cleanup done';
    })()`);
}

// Exporta para uso em test-api-modules.js
if (typeof module !== 'undefined') module.exports = { testHierarchy };
