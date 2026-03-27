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
   LIBRARY LOADER — Manifest injector and remover
   Injetor e removedor de conteudo de bibliotecas

   Parseia o manifesto e injeta/remove conteudo nos modulos alvo.
   Cada secao do manifesto (families, units, parameters, agents, etc.)
   tem um par _inject/_remove que sabe conversar com o modulo alvo.

   Retorna injectedIds para rastreamento na desinstalacao.
   ================================================================ */

import { addCustomFamily, deleteFamily } from '../../core/elements/families.js';
import { CONFIG } from '../../config.js';
import { saveUserAgent, deleteUserAgent } from '../../core/llm/agents.js';
import { addUserTool, removeUserTool } from '../../core/llm/chatTools.js';
import { addTickerItem, removeTickerItem } from '../ticker/manager.js';
import {
    REGULATORY_THRESHOLDS,
    PARAMETER_THRESHOLDS,
    BENCHMARKS,
    addCustomThreshold,
    getCustomThresholds,
    removeCustomThreshold,
} from '../../core/validation/rules.js';
import { registerLock, unregisterLibraryLocks } from './locks.js';

// ----------------------------------------------------------------
// MAIN ORCHESTRATION
// Orquestra injecao/remocao de todas as secoes
// ----------------------------------------------------------------

/**
 * Inject all content sections from a library manifest.
 * Injeta todo o conteudo do manifesto nos modulos alvo.
 *
 * @param {Object} manifest - Library manifest
 * @returns {Object} injectedIds - Tracking object for uninstall
 */
export function injectLibrary(manifest) {
    const contents = manifest.contents || {};
    const injectedIds = {
        families: [],
        parameters: [],
        units: [],
        agents: [],
        chatTools: [],
        tickerItems: [],
        validationRules: { regulatoryLimits: [], parameterLimits: [], benchmarks: [] },
        lockedFields: [],
        i18n: [],
        imagery: [],
    };

    // Order matters: units before parameters (params may reference units)
    if (contents.units) {
        injectedIds.units = _injectUnits(contents.units);
    }
    if (contents.families) {
        injectedIds.families = _injectFamilies(contents.families);
    }
    if (contents.parameters) {
        injectedIds.parameters = _injectParameters(contents.parameters);
    }
    if (contents.validationRules) {
        injectedIds.validationRules = _injectValidationRules(contents.validationRules);
    }
    if (contents.agents) {
        injectedIds.agents = _injectAgents(contents.agents, manifest.id);
    }
    if (contents.chatTools) {
        injectedIds.chatTools = _injectChatTools(contents.chatTools, manifest.id);
    }
    if (contents.tickerItems) {
        injectedIds.tickerItems = _injectTickerItems(contents.tickerItems, manifest.id);
    }
    if (contents.i18n) {
        injectedIds.i18n = _injectI18n(contents.i18n);
    }
    if (contents.lockedFields) {
        injectedIds.lockedFields = _injectLockedFields(contents.lockedFields, manifest.id);
    }
    if (contents.imagery) {
        injectedIds.imagery = _injectImagery(contents.imagery, manifest.id);
    }

    return injectedIds;
}

/**
 * Remove all injected content from a library.
 * Remove todo o conteudo injetado por uma biblioteca.
 *
 * @param {Object} manifest - Library manifest
 * @param {Object} injectedIds - Tracking object from install
 */
export function removeLibrary(manifest, injectedIds) {
    if (!injectedIds) return;

    // Remove in reverse order of injection
    if (injectedIds.imagery?.length > 0) {
        _removeImagery(injectedIds.imagery);
    }
    unregisterLibraryLocks(manifest.id);

    if (injectedIds.i18n?.length > 0) {
        _removeI18n(injectedIds.i18n);
    }
    if (injectedIds.tickerItems?.length > 0) {
        _removeTickerItems(injectedIds.tickerItems);
    }
    if (injectedIds.chatTools?.length > 0) {
        _removeChatTools(injectedIds.chatTools);
    }
    if (injectedIds.agents?.length > 0) {
        _removeAgents(injectedIds.agents);
    }
    if (injectedIds.validationRules) {
        _removeValidationRules(injectedIds.validationRules);
    }
    if (injectedIds.parameters?.length > 0) {
        _removeParameters(injectedIds.parameters);
    }
    if (injectedIds.families?.length > 0) {
        _removeFamilies(injectedIds.families);
    }
    if (injectedIds.units?.length > 0) {
        _removeUnits(injectedIds.units);
    }
}

