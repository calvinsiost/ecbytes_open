// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Version: 0.1-beta
// Authorship: Calvin Stefan Iost
// Copyright (c) 2026 Calvin Stefan Iost

/**
 * PIPELINES MODULE — Barrel de re-exports e inicialização.
 * Importar deste arquivo em vez dos módulos individuais.
 *
 * Inicialização: chama loadFromStorage() ao importar.
 */

// Schema
export {
    NODE_TYPES,
    BPMN_ELEMENT_MAP,
    ALLOWED_PATHS,
    BPMN_TEMPLATE,
    createPipelineId,
    createRunId,
    parseBpmnXml,
    serializeToBpmn,
    validatePipeline,
} from './schema.js';

// Registry
export {
    loadFromStorage,
    savePipeline,
    getPipeline,
    getAllPipelines,
    deletePipeline,
    saveRunLog,
    getRunLogs,
} from './registry.js';

// Executor
export {
    registerPipelineAction,
    getRegisteredActions,
    abortRun,
    createRun,
    runPipeline,
    executeNode,
} from './executor.js';

// Inicialização automática ao importar o módulo
import { loadFromStorage } from './registry.js';
loadFromStorage();
