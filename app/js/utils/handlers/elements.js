// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Version: 0.1-beta
// Architecture: Digital Twin Architecture (Blockchain + ML + LLM)
// Application: EHS & Mining
// Authorship: Calvin Stefan Iost
// Copyright (c) 2026 Calvin Stefan Iost

/* ================================================================
   ELEMENT HANDLERS — User actions on environmental elements
   Acoes do usuario sobre elementos ambientais (pocos, plumas, etc.)

   Cada "elemento" representa um objeto real no terreno:
   um poco de monitoramento, uma pluma de contaminacao, um lago, etc.
   Estes handlers conectam os botoes da interface com a logica de dados.
   ================================================================ */

import {
    addElement,
    addNewElement,
    removeElement,
    removeElementsByFamily,
    toggleElementVisibility,
    setSelectedElement,
    getSelectedElement,
    getElementById,
    updateElement,
    generateRandomModel,
    getAllElements,
    getMeshByElementId,
    clearAllElements,
    countByFamily,
    isEffectivelyVisible,
} from '../../core/elements/manager.js';
import { openFamilySelectModal } from '../ui/familySelectModal.js';
import { updateMesh, loadOverlayTexture } from '../../core/elements/meshFactory.js';
import { highlightMesh, clearHighlight } from '../scene/picker.js';
import { setSelectedVolume, clearAllVolumes } from '../../core/voxel/manager.js';
import { clearAllLayers } from '../../core/interpolation/manager.js';
import { initEdges, clearEdges } from '../edges/manager.js';
import { clearCampaigns } from '../../core/campaigns/manager.js';
import { addScene, removeScene, getAllScenes, clearScenes, captureViewStart } from '../scenes/manager.js';
import { generateRandomReport, clearReport } from '../report/manager.js';
import { clearPresets as clearFilterPresets } from '../report/filterPresets.js';
import { clearTicker, generateRandomTicker } from '../ticker/manager.js';
import { clearAllLibraries, installLibrary, isLibraryActive } from '../libraries/manager.js';
import { getImageryById } from '../libraries/loader.js';
import { BUILTIN_EXAMPLES } from '../libraries/marketplace.js';
import { clearGroups, generateRandomGroups } from '../groups/manager.js';
import { clearCalculator, generateRandomCalculator } from '../../core/calculator/manager.js';
import { generateRandomConstants, clearDemoConstants } from '../../core/constants/manager.js';
import { clearModelData, safeSetItem } from '../storage/storageMonitor.js';
import { idbDelete } from '../storage/idbStore.js';
import { clearIssues } from '../../core/issues/manager.js';
import { clearAllLabels } from '../labels/manager.js';
import { clearHistory } from '../history/manager.js';
import { getEnabledFamilies, getAllFamilies } from '../../core/elements/families.js';
import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';
import {
    updateFamiliesList,
    updateElementsList,
    updateElementDetails,
    updateCampaignsList,
    updateScenesList,
    updateStatusBar,
    highlightSelectedElement,
} from '../ui/lists.js';
import { updateStampPanel } from '../ui/stampPanel.js';
import { updateEdgePanel } from '../ui/edgeEditor.js';
import { updateConstellation } from '../scene/constellation.js';
import { loadElementContext } from './llmChat.js';
import { canEdit, canEditElement, canDo, isAccessControlActive } from '../auth/permissions.js';
import {
    isEditing,
    exitEditMode,
    getEditingElementId,
    getEditMode,
    enterEditMode,
    enterGizmoMode,
    exitGizmoMode,
    hasStrategy,
} from '../editing/editManager.js';
import { fitAllElements, zoomToElement, zoomToFamily } from '../scene/controls.js';
import { setSelectedLayer } from '../../core/interpolation/manager.js';
import { showLoading, hideLoading, setLoadingProgress, setLoadingMessage } from '../ui/loadingOverlay.js';
import { addContract, clearContracts } from '../governance/contractManager.js';
import { addWbsItem, clearWbs } from '../governance/wbsManager.js';
import { addProject, addResource, addAllocation, clearProjects } from '../governance/projectManager.js';
import {
    addCostCenter,
    addAllocation as addCCAllocation,
    clearCostCenters,
    setBudget,
} from '../governance/costCenterManager.js';
import { savePipeline, getPipeline } from '../../core/pipelines/index.js';

// updateAllUI sera injetada pelo main.js para evitar dependencia circular
let _updateAllUI = null;

/**
 * Set the updateAllUI callback.
 * Define a funcao que atualiza toda a interface.
 * Chamada pelo main.js durante a inicializacao.
 *
 * @param {Function} fn - The updateAllUI function
 */
export function setUpdateAllUI(fn) {
    _updateAllUI = fn;
}

function updateAllUI() {
    if (_updateAllUI) _updateAllUI();
}

// ----------------------------------------------------------------
// ELEMENT CRUD HANDLERS
// Funcoes para adicionar, remover e editar elementos do modelo.
// ----------------------------------------------------------------

/**
 * Add a new element of a given family to the model.
 * Adiciona um novo elemento ao modelo 3D.
 * Ex: adicionar um poco de monitoramento ou uma pluma de contaminacao.
 *
 * @param {string} familyId - Element family ID (e.g. 'well', 'plume')
 */
export function handleAddElement(familyIdOrParams) {
    // P2: Headless mode — create element without UI (pipeline automation)
    if (typeof familyIdOrParams === 'object' && familyIdOrParams?._headless) {
        const { familyId, name, x, y } = familyIdOrParams;
        if (!familyId) return { error: 'familyId required' };
        const element = addNewElement(familyId);
        if (element) {
            if (name) element.name = name;
            if (x != null || y != null) {
                element.data = element.data || {};
                element.data.coordinates = element.data.coordinates || {};
                if (x != null) element.data.coordinates.easting = Number(x);
                if (y != null) element.data.coordinates.northing = Number(y);
            }
            return { success: true, elementId: element.id, name: element.name };
        }
        return { error: 'element_creation_failed' };
    }

    // Original UI path
    const familyId = typeof familyIdOrParams === 'string' ? familyIdOrParams : familyIdOrParams;
    if (isAccessControlActive() && !canEdit()) {
        showToast(t('permissionDenied') || 'Permission denied', 'error');
        return;
    }
    const element = addNewElement(familyId);
    if (element) {
        // Auto-assign: vincula ao no selecionado da arvore Org/Op
        if (window.activeAreaNodeId) {
            element.data.areaId = window.activeAreaNodeId;
        }
        showToast(`${t('added')} ${element.name}`, 'success');
        setSelectedElement(element.id);
        updateAllUI();
    }
}

/**
 * Remove an element from the model.
 * Remove um elemento do modelo e limpa a selecao se necessario.
 *
 * @param {string} elementId - ID of the element to remove
 */
export function handleRemoveElement(elementId) {
    if (!canDo('delete')) {
        showToast(t('auth.actionDenied') || "You don't have permission to perform this action.", 'error');
        return;
    }
    if (isAccessControlActive() && !canEditElement(elementId)) {
        showToast(t('permissionDenied') || 'Permission denied', 'error');
        return;
    }
    // Cleanup auto-refresh se sensor ativo
    const elToRemove = getElementById(elementId);
    if (elToRemove?.family === 'sensor' && elToRemove.data?._autoRefreshActive) {
        import('../../core/sensor/autoRefresh.js').then((m) => m.stopAutoRefresh(elementId)).catch(() => {});
    }

    removeElement(elementId);
    showToast(t('elementRemoved'), 'info');
    if (getSelectedElement()?.id === elementId) {
        setSelectedElement(null);
        clearHighlight();
    }
    updateAllUI();
}

/**
 * Toggle element visibility in the 3D scene.
 * Mostra ou esconde um elemento na visualizacao 3D.
 *
 * @param {string} elementId - ID of the element
 */
