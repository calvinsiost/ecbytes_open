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
   HANDLER REGISTRY — Central registration of global functions
   Registro central de funcoes globais para o HTML

   Este arquivo e o unico lugar onde funcoes sao expostas no
   objeto window.* para serem chamadas pelos onclick do HTML.

   Por que window.*?
   O HTML usa atributos como onclick="handleAddElement('plume')".
   Para que isso funcione, a funcao precisa estar acessivel globalmente.
   Este registro centralizado facilita encontrar e manter essas funcoes.
   ================================================================ */

import { elementHandlers, setUpdateAllUI as setElementsUpdateAllUI } from './elements.js';
import { observationHandlers, setUpdateAllUI as setObservationsUpdateAllUI } from './observations.js';
import { projectHandlers } from './project.js';
import { campaignHandlers } from './campaigns.js';
import { sceneHandlers } from './scenes.js';
import { llmChatHandlers, setUpdateAllUI as setLLMUpdateAllUI } from './llmChat.js';
import { agentHandlers } from './agents.js';
import { smartImportHandlers, setSmartImportUpdateAllUI } from './smartImport.js';
import { mergeHandlers, setMergeUpdateAllUI } from './merge.js';
import { governanceHandlers, setGovernanceUpdateAllUI } from './governance.js';
import { saoHandlers } from './sao.js';
import { sensorHandlers, setUpdateAllUI as setSensorUpdateAllUI } from './sensor.js';
import { historyHandlers } from './history.js';
import { tickerHandlers, setUpdateAllUI as setTickerUpdateAllUI } from './ticker.js';
import { authHandlers, setAuthUpdateAllUI } from './auth.js';
import { observerHandlers } from './observer.js';
import { groupHandlers, setGroupsUpdateAllUI } from './groups.js';
import { aerialHandlers, setAerialUpdateAllUI } from './aerial.js';
import { reportHandlers, setReportUpdateAllUI } from './report.js';
import { xlsxHandlers } from './xlsx.js';
import { libraryHandlers, setLibrariesUpdateAllUI } from './libraries.js';
import { shapeEditHandlers } from './shapeEdit.js';
import { hudCardsHandlers, setHudCardsUpdateAllUI } from './hudCards.js';
import { vizSettingsHandlers } from './vizSettings.js';
import { inspectorHandlers, setInspectorUpdateAllUI } from './inspector.js';
import { nnHandlers, setNNUpdateAllUI } from './nn.js';
import { themeHandlers } from './theme.js';
import { calculatorHandlers, setCalculatorUpdateAllUI } from './calculator.js';
import { hypothesisTestHandlers } from './hypothesisTest.js';
import { backgroundAnalysisHandlers } from './backgroundAnalysis.js';
import { macCurveHandlers } from './macCurve.js';
import { projectRegistryHandlers, setProjectRegistryUpdateAllUI } from './projects.js';
import { interpolationHandlers, setInterpolationHandlerUpdateAllUI } from './interpolation.js';
import {
    handleStartCrossSection,
    handleOpenCrossSectionPanel,
    handleCloseCrossSectionPanel,
    handleExportCrossSection,
    handleCancelCrossSection,
} from './crossSection.js';
import { voxelHandlers, setVoxelUpdateAllUI } from './voxel.js';
import { boreholeHandlers, setBoreholeUpdateAllUI } from './borehole.js';
import { tourHandlers, setTourHandlerUpdateAllUI } from './tour.js';
import { demoHandlers, setDemoHandlerUpdateAllUI } from './demo.js';
import { cloudHandlers, setCloudUpdateAllUI } from './cloud.js';
import { ingestionHandlers, setUpdateAllUI as setIngestionUpdateAllUI } from './ingestion.js';
import { filesHandlers, setFilesUpdateAllUI } from './files.js';
import {
    showLoading,
    hideLoading,
    setLoadingMessage,
    setLoadingProgress,
    withLoading,
    forceHideLoading,
} from '../ui/loadingOverlay.js';
import { eisHandlers } from './eis.js';
import { spatialHandlers, setUpdateAllUI as setSpatialUpdateAllUI } from './spatial.js';
import { workflowHandlers, setWorkflowsUpdateAllUI } from './workflows.js';
import { pipelineHandlers, setPipelinesUpdateAllUI } from './pipelines.js';
import { costAnalysisHandlers, setCostAnalysisUpdateAllUI } from './costAnalysis.js';
import { costCenterHandlers, setCostCenterUpdateAllUI } from './costCenter.js';
import { dataEntryHandlers, setDataEntryUpdateAllUI } from './dataEntry.js';
import { optimizationHandlers, setOptimizationUpdateAllUI } from './optimization.js';
import { labelHandlers } from './labels.js';
import { imageryHandlers } from './imagery.js';
import { quickActionHandlers } from './quickActions.js';
import { temporalAnalysisHandlers } from './temporalAnalysis.js';
import { ecoToolsHandlers } from './ecoTools.js';
import { symbologyHandlers, setSymbologyHandlerDeps } from './symbology.js';
import { validationHandlers, setValidationUpdateAllUI } from './validationHandlers.js';
import { domainValidationHandlers, setDomainValidationUpdateAllUI } from './domainValidation.js';
import { meteringHandlers } from './metering.js';
import { constantHandlers, setConstantsUpdateAllUI } from './constants.js';
import { hierarchyHandlers, setHierarchyUpdateAllUI } from './hierarchyHandlers.js';
import { issueHandlers } from './issueHandlers.js';
import { bountyHandlers } from './bountyHandlers.js';
import { permissionsHandlers } from './permissions.js';
import { homeHandlers } from './home.js';
import { customizeHandlers } from './customize.js';
// productWizard: dynamic import para nao quebrar handler chain se modulo falhar
// (mesmo padrao do sequencer.js)
import {
    openRegulatoryStandards,
    handleRegMatrixChange,
    handleRegLandUseChange,
    handleRegAddThreshold,
    handleRegRemoveCustom,
    handleRegulatoryExport,
    handleRegulatoryImport,
    handleRegulatoryRestore,
    handleRegGlobalView,
} from '../ui/regulatoryModal.js';
// sequencerHandlers: dynamic import (cadeia pesada: videoBot → llm/client → setup)
import { captureSnapshot } from '../ui/snapshot.js';
import {
    getStorageUsage,
    getStorageBreakdown,
    clearModelData,
    clearWorkspace,
    isEphemeral,
} from '../storage/storageMonitor.js';
import { handleFamilySelectToggleAll, handleFamilySelectConfirm } from '../ui/familySelectModal.js';
import { listNetworks, getNetwork, getNetworkMetadata, removeNetwork } from '../../core/nn/manager.js';
// predictionHandlers and auditHandlers are bot-only (not exposed on window)
// They are invoked via LLM commandExecutor.js actions: ANALYZE_TRENDS, SUGGEST_SAMPLING, RUN_AUDIT

