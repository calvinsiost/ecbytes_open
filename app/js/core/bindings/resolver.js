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
   BINDING RESOLVER — Motor de resolucao de bindings
   Navega dot-paths, resolve referencias entre entidades do modelo,
   aplica transforms, detecta ciclos.

   Resolucao LAZY: ocorre no momento da leitura (UI render, export,
   analytics), nao na escrita. Isso elimina a necessidade de
   interceptar toda mutacao no modelo.
   ================================================================ */

import { applyTransform } from './transforms.js';

/** Maximum binding chain depth to prevent infinite loops */
const MAX_DEPTH = 10;

// ----------------------------------------------------------------
// PATH PARSING & NAVIGATION
// ----------------------------------------------------------------

/**
 * Parse a dot-path string into an array of typed segments.
 * Converte "data.profile.constructive.elements[type=screen].topDepth"
 * em segmentos tipados para navegacao segura.
 *
 * Segment types:
 * - { type: 'property', key: 'data' }
 * - { type: 'index', index: 4 }
 * - { type: 'selector', key: 'type', value: 'screen' }
 *
 * @param {string} path - Dot-path with optional bracket notation
 * @returns {Array<Object>} Parsed segments
 */
export function parsePath(path) {
    if (!path || typeof path !== 'string') return [];

    const segments = [];
    // Regex captura: propriedade simples, [indice], [chave=valor]
    const regex = /([^.\[\]]+)|\[(\d+)\]|\[(\w+)=([^\]]+)\]/g;
    let match;

    while ((match = regex.exec(path)) !== null) {
        if (match[1] !== undefined) {
            // Propriedade simples: "data", "position", "topDepth"
            segments.push({ type: 'property', key: match[1] });
        } else if (match[2] !== undefined) {
            // Indice numerico: [4], [0]
            segments.push({ type: 'index', index: parseInt(match[2], 10) });
        } else if (match[3] !== undefined && match[4] !== undefined) {
            // Seletor: [type=screen], [elementId=well-3]
            segments.push({ type: 'selector', key: match[3], value: match[4] });
        }
    }

    return segments;
}

/**
 * Navigate a dot-path on an object, returning the value at that path.
 * Navega um objeto seguindo o caminho especificado.
 *
 * Supports:
 * - Simple property: "data.position.z"
 * - Numeric index: "elements[4]"
 * - Selector: "elements[type=screen]" (finds first match in array)
 *
 * @param {Object} obj - Root object to navigate
 * @param {string} path - Dot-path string
 * @returns {*} Value at path, or undefined if path is invalid
 */
export function resolvePath(obj, path) {
    if (obj == null || !path) return undefined;

    const segments = parsePath(path);
    let current = obj;

    for (const seg of segments) {
        if (current == null) return undefined;

        if (seg.type === 'property') {
            current = current[seg.key];
        } else if (seg.type === 'index') {
            current = Array.isArray(current) ? current[seg.index] : undefined;
        } else if (seg.type === 'selector') {
            current = Array.isArray(current)
                ? current.find((item) => item != null && String(item[seg.key]) === String(seg.value))
                : undefined;
        }
    }

    return current;
}

/**
 * Set a value at a dot-path on an object.
 * Atribui um valor no caminho especificado (para writeback do resolved value).
 * Cria objetos intermediarios se necessario, mas NAO cria arrays.
 *
 * @param {Object} obj - Root object
 * @param {string} path - Dot-path (only simple properties supported for set)
 * @param {*} value - Value to set
 * @returns {boolean} true if set succeeded
 */
export function setPath(obj, path, value) {
    if (obj == null || !path) return false;

    const parts = path.split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
        if (current[parts[i]] == null) {
            current[parts[i]] = {};
        }
        current = current[parts[i]];
        if (typeof current !== 'object') return false;
    }

    current[parts[parts.length - 1]] = value;
    return true;
}

// ----------------------------------------------------------------
// TARGET RESOLUTION
// ----------------------------------------------------------------

/**
 * Resolve the target object for a binding.
 * Encontra a entidade-alvo (elemento, campanha, calculator, observacao).
 *
 * @param {Object} binding - BindingRef with targetType and targetId
 * @param {Object} context - { getElementById, getCampaignById, getCalculatorMetric, getObservationById }
 * @returns {Object|null} Target object or null if not found
 */