export function handleToggleVisibility(elementId) {
    toggleElementVisibility(elementId);

    const element = getElementById(elementId);
    const family = element ? getAllFamilies()[element.family] : null;

    // Containers afetam visibilidade de filhos — re-render completo para propagar cascade
    if (family?.isContainer) {
        updateElementsList();
        return;
    }

    // Elemento folha: atualiza apenas o card afetado (troca icone eye/eye-off + opacidade)
    const card = document.querySelector(`[data-element-id="${elementId}"]`);
    if (card && element) {
        card.classList.toggle('opacity-50', !isEffectivelyVisible(elementId));
    } else {
        updateElementsList();
    }
}

/**
 * Select an element for editing.
 * Seleciona um elemento para editar suas propriedades no painel lateral.
 *
 * @param {string} elementId - ID of the element
 */
export function handleSelectElement(elementId) {
    // Sai do modo de edição se selecionou outro elemento ou deselecionou
    if (isEditing()) {
        const editingId = getEditingElementId();
        if (!elementId || elementId !== editingId) {
            const wasGizmo = getEditMode() === 'gizmo';
            if (wasGizmo) {
                exitGizmoMode();
            } else {
                exitEditMode();
            }
            // Re-attach gizmo ao novo elemento se estava em gizmo mode
            if (wasGizmo && elementId) {
                // Defer para apos setSelectedElement
                queueMicrotask(() => enterGizmoMode(elementId));
            }
        }
    }

    // Desmonta modulo de familia ativo antes de trocar selecao
    import('../../core/elements/familyModuleRegistry.js')
        .then(({ unmountActiveFamilyModule }) => unmountActiveFamilyModule())
        .catch(() => {});

    setSelectedElement(elementId);
    setSelectedLayer(null); // Limpa seleção de layer (mutuamente exclusivo)
    setSelectedVolume(null); // Limpa seleção de volume (mutuamente exclusivo)

    if (elementId) {
        window.dispatchEvent(new CustomEvent('ecbt:elementSelected', { detail: { id: elementId } }));
    }

    // Destacar mesh 3D do elemento selecionado
    if (elementId) {
        const mesh = getMeshByElementId(elementId);
        highlightMesh(mesh);
    } else {
        clearHighlight();
    }

    // Auto-entra em gizmo mode (translate/rotate/scale) para TODOS os elementos.
    // Shape edit (vertices/handles) fica como secondary via botao "Edit Shape" ou tecla G.
    if (elementId && !isEditing()) {
        enterGizmoMode(elementId);
    }

    // Swap .selected class sem reconstruir toda a lista (rapido)
    highlightSelectedElement(elementId);
    updateElementDetails();
    updateStampPanel(getSelectedElement());
    updateEdgePanel(getSelectedElement());
    updateConstellation(getSelectedElement());

    // Contextual chat: carrega contexto do elemento no chat IA
    if (elementId) {
        loadElementContext(elementId);
    }

    // Notifica inspetor para destacar elemento selecionado
    window.dispatchEvent(new CustomEvent('selectionChanged'));
    if (elementId) window.dispatchEvent(new CustomEvent('elementSelected', { detail: { id: elementId } }));
}

/**
 * Update a single field of an element.
 * Atualiza um campo especifico de um elemento (nome, posicao, etc.)
 *
 * @param {string} elementId - ID of the element
 * @param {string} field - Field name to update
 * @param {*} value - New value
 */
export function handleElementFieldChange(elementId, field, value) {
    updateElement(elementId, { [field]: value });
    updateElementsList();
    updateElementDetails();
}

// ----------------------------------------------------------------
// RANDOM MODEL GENERATION
// Gera um modelo de demonstracao com dados aleatorios.
// Util para testar o sistema ou fazer apresentacoes.
// ----------------------------------------------------------------

/**
 * Generate a random environmental model for demonstration.
 * Cria um modelo aleatorio com pocos, plumas, campanhas e cenas.
 * Preenche tambem os metadados do projeto (nome, autor, etc.)
 */
export function handleGenerateRandomModel() {
    // Abre modal para selecionar familias antes de gerar
    openFamilySelectModal('random', (selectedFamilies) => {
        _executeRandomModel(selectedFamilies);
    });
}

/**
 * Execute random model generation with selected families.
 * Logica interna extraida para permitir chamada via modal.
 * @param {Set<string>} selectedFamilies - Familias a incluir
 */
