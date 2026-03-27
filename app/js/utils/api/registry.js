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
   ACTION REGISTRY — Metadata for all API-accessible actions
   Registro de acoes disponiveis via API com metadados

   Catalogo de todas as funcoes window.* que podem ser executadas
   via POST /api/action. Usado pelo endpoint GET /api/actions
   para auto-documentacao da API.

   Cada entrada documenta: nome, parametros esperados, categoria.
   ================================================================ */

/**
 * Registry of all actions available via the API.
 * @type {Array<{name: string, params: string[], cat: string}>}
 */
export const ACTION_REGISTRY = [
    // ---- Elements ----
    // Criacao, remocao e manipulacao de elementos ambientais
    { name: 'handleAddElement', params: ['familyId'], cat: 'elements' },
    { name: 'handleRemoveElement', params: ['elementId'], cat: 'elements' },
    { name: 'handleSelectElement', params: ['elementId'], cat: 'elements' },
    { name: 'handleToggleVisibility', params: ['elementId'], cat: 'elements' },
    { name: 'handleElementFieldChange', params: ['elementId', 'field', 'value'], cat: 'elements' },
    { name: 'handleElementTransform', params: ['elementId', 'property', 'values'], cat: 'elements' },

    // ---- Observations ----
    // Medicoes de campo (pH, benzeno, etc.)
    { name: 'handleAddObservation', params: ['elementId'], cat: 'observations' },
    { name: 'handleObservationChange', params: ['elementId', 'index', 'field', 'value'], cat: 'observations' },
    { name: 'handleRemoveObservation', params: ['elementId', 'index'], cat: 'observations' },
    { name: 'handleObservationParameterChange', params: ['elementId', 'index', 'parameterId'], cat: 'observations' },
    { name: 'handleAddAdditionalReading', params: ['elementId', 'obsIndex'], cat: 'observations' },
    { name: 'handleRemoveAdditionalReading', params: ['elementId', 'obsIndex', 'readingIndex'], cat: 'observations' },
    {
        name: 'handleReadingChange',
        params: ['elementId', 'obsIndex', 'readingIndex', 'field', 'value'],
        cat: 'observations',
    },
    { name: 'handleUnitChange', params: ['elementId', 'obsIndex', 'readingIndex', 'newUnitId'], cat: 'observations' },
    { name: 'handleAddQualField', params: ['elementId', 'observationIndex'], cat: 'observations' },
    { name: 'handleRemoveQualField', params: ['elementId', 'observationIndex', 'fieldIndex'], cat: 'observations' },
    {
        name: 'handleQualFieldChange',
        params: ['elementId', 'observationIndex', 'fieldIndex', 'field', 'value'],
        cat: 'observations',
    },

    // ---- Campaigns ----
    // Campanhas de amostragem
    { name: 'handleAddCampaign', params: [], cat: 'campaigns' },
    { name: 'handleCampaignChange', params: ['campaignId', 'field', 'value'], cat: 'campaigns' },
    { name: 'handleCampaignVisibility', params: ['campaignId', 'visible'], cat: 'campaigns' },
    { name: 'handleRemoveCampaign', params: ['campaignId'], cat: 'campaigns' },

    // ---- Scenes ----
    // Snapshots de camera
    { name: 'handleAddScene', params: [], cat: 'scenes' },
    { name: 'handleSceneChange', params: ['sceneId', 'field', 'value'], cat: 'scenes' },
    { name: 'handleCaptureViewStart', params: ['sceneId'], cat: 'scenes' },
    { name: 'handleCaptureViewEnd', params: ['sceneId'], cat: 'scenes' },
    { name: 'handleApplyViewStart', params: ['sceneId'], cat: 'scenes' },
    { name: 'handleApplyViewEnd', params: ['sceneId'], cat: 'scenes' },
    { name: 'handleRemoveScene', params: ['sceneId'], cat: 'scenes' },

    // ---- Camera ----
    // Controles de camera 3D
    { name: 'setIsometricView', params: [], cat: 'camera' },
    { name: 'setTopView', params: [], cat: 'camera' },
    { name: 'setFrontView', params: [], cat: 'camera' },
    { name: 'zoomIn', params: [], cat: 'camera' },
    { name: 'zoomOut', params: [], cat: 'camera' },
    { name: 'resetView', params: [], cat: 'camera' },

    // ---- UI ----
    // Controles de interface
    { name: 'switchRibbonTab', params: ['tabId'], cat: 'ui' },
    { name: 'setLanguage', params: ['lang'], cat: 'ui' },
    { name: 'toggleLeftPanel', params: [], cat: 'ui' },
    { name: 'toggleRightPanel', params: [], cat: 'ui' },
    { name: 'toggleAnalyticsFullscreen', params: [], cat: 'ui' },
    { name: 'closeModal', params: ['modalId'], cat: 'ui' },

    // ---- IO ----
    // Import/Export
    { name: 'openExportModal', params: [], cat: 'io' },
    { name: 'openImportModal', params: [], cat: 'io' },
    { name: 'copyExportKey', params: [], cat: 'io' },
    { name: 'copyShareURL', params: [], cat: 'io' },
    { name: 'downloadKey', params: [], cat: 'io' },
    { name: 'onExportFormatChange', params: [], cat: 'io' },

    // ---- Family Management ----
    // Gerenciamento de familias de elementos
    { name: 'openFamilyManager', params: [], cat: 'families' },
    { name: 'handleFamilyToggle', params: ['familyId'], cat: 'families' },
    { name: 'handleFamilyDelete', params: ['familyId'], cat: 'families' },
    { name: 'addCustomFamily', params: [], cat: 'families' },

    // ---- Project ----
    // Gerenciamento de projeto e areas
    { name: 'handleAddProjectArea', params: [], cat: 'project' },
    { name: 'handleRemoveProjectArea', params: ['index'], cat: 'project' },
    { name: 'handleProjectAreaChange', params: ['index', 'field', 'value'], cat: 'project' },
    { name: 'handleAddInputLink', params: [], cat: 'project' },
    { name: 'handleAddOutputLink', params: [], cat: 'project' },
    { name: 'handleRemoveInputLink', params: ['linkedModelId'], cat: 'project' },
    { name: 'handleRemoveOutputLink', params: ['linkedModelId'], cat: 'project' },

    // ---- Model ----
    // Operacoes no modelo completo
    { name: 'generateRandomModel', params: [], cat: 'model' },
    { name: 'handleClearModel', params: [], cat: 'model' },
    { name: 'handleUndo', params: [], cat: 'model' },
    { name: 'handleRedo', params: [], cat: 'model' },
    { name: 'handleCopyElement', params: [], cat: 'model' },
    { name: 'handlePasteElement', params: [], cat: 'model' },
    { name: 'newProject', params: [], cat: 'model' },

    // ---- Storage Monitor ----
    // Monitoramento e limpeza do localStorage
    { name: 'getStorageUsage', params: [], cat: 'storage' },
    { name: 'getStorageBreakdown', params: [], cat: 'storage' },
    { name: 'clearModelData', params: [], cat: 'storage' },
    { name: 'clearWorkspace', params: [], cat: 'storage' },
    { name: 'isEphemeral', params: [], cat: 'storage' },

    // ---- Analytics ----
    // Atualizacao de graficos
    { name: 'updateAnalyticsData', params: [], cat: 'analytics' },

    // ---- LLM Chat ----
    // Assistente de IA
    { name: 'openLLMChat', params: [], cat: 'llm' },
    { name: 'closeLLMChat', params: [], cat: 'llm' },
    { name: 'openLLMConfig', params: [], cat: 'llm' },

    // ---- Parameters ----
    // Modal de parametros customizados
    { name: 'handleOpenParameterModal', params: [], cat: 'parameters' },
    { name: 'handleCloseParameterModal', params: [], cat: 'parameters' },
    { name: 'handleSaveParameter', params: [], cat: 'parameters' },

    // ---- Stamps ----
    // Estampas de governanca, contexto e reporte (self-registered by stampPanel.js)
    { name: 'handleAddStampClick', params: [], cat: 'stamps' },
    { name: 'handleRemoveStamp', params: ['stampId'], cat: 'stamps' },
    { name: 'handleStampCategoryFilter', params: ['category'], cat: 'stamps' },
    { name: 'handleStampClassificationFilter', params: ['classification'], cat: 'stamps' },
    { name: 'handlePendingClassification', params: ['classification'], cat: 'stamps' },
    { name: 'handleStampTypeSelect', params: ['typeId'], cat: 'stamps' },
    { name: 'handleSaveStamp', params: [], cat: 'stamps' },
    { name: 'handleQuickClassification', params: ['classificationType'], cat: 'stamps' },
    { name: 'closeStampModal', params: [], cat: 'stamps' },

    // ---- Edges ----
    // Relacionamentos entre elementos (self-registered by edgeEditor.js)
    { name: 'handleAddEdgeClick', params: [], cat: 'edges' },
    { name: 'handleRemoveEdge', params: ['edgeId'], cat: 'edges' },
    { name: 'handleEdgeTypeSelect', params: ['typeId'], cat: 'edges' },
    { name: 'handleTargetSelect', params: ['targetId'], cat: 'edges' },
    { name: 'handleSaveEdge', params: [], cat: 'edges' },
    { name: 'closeEdgeModal', params: [], cat: 'edges' },

    // ---- Panels ----
    // Gerenciamento de paineis (self-registered by panelManager.js)
    { name: 'dockPanel', params: ['panelId', 'position'], cat: 'panels' },
    { name: 'minimizePanel', params: ['panelId'], cat: 'panels' },
    { name: 'restorePanel', params: ['panelId'], cat: 'panels' },
    { name: 'floatPanel', params: ['panelId'], cat: 'panels' },

    // ---- Custom Select ----
    // Dropdowns customizados de parametros (self-registered by customSelect.js)
    { name: 'toggleParamDropdown', params: ['selectId'], cat: 'ui' },
    { name: 'filterParamOptions', params: ['selectId', 'query'], cat: 'ui' },
    {
        name: 'selectParameter',
        params: ['selectId', 'value', 'elementId', 'obsIndex', 'readingIndex', 'isAdditional'],
        cat: 'ui',
    },

    // ---- Scenes (additional) ----
    // Funcoes de cena faltantes no registro original
    { name: 'handleSceneCampaigns', params: ['sceneId', 'field', 'selectElement'], cat: 'scenes' },
    { name: 'handleSceneElementFilter', params: ['sceneId', 'elementId', 'visible'], cat: 'scenes' },

    // ---- Observations (additional) ----
    // Campo customizado de observacao
    {
        name: 'handleCustomFieldChange',
        params: ['elementId', 'observationIndex', 'fieldId', 'value'],
        cat: 'observations',
    },

    // ---- Diff & Merge ----
    // Reconciliacao de estados entre modelos
    { name: 'handleOpenMergeModal', params: [], cat: 'merge' },
    { name: 'handleLoadCurrentAsA', params: [], cat: 'merge' },
    { name: 'handleLoadModelA', params: [], cat: 'merge' },
    { name: 'handleLoadModelB', params: [], cat: 'merge' },
    { name: 'handleRunDiff', params: [], cat: 'merge' },
    { name: 'handleAcceptAllA', params: [], cat: 'merge' },
    { name: 'handleAcceptAllB', params: [], cat: 'merge' },
    { name: 'handleApplyMerge', params: [], cat: 'merge' },
    { name: 'handleExportDelta', params: [], cat: 'merge' },

    // ---- Governance ----
    // Contratos, WBS, EVA
    { name: 'handleAddContract', params: [], cat: 'governance' },
    { name: 'handleEditContract', params: ['contractId'], cat: 'governance' },
    { name: 'handleRemoveContract', params: ['contractId'], cat: 'governance' },
    { name: 'handleSaveContract', params: [], cat: 'governance' },
    { name: 'handleAddWbsItem', params: ['parentId'], cat: 'governance' },
    { name: 'handleEditWbsItem', params: ['id', 'field', 'value'], cat: 'governance' },
    { name: 'handleRemoveWbsItem', params: ['id'], cat: 'governance' },
    { name: 'handleApplyWbsTemplate', params: ['templateId'], cat: 'governance' },
    { name: 'handleCalculateEVA', params: [], cat: 'governance' },
    { name: 'handleLinkElementToContract', params: ['elementId', 'contractId'], cat: 'governance' },
    { name: 'handleFileInsuranceClaim', params: ['contractId'], cat: 'governance' },
    { name: 'handleContractFilter', params: ['filter'], cat: 'governance' },
    { name: 'handleToggleInsurance', params: ['listingId'], cat: 'libraries' },
    { name: 'handleInsuranceCheckChange', params: ['listingId', 'currency'], cat: 'libraries' },

    // ---- SAO Protocol ----
    // Cenarios, matrizes e tiers de monitoramento ambiental
    { name: 'handleOpenSAOScenarioModal', params: [], cat: 'sao' },
    { name: 'handleActivateScenario', params: ['scenarioId'], cat: 'sao' },
    { name: 'handleDeactivateScenario', params: [], cat: 'sao' },
    { name: 'handleSetTier', params: ['tier'], cat: 'sao' },
    { name: 'handleToggleMatrix', params: ['matrixId'], cat: 'sao' },
    { name: 'handleOpenSAOMatrixPanel', params: [], cat: 'sao' },
    { name: 'handleLoadAllMatrices', params: [], cat: 'sao' },
    { name: 'closeSAOScenarioModal', params: [], cat: 'sao' },

    // ---- Sensor ----
    // Dispositivos IoT de monitoramento remoto
    { name: 'handleFetchSensorData', params: ['elementId'], cat: 'sensor' },
    { name: 'handleSetSensorApiKey', params: ['elementId', 'apiKey'], cat: 'sensor' },
    { name: 'handleSensorFieldChange', params: ['elementId', 'field', 'value'], cat: 'sensor' },
    { name: 'handleSensorParameterToggle', params: ['elementId', 'parameterId', 'enabled'], cat: 'sensor' },
    { name: 'handleSensorToObservation', params: ['elementId'], cat: 'sensor' },
    { name: 'handleSensorEndpointChange', params: ['elementId', 'endpointKey', 'url'], cat: 'sensor' },
    { name: 'handleSensorProfileChange', params: ['elementId', 'field', 'value'], cat: 'sensor' },
    { name: 'handleSensorEvalChange', params: ['elementId', 'field', 'value'], cat: 'sensor' },
    { name: 'handleFetchSensorDataSilent', params: ['elementId'], cat: 'sensor' },
    { name: 'handleToggleAutoRefresh', params: ['elementId', 'enabled', 'intervalKey'], cat: 'sensor' },
    { name: 'handleAutoRefreshIntervalChange', params: ['elementId', 'intervalKey'], cat: 'sensor' },
    { name: 'handleStopAllAutoRefresh', params: [], cat: 'sensor' },
    { name: 'handleOpenSensorsCenter', params: ['sensorId?'], cat: 'sensor' },
    { name: 'handleSensorCenterRefreshAll', params: [], cat: 'sensor' },
    { name: 'handleSensorCenterStartAll', params: ['intervalKey'], cat: 'sensor' },
    { name: 'handleSensorCenterStopAll', params: [], cat: 'sensor' },
    { name: 'handleSensorCenterFocusElement', params: ['sensorId'], cat: 'sensor' },
    { name: 'handleSensorCenterSearch', params: ['query'], cat: 'sensor' },
    { name: 'handleSensorCenterFilter', params: ['status'], cat: 'sensor' },
    { name: 'handleSensorCenterSort', params: ['column'], cat: 'sensor' },
    { name: 'handleSensorCenterPage', params: ['page'], cat: 'sensor' },
    { name: 'handleSensorCenterToggleExpand', params: ['sensorId'], cat: 'sensor' },
    { name: 'handleSensorCenterSetBulkInterval', params: ['intervalKey'], cat: 'sensor' },

    // ---- Ticker ----
    // Barra de metricas rolante estilo painel financeiro
    { name: 'handleToggleTicker', params: [], cat: 'ticker' },
    { name: 'handleOpenTickerConfig', params: [], cat: 'ticker' },
    { name: 'handleExpandTickerItem', params: ['itemId'], cat: 'ticker' },
    { name: 'handleAddTickerItem', params: [], cat: 'ticker' },
    { name: 'handleRemoveTickerItem', params: ['itemId'], cat: 'ticker' },
    { name: 'handleUpdateTickerItem', params: ['itemId', 'field', 'value'], cat: 'ticker' },
    { name: 'handleToggleTickerItem', params: ['itemId'], cat: 'ticker' },
    { name: 'handleDuplicateTickerItem', params: ['itemId'], cat: 'ticker' },
    { name: 'handleReorderTickerItem', params: ['itemId', 'direction'], cat: 'ticker' },
    { name: 'handleAddTickerFilter', params: ['itemId'], cat: 'ticker' },
    { name: 'handleRemoveTickerFilter', params: ['itemId', 'filterIndex'], cat: 'ticker' },
    { name: 'handleUpdateTickerFilter', params: ['itemId', 'filterIndex', 'field', 'value'], cat: 'ticker' },
    { name: 'handleTickerFilterValueChange', params: ['itemId', 'filterIndex', 'selectEl'], cat: 'ticker' },
    { name: 'handleTickerSpeedChange', params: ['speed'], cat: 'ticker' },
    { name: 'handleTickerSeparatorChange', params: ['separator'], cat: 'ticker' },

    // ---- Calculator ----
    // Metricas compostas, regras e ratios com filtros genericos
    { name: 'handleOpenCalculator', params: [], cat: 'calculator' },
    { name: 'handleCloseCalculator', params: [], cat: 'calculator' },
    { name: 'handleAddCalculatorMetric', params: [], cat: 'calculator' },
    { name: 'handleAddCalculatorRule', params: [], cat: 'calculator' },
    { name: 'handleAddCalculatorRatio', params: [], cat: 'calculator' },
    { name: 'handleRemoveCalculatorItem', params: ['id'], cat: 'calculator' },
    { name: 'handleToggleCalculatorItem', params: ['id'], cat: 'calculator' },
    { name: 'handleClearCalculator', params: [], cat: 'calculator' },

    // ---- Interpolation ----
    // Superfícies interpoladas: terreno, nível d'água, contaminação
    { name: 'handleOpenInterpolationPanel', params: [], cat: 'interpolation' },
    { name: 'handleCloseInterpolationPanel', params: [], cat: 'interpolation' },
    { name: 'handleAddTerrainLayer', params: [], cat: 'interpolation' },
    { name: 'handleAddWaterTableLayer', params: [], cat: 'interpolation' },
    { name: 'handleAddContaminationLayer', params: ['parameterId'], cat: 'interpolation' },
    { name: 'handleRemoveInterpolationLayer', params: ['id'], cat: 'interpolation' },
    { name: 'handleToggleInterpolationLayer', params: ['id'], cat: 'interpolation' },
    { name: 'handleRefreshInterpolationLayer', params: ['id'], cat: 'interpolation' },

    // ---- Agents ----
    // Biblioteca de agentes IA (system + user agents)
    { name: 'openAgentsModal', params: [], cat: 'agents' },
    { name: 'handleCreateAgent', params: [], cat: 'agents' },
    { name: 'handleEditAgent', params: ['agentId'], cat: 'agents' },
    { name: 'handleSaveAgent', params: [], cat: 'agents' },
    { name: 'handleCancelEditAgent', params: [], cat: 'agents' },
    { name: 'handleDeleteAgent', params: ['agentId'], cat: 'agents' },
    { name: 'handleSelectAgent', params: ['agentId'], cat: 'agents' },
    { name: 'handleExportAgent', params: ['agentId'], cat: 'agents' },
    { name: 'handleImportAgent', params: [], cat: 'agents' },

    // ---- Smart Import ----
    // Importacao inteligente via LLM (mapeamento de colunas)
    { name: 'openSmartImportModal', params: [], cat: 'smartImport' },
    { name: 'handleSmartImportFile', params: [], cat: 'smartImport' },
    { name: 'handleAdjustMapping', params: [], cat: 'smartImport' },
    { name: 'handleConfirmSmartImport', params: [], cat: 'smartImport' },

    // ---- LLM Chat (extended) ----
    // Funcoes adicionais do assistente IA
    { name: 'saveLLMConfig', params: [], cat: 'llm' },
    { name: 'sendLLMMessage', params: ['messageText?'], cat: 'llm' },
    { name: 'confirmLLMAction', params: [], cat: 'llm' },
    { name: 'cancelLLMAction', params: [], cat: 'llm' },
    { name: 'handleProviderChange', params: ['providerId'], cat: 'llm' },
    { name: 'testLLMConnection', params: [], cat: 'llm' },
    { name: 'refreshLLMModels', params: [], cat: 'llm' },
    { name: 'toggleChatToolsMenu', params: [], cat: 'llm' },
    { name: 'handleToggleChatTool', params: ['toolId'], cat: 'llm' },
    { name: 'toggleContextualChat', params: [], cat: 'llm' },
    { name: 'handleCreateCustomTool', params: [], cat: 'llm' },
    { name: 'handleEditCustomTool', params: ['toolId'], cat: 'llm' },
    { name: 'handleSaveCustomTool', params: [], cat: 'llm' },
    { name: 'handleRemoveCustomTool', params: ['toolId'], cat: 'llm' },

    // ---- Governance (extended) ----
    // Funcoes adicionais de governanca (partes, desembolsos)
    { name: 'handleAddContractParty', params: ['contractId'], cat: 'governance' },
    { name: 'handleRemoveContractParty', params: ['contractId', 'index'], cat: 'governance' },
    { name: 'handleUpdateContractParty', params: ['contractId', 'index', 'field', 'value'], cat: 'governance' },
    { name: 'handleAddDisbursement', params: ['contractId'], cat: 'governance' },
    { name: 'handleUnlinkElementFromContract', params: ['elementId', 'contractId'], cat: 'governance' },

    // ---- Merge (extended) ----
    // Aceitar mudancas individuais de cada lado
    { name: 'handleMergeAcceptA', params: ['key'], cat: 'merge' },
    { name: 'handleMergeAcceptB', params: ['key'], cat: 'merge' },

    // ---- Panels (extended) ----
    // Funcoes adicionais de paineis (self-registered by panelManager.js)
    { name: 'moveTab', params: ['tabId', 'targetPanelId'], cat: 'panels' },
    { name: 'toggleToolbar', params: [], cat: 'panels' },
    { name: 'toggleStatusbar', params: [], cat: 'panels' },
    { name: 'toggleConstellation', params: [], cat: 'panels' },
    { name: 'floatToolbar', params: [], cat: 'panels' },
    { name: 'dockToolbar', params: [], cat: 'panels' },
    { name: 'floatConstellation', params: [], cat: 'panels' },
    { name: 'dockConstellation', params: [], cat: 'panels' },
    { name: 'toggleLLMChatPanel', params: [], cat: 'panels' },

    // ---- Elements (extended) ----
    // Campos especificos de boundary (overlay, opacidade)
    { name: 'handleBoundaryFieldChange', params: ['elementId', 'field', 'value'], cat: 'elements' },
    { name: 'handleAreaFieldChange', params: ['elementId', 'field', 'value'], cat: 'elements' },

    // ---- Camera (extended) ----
    // Enquadrar todos os elementos na camera
    { name: 'fitAllElements', params: [], cat: 'camera' },

    // ---- IO (extended) ----
    // Funcoes extras de exportacao/importacao
    { name: 'toggleBlockchainOptions', params: [], cat: 'io' },
    { name: 'onKeySelectChange', params: [], cat: 'io' },
    { name: 'createNewKey', params: [], cat: 'io' },
    { name: 'executeImport', params: [], cat: 'io' },
    { name: 'showAboutDialog', params: [], cat: 'ui' },
    { name: 'handleOpenDocs', params: [], cat: 'ui' },
    { name: 'handleOpenApiDocs', params: [], cat: 'ui' },

    // ---- Groups (elements) ----
    { name: 'handleAddElementGroup', params: [], cat: 'groups' },
    { name: 'handleRenameElementGroup', params: ['groupId'], cat: 'groups' },
    { name: 'handleRemoveElementGroup', params: ['groupId'], cat: 'groups' },
    { name: 'handleToggleElementGroupCollapse', params: ['groupId'], cat: 'groups' },
    { name: 'handleToggleElementUngroupedCollapse', params: [], cat: 'groups' },
    { name: 'handleElementGroupColorChange', params: ['groupId', 'color'], cat: 'groups' },
    { name: 'handleMoveElementToGroup', params: ['elementId', 'groupId'], cat: 'groups' },
    // ---- Groups (families) ----
    { name: 'handleAddFamilyGroup', params: [], cat: 'groups' },
    { name: 'handleRenameFamilyGroup', params: ['groupId'], cat: 'groups' },
    { name: 'handleRemoveFamilyGroup', params: ['groupId'], cat: 'groups' },
    { name: 'handleToggleFamilyGroupCollapse', params: ['groupId'], cat: 'groups' },
    { name: 'handleToggleFamilyUngroupedCollapse', params: [], cat: 'groups' },
    { name: 'handleFamilyGroupColorChange', params: ['groupId', 'color'], cat: 'groups' },
    { name: 'handleMoveFamilyToGroup', params: ['familyId', 'groupId'], cat: 'groups' },

    // ---- Aerial Recognition ----
    // Reconhecimento de imagem aerea (IA ou algoritmo)
    { name: 'handleOpenAerialModal', params: [], cat: 'aerial' },
    { name: 'handleAerialAnalyze', params: [], cat: 'aerial' },
    { name: 'handleAerialConfirmImport', params: [], cat: 'aerial' },
    { name: 'handleAerialImageUpload', params: [], cat: 'aerial' },
    { name: 'handleAerialUseBoundary', params: [], cat: 'aerial' },
    { name: 'handleAerialToggleFeature', params: ['index'], cat: 'aerial' },
    { name: 'handleAerialSelectAll', params: ['checked'], cat: 'aerial' },
    { name: 'handleAerialSetExtent', params: [], cat: 'aerial' },
    { name: 'handleAerialMethodChange', params: ['method'], cat: 'aerial' },
    { name: 'handleAerialAutoCalibrate', params: [], cat: 'aerial' },
    { name: 'handleAerialCalibrationChange', params: ['param', 'value'], cat: 'aerial' },
    { name: 'handleAerialResetCalibration', params: [], cat: 'aerial' },
    { name: 'handleAerialToggleAdvanced', params: [], cat: 'aerial' },
    { name: 'handleAerialRemoveAnnotation', params: ['index'], cat: 'aerial' },
    { name: 'handleAerialClearAnnotations', params: [], cat: 'aerial' },
    { name: 'handleAerialClearResults', params: [], cat: 'aerial' },
    { name: 'handleAerialSelectPaintFamily', params: ['family'], cat: 'aerial' },
    { name: 'handleAerialBrushChange', params: ['value'], cat: 'aerial' },
    { name: 'handleAerialTrainNN', params: [], cat: 'aerial' },
    { name: 'handleAerialClassifyNN', params: [], cat: 'aerial' },
    { name: 'handleAerialClearPaint', params: [], cat: 'aerial' },
    { name: 'handleAerialUndoPaint', params: [], cat: 'aerial' },
    { name: 'handleAerialVectorize', params: [], cat: 'aerial' },
    { name: 'handleAerialExportGeoJSON', params: [], cat: 'aerial' },

    // ---- Neural Networks ----
    // Gerenciamento de redes neurais registradas
    { name: 'handleListNetworks', params: [], cat: 'nn' },
    { name: 'handleGetNetworkInfo', params: ['networkId'], cat: 'nn' },
    { name: 'handleResetNetwork', params: ['networkId'], cat: 'nn' },
    { name: 'handleRemoveNetwork', params: ['networkId'], cat: 'nn' },
    { name: 'handleOpenNNManager', params: [], cat: 'nn' },
    { name: 'handleNNCreate', params: [], cat: 'nn' },
    { name: 'handleNNOpenBuilder', params: ['networkId'], cat: 'nn' },
    { name: 'handleNNTrain', params: ['networkId'], cat: 'nn' },
    { name: 'handleNNOpenWhatIf', params: ['networkId'], cat: 'nn' },
    { name: 'handleWhatIfSliderChange', params: ['networkId', 'variableId', 'value'], cat: 'nn' },
    { name: 'handleWhatIfConnectPlume', params: ['networkId', 'elementId'], cat: 'nn' },

    // ---- Report ----
    // Relatorio ambiental com ancoras de cena
    { name: 'handleReportTitleChange', params: ['value'], cat: 'report' },
    { name: 'handleInsertSceneAnchor', params: [], cat: 'report' },
    { name: 'handleReportAnchorClick', params: ['sceneId'], cat: 'report' },
    { name: 'handleExportReportPDF', params: [], cat: 'report' },
    { name: 'handleScrollToReportAnchor', params: ['sceneId'], cat: 'report' },
    { name: 'handleOpenReportOverlay', params: [], cat: 'report' },
    { name: 'handleCloseReportOverlay', params: [], cat: 'report' },
    { name: 'handleToggleReportSplit', params: [], cat: 'report' },
    { name: 'handleToggleReportReadMode', params: [], cat: 'report' },
    { name: 'handleReportPrintPreview', params: [], cat: 'report' },

    // ---- Auth ----
    // Autenticacao, login/logout, controle de acesso
    { name: 'handleLoginEmail', params: [], cat: 'auth' },
    { name: 'handleRegisterEmail', params: [], cat: 'auth' },
    { name: 'handleLoginGoogle', params: [], cat: 'auth' },
    { name: 'handleLogout', params: [], cat: 'auth' },
    { name: 'handleToggleAuthMenu', params: [], cat: 'auth' },
    { name: 'handleOpenAccessModal', params: [], cat: 'auth' },
    { name: 'handleClaimOwnership', params: [], cat: 'auth' },
    { name: 'handleAddAccessRule', params: [], cat: 'auth' },
    { name: 'handleRemoveAccessRule', params: ['index'], cat: 'auth' },
    { name: 'handleUpdateAccessRule', params: ['index', 'field', 'value'], cat: 'auth' },
    { name: 'handleObserverModeChange', params: ['mode'], cat: 'auth' },
    { name: 'handleLoginGitHub', params: [], cat: 'auth' },
    { name: 'handleLoginMicrosoft', params: [], cat: 'auth' },
    { name: 'handleForgotPassword', params: [], cat: 'auth' },
    { name: 'handleOpenAuthModal', params: [], cat: 'auth' },
    { name: 'handleCloseAuthModal', params: [], cat: 'auth' },
    { name: 'updateAuthUI', params: [], cat: 'auth' },

    // ---- Observer ----
    // Submissao de observacoes por observadores e aprovacao/rejeicao
    { name: 'handleSubmitObserverObservation', params: ['elementId', 'data'], cat: 'observer' },
    { name: 'handleSubmitObserverForm', params: [], cat: 'observer' },
    { name: 'handleSubmitObserverComment', params: ['elementId', 'content'], cat: 'observer' },
    { name: 'handleSubmitObserverCommentForm', params: [], cat: 'observer' },
    { name: 'handleApproveObservation', params: ['elementId', 'obsIndex'], cat: 'observer' },
    { name: 'handleRejectObservation', params: ['elementId', 'obsIndex'], cat: 'observer' },

    // ---- Observations (variables) ----
    // Variaveis de observacao (matriz, contexto de amostragem)
    {
        name: 'handleObservationVariableChange',
        params: ['elementId', 'obsIndex', 'variableId', 'field', 'newVal'],
        cat: 'observations',
    },
    { name: 'handleAddObservationVariable', params: ['elementId', 'obsIndex'], cat: 'observations' },
    { name: 'handleRemoveObservationVariable', params: ['elementId', 'obsIndex', 'variableId'], cat: 'observations' },
    {
        name: 'handleRenameObservationVariable',
        params: ['elementId', 'obsIndex', 'oldId', 'newId'],
        cat: 'observations',
    },

    // ---- Project (tree navigation) ----
    // Navegacao na arvore de areas do projeto
    { name: 'toggleAreaNode', params: ['nodeId'], cat: 'project' },
    { name: 'selectAreaNode', params: ['nodeId'], cat: 'project' },

    // ---- Libraries ----
    // Gerenciamento de bibliotecas (instalar, ativar, desativar, desinstalar)
    { name: 'handleOpenLibraryManager', params: [], cat: 'libraries' },
    { name: 'handleOpenMarketplace', params: [], cat: 'libraries' },
    { name: 'handleInstallLibrary', params: ['libraryId'], cat: 'libraries' },
    { name: 'handleUninstallLibrary', params: ['libraryId'], cat: 'libraries' },
    { name: 'handleActivateLibrary', params: ['libraryId'], cat: 'libraries' },
    { name: 'handleDeactivateLibrary', params: ['libraryId'], cat: 'libraries' },
    { name: 'handleImportLibraryFile', params: [], cat: 'libraries' },
    { name: 'handleExportLibrary', params: ['libraryId'], cat: 'libraries' },
    { name: 'handleSearchMarketplace', params: [], cat: 'libraries' },
    { name: 'handleRateLibrary', params: ['libraryId', 'rating'], cat: 'libraries' },
    { name: 'handleMarketOpenWizard', params: [], cat: 'libraries' },
    { name: 'handleMarketSearch', params: ['reset'], cat: 'libraries' },
    { name: 'handleMarketBuyListing', params: ['listingId'], cat: 'libraries' },
    { name: 'handleMarketOpenRfqPrompt', params: ['listingId', 'currency'], cat: 'libraries' },
    { name: 'handleMarketPublishListing', params: [], cat: 'libraries' },
    { name: 'handleMarketMarkNotificationRead', params: ['notificationId'], cat: 'libraries' },
    { name: 'handleMarketAdminModerate', params: ['listingId', 'decision'], cat: 'libraries' },
    { name: 'handleMarketAdminResolveDispute', params: ['disputeId', 'resolution'], cat: 'libraries' },

    // --- Shape editing ---
    { name: 'handleEnterShapeEdit', params: ['elementId'], cat: 'editing' },
    { name: 'handleEnterGizmoMode', params: ['elementId'], cat: 'editing' },
    { name: 'handleExitShapeEdit', params: [], cat: 'editing' },
    { name: 'handleToggleDrawMode', params: [], cat: 'editing' },
    { name: 'handleDeleteSelectedVertex', params: [], cat: 'editing' },
    { name: 'handleResetShape', params: [], cat: 'editing' },
    { name: 'handleToggleSnap', params: [], cat: 'editing' },
    { name: 'handleSetGridSize', params: ['size'], cat: 'editing' },
    { name: 'handleSetGizmoMode', params: ['mode'], cat: 'editing' },
    { name: 'handleToggleGizmoSpace', params: [], cat: 'editing' },
    { name: 'handleToggleGizmoShapeEdit', params: [], cat: 'editing' },
    { name: 'handleSetCoordinate', params: ['axis', 'value'], cat: 'editing' },

    // ---- Context menu actions ----
    // Zoom, duplicate, show/hide all family, dock details
    { name: 'handleZoomToElement', params: ['elementId'], cat: 'elements' },
    { name: 'handleZoomToFamily', params: ['familyId'], cat: 'elements' },
    { name: 'handleDuplicateElement', params: ['elementId'], cat: 'elements' },
    { name: 'handleShowAllFamily', params: ['familyId'], cat: 'elements' },
    { name: 'handleHideAllFamily', params: ['familyId'], cat: 'elements' },
    { name: 'handleToggleDetailsDock', params: [], cat: 'ui' },

    // ---- HUD Cards ----
    // Cards HUD para elementos intangiveis/genericos no viewport
    { name: 'handleToggleHudCards', params: [], cat: 'hudCards' },
    { name: 'handleToggleHudCard', params: ['elementId'], cat: 'hudCards' },
    { name: 'handleExpandAllHudCards', params: [], cat: 'hudCards' },
    { name: 'handleCollapseAllHudCards', params: [], cat: 'hudCards' },

    // ---- Viz Settings ----
    // Barra de configuracoes de visualizacao 3D (presets, fog, wireframe, etc.)
    { name: 'handleToggleVizSettings', params: [], cat: 'vizSettings' },
    { name: 'handleToggleVizSettingsCollapsed', params: [], cat: 'vizSettings' },
    { name: 'handleApplyVizPreset', params: ['presetId'], cat: 'vizSettings' },
    { name: 'handleVizSettingChange', params: ['key', 'value'], cat: 'vizSettings' },
    { name: 'handleSaveVizPreset', params: [], cat: 'vizSettings' },
    { name: 'handleDeleteVizPreset', params: ['presetId'], cat: 'vizSettings' },
    { name: 'handleResetVizSettings', params: [], cat: 'vizSettings' },
    { name: 'handleOpenClipPlanes', params: [], cat: 'vizSettings' },
    { name: 'handleCloseClipPlanes', params: [], cat: 'vizSettings' },
    { name: 'handleAddClipPlane', params: [], cat: 'vizSettings' },
    { name: 'handleRemoveClipPlane', params: ['id'], cat: 'vizSettings' },
    { name: 'handleDuplicateClipPlane', params: ['id'], cat: 'vizSettings' },
    { name: 'handleToggleClipPlane', params: ['id'], cat: 'vizSettings' },
    { name: 'handleUpdateClipPlaneField', params: ['id', 'field', 'value'], cat: 'vizSettings' },
    { name: 'handleSetClipPlaneScope', params: ['id', 'scope'], cat: 'vizSettings' },
    { name: 'handleToggleClipPlaneElement', params: ['planeId', 'elementId'], cat: 'vizSettings' },

    // ---- Inspector ----
    { name: 'handleToggleInspector', params: [], cat: 'inspector' },
    { name: 'handleToggleNode', params: ['path'], cat: 'inspector' },
    { name: 'handleStartEdit', params: ['path'], cat: 'inspector' },
    { name: 'handleConfirmEdit', params: ['path', 'newValue'], cat: 'inspector' },
    { name: 'handleExpandAllNodes', params: [], cat: 'inspector' },
    { name: 'handleCollapseAllNodes', params: [], cat: 'inspector' },
    { name: 'handleInspectorSearch', params: ['query'], cat: 'inspector' },
    { name: 'handleCopyPath', params: ['path'], cat: 'inspector' },

    // --- Performance Monitor ---
    { name: 'handleTogglePerfMonitor', params: [], cat: 'performance' },

    // --- Focus Mode & Snapshot ---
    { name: 'handleToggleFocusMode', params: [], cat: 'view' },
    { name: 'handleCaptureSnapshot', params: [], cat: 'view' },
    { name: 'toggleConstellationCollapse', params: [], cat: 'view' },

    // --- Borehole ---
    { name: 'handleImportBorehole', params: [], cat: 'borehole' },
    { name: 'handleValidateBorehole', params: [], cat: 'borehole' },
    { name: 'handleImportBoreholeFromText', params: ['jsonText'], cat: 'borehole' },

    // --- Pipelines (automação de APIs) ---
    { name: 'handleOpenPipelineManager', params: [], cat: 'pipelines' },
    { name: 'handleNewPipeline', params: [], cat: 'pipelines' },
    { name: 'handleEditPipeline', params: ['id'], cat: 'pipelines' },
    { name: 'handleRunPipeline', params: ['id'], cat: 'pipelines' },
    { name: 'handleDeletePipeline', params: ['id'], cat: 'pipelines' },

    // ---- Issues 3D ----
    {
        name: 'handleCreateIssueAtPosition',
        params: ['position', 'elementId'],
        cat: 'issues',
        headlessSafe: true,
        paramsSchema: {
            x: { type: 'number', required: true, label: 'X (m)' },
            y: { type: 'number', required: true, label: 'Y (m)' },
            z: { type: 'number', required: true, label: 'Z (m)' },
            title: { type: 'string', required: true, label: 'Title' },
            severity: {
                type: 'select',
                required: true,
                options: ['low', 'medium', 'high', 'critical'],
                label: 'Severity',
            },
        },
    },
    { name: 'handleResolveIssue', params: ['issueId'], cat: 'issues' },
    { name: 'handleDeleteIssue', params: ['issueId'], cat: 'issues', destructive: true },
    { name: 'handleFocusIssue', params: ['issueId'], cat: 'issues' },
    { name: 'handleOpenIssuesPanel', params: [], cat: 'issues' },
    { name: 'handleGetIssues', params: [], cat: 'issues' },
    { name: 'handleGetOpenIssueCount', params: [], cat: 'issues' },
    { name: 'handleCreateIssuesFromValidation', params: ['candidates'], cat: 'issues', headlessSafe: true },

    // ---- Bounty Board ----
    // Bug bounty: criacao, claim, resolucao, verificacao, leaderboard, screenshots
    { name: 'handleOpenBountyPanel', params: [], cat: 'bounty' },
    { name: 'handleCreateBounty', params: ['params'], cat: 'bounty' },
    { name: 'handleClaimBounty', params: ['issueId'], cat: 'bounty' },
    { name: 'handleSubmitBountyResolution', params: ['issueId'], cat: 'bounty' },
    { name: 'handleVerifyBountyResolution', params: ['issueId'], cat: 'bounty' },
    { name: 'handleGetLeaderboard', params: [], cat: 'bounty' },
    { name: 'handleGetOpenBountyCount', params: [], cat: 'bounty' },
    { name: 'handleCaptureBountyScreenshot', params: ['issueId'], cat: 'bounty' },
    { name: 'handleCreateServiceRequest', params: ['params'], cat: 'bounty' },
    { name: 'handlePublishServiceRequest', params: ['issueId'], cat: 'bounty' },
];