function resolveTarget(binding, context) {
    if (!binding?.targetType || !binding?.targetId) return null;

    switch (binding.targetType) {
        case 'element':
            return context.getElementById?.(binding.targetId) || null;
        case 'campaign':
            return context.getCampaignById?.(binding.targetId) || null;
        case 'calculator':
            return context.getCalculatorMetric?.(binding.targetId) || null;
        case 'observation':
            return context.getObservationById?.(binding.targetId) || null;
        case 'constant':
            return context.getConstantById?.(binding.targetId) || null;
        default:
            console.warn(`[Bindings] Unknown targetType: "${binding.targetType}"`);
            return null;
    }
}

function _isFieldTypeCompatible(field, value) {
    const numericFields = new Set(['x', 'y', 'z', 'value', 'limit', 'expectedValue', 'uncertainty', 'coverageFactor']);
    if (numericFields.has(field)) {
        if (value === null || value === '' || value === undefined) return false;
        return Number.isFinite(Number(value));
    }
    if (field === 'date') return typeof value === 'string' && value.length > 0;
    return true;
}

// ----------------------------------------------------------------
// SINGLE BINDING RESOLUTION
// ----------------------------------------------------------------

/**
 * Resolve a single binding, returning the resolved value and status.
 * Resolve um binding individual: encontra o alvo, navega o path,
 * aplica o transform.
 *
 * @param {Object} binding - BindingRef object
 * @param {Object} context - Resolution context with entity lookups
 * @param {Set} [visited] - Visited set for cycle detection
 * @param {number} [depth] - Current chain depth
 * @returns {{ value: *, status: string, error?: string }}
 */
export function resolveBinding(binding, context, visited, depth = 0) {
    if (!binding || !binding.targetId || !binding.targetPath) {
        return { value: binding?.resolvedValue, status: 'broken', error: 'Missing targetId or targetPath' };
    }

    // Deteccao de ciclo: chave unica por binding target+path
    const bindingKey = `${binding.targetType}:${binding.targetId}:${binding.targetPath}`;
    if (visited?.has(bindingKey)) {
        return { value: binding.resolvedValue, status: 'circular', error: 'Circular binding detected' };
    }
    if (depth >= MAX_DEPTH) {
        return { value: binding.resolvedValue, status: 'circular', error: `Max depth (${MAX_DEPTH}) exceeded` };
    }

    // Adiciona ao visited set
    visited?.add(bindingKey);

    // Encontra entidade-alvo
    const target = resolveTarget(binding, context);
    if (target == null) {
        return {
            value: binding.resolvedValue,
            status: 'broken',
            error: `Target not found: ${binding.targetType}/${binding.targetId}`,
        };
    }

    // Navega o path no alvo
    const rawValue = resolvePath(target, binding.targetPath);
    if (rawValue === undefined) {
        return { value: binding.resolvedValue, status: 'broken', error: `Path not found: ${binding.targetPath}` };
    }

    // Aplica transform
    const transformContext = {
        targetObj: target,
        resolvePath,
    };
    const transformed = applyTransform(binding.transform, rawValue, binding.transformArgs, transformContext);

    return { value: transformed, status: 'ok' };
}

// ----------------------------------------------------------------
// OBSERVATION-LEVEL RESOLUTION
// ----------------------------------------------------------------

/**
 * Resolve all bindings on a single observation.
 * Resolve todos os bindings de uma observacao, atualizando os campos
 * reais (obs.z, obs.date, etc.) e o cache (resolvedValue, status).
 *
 * Mutates the observation in place for performance.
 *
 * @param {Object} obs - Observation object with optional bindings
 * @param {Object} context - Resolution context
 * @returns {{ resolved: number, broken: number, circular: number }}
 */
export function resolveObservation(obs, context) {
    const stats = { resolved: 0, broken: 0, circular: 0 };
    if (!obs?.bindings || typeof obs.bindings !== 'object') return stats;

    const visited = new Set();

    for (const [field, binding] of Object.entries(obs.bindings)) {
        const result = resolveBinding(binding, context, visited, 0);

        // Atualiza cache do binding
        binding.status = result.status;
        if (result.status === 'ok') {
            binding.resolvedValue = result.value;
            binding.resolvedAt = new Date().toISOString();
            // Writeback: atualiza campo real da observacao
            setPath(obs, field, result.value);
            stats.resolved++;
        } else if (result.status === 'circular') {
            stats.circular++;
        } else {
            stats.broken++;
        }
    }

    return stats;
}