async function _executeRandomModel(selectedFamilies) {
    // ── FASE BLOQUEANTE: Loading overlay com progress bar ──
    showLoading(t('generatingModel') || 'Generating model...');
    let financial = null;

    try {
        // Limpa sessão salva e dados do modelo anterior (start fresh explícito).
        setLoadingProgress(5, t('clearingModel') || 'Clearing previous model...');
        idbDelete('ecbyts-session').catch(() => {});
        // Para todos os auto-refresh de sensores antes de limpar
        import('../../core/sensor/autoRefresh.js').then((m) => m.stopAllAutoRefresh()).catch(() => {});
        clearModelData();

        // Limpa dados anteriores (clearCampaigns reseta counter para IDs coincidirem)
        clearCampaigns();
        getAllScenes().forEach((s) => removeScene(s.id));
        clearTicker();
        clearAllLibraries();
        clearGroups();
        clearCalculator();
        clearDemoConstants();
        clearReport();
        clearFilterPresets();
        clearAllLayers();
        clearAllVolumes();
        clearContracts();
        clearWbs();
        clearProjects();
        clearCostCenters();
        clearIssues();
        clearAllLabels();
        clearHistory();

        // Salva origin completo do usuario (se definido) para restaurar depois do random
        const _oeEl = document.getElementById('utm-origin-easting');
        const _onEl = document.getElementById('utm-origin-northing');
        const _oElev = document.getElementById('utm-origin-elevation');
        const _oZone = document.getElementById('utm-zone');
        const _oHemi = document.getElementById('utm-hemisphere');
        const _savedE = _oeEl ? parseFloat(_oeEl.value) || 0 : 0;
        const _savedN = _onEl ? parseFloat(_onEl.value) || 0 : 0;
        const _savedElev = _oElev ? parseFloat(_oElev.value) || 0 : 0;
        const _savedZone = _oZone ? parseInt(_oZone.value, 10) || 23 : 23;
        const _savedHemi = _oHemi ? _oHemi.value : 'S';

        setLoadingProgress(15, t('generatingElements') || 'Generating 25 wells, plumes & infrastructure...');
        // Yield para permitir render do progress bar
        await new Promise((r) => setTimeout(r, 0));

        // Gera elementos aleatorios (pocos, plumas, etc.) — apenas familias selecionadas
        const result = await generateRandomModel(selectedFamilies);
        const { campaigns, edges } = result;
        financial = result.financial || null;

        setLoadingProgress(75, t('buildingMeshes') || 'Building 3D meshes & edges...');
        await new Promise((r) => setTimeout(r, 0));

        // Restaura origin completo do usuario se tinha definido antes do random
        // e recalcula imagem aerea do boundary para o local correto
        if (_savedE !== 0 || _savedN !== 0) {
            import('../../core/io/geo/coordinates.js').then(async ({ setOrigin, relativeToUTM, utmToWGS84 }) => {
                setOrigin({
                    easting: _savedE,
                    northing: _savedN,
                    elevation: _savedElev,
                    zone: _savedZone,
                    hemisphere: _savedHemi,
                });
                if (_oeEl) _oeEl.value = _savedE.toFixed(2);
                if (_onEl) _onEl.value = _savedN.toFixed(2);

                // Recalcula overlay do boundary com o novo origin
                const boundary = getAllElements().find((e) => e.family === 'boundary');
                if (
                    boundary &&
                    boundary.data &&
                    boundary.data.vertices &&
                    !boundary.data.overlayUrl?.startsWith('data:')
                ) {
                    const vs = boundary.data.vertices;
                    const xs = vs.map((v) => v.x);
                    const zs = vs.map((v) => v.z);
                    const halfW = (Math.max(...xs) - Math.min(...xs)) / 2;
                    const halfL = (Math.max(...zs) - Math.min(...zs)) / 2;
                    const { buildOverlayUrls } = await import('../../core/io/geo/overlayUrls.js');
                    const { overlayUrl } = await buildOverlayUrls(halfW, halfL);
                    boundary.data.overlayUrl = overlayUrl;
                    boundary.data.overlayFallbackUrls = [];

                    // Recarrega textura do overlay
                    const mesh = getMeshByElementId(boundary.id);
                    if (mesh) {
                        const overlay = mesh.getObjectByName('overlay');
                        if (overlay && overlay.material) {
                            import('../../core/elements/meshFactory.js')
                                .then(({ loadOverlayTexture }) => {
                                    loadOverlayTexture([overlayUrl], overlay.material);
                                })
                                .catch(() => {});
                        }
                    }
                }
            });
        }
        initEdges(edges || []);

        // Campanhas ja foram criadas dentro de generateRandomModel()
        // com IDs, cores e plannedReadings corretos

        // Gera cenarios de visualizacao (1 a 3)
        const sceneNames = ['Linha de Base', 'Evolucao', 'Estado Atual'];
        const numScenes = 1 + Math.floor(Math.random() * 3);
        const createdScenes = [];
        for (let i = 0; i < numScenes; i++) {
            const s = addScene({ name: sceneNames[i] || `Cena ${i + 1}` });
            captureViewStart(s.id);
            createdScenes.push(s);
        }

        // Preenche metadados do projeto com codigos aleatorios (antes do relatorio para usar o nome)
        const randomCode = () => String(Math.floor(Math.random() * 100)).padStart(2, '0');
        const projectName = `Projeto Random ${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

        document.getElementById('project-name').value = projectName;
        document.getElementById('project-description').value =
            'Modelo gerado automaticamente para demonstracao do sistema';
        document.getElementById('project-author').value = `autor${randomCode()}`;

        // Gera relatorio simplificado com ancoras de cena
        const createdCampaigns = campaigns.map((c) => ({
            name: c.name,
            startDate: c.date.toISOString().slice(0, 10),
        }));
        generateRandomReport(createdScenes, getAllElements(), createdCampaigns);

        const techResponsible = document.getElementById('project-responsible-tech');
        const legalResponsible = document.getElementById('project-responsible-legal');
        const dataManager = document.getElementById('project-data-manager');
        if (techResponsible) techResponsible.value = `resptec${randomCode()}`;
        if (legalResponsible) legalResponsible.value = `respleg${randomCode()}`;
        if (dataManager) dataManager.value = `gestdados${randomCode()}`;

        // Gera ticker, calculator/constants demo, biblioteca demo e grupos
        generateRandomTicker();
        generateRandomCalculator();
        generateRandomConstants();
        if (!isLibraryActive('synthetic-monitoring-demo')) {
            const demoLib = BUILTIN_EXAMPLES.find((l) => l.id === 'synthetic-monitoring-demo');
            if (demoLib) installLibrary(demoLib);
        }
        generateRandomGroups(getAllElements(), getEnabledFamilies());

        // Gera centros de custo demo
        _generateRandomCostCenters(getAllElements());

        // ── Geology surfaces — cria 2 superficies geologicas automaticamente ──
        setLoadingProgress(95, t('creatingGeologySurfaces') || 'Creating geology surfaces...');
        await new Promise((r) => setTimeout(r, 100)); // Yield para UI

        try {
            const { createGeologyLayer, getAvailableSoilTypes } = await import('../../core/interpolation/manager.js');

            // Aguarda dados estarem disponíveis (até 3 tentativas)
            let soilTypes = [];
            for (let i = 0; i < 3; i++) {
                soilTypes = getAvailableSoilTypes();
                if (soilTypes.length > 0) break;
                await new Promise((r) => setTimeout(r, 500)); // Aguarda dados
            }

            console.log(
                '[RandomModel] Available soil types for geology:',
                soilTypes.map((s) => s.soilType),
            );

            if (soilTypes.length >= 1) {
                await createGeologyLayer(soilTypes[0].soilType, { contactType: 'top', method: 'idw' });
                console.log('[RandomModel] Created geology layer 1:', soilTypes[0].soilType);
            }
            if (soilTypes.length >= 2) {
                await createGeologyLayer(soilTypes[1].soilType, { contactType: 'top', method: 'idw' });
                console.log('[RandomModel] Created geology layer 2:', soilTypes[1].soilType);
            }
        } catch (err) {
            console.warn('[RandomModel] Geology layers skipped:', err.message);
        }

        setLoadingProgress(100, t('done') || 'Done!');
    } finally {
        hideLoading();
    }

    // ── SYNC: financial data → governance managers ──
    if (financial) {
        // 1. Contratos → contractManager (adapter de formato)
        const contractIdMap = {};
        for (const rc of financial.contracts || []) {
            const c = addContract({
                name: rc.name,
                type: rc.type,
                status: rc.status === 'complete' ? 'completed' : rc.status,
                parties: [{ name: rc.supplier, role: 'supplier' }],
                financial: { totalValue: rc.value, currency: rc.currency || 'BRL' },
                dates: { effectiveDate: rc.startDate, expirationDate: rc.endDate },
            });
            contractIdMap[rc.id] = c.id;
        }

        // 2. WBS → wbsManager (adapter: parentId + baseline/planned/actual)
        const phaseItemMap = {};
        for (const wbs of financial.wbs || []) {
            if (!phaseItemMap[wbs.phaseCode]) {
                const parent = addWbsItem({
                    code: wbs.phaseCode,
                    name: wbs.phaseName,
                    status: 'in_progress',
                });
                phaseItemMap[wbs.phaseCode] = parent.id;
            }
            addWbsItem({
                parentId: phaseItemMap[wbs.phaseCode],
                code: wbs.code,
                name: wbs.name,
                baseline: { cost: wbs.budget, startDate: wbs.startDate, endDate: wbs.endDate, weight: wbs.weight || 0 },
                planned: { cost: wbs.budget, startDate: wbs.startDate, endDate: wbs.endDate },
                actual: { cost: wbs.eva?.ac || 0, percentComplete: wbs.progress || 0 },
                status: wbs.status === 'complete' ? 'completed' : wbs.status,
            });
        }

        // 3. Project Registry → projectManager
        if (financial.projectRegistry) {
            const reg = financial.projectRegistry;
            // Remapeia IDs temporarios de contratos → IDs reais do manager
            reg.project.linkedContractIds = (reg.project.linkedContractIds || []).map(
                (oldId) => contractIdMap[oldId] || oldId,
            );
            const proj = addProject(reg.project);
            for (const res of reg.resources || []) {
                addResource(res);
            }
            for (const alloc of reg.allocations || []) {
                addAllocation({ ...alloc, projectId: proj.id });
            }
        }
    }

    // ── FASE NÃO-BLOQUEANTE: modelo visível, tarefas em background ──
    // Pipelines de exemplo — conteúdo do usuário (Category B), não dados de modelo.
    // Desativa o modo efêmero temporariamente para que safeSetItem persista corretamente.
    generateRandomPipelines();

    updateAllUI();

    // ── SEEDS DE MODULOS (pós-updateAllUI, cada um com try/catch individual) ──

    // Issues / Bounty — cria não-conformidades a partir de violações reais
    try {
        const { createIssue } = await import('../../core/issues/manager.js');
        const wells = getAllElements().filter((el) => el.family === 'well');
        // Busca pocos com contaminacao elevada (benzene > 1 ug/L ou tph > 20 mg/L)
        const violWells = wells
            .filter((el) =>
                (el.data?.observations || []).some(
                    (o) => (o.parameterId === 'benzene' && o.value > 1) || (o.parameterId === 'tph' && o.value > 20),
                ),
            )
            .slice(0, 3);
        violWells.forEach((el) => {
            const obs = el.data.observations.find(
                (o) => (o.parameterId === 'benzene' && o.value > 1) || (o.parameterId === 'tph' && o.value > 20),
            );
            const isBenzene = obs.parameterId === 'benzene';
            const posData =
                el.data.position ||
                (el.data.coordinates
                    ? {
                          x: el.data.coordinates.easting,
                          y: el.data.coordinates.elevation || 0,
                          z: el.data.coordinates.northing,
                      }
                    : { x: 0, y: 0, z: 0 });
            createIssue({
                type: 'nonconformity',
                title: `${isBenzene ? 'Benzene' : 'TPH'} acima do ${isBenzene ? 'VP' : 'VI'} em ${el.name}`,
                severity: obs.value > (isBenzene ? 3 : 50) ? 'critical' : 'high',
                position: posData,
                elementId: el.id,
                measuredValue: obs.value,
                thresholdValue: isBenzene ? 1 : 20,
                unit: isBenzene ? 'ug/L' : 'mg/L',
            });
        });
        if (wells[0]) {
            const wellPos =
                wells[0].data?.position ||
                (wells[0].data?.coordinates
                    ? { x: wells[0].data.coordinates.easting, y: 0, z: wells[0].data.coordinates.northing }
                    : null);
            createIssue({
                type: 'bounty',
                title: 'Instalar poco substituto',
                severity: 'medium',
                position: wellPos,
                flagType: 'infrastructure',
            });
        }
        createIssue({
            type: 'service_request',
            title: 'Topografia complementar',
            severity: 'low',
            serviceType: 'topography',
            estimatedCost: 8500,
            currency: 'BRL',
        });
    } catch (e) {
        console.warn('[random] issues seed skipped:', e.message);
    }

    // Sequencer — keyframes via scenes com viewStart sintetico
    try {
        const seqMgr = await import('../../core/sequencer/manager.js');
        if (seqMgr.initSequencer) await seqMgr.initSequencer();

        // Garantir que scenes tenham viewStart (pode estar vazio se cena 3D nao estava pronta)
        const allScenes = getAllScenes();
        const boundary = getAllElements().find((e) => e.family === 'boundary');
        if (boundary?.data?.vertices) {
            const vs = boundary.data.vertices;
            const cx = vs.reduce((s, v) => s + (v.x || 0), 0) / vs.length;
            const cz = vs.reduce((s, v) => s + (v.z || 0), 0) / vs.length;
            const span = Math.max(...vs.map((v) => Math.abs(v.x || 0)), ...vs.map((v) => Math.abs(v.z || 0)));
            const camDist = span * 2;
            const presets = [
                { camera: { x: camDist, y: camDist, z: camDist }, target: { x: cx, y: 0, z: cz } },
                { camera: { x: cx, y: camDist * 1.5, z: cz }, target: { x: cx, y: 0, z: cz } },
                { camera: { x: cx, y: camDist * 0.3, z: cz + camDist }, target: { x: cx, y: 0, z: cz } },
            ];
            allScenes.forEach((scene, i) => {
                if (!scene.viewStart) {
                    scene.viewStart = presets[i % presets.length];
                }
            });
        }

        seqMgr.refreshItems();
        const items = seqMgr.getItems();
        const kfCount = Math.min(items.length, 5);
        for (let i = 0; i < kfCount; i++) {
            seqMgr.addKeyframe(items[i].id, {
                position: i / Math.max(1, kfCount - 1),
                duration: 3000,
                annotation: items[i].name,
            });
        }
    } catch (e) {
        console.warn('[random] sequencer seed skipped:', e.message);
    }

    // Validation — ativar CONAMA e validar observações
    try {
        const { setActiveProfileIds, validateBatchWithProfile, getValidationProfile } =
            await import('../../core/validation/profileEngine.js');
        const profile = await getValidationProfile('conama-420');
        if (profile) {
            await setActiveProfileIds(['conama-420']);
            const allObs = getAllElements().flatMap((el) =>
                (el.data?.observations || []).map((o) => ({
                    parameterId: o.parameterId,
                    value: o.value,
                    unitId: o.unitId,
                    elementId: el.id,
                })),
            );
            await validateBatchWithProfile(allObs, 'conama-420');
        }
    } catch (e) {
        console.warn('[random] validation seed skipped:', e.message);
    }

    // SAO — ativar cenário oil_spill (requer initSAO prévio)
    try {
        const sao = await import('../../core/sao/index.js');
        if (sao.initSAO) await sao.initSAO(); // idempotente
        await sao.activateScenario('oil_spill');
        sao.setTier('recommended');
    } catch (e) {
        console.warn('[random] SAO seed skipped:', e.message);
    }

    // Audit — Benford test nos valores de observação
    try {
        const { benfordTest } = await import('../../core/audit/benford.js');
        const values = getAllElements()
            .flatMap((el) => (el.data?.observations || []).map((o) => o.value))
            .filter((v) => v > 0);
        if (values.length >= 10) {
            const result = benfordTest(values);
            safeSetItem('ecbyts-audit-benford', JSON.stringify(result));
        }
    } catch (e) {
        console.warn('[random] audit seed skipped:', e.message);
    }

    // EIS — calcular score demo
    try {
        const { EisCalculator } = await import('../../core/eis/eisCalculator.js');
        const calc = new EisCalculator();
        const result = calc.calculate({ T: 4, A: 4, Cp: 4, Ty: 3, Cs: 4, Cm: 4 }, 'geometric');
        safeSetItem('ecbyts-eis-demo', JSON.stringify(result));
    } catch (e) {
        console.warn('[random] EIS seed skipped:', e.message);
    }

    // NN demo — registrar, configurar mapping, e treinar rede plume predictor
    try {
        const { registerNetwork, getNetwork, updateNetworkMapping, resizeNetwork } =
            await import('../../core/nn/manager.js');
        const { trainNetworkFromModel } = await import('../../core/nn/whatIfEngine.js');
        const nnId = 'demo-plume-predictor';
        if (!getNetwork(nnId)) {
            registerNetwork(nnId, {
                inputSize: 7,
                hiddenLayerSizes: [16, 8],
                outputSize: 6,
                mode: 'regression',
            });
        }
        // Configura mapping: 7 inputs (well chemistry) → 6 outputs (plume geometry)
        const PR = (await import('../../core/elements/randomModel.js')).PARAMETER_RANGES;
        const mkInput = (id) => ({ variableId: id, min: PR[id]?.min ?? 0, max: PR[id]?.max ?? 1 });
        const geoRange = {
            plume_radiusX: [1, 50],
            plume_radiusY: [1, 50],
            plume_radiusZ: [1, 30],
            plume_centerX: [-100, 100],
            plume_centerY: [-80, 0],
            plume_centerZ: [-100, 100],
        };
        const mkOutput = (id) => ({ variableId: id, min: geoRange[id][0], max: geoRange[id][1] });
        updateNetworkMapping(nnId, {
            inputs: ['pH', 'conductivity', 'temperature', 'redox', 'benzene', 'toluene', 'tph'].map(mkInput),
            outputs: Object.keys(geoRange).map(mkOutput),
        });
        resizeNetwork(nnId, 7, 6);
        trainNetworkFromModel(nnId);
    } catch (e) {
        console.warn('[random] NN demo training skipped:', e.message);
    }

    // Fecha ML Studio se aberto (nao deve abrir automaticamente no random)
    try {
        const nnPanel = document.getElementById('nn-side-panel');
        if (nnPanel?.classList.contains('visible')) {
            nnPanel.classList.remove('visible');
        }
    } catch (_) {}

    // Se o usuario estava na Home (Actions), leva para 3D para visualizar
    // imediatamente o modelo random gerado.
    try {
        const { getCurrentView, switchView } = await import('../scene/viewRouter.js');
        if (getCurrentView?.() === 'actions') {
            await switchView('3d');
        }
    } catch (_) {
        /* viewRouter pode nao estar carregado em builds legados */
    }

    // Aguarda um frame para meshes serem processados pelo renderer
    await new Promise((r) => requestAnimationFrame(r));
    try {
        fitAllElements();
    } catch (_) {}
    showToast(t('randomGenerated'), 'success');
    window.dispatchEvent(new CustomEvent('modelGenerated'));
}

// ----------------------------------------------------------------
// RANDOM PIPELINES — Automações BPMN de exemplo
// ----------------------------------------------------------------

/**
 * Gera 3 pipelines BPMN de exemplo relevantes para monitoramento ambiental.
 * Usa IDs fixos para que re-execuções do random apenas atualizem as entradas.
 * Pipelines são conteúdo do usuário (Category B) — persistidos mesmo em modo efêmero.
 * Chamada ao final de _executeRandomModel().
 */
export function generateRandomPipelines() {
    // Idempotente: não re-cria se os demos já existirem (preserva dados de teste/usuário)
    if (getPipeline('demo-pipeline-report')) return;

    // Pipeline 1 — Relatório automático: gera modelo e abre relatório
    savePipeline({
        id: 'demo-pipeline-report',
        name: 'Relatorio Automatico',
        xml: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  xmlns:ecbyts="http://ecbyts.com/bpmn"
                  id="Def_report" targetNamespace="http://ecbyts.com">
  <bpmn:process id="Process_report" isExecutable="true">
    <bpmn:startEvent id="Start_report" name="Inicio">
      <bpmn:extensionElements>
        <ecbyts:config>{"type":"trigger","config":{"triggerType":"manual"}}</ecbyts:config>
      </bpmn:extensionElements>
    </bpmn:startEvent>
    <bpmn:sequenceFlow id="Flow_r1" sourceRef="Start_report" targetRef="Task_addReport"/>
    <bpmn:serviceTask id="Task_addReport" name="Novo Relatorio">
      <bpmn:extensionElements>
        <ecbyts:config>{"type":"action","config":{"action":"handleAddReport","params":{}}}</ecbyts:config>
      </bpmn:extensionElements>
    </bpmn:serviceTask>
    <bpmn:sequenceFlow id="Flow_r2" sourceRef="Task_addReport" targetRef="Task_openReport"/>
    <bpmn:serviceTask id="Task_openReport" name="Abrir Overlay de Relatorio">
      <bpmn:extensionElements>
        <ecbyts:config>{"type":"action","config":{"action":"handleOpenReportOverlay","params":{}}}</ecbyts:config>
      </bpmn:extensionElements>
    </bpmn:serviceTask>
    <bpmn:sequenceFlow id="Flow_r3" sourceRef="Task_openReport" targetRef="End_report"/>
    <bpmn:endEvent id="End_report" name="Fim"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_report">
    <bpmndi:BPMNPlane id="Plane_report" bpmnElement="Process_report">
      <bpmndi:BPMNShape id="Start_report_di" bpmnElement="Start_report">
        <dc:Bounds x="152" y="82" width="36" height="36"/><bpmndi:BPMNLabel><dc:Bounds x="145" y="125" width="50" height="14"/></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_addReport_di" bpmnElement="Task_addReport">
        <dc:Bounds x="240" y="60" width="100" height="80"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_openReport_di" bpmnElement="Task_openReport">
        <dc:Bounds x="400" y="60" width="100" height="80"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_report_di" bpmnElement="End_report">
        <dc:Bounds x="562" y="82" width="36" height="36"/><bpmndi:BPMNLabel><dc:Bounds x="568" y="125" width="24" height="14"/></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_r1_di" bpmnElement="Flow_r1">
        <di:waypoint x="188" y="100"/><di:waypoint x="240" y="100"/>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_r2_di" bpmnElement="Flow_r2">
        <di:waypoint x="340" y="100"/><di:waypoint x="400" y="100"/>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_r3_di" bpmnElement="Flow_r3">
        <di:waypoint x="500" y="100"/><di:waypoint x="562" y="100"/>
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`,
    });

    // Pipeline 2 — Interpolação + Voxel: cadeia de análise espacial
    savePipeline({
        id: 'demo-pipeline-interp',
        name: 'Interpolacao e Voxel 3D',
        xml: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  xmlns:ecbyts="http://ecbyts.com/bpmn"
                  id="Def_interp" targetNamespace="http://ecbyts.com">
  <bpmn:process id="Process_interp" isExecutable="true">
    <bpmn:startEvent id="Start_interp" name="Inicio">
      <bpmn:extensionElements>
        <ecbyts:config>{"type":"trigger","config":{"triggerType":"manual"}}</ecbyts:config>
      </bpmn:extensionElements>
    </bpmn:startEvent>
    <bpmn:sequenceFlow id="Flow_i1" sourceRef="Start_interp" targetRef="Task_openInterp"/>
    <bpmn:serviceTask id="Task_openInterp" name="Abrir Painel Interpolacao">
      <bpmn:extensionElements>
        <ecbyts:config>{"type":"action","config":{"action":"handleOpenInterpolationPanel","params":{}}}</ecbyts:config>
      </bpmn:extensionElements>
    </bpmn:serviceTask>
    <bpmn:sequenceFlow id="Flow_i2" sourceRef="Task_openInterp" targetRef="Task_refreshInterp"/>
    <bpmn:serviceTask id="Task_refreshInterp" name="Calcular Interpolacao">
      <bpmn:extensionElements>
        <ecbyts:config>{"type":"action","config":{"action":"handleRefreshInterpolationLayer","params":{}}}</ecbyts:config>
      </bpmn:extensionElements>
    </bpmn:serviceTask>
    <bpmn:sequenceFlow id="Flow_i3" sourceRef="Task_refreshInterp" targetRef="Task_voxel"/>
    <bpmn:serviceTask id="Task_voxel" name="Gerar Voxel 3D">
      <bpmn:extensionElements>
        <ecbyts:config>{"type":"action","config":{"action":"handleGenerateVoxel","params":{}}}</ecbyts:config>
      </bpmn:extensionElements>
    </bpmn:serviceTask>
    <bpmn:sequenceFlow id="Flow_i4" sourceRef="Task_voxel" targetRef="End_interp"/>
    <bpmn:endEvent id="End_interp" name="Fim"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_interp">
    <bpmndi:BPMNPlane id="Plane_interp" bpmnElement="Process_interp">
      <bpmndi:BPMNShape id="Start_interp_di" bpmnElement="Start_interp">
        <dc:Bounds x="152" y="82" width="36" height="36"/><bpmndi:BPMNLabel><dc:Bounds x="145" y="125" width="50" height="14"/></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_openInterp_di" bpmnElement="Task_openInterp">
        <dc:Bounds x="240" y="60" width="100" height="80"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_refreshInterp_di" bpmnElement="Task_refreshInterp">
        <dc:Bounds x="400" y="60" width="100" height="80"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_voxel_di" bpmnElement="Task_voxel">
        <dc:Bounds x="560" y="60" width="100" height="80"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_interp_di" bpmnElement="End_interp">
        <dc:Bounds x="722" y="82" width="36" height="36"/><bpmndi:BPMNLabel><dc:Bounds x="728" y="125" width="24" height="14"/></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_i1_di" bpmnElement="Flow_i1">
        <di:waypoint x="188" y="100"/><di:waypoint x="240" y="100"/>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_i2_di" bpmnElement="Flow_i2">
        <di:waypoint x="340" y="100"/><di:waypoint x="400" y="100"/>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_i3_di" bpmnElement="Flow_i3">
        <di:waypoint x="500" y="100"/><di:waypoint x="560" y="100"/>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_i4_di" bpmnElement="Flow_i4">
        <di:waypoint x="660" y="100"/><di:waypoint x="722" y="100"/>
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`,
    });

    // Pipeline 3 — Condicional: verifica se há poços antes de calcular
    savePipeline({
        id: 'demo-pipeline-conditional',
        name: 'Verificar Pocos e Calcular',
        xml: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  xmlns:ecbyts="http://ecbyts.com/bpmn"
                  id="Def_cond" targetNamespace="http://ecbyts.com">
  <bpmn:process id="Process_cond" isExecutable="true">
    <bpmn:startEvent id="Start_cond" name="Inicio">
      <bpmn:extensionElements>
        <ecbyts:config>{"type":"trigger","config":{"triggerType":"manual"}}</ecbyts:config>
      </bpmn:extensionElements>
    </bpmn:startEvent>
    <bpmn:sequenceFlow id="Flow_c1" sourceRef="Start_cond" targetRef="Gate_wells"/>
    <bpmn:exclusiveGateway id="Gate_wells" name="Ha pocos?">
      <bpmn:extensionElements>
        <ecbyts:config>{"type":"condition","config":{"subject":"elements[familyId=well].length","operator":">=","value":1}}</ecbyts:config>
      </bpmn:extensionElements>
    </bpmn:exclusiveGateway>
    <bpmn:sequenceFlow id="Flow_c2" sourceRef="Gate_wells" targetRef="Task_calc">
      <bpmn:conditionExpression>true</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_c3" sourceRef="Gate_wells" targetRef="Task_genModel">
      <bpmn:conditionExpression>false</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:serviceTask id="Task_calc" name="Abrir Calculadora">
      <bpmn:extensionElements>
        <ecbyts:config>{"type":"action","config":{"action":"handleOpenCalculator","params":{}}}</ecbyts:config>
      </bpmn:extensionElements>
    </bpmn:serviceTask>
    <bpmn:serviceTask id="Task_genModel" name="Gerar Modelo Aleatorio">
      <bpmn:extensionElements>
        <ecbyts:config>{"type":"action","config":{"action":"generateRandomModel","params":{}}}</ecbyts:config>
      </bpmn:extensionElements>
    </bpmn:serviceTask>
    <bpmn:sequenceFlow id="Flow_c4" sourceRef="Task_calc" targetRef="End_cond"/>
    <bpmn:sequenceFlow id="Flow_c5" sourceRef="Task_genModel" targetRef="End_cond"/>
    <bpmn:endEvent id="End_cond" name="Fim"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_cond">
    <bpmndi:BPMNPlane id="Plane_cond" bpmnElement="Process_cond">
      <bpmndi:BPMNShape id="Start_cond_di" bpmnElement="Start_cond">
        <dc:Bounds x="152" y="162" width="36" height="36"/><bpmndi:BPMNLabel><dc:Bounds x="145" y="205" width="50" height="14"/></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gate_wells_di" bpmnElement="Gate_wells" isMarkerVisible="true">
        <dc:Bounds x="255" y="155" width="50" height="50"/><bpmndi:BPMNLabel><dc:Bounds x="238" y="212" width="85" height="14"/></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_calc_di" bpmnElement="Task_calc">
        <dc:Bounds x="370" y="60" width="100" height="80"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_genModel_di" bpmnElement="Task_genModel">
        <dc:Bounds x="370" y="240" width="100" height="80"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_cond_di" bpmnElement="End_cond">
        <dc:Bounds x="542" y="162" width="36" height="36"/><bpmndi:BPMNLabel><dc:Bounds x="548" y="205" width="24" height="14"/></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_c1_di" bpmnElement="Flow_c1">
        <di:waypoint x="188" y="180"/><di:waypoint x="255" y="180"/>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_c2_di" bpmnElement="Flow_c2">
        <di:waypoint x="280" y="155"/><di:waypoint x="280" y="100"/><di:waypoint x="370" y="100"/>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_c3_di" bpmnElement="Flow_c3">
        <di:waypoint x="280" y="205"/><di:waypoint x="280" y="280"/><di:waypoint x="370" y="280"/>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_c4_di" bpmnElement="Flow_c4">
        <di:waypoint x="470" y="100"/><di:waypoint x="560" y="100"/><di:waypoint x="560" y="162"/>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_c5_di" bpmnElement="Flow_c5">
        <di:waypoint x="470" y="280"/><di:waypoint x="560" y="280"/><di:waypoint x="560" y="198"/>
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`,
    });
}