// Funcoes importadas diretamente dos modulos originais
// (nao precisaram de handler wrapper)
import { setLanguage, toggleLanguageDropdown } from '../i18n/translations.js';
import {
    setIsometricView,
    setTopView,
    setFrontView,
    zoomIn,
    zoomOut,
    resetView,
    fitAllElements,
    getCameraState,
    setCameraState,
    toggleViewMode,
    getViewMode,
    setViewMode,
} from '../scene/controls.js';
import { setGlobeDetailLevel } from '../scene/compass.js';
import { copyKeyToClipboard, copyShareURL } from '../../core/io/export.js';
import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';
import { switchRibbonTab } from '../ui/ribbon.js';
// Panel toggle functions are registered by panelManager.js in initPanelManager()
import {
    openExportModal,
    openImportModal,
    executeImport,
    closeModal,
    closeOnOverlayClick,
    handleCopyKey,
    handleCopyURL,
    handleDownload,
    onExportFormatChange,
    openFamilyManager,
    handleFamilyToggle,
    handleFamilyDelete,
    handleAddCustomFamily,
    toggleBlockchainOptions,
    onKeySelectChange,
    createNewKey,
} from '../ui/modals.js';

/**
 * Register all handler functions on the window object.
 * Registra todas as funcoes no window para uso no HTML.
 * Tambem injeta a funcao updateAllUI nos handlers que precisam dela.
 *
 * @param {Function} updateAllUI - The main UI update function
 * @param {Function} updateAnalyticsData - The analytics data update function
 */
