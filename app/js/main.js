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
   APPLICATION ENTRY POINT â€” ecbyts v0.1.0-beta
   Ponto de entrada da aplicacao ecbyts

   Este arquivo apenas inicializa o sistema e conecta os modulos.
   A logica de cada area esta nos arquivos especificos:
   - handlers/   â†’ acoes do usuario (botoes, formularios)
   - scene/      â†’ visualizacao 3D (Three.js)
   - elements/   â†’ dados dos elementos ambientais
   - ui/         â†’ componentes da interface
   - analytics/  â†’ graficos e analises
   - io/         â†’ importar/exportar modelos

   ORDEM DE INICIALIZACAO:
   1. Traducoes (i18n)
   2. Gerenciador de campos
   3. Cena 3D
   4. Carrega modelo da URL (se houver)
   5. Interface (abas, paineis, eventos)
   6. Registra handlers globais
   7. Inicia animacao
   ================================================================ */

// --- Core ---
import { initI18n, t, applyTranslations, updateLanguageSelector } from './utils/i18n/translations.js';
import {
    initScene,
    handleResize,
    animate,
    wakeRenderLoop,
    requestRender,
    getInterpolationGroup,
    getVoxelGroup,
    getIssuesGroup,
} from './utils/scene/setup.js';
import { initLabelRenderer } from './utils/labels/renderer.js';
import { initLabels, clearAllLabels } from './utils/labels/manager.js';
import { restoreLabelDensity } from './utils/handlers/labels.js';
import { initPicker } from './utils/scene/picker.js';
import { initCompass, initGlobe, updateGlobe } from './utils/scene/compass.js';
import { initCursorProjector } from './utils/scene/cursorProjector.js';
import { initConstellation, updateConstellation } from './utils/scene/constellation.js';
import {
    generateRandomModel,
    getAllElements,
    setSelectedElement,
    getMeshByElementId,
    refreshAutoLabelNames,
    addElement,
    nextElementCounter,
    rebindMeshesToScene,
} from './core/elements/manager.js';
import {
    fitAllElements,
    setIsometricView,
    setTopView,
    setFrontView,
    getCameraState,
    setCameraState,
} from './utils/scene/controls.js';
import { getEnabledFamilies } from './core/elements/families.js';
import { getSelectedElement } from './core/elements/manager.js';
import { CONFIG, APP_VERSION } from './config.js';

// --- I/O ---
import { importFromURL, applyModel } from './core/io/import.js';
import { buildModel } from './core/io/export.js';
import { getModelId, getModelIdSync } from './core/io/modelLink.js';

// --- History ---
import { initHistory, pushSnapshot, clearHistory } from './utils/history/manager.js';
import { importCampaigns } from './core/campaigns/manager.js';
import { importEdges } from './utils/edges/manager.js';

// --- Cross-tab sync ---
import {
    initBroadcastSync,
    broadcastChange,
    onSyncMessage,
    destroyBroadcastSync,
    setSuppressed,
} from './utils/storage/broadcastSync.js';

// --- View Router + Home ---
import {
    initViewRouter,
    onSceneReady,
    switchView,
    getCurrentView,
    isSceneReady,
    markSceneReady,
    applySavedView,
} from './utils/scene/viewRouter.js';
import { initHomeGrid, renderHomeGrid, isHomeViewActive, setHomePreparingRandom } from './utils/ui/homeGrid.js';
import { initCustomize } from './utils/customize/manager.js';

// --- UI ---
import { showToast } from './utils/ui/toast.js';
import { initTabs, initSections } from './utils/ui/tabs.js';
import { initRibbon } from './utils/ui/ribbon.js';
import { initPanelManager, rebuildGridRows } from './utils/ui/panelManager.js';
import { initPanels } from './utils/ui/panels.js';
import { initMobileMenu } from './utils/ui/mobileMenu.js';
import { hydrateIcons, initIconObserver } from './utils/ui/icons.js';
import { initStampPanel, updateStampPanel, injectStampStyles } from './utils/ui/stampPanel.js';
import { initEdgeEditor, updateEdgePanel, injectEdgeStyles } from './utils/ui/edgeEditor.js';
import { initFieldManager } from './utils/ui/fieldManager.js';
import { initFormAccessibility } from './utils/ui/formAccessibility.js';
import { applyChartDefaults } from './utils/ui/chartTheme.js';
import './utils/ui/customSelect.js';
import { renderSensorCenterTab } from './utils/ui/sensorCenterPanel.js';
import {
    updateFamiliesList,
    updateElementsList,
    updateStatusBar,
    updateElementDetails,
    updateCampaignsList,
    updateScenesList,
} from './utils/ui/lists.js';
import { handleFileInputChange, handleKeyInputChange } from './utils/ui/modals.js';

// --- Analytics ---
import { getAnalytics, initLifecycleMetrics } from './core/analytics/index.js';

// --- Handlers (registro central) ---
import { registerAllHandlers } from './utils/handlers/index.js';
import { initTour } from './utils/tour/engine.js';
import {
    initProjectAreas,
    renderProjectAreas,
    renderCorporateIO,
    getInitConfig,
    restoreInitForm,
    createDefaultBoundary,
} from './utils/handlers/project.js';
import { initAreasTree, renderAreasTree } from './utils/handlers/project.js';

// --- Governance ---
import { renderGovernanceTab } from './utils/ui/governancePanel.js';
import { addInsuranceContract } from './utils/governance/contractManager.js';

// --- Cost Analysis ---
import { renderCostAnalysisTab } from './utils/ui/costAnalysisPanel.js';

// --- Pipeline Automation tab ---
import { renderPipelineManagerTab } from './utils/handlers/pipelines.js';
import { renderFilesPanel } from './utils/files/filePanel.js';

// --- SAO Protocol ---
import { initSAO } from './core/sao/index.js';

// --- Auth ---
import { initAuth } from './utils/auth/session.js';
import { updateAuthUI, authHandlers } from './utils/handlers/auth.js';

// --- Ticker ---
import { initTicker, getTickerConfig, computeAll, generateRandomTicker } from './utils/ticker/manager.js';
import { initTickerBar, renderTicker, setTickerBarVisible } from './utils/ticker/renderer.js';

// --- Calculator ---
import { initCalculator, generateRandomCalculator, getCalculatorItems } from './core/calculator/manager.js';

// --- User Constants ---
import { initConstants, generateRandomConstants } from './core/constants/manager.js';

// --- Pipelines ---
import { generateRandomPipelines } from './utils/handlers/elements.js';

// --- Interpolation ---
import {
    initInterpolation,
    setInterpolationGroup,
    createTerrainLayer,
    applyTerrainElevationToElements,
} from './core/interpolation/manager.js';

// --- Voxel Geology ---
import { initVoxel, setVoxelGroup } from './core/voxel/manager.js';

// --- Issues 3D + Bounty ---
import {
    loadIssues,
    setUpdateCallback as setIssuesUpdateCallback,
    setMarkerRefreshCallback,
    getOpenBountyCount,
    clearIssues,
} from './core/issues/manager.js';
import { setIssuesGroup as setIssuesGroupRef, refreshAllMarkers } from './core/issues/issueMarker.js';
import { initBountyPanel, updateBountyBadge } from './utils/ui/bountyPanel.js';

// --- Groups ---
import { initGroups, generateRandomGroups } from './utils/groups/manager.js';

// --- Report ---
import { initReport, generateRandomReport } from './utils/report/manager.js';
import { initFilterPresets } from './utils/report/filterPresets.js';
import { addScene, captureViewStart } from './utils/scenes/manager.js';

// --- Neural Networks ---
import { initNN } from './core/nn/manager.js';

// --- Libraries ---
import { initLibraries, installLibrary, isLibraryActive } from './utils/libraries/manager.js';
import { BUILTIN_EXAMPLES } from './utils/libraries/marketplace.js';
import { hasUserPurchased, downloadLibraryManifest } from './utils/libraries/supabaseMarketplace.js';

// --- Quick Actions (lightbulb) ---
import { initQuickActions } from './utils/handlers/quickActions.js';

// --- HUD Cards ---
import { initHudCards } from './utils/hud/cardManager.js';
import { initHudCardsPanel, renderHudCards } from './utils/hud/cardRenderer.js';

// --- Theme ---
import { initTheme } from './utils/theme/manager.js';

// --- Performance Monitor ---
import { getPerfMonitor } from './utils/performance/monitor.js';
import { initPerfHud, togglePerfHud } from './utils/performance/hud.js';

// --- Viz Settings ---
import { initVizSettings } from './utils/vizSettings/manager.js';
import { initSymbology } from './core/symbology/manager.js';
import { initVizSettingsBar, renderVizSettings } from './utils/vizSettings/renderer.js';

// --- JSON Inspector ---
import { initInspector } from './utils/inspector/manager.js';
import { initInspectorPanel, renderInspector } from './utils/inspector/renderer.js';

// --- Disclaimer ---
import { initDisclaimer } from './utils/ui/disclaimer.js';

// --- Storage Monitor ---
import { setEphemeral, clearModelData, safeSetItem } from './utils/storage/storageMonitor.js';

// --- Shape Editing ---
import {
    initEditor,
    isEditing,
    exitEditMode,
    exitGizmoMode,
    getEditMode,
    registerStrategy,
    toggleGizmoShapeEdit,
} from './utils/editing/editManager.js';
import { initContextMenu } from './utils/editing/contextMenu.js';
import { initGizmo, setGizmoMode, toggleGizmoSpace } from './utils/editing/gizmoController.js';
import { toggleSnap } from './utils/editing/snapEngine.js';

// --- Element Context Menu ---
import { initElementContextMenu } from './utils/ui/contextMenu.js';
// --- Canvas Context Menu (right-click on empty 3D space) ---
import { initCanvasContextMenu } from './utils/scene/canvasContextMenu.js';
import { PolygonStrategy } from './utils/editing/strategies/polygonStrategy.js';
import { PathStrategy } from './utils/editing/strategies/pathStrategy.js';
import { EllipsoidStrategy } from './utils/editing/strategies/ellipsoidStrategy.js';
import { EllipseStrategy } from './utils/editing/strategies/ellipseStrategy.js';
import { BoxStrategy } from './utils/editing/strategies/boxStrategy.js';
import { ExtrudedPolygonStrategy } from './utils/editing/strategies/extrudedPolygonStrategy.js';
import { PointStrategy } from './utils/editing/strategies/pointStrategy.js';