// ----------------------------------------------------------------
// CLEAR MODEL
// Limpa todo o modelo sem recarregar a pagina.
// ----------------------------------------------------------------

/**
 * Clear all model data (elements, edges, campaigns, scenes).
 * Limpa todos os dados do modelo atual sem recarregar a pagina.
 * Pede confirmacao antes de executar.
 */
export function handleClearModel() {
    if (!canDo('delete')) {
        showToast(t('auth.actionDenied') || "You don't have permission to perform this action.", 'error');
        return;
    }
    // Abre modal para selecionar familias antes de limpar
    openFamilySelectModal('clear', (selectedFamilies) => {
        _executeClearModel(selectedFamilies);
    });
}

/**
 * Execute clear with selected families.
 * Se todas as familias estao selecionadas, faz clear total (campaigns, scenes, etc.).
 * Se parcial, remove apenas elementos das familias selecionadas.
 * @param {Set<string>} selectedFamilies - Familias a remover
 */
function _executeClearModel(selectedFamilies) {
    // Compara contra familias COM elementos (nao todas as registradas)
    const counts = countByFamily();
    const populatedIds = Object.keys(counts).filter((id) => counts[id] > 0);
    const isTotal = populatedIds.length > 0 && populatedIds.every((f) => selectedFamilies.has(f));

    if (isTotal) {
        // Clear total — comportamento original
        clearAllElements();
        clearEdges();
        clearCampaigns();
        clearScenes();
        clearReport();
        clearFilterPresets();
        clearTicker();
        clearAllLibraries();
        clearGroups();
        clearAllLayers();
        clearAllVolumes();
        clearCalculator();
        clearContracts();
        clearWbs();
        clearProjects();

        // Reset project form fields
        const fields = [
            'project-name',
            'project-description',
            'project-author',
            'project-responsible-tech',
            'project-responsible-legal',
            'project-data-manager',
        ];
        fields.forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        // Para todos os auto-refresh de sensores
        import('../../core/sensor/autoRefresh.js').then((m) => m.stopAllAutoRefresh()).catch(() => {});
        clearModelData();
        clearHighlight();
        updateAllUI();
        showToast(t('modelCleared'), 'success');
    } else {
        // Clear parcial — remove apenas elementos das familias selecionadas
        let totalRemoved = 0;
        selectedFamilies.forEach((familyId) => {
            totalRemoved += removeElementsByFamily(familyId);
        });

        clearHighlight();
        updateAllUI();
        showToast(`${t('modelCleared')}: ${totalRemoved} ${t('elements') || 'elements'}`, 'success');
    }
}