// ----------------------------------------------------------------
// FAMILIES
// Injeta/remove familias customizadas
// ----------------------------------------------------------------

function _injectFamilies(families) {
    const ids = [];
    for (const [famId, famDef] of Object.entries(families)) {
        const result = addCustomFamily(famDef.id || famId, famDef.name || famId, famDef.icon || 'cube');
        if (result) {
            ids.push(result.id);
        }
    }
    return ids;
}

function _removeFamilies(familyIds) {
    for (const id of familyIds) {
        deleteFamily(id);
    }
}

// ----------------------------------------------------------------
// PARAMETERS
// Injeta/remove parametros em CONFIG.PARAMETERS
// Mesmo padrao do SAO: merge sem duplicar IDs existentes
// ----------------------------------------------------------------

function _injectParameters(parameters) {
    const ids = [];
    for (const param of parameters) {
        if (!param.id) continue;
        // Check if already exists — only add sao metadata, don't duplicate
        const existing = CONFIG.PARAMETERS.find((p) => p.id === param.id);
        if (existing) {
            // Merge library-specific fields without overwriting core fields
            if (param.library) existing.library = param.library;
            ids.push(param.id);
        } else {
            CONFIG.PARAMETERS.push({ ...param });
            ids.push(param.id);
        }
    }
    return ids;
}

function _removeParameters(paramIds) {
    for (const id of paramIds) {
        const idx = CONFIG.PARAMETERS.findIndex((p) => p.id === id);
        // Only remove if it was added by a library (has no sao or existing default)
        if (idx !== -1) {
            CONFIG.PARAMETERS.splice(idx, 1);
        }
    }
}

// ----------------------------------------------------------------
// UNITS
// Injeta/remove unidades em CONFIG.UNITS (array)
// ----------------------------------------------------------------

function _injectUnits(units) {
    const ids = [];
    for (const unit of units) {
        if (!unit.id) continue;
        // Skip if already exists
        const existing = CONFIG.UNITS.find((u) => u.id === unit.id);
        if (!existing) {
            CONFIG.UNITS.push({ ...unit });
            ids.push(unit.id);
        }
    }
    return ids;
}

function _removeUnits(unitIds) {
    for (const id of unitIds) {
        const idx = CONFIG.UNITS.findIndex((u) => u.id === id);
        if (idx !== -1) {
            CONFIG.UNITS.splice(idx, 1);
        }
    }
}

// ----------------------------------------------------------------
// VALIDATION RULES
// Injeta/remove limites regulatorios, parametros e benchmarks
// ----------------------------------------------------------------