// ----------------------------------------------------------------
// MODEL-WIDE RESOLUTION SWEEP
// ----------------------------------------------------------------

/**
 * Resolve all bindings across all elements in the model.
 * Sweep completo: chamado apos import ou export para garantir
 * que todos os valores vinculados estao atualizados.
 *
 * @param {Object[]} elements - All model elements
 * @param {Object[]} campaigns - All campaigns
 * @param {Object} [options] - { getCalculatorMetric }
 * @returns {{ resolved: number, broken: number, circular: number, errors: string[] }}
 */
export function resolveAllBindings(elements, campaigns, options = {}) {
    const totals = { resolved: 0, broken: 0, circular: 0, errors: [] };

    if (!Array.isArray(elements)) return totals;

    // Constroi lookups para resolucao eficiente
    const elementMap = new Map();
    const observationMap = new Map();

    for (const el of elements) {
        if (el?.id) elementMap.set(el.id, el);
        // Indexa observacoes por ID (se tiverem id)
        if (Array.isArray(el?.data?.observations)) {
            for (const obs of el.data.observations) {
                if (obs?.id) observationMap.set(obs.id, obs);
            }
        }
    }

    const campaignMap = new Map();
    if (Array.isArray(campaigns)) {
        for (const c of campaigns) {
            if (c?.id) campaignMap.set(c.id, c);
        }
    }

    const constantMap = new Map();
    if (Array.isArray(options.constants)) {
        for (const c of options.constants) {
            if (c?.id) constantMap.set(c.id, c);
        }
    }

    const context = {
        getElementById: (id) => elementMap.get(id),
        getCampaignById: (id) => campaignMap.get(id),
        getObservationById: (id) => observationMap.get(id),
        getCalculatorMetric: options.getCalculatorMetric || (() => null),
        getConstantById: options.getConstantById || ((id) => constantMap.get(id) || null),
    };

    // Resolve bindings em todas as observacoes
    for (const el of elements) {
        if (!Array.isArray(el?.data?.observations)) continue;

        for (const obs of el.data.observations) {
            const stats = resolveObservation(obs, context);
            totals.resolved += stats.resolved;
            totals.broken += stats.broken;
            totals.circular += stats.circular;
        }

        // Resolve bindings em element.data.bindings (se existirem)
        if (el.data?.bindings && typeof el.data.bindings === 'object') {
            const visited = new Set();
            for (const [field, binding] of Object.entries(el.data.bindings)) {
                const result = resolveBinding(binding, context, visited, 0);
                binding.status = result.status;
                if (result.status === 'ok') {
                    binding.resolvedValue = result.value;
                    binding.resolvedAt = new Date().toISOString();
                    setPath(el.data, field, result.value);
                    totals.resolved++;
                } else if (result.status === 'circular') {
                    totals.circular++;
                } else {
                    totals.broken++;
                }
            }
        }
    }

    // Resolve bindings em campanhas (se existirem)
    if (Array.isArray(campaigns)) {
        for (const campaign of campaigns) {
            if (!campaign?.bindings || typeof campaign.bindings !== 'object') continue;
            const visited = new Set();
            for (const [field, binding] of Object.entries(campaign.bindings)) {
                const result = resolveBinding(binding, context, visited, 0);
                binding.status = result.status;
                if (result.status === 'ok') {
                    binding.resolvedValue = result.value;
                    binding.resolvedAt = new Date().toISOString();
                    setPath(campaign, field, result.value);
                    totals.resolved++;
                } else {
                    totals.broken++;
                }
            }
        }
    }

    if (totals.broken > 0 || totals.circular > 0) {
        console.warn(
            `[Bindings] Sweep: ${totals.resolved} resolved, ${totals.broken} broken, ${totals.circular} circular`,
        );
    }

    return totals;
}

// ----------------------------------------------------------------
// BINDING CRUD HELPERS
// ----------------------------------------------------------------

/**
 * Create a new binding on an object's field.
 * Cria um binding novo: valida, detecta ciclos preventivamente, atribui.
 *
 * @param {Object} obj - Object that will own the binding (observation, element.data, etc.)
 * @param {string} field - Field name to bind (e.g., 'z', 'date', 'value')
 * @param {Object} config - { targetType, targetId, targetPath, transform?, transformArgs? }
 * @param {Object} context - Resolution context for immediate resolution
 * @returns {{ success: boolean, error?: string }}
 */