// ----------------------------------------------------------------
// COPY / PASTE ELEMENT
// Copia e cola o elemento selecionado no modelo.
// ----------------------------------------------------------------

let _clipboard = null;

/**
 * Check if clipboard has content for paste.
 * @returns {boolean}
 */
export function hasClipboard() {
    return _clipboard !== null;
}

/**
 * Copy the currently selected element to internal clipboard.
 * Copia o elemento selecionado para a area de transferencia interna.
 */
export function handleCopyElement() {
    const selected = getSelectedElement();
    if (!selected) {
        showToast(t('noElementSelected'), 'warning');
        return;
    }

    _clipboard = JSON.parse(
        JSON.stringify({
            family: selected.family,
            name: selected.name,
            data: selected.data,
            stamps: selected.stamps || [],
            iconClass: selected.iconClass || '',
            color: selected.color || '',
            label: selected.label || selected.name,
        }),
    );

    showToast(`${t('copied')} ${selected.name}`, 'success');
}

/**
 * Paste the copied element with offset position.
 * Cola o elemento copiado com posicao deslocada para nao sobrepor o original.
 */
export function handlePasteElement() {
    if (!_clipboard) {
        showToast(t('nothingToPaste'), 'warning');
        return;
    }

    const clonedData = JSON.parse(JSON.stringify(_clipboard.data));
    const OFFSET = 5;
    offsetElementPosition(clonedData, _clipboard.family, OFFSET);

    const newId = `${_clipboard.family}-paste-${Date.now()}`;
    const newName = `${_clipboard.name} (copy)`;

    const element = addElement(_clipboard.family, newId, newName, clonedData, {
        iconClass: _clipboard.iconClass,
        color: _clipboard.color,
        label: newName,
        stamps: JSON.parse(JSON.stringify(_clipboard.stamps)),
    });

    if (element) {
        setSelectedElement(element.id);
        updateAllUI();
        showToast(`${t('pasted')} ${newName}`, 'success');
    }
}