export function registerAllHandlers(updateAllUI, updateAnalyticsData) {
    // Injeta updateAllUI nos handlers que precisam
    setElementsUpdateAllUI(updateAllUI);
    setObservationsUpdateAllUI(updateAllUI);
    setLLMUpdateAllUI(updateAllUI);
    setSmartImportUpdateAllUI(updateAllUI);
    setMergeUpdateAllUI(updateAllUI);
    setGovernanceUpdateAllUI(updateAllUI);
    setProjectRegistryUpdateAllUI(updateAllUI);
    setSensorUpdateAllUI(updateAllUI);
    setTickerUpdateAllUI(updateAllUI);
    setAuthUpdateAllUI(updateAllUI);
    setGroupsUpdateAllUI(updateAllUI);
    setAerialUpdateAllUI(updateAllUI);
    setReportUpdateAllUI(updateAllUI);
    setLibrariesUpdateAllUI(updateAllUI);
    setHudCardsUpdateAllUI(updateAllUI);
    setInspectorUpdateAllUI(updateAllUI);
    setNNUpdateAllUI(updateAllUI);
    setCalculatorUpdateAllUI(updateAllUI);
    setInterpolationHandlerUpdateAllUI(updateAllUI);
    setVoxelUpdateAllUI(updateAllUI);
    setBoreholeUpdateAllUI(updateAllUI);
    setTourHandlerUpdateAllUI(updateAllUI);
    setDemoHandlerUpdateAllUI(updateAllUI);
    setCloudUpdateAllUI(updateAllUI);
    setIngestionUpdateAllUI(updateAllUI);
    setFilesUpdateAllUI(updateAllUI);
    setSpatialUpdateAllUI(updateAllUI);
    setWorkflowsUpdateAllUI(updateAllUI);
    setPipelinesUpdateAllUI(updateAllUI);
    setCostAnalysisUpdateAllUI(updateAllUI);
    setDataEntryUpdateAllUI(updateAllUI);
    setOptimizationUpdateAllUI(updateAllUI);
    setSymbologyHandlerDeps(updateAllUI);
    setValidationUpdateAllUI(updateAllUI);
    setDomainValidationUpdateAllUI(updateAllUI);
    setConstantsUpdateAllUI(updateAllUI);
    setHierarchyUpdateAllUI(updateAllUI);
    setCostCenterUpdateAllUI(updateAllUI);

    // Registra handlers dos modulos
    Object.assign(window, elementHandlers);
    Object.assign(window, observationHandlers);
    Object.assign(window, projectHandlers);
    Object.assign(window, campaignHandlers);
    Object.assign(window, sceneHandlers);
    Object.assign(window, llmChatHandlers);
    Object.assign(window, agentHandlers);
    Object.assign(window, smartImportHandlers);
    Object.assign(window, mergeHandlers);
    Object.assign(window, governanceHandlers);
    Object.assign(window, costCenterHandlers);
    Object.assign(window, projectRegistryHandlers);
    Object.assign(window, saoHandlers);
    Object.assign(window, sensorHandlers);
    Object.assign(window, historyHandlers);
    Object.assign(window, tickerHandlers);
    Object.assign(window, authHandlers);
    Object.assign(window, observerHandlers);
    Object.assign(window, groupHandlers);
    Object.assign(window, aerialHandlers);
    Object.assign(window, reportHandlers);
    Object.assign(window, xlsxHandlers);
    Object.assign(window, libraryHandlers);
    Object.assign(window, shapeEditHandlers);
    Object.assign(window, hudCardsHandlers);
    Object.assign(window, vizSettingsHandlers);
    Object.assign(window, inspectorHandlers);
    Object.assign(window, nnHandlers);
    Object.assign(window, themeHandlers);
    Object.assign(window, calculatorHandlers);
    Object.assign(window, hypothesisTestHandlers);
    Object.assign(window, backgroundAnalysisHandlers);
    Object.assign(window, macCurveHandlers);
    Object.assign(window, interpolationHandlers);
    Object.assign(window, {
        handleStartCrossSection,
        handleOpenCrossSectionPanel,
        handleCloseCrossSectionPanel,
        handleExportCrossSection,
        handleCancelCrossSection,
    });
    Object.assign(window, voxelHandlers);
    Object.assign(window, boreholeHandlers);
    Object.assign(window, tourHandlers);
    Object.assign(window, demoHandlers);
    Object.assign(window, cloudHandlers);
    Object.assign(window, ingestionHandlers);
    Object.assign(window, filesHandlers);
    // Loading overlay — disponivel globalmente para qualquer modulo
    Object.assign(window, {
        showLoading,
        hideLoading,
        setLoadingMessage,
        setLoadingProgress,
        withLoading,
        forceHideLoading,
    });
    Object.assign(window, eisHandlers);
    Object.assign(window, spatialHandlers);
    Object.assign(window, workflowHandlers);
    Object.assign(window, pipelineHandlers);
    Object.assign(window, costAnalysisHandlers);
    Object.assign(window, dataEntryHandlers);
    Object.assign(window, optimizationHandlers);
    Object.assign(window, labelHandlers);
    Object.assign(window, imageryHandlers);
    Object.assign(window, quickActionHandlers);
    Object.assign(window, temporalAnalysisHandlers);
    Object.assign(window, ecoToolsHandlers);
    Object.assign(window, symbologyHandlers);
    Object.assign(window, validationHandlers);
    Object.assign(window, domainValidationHandlers);
    Object.assign(window, meteringHandlers);
    Object.assign(window, constantHandlers);
    Object.assign(window, hierarchyHandlers);
    Object.assign(window, issueHandlers);
    Object.assign(window, bountyHandlers);
    Object.assign(window, permissionsHandlers);
    Object.assign(window, homeHandlers);
    Object.assign(window, customizeHandlers);

    // --- Cursor Projector (dynamic import — scene module) ---
    import('../scene/cursorProjector.js')
        .then((mod) => {
            window.toggleCursorProjector = mod.toggleCursorProjector;
        })
        .catch(() => {});

    // --- Plume Animation (dynamic import — heavy Three.js + interpolation chain) ---
    import('./plumeAnimation.js')
        .then((mod) => {
            Object.assign(window, mod.plumeAnimationHandlers);
        })
        .catch(() => {});

    // --- API Key modal alias ---
    window.closeApiKeyModal = () => {
        if (typeof window.handleCloseApiKeys === 'function') window.handleCloseApiKeys();
    };

    // --- Service Productization Wizard (dynamic import) ---
    window.handleOpenProductWizard = async (opts) => {
        try {
            const { openProductWizard } = await import('../ui/productWizard.js');
            return openProductWizard(opts);
        } catch (err) {
            console.error('[ecbyts] Failed to load product wizard:', err);
            showToast('Erro ao abrir wizard de produtizacao', 'error');
        }
    };
    window.handleEditProductWizard = async (productId, opts) => {
        try {
            const { editProductWizard } = await import('../ui/productWizard.js');
            return editProductWizard(productId, opts);
        } catch (err) {
            console.error('[ecbyts] Failed to load product wizard:', err);
            showToast('Erro ao abrir wizard de produtizacao', 'error');
        }
    };
    window.handleCloseProductWizard = async () => {
        try {
            const { closeProductWizard } = await import('../ui/productWizard.js');
            closeProductWizard();
        } catch {}
    };

    // --- Regulatory Standards ---
    window.handleOpenRegulatoryStandards = openRegulatoryStandards;
    window.handleRegMatrixChange = handleRegMatrixChange;
    window.handleRegLandUseChange = handleRegLandUseChange;
    window.handleRegAddThreshold = handleRegAddThreshold;
    window.handleRegRemoveCustom = handleRegRemoveCustom;
    window.handleRegulatoryExport = handleRegulatoryExport;
    window.handleRegulatoryImport = handleRegulatoryImport;
    window.handleRegulatoryRestore = handleRegulatoryRestore;
    window.handleRegGlobalView = handleRegGlobalView;

    // Sequencer: dynamic import para nao quebrar app se cadeia falhar
    import('./sequencer.js')
        .then((mod) => {
            Object.assign(window, mod.sequencerHandlers);
        })
        .catch(() => {});

    // --- Neural Networks (programmatic API) ---
    window.handleListNetworks = () => listNetworks();
    window.handleGetNetworkInfo = (id) => getNetworkMetadata(id);
    window.handleResetNetwork = (id) => {
        const nn = getNetwork(id);
        if (nn) nn.reset();
    };
    window.handleRemoveNetwork = (id) => removeNetwork(id);

    // --- Funcoes de idioma ---
    window.setLanguage = setLanguage;
    window.handleSetLanguage = (lang) => setLanguage(lang);
    window.toggleLanguageDropdown = toggleLanguageDropdown;

    // --- Funcoes de visualizacao 3D ---
    window.setIsometricView = setIsometricView;
    window.setTopView = setTopView;
    window.setFrontView = setFrontView;
    window.zoomIn = zoomIn;
    window.zoomOut = zoomOut;
    window.resetView = resetView;
    window.fitAllElements = fitAllElements;
    window.getCameraState = getCameraState;
    window.setCameraState = setCameraState;
    window.toggleViewMode = toggleViewMode;
    window.getViewMode = getViewMode;
    window.setViewMode = setViewMode;
    window.setGlobeDetailLevel = setGlobeDetailLevel;

    // --- Funcoes de exportacao ---
    window.openExportModal = openExportModal;
    window.copyExportKey = handleCopyKey;
    window.copyShareURL = handleCopyURL;
    window.downloadKey = handleDownload;
    window.onExportFormatChange = onExportFormatChange;
    window.toggleBlockchainOptions = toggleBlockchainOptions;
    window.onKeySelectChange = onKeySelectChange;
    window.createNewKey = createNewKey;

    window.copyKeyToClipboard = async () => {
        const success = await copyKeyToClipboard();
        if (success) showToast(t('keyCopied'), 'success');
    };

    window.shareURL = async () => {
        const success = await copyShareURL();
        if (success) showToast(t('urlCopied'), 'success');
    };

    // --- Funcoes de importacao ---
    window.openImportModal = openImportModal;
    window.executeImport = () => executeImport(updateAllUI);

    // --- Funcoes de modal ---
    window.closeModal = closeModal;
    window.closeOnOverlayClick = closeOnOverlayClick;

    // --- Funcoes de familias ---
    window.openFamilyManager = openFamilyManager;
    window.handleFamilyToggle = handleFamilyToggle;
    window.handleFamilyDelete = handleFamilyDelete;
    window.addCustomFamily = handleAddCustomFamily;

    // --- Family selection modal (Random/Clear) ---
    window.handleFamilySelectToggleAll = handleFamilySelectToggleAll;
    window.handleFamilySelectConfirm = handleFamilySelectConfirm;

    // --- Analytics ---
    window.updateAnalyticsData = updateAnalyticsData;

    // --- Storage Monitor ---
    window.getStorageUsage = getStorageUsage;
    window.getStorageBreakdown = getStorageBreakdown;
    window.clearModelData = clearModelData;
    window.clearWorkspace = clearWorkspace;
    window.isEphemeral = isEphemeral;

    // --- Ribbon tabs ---
    window.switchRibbonTab = switchRibbonTab;

    // --- About ---
    window.showAboutDialog = () => {
        showToast('ecbyts v0.1.0-beta — Environmental Digital Twin Platform', 'info');
    };

    // --- Documentation ---
    window.handleOpenDocs = () => {
        window.open('./docs.html', '_blank', 'noopener');
    };
    window.handleOpenApiDocs = () => {
        window.open('./api-docs.html', '_blank', 'noopener');
    };

    // --- Focus Mode & Snapshot ---
    window.handleToggleFocusMode = () => {
        document.body.classList.toggle('focus-mode');
        // Sai de zen-mode se estiver ativo
        document.body.classList.remove('zen-mode');
    };
    window.handleCaptureSnapshot = captureSnapshot;

    // Panel toggles (toggleLeftPanel, toggleRightPanel, toggleAnalyticsFullscreen)
    // are registered by panelManager.js in initPanelManager()

    // --- Pipeline action allowlist ---
    // Registra subconjunto seguro de handlers como ações executáveis em pipelines.
    // Apenas handlers ambientais e de modelo — auth/admin excluídos por segurança.
    import('../../core/pipelines/executor.js')
        .then(({ registerPipelineAction }) => {
            const safeActions = [
                'generateRandomModel',
                'clearWorkspace',
                'handleAddElement',
                'handleRemoveElement',
                'handleAddCampaign',
                'handleAddObservation',
                'handleOpenInterpolationPanel',
                'handleRefreshInterpolationLayer',
                'handleRecomputeVoxels',
                'handleToggleVoxelMode',
                'handleOpenWorkflowPicker',
                'handleOpenEisDashboard',
                'handleAddReport',
                'handleOpenReportOverlay',
                'handleExportReport',
                'handleOpenCalculator',
                'handleCalculateEVA',
            ];
            safeActions.forEach((name) => {
                if (typeof window[name] === 'function') {
                    registerPipelineAction(name, window[name]);
                }
            });
        })
        .catch(() => {});

    // Mark handlers as ready for E2E tests
    window.handlersReady = true;
}