function _injectValidationRules(rules) {
    const injected = { regulatoryThresholds: [], parameterThresholds: [], benchmarks: [] };

    if (rules.regulatoryLimits || rules.regulatoryThresholds) {
        const thresholds = rules.regulatoryThresholds || rules.regulatoryLimits;
        for (const [cas, entries] of Object.entries(thresholds)) {
            // Suporta formato novo (array de ThresholdEntry) e legado (matrixLimits)
            const entryArray = Array.isArray(entries)
                ? entries
                : Object.entries(entries).map(([matrix, lim]) => ({
                      type: 'vi',
                      value: lim.max,
                      matrix,
                      unit: lim.unit,
                      severity: 'intervention',
                      source: lim.source || 'library',
                      meta: {},
                  }));
            for (const entry of entryArray) {
                addCustomThreshold(cas, { ...entry, meta: { ...entry.meta, _libraryInjected: true } });
            }
            injected.regulatoryThresholds.push(cas);
        }
    }

    if (rules.parameterLimits || rules.parameterThresholds) {
        const thresholds = rules.parameterThresholds || rules.parameterLimits;
        for (const [paramId, entries] of Object.entries(thresholds)) {
            const entryArray = Array.isArray(entries)
                ? entries
                : [
                      {
                          type: 'vi',
                          value: entries.max,
                          matrix: entries.matrix || 'effluent',
                          unit: entries.unit,
                          severity: 'intervention',
                          source: entries.source || 'library',
                          meta: {},
                      },
                  ];
            for (const entry of entryArray) {
                addCustomThreshold(paramId, { ...entry, meta: { ...entry.meta, _libraryInjected: true } });
            }
            injected.parameterThresholds.push(paramId);
        }
    }

    if (rules.benchmarks) {
        for (const [indicatorId, benchmark] of Object.entries(rules.benchmarks)) {
            BENCHMARKS[indicatorId] = { ...benchmark };
            injected.benchmarks.push(indicatorId);
        }
    }

    return injected;
}

function _removeValidationRules(injectedRules) {
    if (injectedRules.regulatoryThresholds) {
        for (const cas of injectedRules.regulatoryThresholds) {
            // Remove only library-injected entries
            const customs = getCustomThresholds(cas);
            for (let i = customs.length - 1; i >= 0; i--) {
                if (customs[i].meta?._libraryInjected) removeCustomThreshold(cas, i);
            }
        }
    }
    if (injectedRules.parameterThresholds) {
        for (const paramId of injectedRules.parameterThresholds) {
            const customs = getCustomThresholds(paramId);
            for (let i = customs.length - 1; i >= 0; i--) {
                if (customs[i].meta?._libraryInjected) removeCustomThreshold(paramId, i);
            }
        }
    }
    if (injectedRules.benchmarks) {
        for (const indicatorId of injectedRules.benchmarks) {
            delete BENCHMARKS[indicatorId];
        }
    }
}

// ----------------------------------------------------------------
// AGENTS
// Injeta/remove agentes de IA como user agents
// ----------------------------------------------------------------

function _injectAgents(agents, libraryId) {
    const ids = [];
    for (const agent of agents) {
        const saved = saveUserAgent({
            id: agent.id || `lib-${libraryId}-${Date.now()}`,
            name: agent.name || 'Library Agent',
            description: agent.description || '',
            systemPromptAddition: agent.systemPromptAddition || '',
            icon: agent.icon || 'cpu',
            isLibrary: true,
            libraryId,
        });
        if (saved) ids.push(saved.id);
    }
    return ids;
}

function _removeAgents(agentIds) {
    for (const id of agentIds) {
        deleteUserAgent(id);
    }
}

// ----------------------------------------------------------------
// CHAT TOOLS
// Injeta/remove ferramentas de chat como user tools
// ----------------------------------------------------------------

function _injectChatTools(tools, libraryId) {
    const ids = [];
    for (const tool of tools) {
        const created = addUserTool({
            name: tool.name || 'Library Tool',
            description: tool.description || '',
            prompt: tool.promptAddition || '',
            icon: tool.icon || 'wrench',
        });
        if (created) {
            // Tag with library info for tracking
            created.isLibrary = true;
            created.libraryId = libraryId;
            ids.push(created.id);
        }
    }
    return ids;
}

function _removeChatTools(toolIds) {
    for (const id of toolIds) {
        removeUserTool(id);
    }
}

// ----------------------------------------------------------------
// TICKER ITEMS
// Injeta/remove itens na barra de metricas
// ----------------------------------------------------------------