/**
 * Offset element position based on family data structure.
 * Cada familia armazena posicao de forma diferente.
 */
function offsetElementPosition(data, family, offset) {
    if (family === 'well' && data.coordinates) {
        data.coordinates.easting = (data.coordinates.easting || 0) + offset;
        data.coordinates.northing = (data.coordinates.northing || 0) + offset;
    } else if (family === 'plume' && data.center) {
        data.center.x = (data.center.x || 0) + offset;
        data.center.z = (data.center.z || 0) + offset;
    } else if (data.position) {
        data.position.x = (data.position.x || 0) + offset;
        data.position.z = (data.position.z || 0) + offset;
    } else if (data.vertices && data.vertices.length > 0) {
        data.vertices.forEach((v) => {
            v.x = (v.x || 0) + offset;
            v.z = (v.z || 0) + offset;
        });
    } else if (data.path && data.path.length > 0) {
        data.path.forEach((p) => {
            p.x = (p.x || 0) + offset;
            p.z = (p.z || 0) + offset;
        });
    }
}

// ----------------------------------------------------------------
// TRANSFORM HANDLERS
// Controles de posicao, escala, rotacao e cor de elementos.
// ----------------------------------------------------------------

/**
 * Update element transform (position, scale, rotation, color).
 * Atualiza transformacao 3D e cor de um elemento em tempo real.
 *
 * @param {string} elementId - ID do elemento
 * @param {string} property - 'position' | 'scale' | 'rotation' | 'color'
 * @param {Object|string} values - Valores ({x,y,z} ou cor hex)
 */