// Ensure static onclick handlers can switch views even before full handler registration.
if (typeof window !== 'undefined' && typeof window.handleSwitchView !== 'function') {
    window.handleSwitchView = (mode) => {
        Promise.resolve(switchView(mode)).catch((err) => {
            console.error('[ecbyts] handleSwitchView fallback failed:', err?.message);
        });
    };
}

const INIT_PHASE_TIMEOUT_MS = 15000;
const INIT_BOOT_WATCHDOG_MS = 45000;

async function _withInitTimeout(task, label, timeoutMs = INIT_PHASE_TIMEOUT_MS, { critical = false } = {}) {
    const timeoutError = new Error(`[Init] ${label} timed out after ${timeoutMs}ms`);
    try {
        return await Promise.race([
            Promise.resolve().then(task),
            new Promise((_, reject) => setTimeout(() => reject(timeoutError), timeoutMs)),
        ]);
    } catch (err) {
        if (critical) throw err;
        console.warn(`[Init] ${label} skipped: ${err?.message || err}`);
        return null;
    }
}

/**
 * Block until the user authenticates (authChanged event with valid session).
 * Aguarda ate o usuario autenticar via evento authChanged.
 * Timeout: 10 minutos (usuario abandonou a pagina).
 *
 * @returns {Promise<void>}
 */
function _waitForAuth() {
    return new Promise((resolve) => {
        const MAX_WAIT = 10 * 60_000; // 10 min
        const timer = setTimeout(resolve, MAX_WAIT);

        const handler = () => {
            import('./utils/auth/session.js').then(({ getCurrentUser }) => {
                if (getCurrentUser()) {
                    clearTimeout(timer);
                    window.removeEventListener('authChanged', handler);
                    resolve();
                }
            });
        };
        window.addEventListener('authChanged', handler);

        // Check imediato (sessao pode ja existir de OAuth redirect rapido)
        import('./utils/auth/session.js').then(({ getCurrentUser }) => {
            if (getCurrentUser()) {
                clearTimeout(timer);
                window.removeEventListener('authChanged', handler);
                resolve();
            }
        });
    });
}

// ================================================================
// MAIN INITIALIZATION
// ================================================================

/**
 * Check if user returned from Stripe library checkout.
 * Verifica se o usuario voltou de uma compra Stripe â€” baixa e instala a lib.
 */
async function _checkLibraryCheckoutReturn() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('library_purchase') !== 'success') return;

    const libraryDbId = params.get('library_db_id');
    if (!libraryDbId) return;

    // Clean URL params without reload
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, '', cleanUrl);

    try {
        // Small delay to ensure auth session is ready
        await new Promise((r) => setTimeout(r, 1000));

        const purchased = await hasUserPurchased(libraryDbId);
        if (!purchased) {
            console.warn('[Checkout] Purchase not confirmed for', libraryDbId);
            return;
        }

        // Download manifest and install
        const dl = await downloadLibraryManifest(libraryDbId);
        if (dl.manifest) {
            const result = installLibrary(dl.manifest);
            if (result.success) {
                window.showToast?.(`Purchase complete! ${dl.manifest.name} installed.`, 'success');
            } else {
                window.showToast?.(result.error, 'error');
            }
        } else {
            console.warn('[Checkout] Manifest download failed:', dl.error);
        }

        // Auto-create local insurance contracts from DB records
        try {
            const { getSupabaseClient, getCurrentUser } = await import('./utils/auth/session.js');
            const sb = getSupabaseClient();
            const user = getCurrentUser();
            if (sb && user) {
                const { data: insuranceRows } = await sb
                    .from('insurance_purchases')
                    .select('*')
                    .eq('user_id', user.id)
                    .eq('library_id', libraryDbId)
                    .in('status', ['active', 'pending']);
                if (insuranceRows?.length) {
                    for (const ins of insuranceRows) {
                        addInsuranceContract({
                            subtype: ins.subtype,
                            linkedOrderId: ins.library_purchase_id || ins.order_id || '',
                            linkedLibraryId: ins.library_id,
                            premiumCents: ins.premium_cents,
                            coverageValueCents: ins.coverage_value_cents,
                            userName: user.email || '',
                            currency: 'USD',
                        });
                    }
                    console.log(`[Checkout] Created ${insuranceRows.length} insurance contract(s)`);
                }
            }
        } catch (insErr) {
            console.warn('[Checkout] Insurance contract creation skipped:', insErr);
        }
    } catch (err) {
        console.error('[Checkout] Post-checkout error:', err);
    }
}

// ----------------------------------------------------------------
// INIT MODE HELPERS â€” funcoes auxiliares para os modos de init
// ----------------------------------------------------------------

/**
 * Initialize from the user's most recent cloud model.
 * Se logado, busca ultimo modelo. Senao, fallback para blank.
 */