// --- Pipeline Headless Metadata ---
// Mapa complementar com metadados para modo headless (P2).
// headlessSafe: handler aceita _headless flag e executa sem UI.
// destructive: acao destrutiva, bloqueada em headless mode sem allowDestructive.
// paramsSchema: schema para form de configuracao no editor de pipelines.

export const HEADLESS_META = {
    handleAddElement: {
        headlessSafe: true,
        paramsSchema: {
            familyId: {
                type: 'select',
                required: true,
                options: ['well', 'plume', 'lake', 'river', 'spring', 'building', 'tank', 'waste', 'boundary'],
                label: 'Family',
            },
            name: { type: 'string', required: false, label: 'Name' },
            x: { type: 'number', required: false, label: 'Easting (m)' },
            y: { type: 'number', required: false, label: 'Northing (m)' },
        },
    },
    handleAddObservation: {
        headlessSafe: true,
        paramsSchema: {
            elementId: { type: 'string', required: true, label: 'Element ID' },
            parameterId: { type: 'string', required: true, label: 'Parameter' },
            value: { type: 'number', required: true, label: 'Value' },
            unit: { type: 'string', required: false, label: 'Unit' },
        },
    },
    handleAddCampaign: {
        headlessSafe: true,
        paramsSchema: {
            name: { type: 'string', required: true, label: 'Name' },
            startDate: { type: 'string', required: false, label: 'Start date (ISO)' },
        },
    },
    handleAddEdgeClick: {
        headlessSafe: true,
        paramsSchema: {
            sourceId: { type: 'string', required: true, label: 'Source element' },
            targetId: { type: 'string', required: true, label: 'Target element' },
            typeId: { type: 'string', required: false, label: 'Edge type' },
        },
    },
    handleSetLanguage: { headlessSafe: true },
    handleToggleTheme: { headlessSafe: true },

    // Destructive actions — blocked in headless unless allowDestructive
    handleClearModel: { destructive: true },
    handleRemoveElement: { destructive: true },
    handleDeletePipeline: { destructive: true },
    handleResetNetwork: { destructive: true },
    handleClearCalculator: { destructive: true },
    handleResetVizSettings: { destructive: true },
};

/**
 * Get headless metadata for an action.
 * @param {string} actionName
 * @returns {{ headlessSafe?: boolean, destructive?: boolean, paramsSchema?: Object }|null}
 */
export function getHeadlessMeta(actionName) {
    // Check inline meta first (from ACTION_REGISTRY entries)
    const entry = ACTION_REGISTRY.find((a) => a.name === actionName);
    if (entry?.headlessSafe !== undefined || entry?.destructive !== undefined || entry?.paramsSchema) {
        return { headlessSafe: entry.headlessSafe, destructive: entry.destructive, paramsSchema: entry.paramsSchema };
    }
    // Then check HEADLESS_META map
    return HEADLESS_META[actionName] || null;
}