export function handleElementTransform(elementId, property, values) {
    const element = getElementById(elementId);
    if (!element) return;

    const mesh = getMeshByElementId(elementId);

    switch (property) {
        case 'position': {
            // Atualiza centro no data do elemento
            if (!element.data) element.data = {};
            if (element.data.center) {
                Object.assign(element.data.center, values);
            } else if (element.data.position) {
                Object.assign(element.data.position, values);
            } else {
                element.data.center = { ...values };
            }
            if (mesh) updateMesh(mesh, { position: values });
            break;
        }
        case 'scale': {
            if (!element.data) element.data = {};
            element.data.scale = { ...values };
            if (mesh) updateMesh(mesh, { scale: values });
            break;
        }
        case 'rotation': {
            if (!element.data) element.data = {};
            element.data.rotation = { ...values };
            if (mesh) updateMesh(mesh, { rotation: values });
            break;
        }
        case 'color': {
            element.color = values;
            if (mesh) updateMesh(mesh, { color: values });
            break;
        }
    }
}

// ----------------------------------------------------------------
// BOUNDARY OVERLAY CONTROLS
// Controles de overlay para elementos do tipo boundary (area de estudo)
// ----------------------------------------------------------------

/**
 * Atualiza campo do overlay de boundary (opacidade ou URL da imagem).
 * Altera o data do elemento E atualiza o mesh 3D em tempo real.
 *
 * @param {string} elementId - ID do elemento boundary
 * @param {string} field - 'overlayOpacity' ou 'overlayUrl'
 * @param {*} value - Novo valor
 */
export function handleBoundaryFieldChange(elementId, field, value) {
    const element = getElementById(elementId);
    if (!element) return;

    // Atualiza data
    if (!element.data) element.data = {};
    element.data[field] = value;

    // Atualiza mesh 3D em tempo real
    const mesh = getMeshByElementId(elementId);
    if (!mesh) return;

    // Busca o plano overlay dentro do Group
    const overlay = mesh.getObjectByName?.('overlay');
    if (!overlay || !overlay.material) return;

    if (field === 'overlayOpacity') {
        overlay.material.opacity = parseFloat(value) || 0.3;
        overlay.material.needsUpdate = true;
    } else if (field === 'overlayUrl') {
        if (value) {
            if (overlay.material.map) {
                overlay.material.map.dispose();
                overlay.material.map = null;
            }
            loadOverlayTexture([value], overlay.material);
        } else {
            if (overlay.material.map) overlay.material.map.dispose();
            overlay.material.map = null;
            overlay.material.needsUpdate = true;
        }
    }
}

/**
 * Handle field changes on area elements (setor/zona).
 * Atualiza data.* do elemento area e sincroniza com Project Areas.
 *
 * @param {string} elementId
 * @param {string} field - 'projectArea', 'areaType', 'headcount', 'workedHours'
 * @param {*} value
 */
export function handleAreaFieldChange(elementId, field, value) {
    const element = getElementById(elementId);
    if (!element) return;
    if (!element.data) element.data = {};
    element.data[field] = value;
}

/**
 * Change the organizational unit assignment for an element.
 * Altera o vinculo do elemento com a arvore organizacional.
 *
 * @param {string} elementId
 * @param {string} nodeId - Tree node ID (or '' to unlink)
 */
export function handleElementOrgUnitChange(elementId, nodeId) {
    const element = getElementById(elementId);
    if (!element) return;
    if (!element.data) element.data = {};
    element.data.areaId = nodeId || '';
}

// ----------------------------------------------------------------
// CONTEXT MENU HANDLERS
// Acoes adicionais expostas pelo menu de contexto (botao direito).
// ----------------------------------------------------------------

/**
 * Zoom camera to specific element.
 * @param {string} elementId
 */
export function handleZoomToElement(elementId) {
    if (!elementId) return;
    zoomToElement(elementId);
}

/**
 * Zoom camera to fit all elements of a family.
 * @param {string} familyId
 */
export function handleZoomToFamily(familyId) {
    if (!familyId) return;
    zoomToFamily(familyId);
}

/**
 * Duplicate an element (copy + paste in one step).
 * @param {string} elementId
 */
export function handleDuplicateElement(elementId) {
    const element = getElementById(elementId);
    if (!element) return;

    const clonedData = JSON.parse(JSON.stringify(element.data));
    offsetElementPosition(clonedData, element.family, 5);

    const newId = `${element.family}-dup-${Date.now()}`;
    const newName = `${element.name} (copy)`;

    const created = addElement(element.family, newId, newName, clonedData, {
        iconClass: element.iconClass || '',
        color: element.color || '',
        label: newName,
        stamps: JSON.parse(JSON.stringify(element.stamps || [])),
    });

    if (created) {
        setSelectedElement(created.id);
        updateAllUI();
        showToast(`${t('duplicated')} ${newName}`, 'success');
    }
}

/**
 * Show all elements of a family.
 * @param {string} familyId
 */
export function handleShowAllFamily(familyId) {
    const elements = getAllElements().filter((el) => el.family === familyId);
    for (const el of elements) {
        if (!el.visible) toggleElementVisibility(el.id);
    }
    updateAllUI();
}

/**
 * Hide all elements of a family.
 * @param {string} familyId
 */
export function handleHideAllFamily(familyId) {
    const elements = getAllElements().filter((el) => el.family === familyId);
    for (const el of elements) {
        if (el.visible) toggleElementVisibility(el.id);
    }
    updateAllUI();
}