async function _initLastProjectMode() {
    const { isLoggedIn } = await import('./utils/auth/session.js');
    if (!isLoggedIn()) {
        showToast(t('initLastProjectNotLoggedIn'), 'warning');
        await getModelId();
        return;
    }

    showToast(t('initLastProjectLoading'), 'info');

    try {
        const { loadMostRecentModel } = await import('./utils/cloud/manager.js');
        const result = await Promise.race([
            loadMostRecentModel(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout (10s)')), 10000)),
        ]);

        if (!result || !result.modelData) {
            showToast(t('initLastProjectNoModels'), 'info');
            await getModelId();
            return;
        }

        setEphemeral(false);
        clearModelData();
        await applyModel(result.modelData);

        // Sincroniza ID do modelo cloud para que "Salvar" faca UPDATE
        const { setCurrentCloudModelId } = await import('./utils/handlers/cloud.js');
        setCurrentCloudModelId(result.modelId);

        showToast(t('initLastProjectLoaded'), 'success');
    } catch (err) {
        console.error('[Init] lastProject mode error:', err);
        showToast(t('initLastProjectError'), 'error');
        await getModelId(); // fallback blank
    }
}

/**
 * Initialize with map picker for UTM origin selection.
 * Abre mapa interativo, usuario seleciona local, cria boundary com aerial overlay.
 */
async function _initMapPickerMode() {
    // Esconde loading overlay para o usuario interagir com o mapa
    const _loadingEl = document.getElementById('loading-overlay');
    if (_loadingEl) _loadingEl.style.display = 'none';

    try {
        const { openMapPickerModal } = await import('./utils/ui/mapPicker.js');
        const result = await openMapPickerModal();

        if (result) {
            const { wgs84ToUTM, setOrigin } = await import('./core/io/geo/coordinates.js');
            const { buildOverlayUrls } = await import('./core/io/geo/overlayUrls.js');
            const utm = wgs84ToUTM({ latitude: result.latitude, longitude: result.longitude });
            const hemisphere = result.latitude < 0 ? 'S' : 'N';

            setOrigin({
                easting: utm.easting,
                northing: utm.northing,
                elevation: 0,
                zone: utm.zone,
                hemisphere,
            });

            // Atualiza campos na UI
            const oeEl = document.getElementById('utm-origin-easting');
            const onEl = document.getElementById('utm-origin-northing');
            const zoneEl = document.getElementById('utm-zone');
            const hemiEl = document.getElementById('utm-hemisphere');
            const latEl = document.getElementById('origin-latitude');
            const lonEl = document.getElementById('origin-longitude');

            if (oeEl) oeEl.value = utm.easting.toFixed(2);
            if (onEl) onEl.value = utm.northing.toFixed(2);
            if (zoneEl) zoneEl.value = utm.zone;
            if (hemiEl) hemiEl.value = hemisphere;
            if (latEl) latEl.value = result.latitude.toFixed(6);
            if (lonEl) lonEl.value = result.longitude.toFixed(6);

            // Cria boundary 200x200m com imagem aerial do local selecionado
            const halfW = 100;
            const halfL = 100;
            const _sp = localStorage.getItem('ecbyts-tile-provider');
            const _piParsed = _sp != null ? parseInt(_sp, 10) : NaN;
            const _pi = Number.isFinite(_piParsed) && _piParsed >= 0 ? _piParsed : undefined;
            const { overlayUrl, overlayFallbackUrls } = await buildOverlayUrls(halfW, halfL, _pi);
            const boundaryId = `boundary-${nextElementCounter()}`;

            addElement('boundary', boundaryId, t('defaultBoundaryName') || 'Area de Estudo', {
                vertices: [
                    { x: -halfW, y: 0, z: -halfL },
                    { x: halfW, y: 0, z: -halfL },
                    { x: halfW, y: 0, z: halfL },
                    { x: -halfW, y: 0, z: halfL },
                ],
                type: 'study_area',
                overlayUrl,
                overlayFallbackUrls,
                overlayOpacity: 0.85,
                sourceLat: result.latitude,
                sourceLon: result.longitude,
            });

            // Atualiza globo explicitamente (listener originChanged pode nÃ£o existir ainda)
            updateGlobe();

            showToast(t('initMapOriginSet'), 'success');
        }
    } catch (err) {
        console.error('[Init] mapPicker mode error:', err);
    } finally {
        // Restaura loading overlay para o resto do init
        if (_loadingEl) _loadingEl.style.display = '';
    }

    // Prossegue como projeto blank independentemente
    await getModelId();
}

/**
 * Initialize with last saved UTM origin from localStorage.
 * Restaura a Ãºltima origem usada nesta mÃ¡quina e cria boundary com aerial overlay.
 */
async function _initLastLocationMode() {
    try {
        const { getLastSavedOrigin, setOrigin, utmToWGS84 } = await import('./core/io/geo/coordinates.js');
        const saved = getLastSavedOrigin();

        if (!saved) {
            showToast(t('initLastLocationEmpty') || 'No saved location. Falling back to Map Picker.', 'warning');
            await _initMapPickerMode();
            return;
        }

        // Aplica origem salva
        setOrigin(saved);

        // Atualiza campos na UI
        const oeEl = document.getElementById('utm-origin-easting');
        const onEl = document.getElementById('utm-origin-northing');
        const zoneEl = document.getElementById('utm-zone');
        const hemiEl = document.getElementById('utm-hemisphere');
        const latEl = document.getElementById('origin-latitude');
        const lonEl = document.getElementById('origin-longitude');

        if (oeEl) oeEl.value = saved.easting.toFixed(2);
        if (onEl) onEl.value = saved.northing.toFixed(2);
        if (zoneEl) zoneEl.value = saved.zone;
        if (hemiEl) hemiEl.value = saved.hemisphere;

        const wgs = utmToWGS84(saved);
        if (latEl) latEl.value = wgs.latitude.toFixed(6);
        if (lonEl) lonEl.value = wgs.longitude.toFixed(6);

        // Cria boundary 200x200m com aerial overlay (funÃ§Ã£o compartilhada)
        await createDefaultBoundary(wgs.latitude, wgs.longitude);

        await getModelId();

        // Atualiza globo explicitamente (listener originChanged pode nÃ£o existir ainda)
        updateGlobe();

        showToast(t('initLastLocationRestored') || 'Last location restored', 'success');
    } catch (err) {
        console.error('[Init] lastLocation mode error:', err);
        await getModelId();
    }
}

/**
 * Main initialization function.
 * Funcao principal â€” inicializa todos os subsistemas na ordem correta.
 * Chamada automaticamente quando a pagina termina de carregar.
 */
async function init() {
    const bootWatchdog = setTimeout(() => {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (!loadingOverlay) return;
        console.warn(`[Init] Boot watchdog reached ${INIT_BOOT_WATCHDOG_MS}ms; hiding startup overlay`);
        loadingOverlay.remove();
        try {
            showToast(
                t('initSlowContinue') || 'Initial loading took too long. Continuing with partial startup.',
                'warning',
            );
        } catch {
            // noop
        }
    }, INIT_BOOT_WATCHDOG_MS);

    try {
        // 0a. Version gate â€” limpa dados de modelo obsoletos em mudanÃ§a de versÃ£o
        const storedVersion = localStorage.getItem('ecbyts-version');
        if (storedVersion !== APP_VERSION) {
            console.warn(`[ecbyts] VersÃ£o ${storedVersion || 'N/A'} â†’ ${APP_VERSION}. Limpando dados de modelo...`);
            clearModelData();
            safeSetItem('ecbyts-version', APP_VERSION);
        }

        // 0b. VersÃ£o na UI (vinculada a APP_VERSION â€” fonte unica)
        const versionEl = document.getElementById('app-version');
        if (versionEl) versionEl.textContent = `v${APP_VERSION}`;

        // 0c. Tema â€” aplica antes de renderizar DOM para evitar flash
        initTheme();

        // 1. Traducoes
        await initI18n();
        updateLanguageSelector();

        // 1a. Telemetria operacional de lifecycle (workflow/pipeline)
        initLifecycleMetrics();

        // 1b. Chart.js global theme + a11y fallback plugin
        if (window.Chart) {
            applyChartDefaults(window.Chart);
        }

        // 2. Gerenciador de campos personalizados
        initFieldManager();

        // 2b. Protocolo SAO (taxonomia de parametros ambientais)
        await _withInitTimeout(() => initSAO(), 'SAO');

        // 2c. Bibliotecas (restaura libs instaladas, reativa as ativas)
        initLibraries();

        // 2c-bis. Quick Actions lightbulb (depende de libraries inicializadas)
        initQuickActions();

        // Expoe modulo de coordenadas para quickActions geo-filtering (lazy)
        // + registra getter de elementos para re-projecao ao mudar origin
        import('./core/io/geo/coordinates.js')
            .then((mod) => {
                window._ecbytsCoordModule = mod;
                mod.setElementsGetter(getAllElements);
            })
            .catch(() => {});

        // 2d. Redes neurais (restaura redes salvas do IndexedDB)
        await _withInitTimeout(() => initNN(), 'Neural Networks');

        // 2e. Autenticacao (restaura sessao, inicia provedores OAuth)
        await _withInitTimeout(() => initAuth(), 'Authentication');

        // 2e-bis. Registra handlers de auth no window cedo — necessario para que
        // o modal de login funcione no invite gate (antes do registerAllHandlers completo)
        Object.assign(window, authHandlers);

        // 2f. Checkout return (verifica se usuario voltou de compra Stripe)
        _checkLibraryCheckoutReturn();

        // 2g. Telemetria de cliques (buffer local, flush em lote, opt-out LGPD)
        import('./utils/telemetry/tracker.js')
            .then(({ initTelemetry }) => {
                initTelemetry();
            })
            .catch((e) => console.warn('[ecbyts] Telemetry init skipped:', e?.message));

        // 2h. View Router (maquina de estado: Actions/2D/2D+D/3D)
        initViewRouter();

        // 2i. Home Grid â€” inicializado APOS registerAllHandlers (precisa de hydrateIcons)
        //     Placeholder: initHomeGrid() e chamado no step 7 abaixo.

        // 3. Cena 3D â€” LAZY: so inicializada na primeira troca para 2D/2D+D/3D
        //    Registra callback via onSceneReady; switchView() chama quando necessario.
        onSceneReady(async () => {
            const container = document.getElementById('canvas-container');
            initScene(container);

            // Injeta grupos Three.js nos managers de interpolação e voxel
            // DEVE rodar aqui (após initScene) porque os grupos são criados em initScene()
            setInterpolationGroup(getInterpolationGroup());
            setVoxelGroup(getVoxelGroup());
            setIssuesGroupRef(getIssuesGroup());

            // Re-vincula meshes criados antes do initScene (modo random + lazy scene init)
            const rebind = rebindMeshesToScene();
            if (rebind.attached > 0) {
                console.info(`[ecbyts] Rebound ${rebind.attached} mesh(es) into scene group`);
            }

            // 3a. Labels 3D (CSS2DRenderer overlay)
            initLabelRenderer(container);
            initLabels();
            restoreLabelDensity();

            // 3b. Seletor 3D (raycasting para clicar em elementos)
            initPicker(container, {
                onSelect: (elementId) => window.handleSelectElement(elementId),
                onDeselect: () => window.handleSelectElement(null),
                onSelectLayer: (layerId) => window.handleSelectLayer(layerId),
            });

            // 3c. Shape editor (ediÃ§Ã£o interativa de formas no viewport)
            initEditor(container);
            initGizmo();
            initContextMenu(container);
            initCanvasContextMenu(container);
            // Tier 1: Polygon + Path
            registerStrategy('boundary', PolygonStrategy);
            registerStrategy('river', PathStrategy);
            // Tier 2: Axis/dimension handles
            registerStrategy('plume', EllipsoidStrategy);
            registerStrategy('lake', EllipseStrategy);
            registerStrategy('building', ExtrudedPolygonStrategy);
            registerStrategy('tank', BoxStrategy);
            // Tier 3: Point-type elements (depth/position handles)
            registerStrategy('well', PointStrategy);
            registerStrategy('spring', PointStrategy);
            registerStrategy('waste', PointStrategy);

            // 3d. Cursor projector (crosshair + coordenadas no ground plane)
            initCursorProjector(container);

            // 3e. HUD de georreferÃªncia (rosa dos ventos + mini globo + constelacao)
            initCompass();
            initGlobe();
            initConstellation({
                onSelect: (elementId) => window.handleSelectElement(elementId),
            });

            // Marca cena como pronta e inicia render loop
            markSceneReady();
            animate();
        });

        // 4. Tenta carregar modelo da URL (?key=ECO1-...)
        //    Se modelo carregado, forÃ§a view 3D (precisa da cena ativa)
        let loadedFromURL = false;
        try {
            const model = await importFromURL();
            if (model) {
                loadedFromURL = true;
                showToast(t('modelLoadedFromUrl'), 'success');
                // Modelo importado via URL â€” ativa view 3D diretamente
                await switchView('3d');
            }
        } catch (error) {
            showToast(`${t('failedToLoad')}: ${error.message}`, 'error');
        }

        // LÃª configuraÃ§Ã£o de inicializaÃ§Ã£o do localStorage
        const initConfig = getInitConfig();
        let _showRandomBootState = false;

        // Invite-only: ler ?invite=CODE da URL para pre-preencher o campo
        const _inviteRaw = new URLSearchParams(location.search).get('invite') || null;
        const _inviteParam = _inviteRaw
            ? _inviteRaw
                  .replace(/[^A-Z0-9-]/gi, '')
                  .toUpperCase()
                  .substring(0, 32)
            : null;
        if (_inviteParam) {
            // Salvar invite code antes de qualquer redirect OAuth perder a URL
            sessionStorage.setItem('ecbyts-invite-code', _inviteParam);
        }

        // --- INVITE GATE — hard block (roda ANTES e INDEPENDENTE de loadedFromURL/welcomeShown) ---
        // V1+V2 fix: desacoplado de localStorage e URL. Unica condicao: INVITE_ONLY + sem auth.
        if (CONFIG.FEATURES.INVITE_ONLY) {
            const { getCurrentUser } = await import('./utils/auth/session.js');
            // E2E bypass: allow tests to skip invite gate
            const e2eBypass =
                typeof localStorage !== 'undefined' && localStorage.getItem('__e2e_bypass_invite__') === '1';
            if (!getCurrentUser() && !e2eBypass) {
                const _loadingEl = document.getElementById('loading-overlay');
                if (_loadingEl) _loadingEl.style.display = 'none';

                try {
                    const { showWelcomeScreen } = await import('./utils/ui/welcomeScreen.js');
                    const chosenMode = await showWelcomeScreen({ prefillCode: _inviteParam });

                    if (chosenMode === 'invite-accepted') {
                        // Auth modal: abrir diretamente (handlers ainda nao registrados no window)
                        const authModal = document.getElementById('auth-modal');
                        if (authModal) {
                            // Invite-lock: esconder X, bloquear Escape
                            const closeBtn = authModal.querySelector('.auth-card-close');
                            if (closeBtn) closeBtn.style.display = 'none';
                            authModal.classList.add('active');
                        }
                        // Aguardar login real via authChanged event
                        await _waitForAuth();
                        // Limpar modal apos login
                        if (authModal) {
                            authModal.classList.remove('active');
                            const closeBtn = authModal.querySelector('.auth-card-close');
                            if (closeBtn) closeBtn.style.display = '';
                        }
                        initConfig.mode = 'blank';
                    }
                    // waitlist ou outro resultado: usuario nao autenticado
                } catch (e) {
                    console.warn('[Welcome] Invite gate error:', e.message);
                } finally {
                    if (_loadingEl) _loadingEl.style.display = '';
                }

                // HARD CHECK: se ainda nao autenticado, abortar init
                const { isInviteGateLocked } = await import('./utils/auth/inviteGate.js');
                if (isInviteGateLocked()) {
                    console.warn('[Init] Invite gate: user not authenticated. Halting init.');
                    const overlay = document.getElementById('loading-overlay');
                    if (overlay) overlay.remove();
                    return; // EXIT init()
                }
            }
        }

        // --- WELCOME SCREEN NORMAL (sem invite ou usuario ja autenticado) ---
        if (!loadedFromURL) {
            const welcomeShown = localStorage.getItem('ecbyts-welcome-shown') === 'true';
            if (!welcomeShown) {
                const _loadingEl = document.getElementById('loading-overlay');
                if (_loadingEl) _loadingEl.style.display = 'none';

                try {
                    const { showWelcomeScreen } = await import('./utils/ui/welcomeScreen.js');
                    const chosenMode = await showWelcomeScreen({ prefillCode: _inviteParam });

                    if (chosenMode === 'tour') {
                        initConfig.mode = 'random';
                        setTimeout(() => {
                            if (window.handleStartTour) window.handleStartTour();
                        }, 1000);
                    } else if (chosenMode) {
                        initConfig.mode = chosenMode;
                    }
                } catch (e) {
                    console.warn('[Welcome] Failed to show welcome screen:', e.message);
                } finally {
                    if (_loadingEl) _loadingEl.style.display = '';
                }
            }
        }

        // Se nao veio da URL, decide se gera modelo random ou inicia em branco
        if (!loadedFromURL && initConfig.mode === 'random') {
            // Random gera novo modelo por padrão.
            // Para restaurar sessão anterior nesse modo, use:
            // initConfig.resumeOnRandom === true
            const shouldResumeOnRandom = initConfig.resumeOnRandom === true;
            let _savedSession = null;
            if (shouldResumeOnRandom) {
                const { idbGet } = await import('./utils/storage/idbStore.js');
                _savedSession = await idbGet('ecbyts-session');
            }
            if (_savedSession) {
                try {
                    await applyModel(_savedSession);
                    // applyModel chama clearModelData internamente â€” IDB de Category C Ã© recarregado

                    // Restaura estado de UI (view mode + painÃ©is) gravado junto Ã  sessÃ£o
                    const ui = _savedSession._uiState;
                    if (ui) {
                        // Re-escreve chaves de painel no localStorage para initPanelManager ler corretamente
                        const _lsSet = (k, v) => {
                            try {
                                if (v != null) localStorage.setItem(k, v);
                            } catch (_) {}
                        };
                        _lsSet('ecbyts-panel-layout', ui.panelLayout);
                        _lsSet('ecbyts-bars-layout', ui.barsLayout);
                        _lsSet('ecbyts-constellation-height', ui.constellationHeight);
                        _lsSet('ecbyts-constellation-collapsed', ui.constellationCollapsed);
                        _lsSet('ecbyts-tab-layout', ui.tabLayout);
                        // View mode: aplica diretamente via setViewMode para sincronizar camera/controls
                        if (ui.viewMode) {
                            try {
                                localStorage.setItem('ecbyts-view-mode', ui.viewMode);
                            } catch (_) {}
                            try {
                                localStorage.setItem('ecbyts-default-view', ui.viewMode);
                            } catch (_) {}
                            const { setViewMode } = await import('./utils/scene/controls.js');
                            setViewMode(ui.viewMode);
                        }
                    }
                } catch (e) {
                    console.warn('[Session] Falha ao restaurar sessÃ£o:', e.message);
                    // SessÃ£o corrompida â€” gera novo random abaixo
                    const { idbDelete } = await import('./utils/storage/idbStore.js');
                    await idbDelete('ecbyts-session');
                }
            }

            if (!_savedSession) {
                // Home state: mostra status transitorio enquanto modelo random e preparado.
                _showRandomBootState = true;
                setHomePreparingRandom(true);

                // clearModelData garante start fresh (limpa IDB + LS Category C).
                clearModelData();
                clearIssues();
                clearAllLabels();
                clearHistory();

                // Salva origin completo do usuario antes do random (se definido, preserva)
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

                const randomResult = await generateRandomModel();

                // Restaura origin completo do usuario se tinha definido antes
                // e recalcula imagem aerea do boundary para o local correto
                if (_savedE !== 0 || _savedN !== 0) {
                    const { setOrigin } = await import('./core/io/geo/coordinates.js');
                    setOrigin({
                        easting: _savedE,
                        northing: _savedN,
                        elevation: _savedElev,
                        zone: _savedZone,
                        hemisphere: _savedHemi,
                    });
                    if (_oeEl) _oeEl.value = _savedE.toFixed(2);
                    if (_onEl) _onEl.value = _savedN.toFixed(2);

                    // Recalcula overlay do boundary com o origin do usuario
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
                        const { buildOverlayUrls: buildUrls } = await import('./core/io/geo/overlayUrls.js');
                        const _sp2 = localStorage.getItem('ecbyts-tile-provider');
                        const _pi2Parsed = _sp2 != null ? parseInt(_sp2, 10) : NaN;
                        const _pi2 = Number.isFinite(_pi2Parsed) && _pi2Parsed >= 0 ? _pi2Parsed : undefined;
                        const { overlayUrl: newUrl } = await buildUrls(halfW, halfL, _pi2);
                        boundary.data.overlayUrl = newUrl;
                        boundary.data.overlayFallbackUrls = [];

                        // Recarrega textura do overlay
                        const mesh = getMeshByElementId(boundary.id);
                        if (mesh) {
                            const overlay = mesh.getObjectByName('overlay');
                            if (overlay && overlay.material) {
                                const { loadOverlayTexture } = await import('./core/elements/meshFactory.js');
                                loadOverlayTexture([newUrl], overlay.material);
                            }
                        }
                    }
                }

                // Importa campanhas geradas pelo modelo random
                if (randomResult.campaigns && randomResult.campaigns.length > 0) {
                    importCampaigns(
                        randomResult.campaigns.map((c) => ({
                            id: c.id,
                            name: c.name,
                            startDate: c.date.toISOString().slice(0, 10),
                        })),
                    );
                }

                // Importa edges (relacoes entre elementos) geradas pelo modelo random
                if (randomResult.edges && randomResult.edges.length > 0) {
                    importEdges(randomResult.edges, { replace: true });
                }

                // Vincula areas geradas ao painel Project > Areas
                if (randomResult.areas && randomResult.areas.length > 0) {
                    window.projectAreas = randomResult.areas;
                }

                await getModelId(); // Gera ID unico para o modelo

                // Gera ticker items de exemplo com dados do modelo random
                generateRandomTicker();

                // Gera calculator items de exemplo (metricas, regras, ratios)
                generateRandomCalculator();
                generateRandomConstants();

                // Gera pipelines de automacao BPMN de exemplo (Category B â€” persistidos)
                generateRandomPipelines();

                // Instala biblioteca de demonstracao (badge "Dados Hipoteticos" no ticker)
                if (!isLibraryActive('synthetic-monitoring-demo')) {
                    const demoLib = BUILTIN_EXAMPLES.find((l) => l.id === 'synthetic-monitoring-demo');
                    if (demoLib) installLibrary(demoLib);
                }

                // Gera grupos de exemplo para organizar elementos e familias
                generateRandomGroups(getAllElements(), getEnabledFamilies());

                // Gera cenas de visualizacao (5) com diferentes vistas de camera
                // Nota: se cena 3D nao esta ativa (lazy init), presets de camera sao no-op
                const sceneConfigs = [
                    { name: 'Linha de Base', view: 'isometric' },
                    { name: 'Vista Superior', view: 'top' },
                    { name: 'Vista Frontal', view: 'front' },
                    { name: 'Evolucao', view: 'isometric' },
                    { name: 'Estado Atual', view: 'isometric' },
                ];
                const viewFns = { isometric: setIsometricView, top: setTopView, front: setFrontView };
                const createdScenes = [];
                for (const cfg of sceneConfigs) {
                    // Aplica preset de camera antes de capturar (no-op se cena nao inicializada)
                    if (isSceneReady()) viewFns[cfg.view]?.();
                    const s = addScene({ name: cfg.name });
                    if (isSceneReady()) captureViewStart(s.id);
                    createdScenes.push(s);
                }
                // Volta para vista isometrica ao final
                if (isSceneReady()) setIsometricView();

                // Gera relatorio simplificado com ancoras vinculadas as cenas
                const campaignData = (randomResult.campaigns || []).map((c) => ({
                    name: c.name,
                    startDate: c.date.toISOString().slice(0, 10),
                }));
                generateRandomReport(createdScenes, getAllElements(), campaignData);

                // Governance: sync financial data → contracts, WBS, project registry
                if (randomResult.financial) {
                    try {
                        const { addContract } = await import('./utils/governance/contractManager.js');
                        const { addWbsItem } = await import('./utils/governance/wbsManager.js');
                        const { addProject, addResource, addAllocation } =
                            await import('./utils/governance/projectManager.js');
                        const fin = randomResult.financial;
                        const contractIdMap = {};
                        for (const rc of fin.contracts || []) {
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
                        const phaseItemMap = {};
                        for (const wbs of fin.wbs || []) {
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
                                baseline: {
                                    cost: wbs.budget,
                                    startDate: wbs.startDate,
                                    endDate: wbs.endDate,
                                    weight: wbs.weight || 0,
                                },
                                planned: { cost: wbs.budget, startDate: wbs.startDate, endDate: wbs.endDate },
                                actual: { cost: wbs.eva?.ac || 0, percentComplete: wbs.progress || 0 },
                                status: wbs.status === 'complete' ? 'completed' : wbs.status,
                            });
                        }
                        if (fin.projectRegistry) {
                            const reg = fin.projectRegistry;
                            reg.project.linkedContractIds = (reg.project.linkedContractIds || []).map(
                                (oldId) => contractIdMap[oldId] || oldId,
                            );
                            const proj = addProject(reg.project);
                            for (const res of reg.resources || []) addResource(res);
                            for (const alloc of reg.allocations || []) addAllocation({ ...alloc, projectId: proj.id });
                        }
                    } catch (e) {
                        console.warn('[bootstrap] governance seed skipped:', e.message);
                    }
                }

                // ── Seeds de modulos (pós-modelo, cada um com try/catch) ──

                // Issues / Bounty
                try {
                    const { createIssue } = await import('./core/issues/manager.js');
                    const wells = getAllElements().filter((e) => e.family === 'well');
                    const violWells = wells
                        .filter((el) =>
                            (el.data?.observations || []).some(
                                (o) =>
                                    (o.parameterId === 'benzene' && o.value > 1) ||
                                    (o.parameterId === 'tph' && o.value > 20),
                            ),
                        )
                        .slice(0, 3);
                    violWells.forEach((el) => {
                        const obs = el.data.observations.find(
                            (o) =>
                                (o.parameterId === 'benzene' && o.value > 1) ||
                                (o.parameterId === 'tph' && o.value > 20),
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
                    console.warn('[bootstrap] issues seed skipped:', e.message);
                }

                // Sequencer — keyframes via scenes com viewStart sintetico
                try {
                    const seqMgr = await import('./core/sequencer/manager.js');
                    if (seqMgr.initSequencer) await seqMgr.initSequencer();
                    const bnd = getAllElements().find((e) => e.family === 'boundary');
                    if (bnd?.data?.vertices) {
                        const vs = bnd.data.vertices;
                        const cx = vs.reduce((s, v) => s + (v.x || 0), 0) / vs.length;
                        const cz = vs.reduce((s, v) => s + (v.z || 0), 0) / vs.length;
                        const span = Math.max(
                            ...vs.map((v) => Math.abs(v.x || 0)),
                            ...vs.map((v) => Math.abs(v.z || 0)),
                        );
                        const camDist = span * 2;
                        const presets = [
                            { camera: { x: camDist, y: camDist, z: camDist }, target: { x: cx, y: 0, z: cz } },
                            { camera: { x: cx, y: camDist * 1.5, z: cz }, target: { x: cx, y: 0, z: cz } },
                            { camera: { x: cx, y: camDist * 0.3, z: cz + camDist }, target: { x: cx, y: 0, z: cz } },
                        ];
                        createdScenes.forEach((scene, i) => {
                            if (!scene.viewStart) scene.viewStart = presets[i % presets.length];
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
                    console.warn('[bootstrap] sequencer seed skipped:', e.message);
                }

                // Validation CONAMA
                try {
                    const { setActiveProfileIds, validateBatchWithProfile, getValidationProfile } =
                        await import('./core/validation/profileEngine.js');
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
                    console.warn('[bootstrap] validation seed skipped:', e.message);
                }

                // SAO cenario
                try {
                    const sao = await import('./core/sao/index.js');
                    if (sao.initSAO) await sao.initSAO();
                    await sao.activateScenario('oil_spill');
                    sao.setTier('recommended');
                } catch (e) {
                    console.warn('[bootstrap] SAO seed skipped:', e.message);
                }

                // Audit Benford
                try {
                    const { benfordTest } = await import('./core/audit/benford.js');
                    const values = getAllElements()
                        .flatMap((el) => (el.data?.observations || []).map((o) => o.value))
                        .filter((v) => v > 0);
                    if (values.length >= 10) {
                        const result = benfordTest(values);
                        safeSetItem('ecbyts-audit-benford', JSON.stringify(result));
                    }
                } catch (e) {
                    console.warn('[bootstrap] audit seed skipped:', e.message);
                }

                // EIS score
                try {
                    const { EisCalculator } = await import('./core/eis/eisCalculator.js');
                    const calc = new EisCalculator();
                    const result = calc.calculate({ T: 4, A: 4, Cp: 4, Ty: 3, Cs: 4, Cm: 4 }, 'geometric');
                    safeSetItem('ecbyts-eis-demo', JSON.stringify(result));
                } catch (e) {
                    console.warn('[bootstrap] EIS seed skipped:', e.message);
                }

                // NN demo
                try {
                    const { registerNetwork, getNetwork, updateNetworkMapping, resizeNetwork } =
                        await import('./core/nn/manager.js');
                    const { trainNetworkFromModel } = await import('./core/nn/whatIfEngine.js');
                    const { PARAMETER_RANGES: PR } = await import('./core/elements/randomModel.js');
                    const nnId = 'demo-plume-predictor';
                    if (!getNetwork(nnId)) {
                        registerNetwork(nnId, {
                            inputSize: 7,
                            hiddenLayerSizes: [16, 8],
                            outputSize: 6,
                            mode: 'regression',
                        });
                    }
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
                        inputs: ['pH', 'conductivity', 'temperature', 'redox', 'benzene', 'toluene', 'tph'].map(
                            mkInput,
                        ),
                        outputs: Object.keys(geoRange).map(mkOutput),
                    });
                    resizeNetwork(nnId, 7, 6);
                    trainNetworkFromModel(nnId);
                } catch (e) {
                    console.warn('[bootstrap] NN demo training skipped:', e.message);
                }

                // Auto-seleciona primeiro poco para a constelacao ficar visivel
                const allEls = getAllElements();
                const firstWell = allEls.find((e) => e.family === 'well') || allEls[0];
                if (firstWell) setSelectedElement(firstWell.id);
            } // fim if (!_savedSession)
        } else if (!loadedFromURL && initConfig.mode === 'lastLocation') {
            // Modo lastLocation: restaura ultima origem UTM do localStorage
            await _initLastLocationMode();
        } else if (!loadedFromURL && initConfig.mode === 'lastProject') {
            // Modo lastProject: carrega ultimo modelo salvo na nuvem
            await _initLastProjectMode();
        } else if (!loadedFromURL && initConfig.mode === 'mapPicker') {
            // Modo mapPicker: abre mapa interativo para selecionar UTM origin
            await _initMapPickerMode();
        } else if (!loadedFromURL) {
            // Modo blank: gera apenas o model ID, sem elementos
            await getModelId();
        }

        // 5. Interface
        initRibbon();

        // 5a. Groups â€” carrega grupos customizados do localStorage
        initGroups();

        // 5c. Report â€” carrega relatorio do localStorage
        await _withInitTimeout(() => initReport(), 'Report');
        initFilterPresets();

        // 5b. Ticker bar â€” precisa estar no DOM antes do panelManager para grid correto
        initTicker();
        initTickerBar();

        // 5b2. Calculator (metricas compostas, regras, ratios)
        initCalculator();
        // Expoe getCalculatorItems para o modulo de constantes (integrity check)
        window.__ecbyts_calculator = { getCalculatorItems };

        // 5b2a. User constants (fatores de emissao, incertezas, conversoes)
        initConstants();

        // 5b3. Interpolation (superfÃ­cies topogrÃ¡ficas, nÃ­vel d'Ã¡gua, contaminaÃ§Ã£o)
        // Nota: setInterpolationGroup() agora roda dentro do callback onSceneReady,
        // após initScene() criar o grupo Three.js. initInterpolation() carrega dados
        // persistidos e não depende do grupo — pode rodar antes da cena.
        await _withInitTimeout(() => initInterpolation(), 'Interpolation');

        // 5b4. Voxel geology (volumes 3D voxelizados â€” zona vadosa/saturada)
        // Nota: setVoxelGroup() agora roda dentro do callback onSceneReady.
        await _withInitTimeout(() => initVoxel(), 'Voxel');

        // 5b5. Issues 3D (marcadores de nao-conformidade vinculados a coordenadas 3D)
        // Nota: setIssuesGroupRef() agora roda dentro do callback onSceneReady.
        if (CONFIG.FEATURES.ISSUES_3D) {
            setMarkerRefreshCallback(refreshAllMarkers);
            await loadIssues();
            refreshAllMarkers();

            // Bounty Board panel in right panel tab
            const bountyTab = document.getElementById('tab-bounty');
            if (bountyTab) initBountyPanel(bountyTab);
            updateBountyBadge();
        }

        // 5d. HUD Cards (intangible/generic elements overlay)
        initHudCards();
        initHudCardsPanel();

        // 5e. Viz Settings bar (3D visualization controls)
        initVizSettings();
        initVizSettingsBar();
        initSymbology();

        // 5f. JSON Inspector panel (element data inspection/editing)
        initInspector();
        initInspectorPanel();

        // 5g. ML Studio side panel (Neural Network wizard)
        import('./core/nn/panelRenderer.js').then((mod) => mod.initMLPanel()).catch(() => {});

        initPanelManager();
        initPanels();
        initMobileMenu();
        initTabs();
        initSections();
        initStampPanel();
        initEdgeEditor();
        initElementContextMenu();
        injectStampStyles();
        injectEdgeStyles();
        setupEventListeners();
        initProjectAreas();
        initAreasTree();
        initAnalyticsModule();
        initFormAccessibility();

        // 5b. Inicializa AES vault para protecao LGPD (fire-and-forget, nao bloqueia boot)
        import('./core/crypto/aesVault.js')
            .then((v) => v.initVaultKey())
            .catch((e) => {
                import('./utils/helpers/securityLogger.js')
                    .then((sl) => sl.logSecurityEvent('crypto', 'error', 'vault init failed', { err: e?.message }))
                    .catch(() => console.error('[ecbyts:security:crypto] vault init failed:', e?.message));
            });

        // 6. Registra handlers globais (window.*)
        registerAllHandlers(updateAllUI, updateAnalyticsData);
        window.registerAllHandlers = registerAllHandlers;

        // 6a. Inicializa tour engine (onboarding)
        initTour();

        // 6b. Inicializa historico (undo/redo) com buildModel/applyModel
        initHistory({ buildModel, applyModel, updateAllUI });

        // 6c. Inicializa sequencer state (UI lazy-loaded via constellation tab)
        import('./core/sequencer/manager.js')
            .then(async (mgr) => {
                await mgr.initSequencer();
            })
            .catch(() => {});

        // 6d. Registra descriptors de family modules (lazy â€” so metadata, sem UI)
        import('./core/elements/families/well/index.js').catch(() => {});

        // 7. Hydrate SVG icons + R6: MutationObserver for dynamic icons
        hydrateIcons();
        initIconObserver();

        // 7a. Customize (antes de homeGrid — aplica CSS vars e define cards visiveis)
        initCustomize();

        // 7b. Home Grid (inicializado apos hydrateIcons para que icones dos cards renderizem)
        initHomeGrid();

        updateAllUI();

        // 7b. Aplica view salva apos home/handlers estarem prontos.
        // Evita estado inconsistente: nav 3D ativa + Actions ainda visivel.
        await applySavedView();

        // 7b2. Restaura camera salva (posicao/zoom/target) do localStorage.
        // Independe da sessao IDB — sobrevive F5 no modo random.
        if (!loadedFromURL) {
            try {
                const raw = localStorage.getItem('ecbyts-camera-state');
                if (raw) setCameraState(JSON.parse(raw));
            } catch {
                /* corrupted — use default camera */
            }
        }

        // 7c. Estado transitorio: "preparando modelo random" na Home.
        // Mantemos curto (800ms) para evitar flicker, mas suficiente para feedback.
        if (_showRandomBootState) {
            setTimeout(() => {
                setHomePreparingRandom(false);
                updateAllUI();
            }, 800);
        }

        // 6e. Cross-tab sync via BroadcastChannel
        initBroadcastSync();
        _setupBroadcastListeners();
        window.addEventListener('pagehide', destroyBroadcastSync);

        // 6f. Telemetry cleanup on page unload (sendBeacon for remaining events)
        import('./utils/telemetry/tracker.js')
            .then(({ destroyTelemetry }) => {
                window.addEventListener('pagehide', destroyTelemetry);
            })
            .catch(() => {});

        // Mostra ticker bar se config diz visible (ex: random model gerou items)
        if (getTickerConfig().visible) setTickerBarVisible(true);

        // animate() agora Ã© chamado dentro de _ensureSceneReady() (via onSceneReady callback)
        // SÃ³ inicia render loop se a cena jÃ¡ foi inicializada (ex: URL import forÃ§ou 3D)
        if (isSceneReady()) animate();

        // 8. Performance monitor HUD (Ctrl+Shift+P para toggle)
        initPerfHud();
        // Expose toggle globally for handlers/ribbon
        window.handleTogglePerfMonitor = togglePerfHud;

        // 9. Disclaimer â€” footer persistente + consentimento no primeiro acesso
        initDisclaimer();

        // 10. Onboarding tour + 50 guided tours (demo carrega sob demanda via handleOpenDemo)
        import('./utils/tour/engine.js').then(({ initTour }) => initTour());
        import('./utils/ui/tourController.js').then(({ initTourUI }) => initTourUI());

        // Guided tours: lazy-load all 11 tour definition files (register steps into categories)
        import('./utils/tour/tours/elementManagement.js');
        import('./utils/tour/tours/fieldData.js');
        import('./utils/tour/tours/campaignManagement.js');
        import('./utils/tour/tours/sceneCamera.js');
        import('./utils/tour/tours/importExport.js');
        import('./utils/tour/tours/spatialInterpolation.js');
        import('./utils/tour/tours/analysisModeling.js');
        import('./utils/tour/tours/environmentalWorkflows.js');
        import('./utils/tour/tours/aiNeural.js');
        import('./utils/tour/tours/advancedFeatures.js');

        // API Bridge: carrega se parametro ?api=PORTA na URL
        // Ex: http://localhost:51517/?api=3001  â†’  conecta ao api-server na porta 3001
        // Ex: http://localhost:51517/?api       â†’  conecta ao api-server na mesma porta
        const apiParam = new URLSearchParams(window.location.search).get('api');
        if (apiParam !== null || localStorage.getItem('ecbyts-api') === 'true') {
            try {
                const { initBridge } = await import('./utils/api/bridge.js');
                initBridge(apiParam || null);
            } catch (e) {
                console.warn('[API Bridge] Failed to load:', e.message);
            }
        }

        // Restaura formulÃ¡rio de inicializaÃ§Ã£o do projeto
        restoreInitForm();

        // Remove loading overlay
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) loadingOverlay.remove();

        showToast(t('modelReady'), 'success');

        // 9. Auto-terrain: cria superfÃ­cie topogrÃ¡fica se modo random + autoTerrain
        if (!loadedFromURL && initConfig.mode === 'random' && initConfig.autoTerrain) {
            createTerrainLayer()
                .then(() => {
                    // Aplica elevaÃ§Ã£o topogrÃ¡fica nos elementos se opÃ§Ã£o habilitada
                    if (initConfig.terrainElevation) {
                        applyTerrainElevationToElements();
                    }
                    fitAllElements();
                    requestRender();

                    // Voxel geology removido do auto-terrain â€” pesado, gerar manualmente
                })
                .catch(() => {
                    /* sem coordenadas vÃ¡lidas ou fetch falhou â€” silencioso */
                });
        }
    } catch (err) {
        console.error('[ecbyts] Init failed:', err);
        // Mostra erro visivel para o usuario em vez de tela vazia
        document.body.innerHTML = `
        <div style="padding:2rem;font-family:monospace;color:#e74c3c">
            <h2>ecbyts failed to initialize</h2>
            <pre>${err.message}\n${err.stack}</pre>
            <button onclick="location.reload()" style="margin-top:1rem;padding:.5rem 1rem;cursor:pointer">
                Reload
            </button>
        </div>`;
    } finally {
        clearTimeout(bootWatchdog);
    }
}

// ================================================================
// BROADCAST SYNC â€” Cross-tab state synchronization
// ================================================================

/** Guard para evitar reloads simultaneos de sync */
let _syncReloading = false;

/** Timestamp do ultimo sync reload â€” broadcasts de session save sao suprimidos no cooldown.
 *  Cobre: 3s debounce do _scheduleSessionSave + tempo variavel de async importLayers (terrain fetch). */
let _lastSyncReloadTs = 0;
const SYNC_RELOAD_COOLDOWN_MS = 10000;

/**
 * Configure outgoing and incoming broadcast listeners.
 * Hooks em eventos existentes para broadcast + handlers para mensagens de outras abas.
 */
function _setupBroadcastListeners() {
    // --- OUTGOING: broadcast UI state changes to other tabs ---
    window.addEventListener('themeChanged', (e) => {
        broadcastChange('ui:theme:changed', { preference: e.detail?.preference });
    });
    window.addEventListener('languageChanged', (e) => {
        broadcastChange('ui:language:changed', { lang: e.detail?.lang });
    });
    window.addEventListener('authChanged', () => {
        broadcastChange('auth:session:changed');
    });
    // Model changes: broadcast via _scheduleSessionSave() apos idbSet

    // --- INCOMING: receive changes from other tabs ---
    onSyncMessage('model:changed', async () => {
        if (_syncReloading) return;
        _syncReloading = true;
        _lastSyncReloadTs = Date.now();
        setSuppressed(true);
        try {
            const { idbGet } = await import('./utils/storage/idbStore.js');
            const session = await idbGet('ecbyts-session');
            if (session) {
                await applyModel(session);
                updateAllUI();
                showToast(t('syncModelUpdated') || 'Modelo atualizado por outra aba', 'info');
            }
        } catch (e) {
            console.warn('[BroadcastSync] Reload from IDB failed:', e.message);
        } finally {
            setSuppressed(false);
            _syncReloading = false;
        }
    });

    onSyncMessage('ui:theme:changed', ({ payload }) => {
        if (!payload?.preference) return;
        setSuppressed(true);
        import('./utils/theme/manager.js')
            .then((m) => m.setThemePreference(payload.preference))
            .catch((e) => console.warn('[BroadcastSync] Theme sync failed:', e.message))
            .finally(() => setSuppressed(false));
    });

    onSyncMessage('ui:language:changed', ({ payload }) => {
        if (!payload?.lang) return;
        setSuppressed(true);
        import('./utils/i18n/translations.js')
            .then((m) => m.setLanguage(payload.lang))
            .catch((e) => console.warn('[BroadcastSync] Language sync failed:', e.message))
            .finally(() => setSuppressed(false));
    });

    onSyncMessage('auth:session:changed', () => {
        // Re-check Supabase session; SDK handles cross-tab token sync
        setSuppressed(true);
        import('./utils/storage/syncQueue.js')
            .then((sq) => {
                // Dispatch authChanged DENTRO do .then (suppression ativa)
                window.dispatchEvent(new CustomEvent('authChanged'));
                return sq.flushSyncQueue({ force: false });
            })
            .catch(() => {})
            .finally(() => setSuppressed(false));
    });
}

// ================================================================
// UI UPDATE & EVENTS
// ================================================================

/**
 * Update all UI components at once (debounced via requestAnimationFrame).
 * Atualiza todos os elementos da interface.
 * Chamada apos qualquer mudanca nos dados do modelo.
 * Multiplas chamadas rapidas sao agrupadas em um unico update no proximo frame.
 */
let _uiUpdateScheduled = false;

// Auto-save de sessÃ£o â€” debounced 3s apÃ³s Ãºltima mudanÃ§a.
// Salva buildModel() no IDB para restaurar na prÃ³xima recarga.
let _sessionSaveTimer = null;
function _scheduleSessionSave() {
    clearTimeout(_sessionSaveTimer);
    _sessionSaveTimer = setTimeout(async () => {
        try {
            const { idbSet } = await import('./utils/storage/idbStore.js');
            const { getViewMode } = await import('./utils/scene/controls.js');
            const session = buildModel();
            // Estado de UI nÃ£o incluÃ­do no ECO1: view mode e layout dos painÃ©is
            session._uiState = {
                viewMode: getViewMode(),
                panelLayout: localStorage.getItem('ecbyts-panel-layout'),
                barsLayout: localStorage.getItem('ecbyts-bars-layout'),
                constellationHeight: localStorage.getItem('ecbyts-constellation-height'),
                constellationCollapsed: localStorage.getItem('ecbyts-constellation-collapsed'),
                tabLayout: localStorage.getItem('ecbyts-tab-layout'),
            };
            const saved = await idbSet('ecbyts-session', session);
            // Broadcast apenas se: IDB save ok E fora do cooldown pos-sync-reload
            // (evita loop infinito Tab A â†” Tab B quando importLayers async termina)
            if (saved && Date.now() - _lastSyncReloadTs > SYNC_RELOAD_COOLDOWN_MS) {
                broadcastChange('model:changed');
            }
        } catch (e) {
            console.warn('[Session] Auto-save falhou:', e.message);
        }
    }, 3000);
}

// Persiste camera no localStorage (debounced 1s) para restaurar apos F5 sem depender de IDB.
let _cameraSaveTimer = null;
function _scheduleCameraSave() {
    clearTimeout(_cameraSaveTimer);
    _cameraSaveTimer = setTimeout(() => {
        try {
            const state = getCameraState();
            if (state) safeSetItem('ecbyts-camera-state', JSON.stringify(state));
        } catch {}
    }, 1000);
}

function _updateBountyStatusbar() {
    const el = document.getElementById('status-bounties');
    if (!el) return;
    const count = getOpenBountyCount();
    el.textContent = count > 0 ? `${count} \u25CF bounties` : '';
}

function updateAllUI() {
    if (_uiUpdateScheduled) return;
    _uiUpdateScheduled = true;
    requestAnimationFrame(_runUIUpdates);
}

/**
 * Internal: execute all UI updates.
 * Executa todas as atualizacoes da interface.
 * Usa try/catch individual para evitar que um erro trave toda a UI.
 */
function _runUIUpdates() {
    _uiUpdateScheduled = false;
    const t0 = performance.now();
    getPerfMonitor().tickUIUpdate();
    if (isSceneReady()) wakeRenderLoop(); // Acorda render loop para mostrar mudancas visuais
    // Helper: true se a tab esta visivel (display !== 'none')
    const _tv = (id) => {
        const el = document.getElementById(id);
        return el && el.style.display !== 'none';
    };

    const updates = [
        // Sempre necessarios (header, status, auth)
        updateStatusBar,
        updateAuthUI,
        updateModelIdDisplay,

        // Home grid (action cards) â€” atualiza stats se visivel
        () => {
            if (isHomeViewActive()) renderHomeGrid();
        },

        // Families tab (left panel, ativa por default)
        updateFamiliesList,

        // Project tab (right panel, ativa por default)
        renderProjectAreas,
        renderCorporateIO,

        // Constellation HUD (visivel apenas quando cena esta ativa)
        () => {
            if (isSceneReady()) updateConstellation(getSelectedElement());
        },

        // Tab-gated: sÃ³ renderiza se a aba estÃ¡ visÃ­vel
        () => {
            if (_tv('tab-elements')) {
                updateElementsList();
                updateElementDetails();
            }
        },
        () => {
            if (_tv('tab-sensors')) renderSensorCenterTab();
        },
        () => {
            if (_tv('tab-campaigns')) updateCampaignsList();
        },
        () => {
            if (_tv('tab-scenes')) updateScenesList();
        },
        () => {
            if (_tv('tab-areas')) renderAreasTree();
        },
        () => {
            if (_tv('tab-stamps')) updateStampPanel(getSelectedElement());
        },
        () => {
            if (_tv('tab-governance')) renderGovernanceTab();
        },
        () => {
            if (_tv('tab-cost-analysis')) renderCostAnalysisTab();
        },
        () => {
            if (_tv('tab-automation')) renderPipelineManagerTab();
        },
        () => {
            if (_tv('tab-files')) {
                renderFilesPanel().catch((e) => console.error('[Files] render failed:', e));
            }
        },

        // Edge panel (detail sidebar, visivel com elemento selecionado)
        () => updateEdgePanel(getSelectedElement()),

        // Ticker (jÃ¡ tem guard interno de cfg.visible)
        () => {
            const cfg = getTickerConfig();
            const bar = document.getElementById('ticker-bar');
            if (bar) bar.style.display = cfg.visible ? '' : 'none';
            if (cfg.visible) {
                renderTicker(computeAll());
                rebuildGridRows();
            }
        },

        // EIS statusbar badge (credencial agregada das leituras)
        () => {
            if (window.updateEisStatusBadge) window.updateEisStatusBadge();
        },

        // Bounty Board tab + statusbar indicator
        () => {
            if (_tv('tab-bounty')) updateBountyBadge();
            _updateBountyStatusbar();
        },

        // JÃ¡ tÃªm guards internos de visibilidade
        renderHudCards,
        renderInspector,
        updateAnalyticsData,
        pushSnapshot,
    ];
    updates.forEach((fn) => {
        try {
            fn();
        } catch (e) {
            console.error(`[UI] Erro em ${fn.name || 'anonymous'}:`, e);
        }
    });
    const dt = performance.now() - t0;
    const perfDebug = typeof localStorage !== 'undefined' && localStorage.getItem('ecbyts-perf-debug') === 'true';
    if (perfDebug && dt > 32) console.warn(`[UI] updateAllUI took ${dt.toFixed(1)}ms`);
    // Agenda auto-save de sessÃ£o apÃ³s cada atualizaÃ§Ã£o da UI
    _scheduleSessionSave();
}

/**
 * Set up DOM event listeners.
 * Configura eventos do DOM (resize, idioma, importacao).
 */
function setupEventListeners() {
    let _resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(() => {
            handleResize(document.getElementById('canvas-container'));
        }, 100);
    });

    window.addEventListener('ecbyts:loading-stuck', (e) => {
        const elapsedSec = Math.max(1, Math.round((e?.detail?.elapsedMs || 0) / 1000));
        showToast(`Operacao cancelada por timeout (${elapsedSec}s).`, 'warning');
    });

    // Keyboard shortcuts (Ctrl+Z undo, Ctrl+Y redo, Ctrl+C copy, Ctrl+V paste, Escape, Delete)
    document.addEventListener('keydown', (e) => {
        const active = document.activeElement;
        const isInput =
            active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);

        // Escape: sai do tour (se ativo)
        if (e.key === 'Escape') {
            const tourTooltip = document.getElementById('tour-tooltip');
            if (tourTooltip && tourTooltip.style.display !== 'none') {
                e.preventDefault();
                window.handleExitTour?.();
                return;
            }
            const demoOverlay = document.getElementById('demo-overlay');
            if (demoOverlay && demoOverlay.style.display !== 'none') {
                e.preventDefault();
                window.handleExitDemo?.();
                return;
            }
        }

        // Escape: sai do modo de ediÃ§Ã£o de formas ou gizmo
        if (e.key === 'Escape' && isEditing()) {
            e.preventDefault();
            if (getEditMode() === 'gizmo') exitGizmoMode();
            else exitEditMode();
            return;
        }

        // Delete / Backspace: deleta vÃ©rtice selecionado no shape editor
        if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput && isEditing()) {
            e.preventDefault();
            window.handleDeleteSelectedVertex?.();
            return;
        }

        // Enter: sai do draw mode (se desenhando) ou sai do edit mode (se editando)
        if (e.key === 'Enter' && !isInput && isEditing()) {
            e.preventDefault();
            if (getEditMode() === 'draw') {
                window.handleToggleDrawMode?.();
            } else {
                window.handleExitShapeEdit?.();
            }
            return;
        }

        // --- Gizmo shortcuts (only in gizmo mode) ---
        if (getEditMode() === 'gizmo' && !isInput && !e.ctrlKey && !e.altKey) {
            if (e.key === 'w' || e.key === 'W') {
                e.preventDefault();
                setGizmoMode('translate');
                return;
            }
            if (e.key === 'e' || e.key === 'E') {
                e.preventDefault();
                setGizmoMode('rotate');
                return;
            }
            if (e.key === 'r' || e.key === 'R') {
                e.preventDefault();
                setGizmoMode('scale');
                return;
            }
            if (e.key === 'x' || e.key === 'X') {
                e.preventDefault();
                toggleGizmoSpace();
                return;
            }
        }

        // G: toggle between gizmo and shape edit modes
        if ((e.key === 'g' || e.key === 'G') && !isInput && !e.ctrlKey && !e.altKey && isEditing()) {
            e.preventDefault();
            toggleGizmoShapeEdit();
            return;
        }

        // S: toggle snap during editing/gizmo (not Ctrl+S, not Ctrl+Shift+S)
        if ((e.key === 's' || e.key === 'S') && !isInput && !e.ctrlKey && !e.altKey && isEditing()) {
            e.preventDefault();
            toggleSnap();
            const snapBtn = document.getElementById('edit-ribbon-snap-btn');
            if (snapBtn) snapBtn.classList.toggle('active');
            return;
        }

        // D: alterna draw mode durante ediÃ§Ã£o (shape edit only, not gizmo)
        if (
            (e.key === 'd' || e.key === 'D') &&
            !isInput &&
            !e.ctrlKey &&
            !e.altKey &&
            isEditing() &&
            getEditMode() !== 'gizmo'
        ) {
            e.preventDefault();
            window.handleToggleDrawMode?.();
            return;
        }

        // R: reseta forma durante ediÃ§Ã£o (shape edit only, not gizmo)
        if (
            (e.key === 'r' || e.key === 'R') &&
            !isInput &&
            !e.ctrlKey &&
            !e.altKey &&
            isEditing() &&
            getEditMode() !== 'gizmo'
        ) {
            e.preventDefault();
            window.handleResetShape?.();
            return;
        }

        // F: Frame selected â€” zoom no elemento selecionado
        if ((e.key === 'f' || e.key === 'F') && !isInput && !e.ctrlKey && !e.altKey && !isEditing()) {
            e.preventDefault();
            const sel = getSelectedElement();
            if (sel) window.handleZoomToElement?.(sel.id);
            return;
        }

        // H: Hide â€” oculta elemento selecionado
        if (e.key === 'h' && !isInput && !e.ctrlKey && !e.altKey && !e.shiftKey && !isEditing()) {
            e.preventDefault();
            const sel = getSelectedElement();
            if (sel && sel.visible !== false) window.handleToggleVisibility?.(sel.id);
            return;
        }

        // Shift+H: Reveal all â€” mostra todos os elementos ocultos
        if (e.key === 'H' && e.shiftKey && !isInput && !e.ctrlKey && !e.altKey && !isEditing()) {
            e.preventDefault();
            const hidden = getAllElements().filter((el) => el.visible === false);
            for (const el of hidden) {
                window.handleToggleVisibility?.(el.id);
            }
            return;
        }

        // Delete/Backspace (fora do shape edit): deleta elemento selecionado
        if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput && !isEditing()) {
            e.preventDefault();
            const sel = getSelectedElement();
            if (sel) window.handleRemoveElement?.(sel.id);
            return;
        }

        // F11: Zen mode â€” oculta toda a UI HTML, deixa apenas o canvas 3D
        if (e.key === 'F11' && !isInput) {
            e.preventDefault();
            document.body.classList.toggle('zen-mode');
            return;
        }

        // Ctrl+Shift+F: Focus mode â€” oculta chrome, mantÃ©m painÃ©is
        if (e.ctrlKey && e.shiftKey && e.key === 'F' && !isInput) {
            e.preventDefault();
            window.handleToggleFocusMode?.();
            return;
        }

        // Ctrl+Shift+S: Snapshot â€” captura canvas 3D como PNG
        if (e.ctrlKey && e.shiftKey && e.key === 'S' && !isInput) {
            e.preventDefault();
            window.handleCaptureSnapshot?.();
            return;
        }

        if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
            if (isInput) return;
            e.preventDefault();
            window.handleUndo();
        }
        if (e.ctrlKey && (e.key === 'y' || (e.key === 'Z' && e.shiftKey))) {
            if (isInput) return;
            e.preventDefault();
            window.handleRedo();
        }
        if (e.ctrlKey && e.key === 'c') {
            if (isInput) return;
            e.preventDefault();
            window.handleCopyElement();
        }
        if (e.ctrlKey && e.key === 'v') {
            if (isInput) return;
            e.preventDefault();
            window.handlePasteElement();
        }
        if (e.ctrlKey && e.key === 'j') {
            if (isInput) return;
            e.preventDefault();
            window.handleToggleInspector?.();
        }
    });

    // Eventos customizados do sistema
    window.addEventListener('languageChanged', () => {
        updateLanguageSelector();
        applyTranslations();
        refreshAutoLabelNames();
        updateAllUI();
    });
    window.addEventListener('familiesChanged', () => updateAllUI());
    window.addEventListener('fieldsChanged', () => updateAllUI());
    window.addEventListener('saoChanged', () => updateAllUI());
    window.addEventListener('tickerChanged', () => updateAllUI());
    window.addEventListener('calculatorChanged', () => updateAllUI());
    window.addEventListener('interpolationChanged', () => updateAllUI());
    window.addEventListener('voxelChanged', () => updateAllUI());
    window.addEventListener('groupsChanged', () => updateAllUI());
    window.addEventListener('reportChanged', () => updateAllUI());
    window.addEventListener('librariesChanged', () => updateAllUI());
    window.addEventListener('nnChanged', () => updateAllUI());
    window.addEventListener('originChanged', (e) => {
        updateGlobe();
        // Re-projeta elementos quando origin muda (offset linear UTM)
        if (e.detail?.oldOrigin && e.detail?.newOrigin) {
            import('./core/io/geo/coordinates.js').then((mod) => {
                mod.reProjectAllElements(e.detail.oldOrigin, e.detail.newOrigin);
                updateAllUI();
            });
        }
    });
    window.addEventListener('edgesChanged', () => updateConstellation(getSelectedElement()));
    window.addEventListener('shapeEditChanged', () => updateStatusBar());
    // View mode change: nÃ£o precisa de updateAllUI, mas salva sessÃ£o
    window.addEventListener('viewModeChanged', () => _scheduleSessionSave());
    // MudanÃ§as de layout de painel: salva sessÃ£o com novo estado dos painÃ©is
    window.addEventListener('panelLayoutChanged', () => _scheduleSessionSave());
    // Camera change: persiste posicao/zoom no localStorage para sobreviver F5 no modo random
    window.addEventListener('cameraChanged', () => {
        _scheduleSessionSave();
        _scheduleCameraSave();
    });
    window.addEventListener('vizSettingsChanged', () => renderVizSettings());
    window.addEventListener('inspectorChanged', () => renderInspector());
    window.addEventListener('selectionChanged', () => renderInspector());

    // Inputs de importacao
    document.getElementById('import-file')?.addEventListener('change', handleFileInputChange);
    document.getElementById('import-key-input')?.addEventListener('input', handleKeyInputChange);

    // Auth: atualiza UI quando usuario faz login/logout
    window.addEventListener('authChanged', () => {
        updateAuthUI();
        updateAllUI();
    });

    // API Bridge: atualiza UI quando bridge modifica dados
    window.addEventListener('apiBridgeUpdate', () => updateAllUI());
    window.addEventListener('tabChanged', () => updateAllUI());
}