export function createBinding(obj, field, config, context) {
    if (!obj || !field || !config?.targetType || !config?.targetId || !config?.targetPath) {
        return { success: false, error: 'Missing required binding config' };
    }

    if (config.targetType === 'constant') {
        const allowedConstantPaths = new Set([
            'value',
            'unitId',
            'name',
            'symbol',
            'uncertainty',
            'uncertaintyType',
            'coverageFactor',
        ]);
        if (!allowedConstantPaths.has(config.targetPath)) {
            return { success: false, error: `Invalid constant targetPath: ${config.targetPath}` };
        }

        const targetConstant = context?.getConstantById?.(config.targetId);
        if (targetConstant?.mutable === false && config.writeToTarget === true) {
            return { success: false, error: 'Target constant is immutable' };
        }
    }

    // Inicializa bindings se nao existe
    if (!obj.bindings) obj.bindings = {};

    const binding = {
        targetType: config.targetType,
        targetId: config.targetId,
        targetPath: config.targetPath,
        transform: config.transform || 'identity',
        transformArgs: config.transformArgs || {},
        resolvedValue: null,
        resolvedAt: null,
        status: 'stale',
    };

    // Resolve imediatamente para validar e popular cache
    const visited = new Set();
    const result = resolveBinding(binding, context, visited, 0);

    if (result.status === 'circular') {
        return { success: false, error: 'Binding would create a circular reference' };
    }

    if (result.status === 'ok' && !_isFieldTypeCompatible(field, result.value)) {
        return {
            success: false,
            error: `Type mismatch: field "${field}" is incompatible with binding value`,
        };
    }

    binding.status = result.status;
    if (result.status === 'ok') {
        binding.resolvedValue = result.value;
        binding.resolvedAt = new Date().toISOString();
        // Writeback imediato
        setPath(obj, field, result.value);
    }

    obj.bindings[field] = binding;
    return { success: true };
}

/**
 * Remove a binding from an object's field.
 * Remove o binding, preservando o ultimo valor resolvido no campo.
 *
 * @param {Object} obj - Object that owns the binding
 * @param {string} field - Field name to unbind
 * @returns {boolean} true if a binding was removed
 */
export function removeBinding(obj, field) {
    if (!obj?.bindings?.[field]) return false;

    delete obj.bindings[field];

    // Limpa bindings vazio
    if (Object.keys(obj.bindings).length === 0) {
        delete obj.bindings;
    }

    return true;
}

/**
 * Check if a field on an object has an active binding.
 * Verifica se o campo esta vinculado (para UI e protecao de mutacao).
 *
 * @param {Object} obj - Object to check
 * @param {string} field - Field name
 * @returns {boolean} true if field is bound with status 'ok'
 */
export function isBound(obj, field) {
    return obj?.bindings?.[field]?.status === 'ok';
}

/**
 * Get binding info for a field (for UI display).
 * Retorna informacoes do binding para exibir na UI.
 *
 * @param {Object} obj - Object to check
 * @param {string} field - Field name
 * @returns {Object|null} Binding info or null
 */
export function getBindingInfo(obj, field) {
    return obj?.bindings?.[field] || null;
}

/**
 * Mark all bindings targeting a specific entity as broken.
 * Chamado quando um elemento/campanha e deletado.
 *
 * @param {Object[]} elements - All model elements
 * @param {string} targetType - Type of deleted entity
 * @param {string} targetId - ID of deleted entity
 * @returns {number} Number of bindings marked as broken
 */
export function markBindingsBroken(elements, targetType, targetId) {
    let count = 0;

    for (const el of elements) {
        // Check observation bindings
        if (Array.isArray(el?.data?.observations)) {
            for (const obs of el.data.observations) {
                if (!obs?.bindings) continue;
                for (const binding of Object.values(obs.bindings)) {
                    if (binding.targetType === targetType && binding.targetId === targetId) {
                        binding.status = 'broken';
                        count++;
                    }
                }
            }
        }
        // Check element-level bindings
        if (el?.data?.bindings) {
            for (const binding of Object.values(el.data.bindings)) {
                if (binding.targetType === targetType && binding.targetId === targetId) {
                    binding.status = 'broken';
                    count++;
                }
            }
        }
    }

    return count;
}