function _injectTickerItems(items, libraryId) {
    const ids = [];
    items.forEach((itemDef, i) => {
        const item = addTickerItem({
            id: `lib-${libraryId}-ticker-${i}`,
            label: itemDef.label || '',
            suffix: itemDef.suffix || '',
            filters: itemDef.filters || [],
            calculation: itemDef.calculation || 'average',
            unitId: itemDef.unitId || null,
            precision: itemDef.precision ?? 2,
            color: itemDef.color || '',
            enabled: true,
        });
        if (item) ids.push(item.id);
    });
    return ids;
}

function _removeTickerItems(itemIds) {
    for (const id of itemIds) {
        removeTickerItem(id);
    }
}

// ----------------------------------------------------------------
// I18N
// Injeta/remove chaves de traducao nos dicionarios carregados
// ----------------------------------------------------------------

/** @type {Object} Tracks injected i18n keys per language for removal */
function _injectI18n(i18nData) {
    const injectedKeys = [];

    // i18nData format: { en: { key: value }, pt: { key: value }, es: { key: value } }
    // We need to merge into the global translations object
    // Since translations.js doesn't export a merge function, we dispatch a custom event
    // that translations.js can listen to, or we use the global _ecbyts_i18n_merge pattern
    for (const [lang, keys] of Object.entries(i18nData)) {
        if (typeof keys !== 'object') continue;
        // Store keys for removal tracking
        injectedKeys.push(...Object.keys(keys).map((k) => `${lang}:${k}`));
    }

    // Dispatch event with the i18n data so translations module can merge
    window.dispatchEvent(new CustomEvent('i18nMerge', { detail: i18nData }));

    return injectedKeys;
}

function _removeI18n(keySpecs) {
    // keySpecs format: ["en:key1", "pt:key2", ...]
    // Dispatch event so translations module can remove
    window.dispatchEvent(new CustomEvent('i18nRemove', { detail: keySpecs }));
}

// ----------------------------------------------------------------
// LOCKED FIELDS
// Registra/remove campos travados no motor de locks
// ----------------------------------------------------------------

function _injectLockedFields(lockedFields, libraryId) {
    const ids = [];
    for (const lockDef of lockedFields) {
        if (!lockDef.id) continue;
        registerLock(lockDef, libraryId);
        ids.push(lockDef.id);
    }
    return ids;
}

// ----------------------------------------------------------------
// IMAGERY
// Registra/remove imagens aereas georreferenciadas
// Armazena referências num catálogo interno; a aplicação
// real no boundary acontece sob demanda pelo inspector.
// ----------------------------------------------------------------

/** @type {Map<string, Object>} id → { ...imgDef, libraryId } */
const _imageryRegistry = new Map();

/**
 * Register imagery entries from a library.
 * @param {Object[]} imagery - Array of imagery definitions
 * @param {string} libraryId - Source library id
 * @returns {string[]} Injected imagery ids
 */
function _injectImagery(imagery, libraryId) {
    const ids = [];
    for (const img of imagery) {
        if (!img.id) continue;
        _imageryRegistry.set(img.id, { ...img, libraryId });
        ids.push(img.id);
    }
    window.dispatchEvent(new CustomEvent('imageryChanged'));
    return ids;
}

/**
 * Remove imagery entries from registry.
 * Boundary overlay cleanup is handled by the 'imageryChanged' event
 * listener in the handler layer (has access to elements module).
 *
 * @param {string[]} ids - Imagery ids to remove
 */
function _removeImagery(ids) {
    for (const id of ids) {
        _imageryRegistry.delete(id);
    }
    window.dispatchEvent(
        new CustomEvent('imageryChanged', {
            detail: { removed: ids },
        }),
    );
}

/**
 * Get all available imagery from installed libraries.
 * @returns {Object[]} Array of imagery entries with libraryId
 */
export function getAvailableImagery() {
    return Array.from(_imageryRegistry.values());
}

/**
 * Get a specific imagery entry by id.
 * @param {string} id - Imagery id
 * @returns {Object|undefined}
 */
export function getImageryById(id) {
    return _imageryRegistry.get(id);
}