/**
 * Toggle element details docking mode.
 * Alterna entre detalhes inline (abaixo do card) e fixo no fundo do painel.
 */
export function handleToggleDetailsDock() {
    const current = localStorage.getItem('ecbyts-details-docked') === 'true';
    safeSetItem('ecbyts-details-docked', (!current).toString());
    updateAllUI();
}

/**
 * Open family module picker for an element.
 * Abre picker de sub-modulos (ex: perfil geologico, inspecao fotografica).
 *
 * @param {string} elementId - ID do elemento
 * @param {HTMLElement} anchorEl - Botao que disparou o picker
 */
export function handleOpenFamilyModulePicker(elementId, anchorEl) {
    const element = getElementById(elementId);
    if (!element) return;

    import('../../core/elements/familyModuleRegistry.js')
        .then(({ openModulePicker }) => {
            openModulePicker(elementId, element.family, anchorEl);
        })
        .catch((err) => console.error('[FamilyModule] Failed to open picker:', err));
}

// ----------------------------------------------------------------
// OVERLAY IMAGE UPLOAD
// Upload de imagem personalizada para overlay de boundary.
// ----------------------------------------------------------------

/**
 * Handle custom image upload for boundary overlay.
 * Redimensiona a imagem para max 512x512 e comprime como JPEG
 * para caber no localStorage (~30-50KB data URL).
 *
 * @param {string} elementId - ID do elemento boundary
 * @param {HTMLInputElement} input - File input element
 */
export async function handleOverlayUpload(elementId, input) {
    const file = input.files?.[0];
    if (!file) return;

    // Limite de 5MB no arquivo original
    if (file.size > 5 * 1024 * 1024) {
        showToast(t('overlayFileTooLarge') || 'File too large (max 5MB)', 'error');
        input.value = '';
        return;
    }

    try {
        // Carregar imagem
        const img = new Image();
        const url = URL.createObjectURL(file);
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = url;
        });

        // Redimensionar para max 512x512 mantendo aspect ratio
        const MAX = 512;
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w > MAX || h > MAX) {
            const scale = Math.min(MAX / w, MAX / h);
            w = Math.round(w * scale);
            h = Math.round(h * scale);
        }

        // Compor em canvas e exportar como JPEG comprimido
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);

        // Atualizar element data
        const element = getElementById(elementId);
        if (!element) return;
        element.data.overlayUrl = dataUrl;
        element.data.overlayFallbackUrls = [];

        // Recarregar textura no mesh 3D
        const mesh = getMeshByElementId(elementId);
        if (mesh) {
            const overlay = mesh.getObjectByName('overlay');
            if (overlay && overlay.material) {
                loadOverlayTexture([dataUrl], overlay.material);
            }
        }

        showToast(t('overlayUploaded') || 'Custom image applied', 'success');
    } catch (err) {
        console.error('[OverlayUpload]', err);
        showToast(t('overlayUploadFailed') || 'Failed to process image', 'error');
    } finally {
        input.value = '';
    }
}

/**
 * Apply library imagery to a boundary element.
 * Para imagens remotas, usa URL direta. Para sentinel-tiles, gera on-demand.
 *
 * @param {string} elementId - Boundary element ID
 * @param {string} imageryId - Imagery entry ID from library
 * @param {boolean} isSentinel - True if source is 'sentinel-tiles' (on-demand)
 */
export async function handleApplyImagery(elementId, imageryId, isSentinel) {
    const element = getElementById(elementId);
    if (!element) return;

    const img = getImageryById(imageryId);
    if (!img) {
        showToast('Imagery not found', 'error');
        return;
    }

    try {
        let overlayUrl;

        if (isSentinel && Array.isArray(img.bbox) && img.bbox.length === 4) {
            // Generate on-demand from Sentinel-2 tiles
            const [south, west, north, east] = img.bbox;
            const { stitchTiles } = await import('../../core/io/geo/tileStitcher.js');
            const sw = { latitude: south, longitude: west };
            const ne = { latitude: north, longitude: east };
            overlayUrl = await stitchTiles(sw, ne, 256);
        } else if (img.url) {
            overlayUrl = img.url;
        } else {
            showToast(t('imageryCorsError') || 'Image unavailable', 'warning');
            return;
        }

        if (!overlayUrl) {
            showToast(t('imageryCorsError') || 'Image unavailable', 'warning');
            return;
        }

        // Apply to boundary
        element.data.overlayUrl = overlayUrl;
        element.data.imageryId = imageryId;
        element.data.imageryLibraryId = img.libraryId;

        // Reload texture on 3D mesh
        const mesh = getMeshByElementId(elementId);
        if (mesh) {
            const overlay = mesh.getObjectByName('overlay');
            if (overlay && overlay.material) {
                loadOverlayTexture([overlayUrl], overlay.material);
            }
        }

        showToast(t('imageryApplied') || 'Imagery applied', 'success');
    } catch (err) {
        console.error('[ApplyImagery]', err);
        showToast(t('imageryCorsError') || 'Image unavailable — CORS restriction', 'error');
    }
}

// ----------------------------------------------------------------
// RANDOM COST CENTERS (demo data)
// ----------------------------------------------------------------

function _generateRandomCostCenters(elements) {
    const fy = new Date().getFullYear();

    const fieldOps = addCostCenter({ code: 'CC-FIELD', name: 'Field Operations', type: 'production' });
    const lab = addCostCenter({ code: 'CC-LAB', name: 'Laboratory Analysis', type: 'production' });
    const mgmt = addCostCenter({ code: 'CC-MGMT', name: 'Project Management', type: 'administrative' });
    const compliance = addCostCenter({ code: 'CC-COMP', name: 'Regulatory Compliance', type: 'support' });

    setBudget(fieldOps.id, fy, { budgetCapex: 80000, budgetOpex: 30000, budgetTotal: 110000 });
    setBudget(lab.id, fy, { budgetCapex: 10000, budgetOpex: 60000, budgetTotal: 70000 });
    setBudget(mgmt.id, fy, { budgetCapex: 5000, budgetOpex: 40000, budgetTotal: 45000 });
    setBudget(compliance.id, fy, { budgetCapex: 0, budgetOpex: 20000, budgetTotal: 20000 });

    // Aloca ~60% dos elementos aleatoriamente
    const ccIds = [fieldOps.id, lab.id, mgmt.id, compliance.id];
    const weights = [0.4, 0.3, 0.15, 0.15]; // probabilidades

    for (const el of elements) {
        if (Math.random() > 0.6) continue; // 40% sem alocacao (unassigned)
        const r = Math.random();
        let cumWeight = 0;
        for (let i = 0; i < ccIds.length; i++) {
            cumWeight += weights[i];
            if (r < cumWeight) {
                addCCAllocation({
                    sourceType: 'element',
                    sourceId: el.id,
                    costCenterId: ccIds[i],
                    percentage: 100,
                });
                break;
            }
        }
    }
}

/**
 * All element handler functions exposed to the HTML via window.
 * Objeto com todas as funcoes que o HTML chama via onclick.
 */
export const elementHandlers = {
    handleAddElement,
    handleRemoveElement,
    handleToggleVisibility,
    handleSelectElement,
    handleElementFieldChange,
    handleElementTransform,
    handleBoundaryFieldChange,
    handleAreaFieldChange,
    handleClearModel,
    handleCopyElement,
    handlePasteElement,
    handleZoomToElement,
    handleZoomToFamily,
    handleDuplicateElement,
    handleShowAllFamily,
    handleHideAllFamily,
    handleToggleDetailsDock,
    handleOpenFamilyModulePicker,
    handleElementOrgUnitChange,
    handleOverlayUpload,
    handleApplyImagery,
    handleGenerateRandomModel,
    generateRandomModel: handleGenerateRandomModel,
};