// ================================================================
// MODEL ID DISPLAY
// ================================================================

/**
 * Update Model ID display in Project tab and status bar.
 * Atualiza exibicao do Model ID na aba Projeto e barra de status.
 */
function updateModelIdDisplay() {
    const id = getModelIdSync();
    // Project tab badge
    const badge = document.getElementById('model-id-badge');
    if (badge) {
        badge.textContent = id || 'â€”';
    }
    // Status bar
    const statusEl = document.getElementById('status-model-id');
    if (statusEl) {
        statusEl.textContent = id ? `ID: ${id}` : '';
    }
}

// ================================================================
// ANALYTICS MODULE
// ================================================================

/**
 * Initialize the analytics module.
 * Inicializa o modulo de analises (graficos, histogramas, scatter plots).
 */
function initAnalyticsModule() {
    const workspaceEl = document.getElementById('analytics-workspace');
    if (!workspaceEl) return;

    try {
        const analytics = getAnalytics();
        analytics.initialize(workspaceEl);

        document.getElementById('analytics-refresh-btn')?.addEventListener('click', updateAnalyticsData);
        document.getElementById('analytics-reset-btn')?.addEventListener('click', () => {
            analytics.getViewportManager()?.resetLayout?.();
        });
        document.getElementById('analytics-sync-btn')?.addEventListener('click', function () {
            const syncManager = analytics.getSyncManager();
            const enabled = !syncManager.isSyncEnabled();
            syncManager.setSyncEnabled(enabled);
            this.classList.toggle('active', enabled);
        });

        const paramSelect = document.getElementById('analytics-parameter-select');
        if (paramSelect) {
            // Preenche o seletor com os parametros disponiveis
            const params = CONFIG.DEFAULT_PARAMETERS || [];
            paramSelect.innerHTML = '<option value="">Todos</option>';
            params.forEach((p) => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                paramSelect.appendChild(opt);
            });
            paramSelect.addEventListener('change', (e) => {
                analytics.getViewportManager()?.updateHistogramParameter?.(e.target.value || null);
            });
        }
    } catch (error) {
        console.error('Erro ao inicializar Analytics:', error);
    }
}

/**
 * Update analytics data from current model elements.
 * Atualiza os dados de analise com os elementos atuais do modelo.
 */
function updateAnalyticsData() {
    try {
        // Pula rebuild do tensor se a aba Analytics nao esta visivel
        const panel = document.getElementById('analytics-workspace');
        if (!panel || panel.offsetParent === null) return;
        const analytics = getAnalytics();
        analytics.loadData(getAllElements());
    } catch (error) {
        console.error('Erro ao atualizar Analytics:', error);
    }
}

// ================================================================
// ================================================================
// GLOBAL ERROR BOUNDARY
// Captura erros e rejeicoes nao tratadas em producao
// ================================================================

const _SECURITY_PATHS = ['crypto/', 'auth/', 'metering/', 'llm/'];

window.onerror = (message, source, lineno, colno, error) => {
    const isSecurity = source && _SECURITY_PATHS.some((p) => source.includes(p));
    const prefix = isSecurity ? '[ecbyts:security]' : '[ecbyts]';
    console.error(`${prefix} Unhandled error: ${message}`, { source, lineno, colno, error });
    return false; // nao suprimir â€” permite console.error normal
};

window.onunhandledrejection = (event) => {
    const stack = event.reason?.stack || '';
    const isSecurity = _SECURITY_PATHS.some((p) => stack.includes(p));
    const prefix = isSecurity ? '[ecbyts:security]' : '[ecbyts]';
    console.error(`${prefix} Unhandled promise rejection:`, event.reason);
};

// Protege dados do IndexedDB de eviction automÃ¡tica pelo browser (mobile principalmente)
// Chrome HTTPS: aprovado automaticamente. Safari: ignorado silenciosamente. Downside: zero.
navigator.storage?.persist?.();

// ================================================================
// START APPLICATION
// ================================================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
