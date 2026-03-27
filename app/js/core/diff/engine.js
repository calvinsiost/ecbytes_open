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
   DIFF ENGINE — Structural comparison and merge of project models
   Motor de diferenciacao estrutural e merge de modelos

   FUNCIONALIDADES:
   - diffModels: Compara dois modelos completos
   - mergeModels: Aplica decisoes de resolucao para gerar modelo mesclado
   - buildDelta: Gera log de transformacoes (registro de decisoes)

   ALGORITMO:
   - Campos escalares: comparacao direta
   - Colecoes com ID: matching por ID, nao por posicao
   - Objetos aninhados: recursao (observations, stamps)
   - Dependencias: detecta edges orfaos quando elementos sao removidos
   ================================================================ */

import { deepEqual, deepClone, buildIdMap, diffFlatObjects, describePath } from './helpers.js';

// ----------------------------------------------------------------
// DIFF MODELS
// ----------------------------------------------------------------

/**
 * Compare two project models and produce a structured diff.
 * Compara dois modelos de projeto e retorna diff estruturado.
 *
 * @param {Object} modelA - First model (e.g., current state)
 * @param {Object} modelB - Second model (e.g., imported key)
 * @returns {Object} - Structured diff with sections, dependencies, stats
 */
export function diffModels(modelA, modelB) {
    const diff = {
        metadata: {
            timestampA: modelA?.timestamp || null,
            timestampB: modelB?.timestamp || null,
            versionA: modelA?.ecbyts || null,
            versionB: modelB?.ecbyts || null,
            modelIdA: modelA?.modelId || null,
            modelIdB: modelB?.modelId || null,
        },
        sections: {},
        dependencies: [],
        stats: { total: 0, additions: 0, removals: 0, conflicts: 0 },
    };

    // 1. Diff scalar sections
    diff.sections.project = diffScalarSection(modelA?.project || {}, modelB?.project || {}, 'project');
    diff.sections.coordinate = diffScalarSection(modelA?.coordinate || {}, modelB?.coordinate || {}, 'coordinate');

    // 2. Diff ID-indexed collections
    diff.sections.elements = diffCollection(modelA?.elements || [], modelB?.elements || [], 'elements');
    diff.sections.edges = diffCollection(modelA?.edges || [], modelB?.edges || [], 'edges');
    diff.sections.campaigns = diffCollection(modelA?.campaigns || [], modelB?.campaigns || [], 'campaigns');
    diff.sections.scenes = diffCollection(modelA?.scenes || [], modelB?.scenes || [], 'scenes');

    // 3. Diff families (object keyed by family ID)
    diff.sections.families = diffFamilies(modelA?.families || {}, modelB?.families || {});

    // 4. Diff governance data if present
    if (modelA?.contracts || modelB?.contracts) {
        diff.sections.contracts = diffCollection(modelA?.contracts || [], modelB?.contracts || [], 'contracts');
    }
    if (modelA?.wbs || modelB?.wbs) {
        diff.sections.wbs = diffCollection(modelA?.wbs || [], modelB?.wbs || [], 'wbs');
    }

    // 5. Detect second-order dependencies
    diff.dependencies = detectDependencies(modelA, modelB, diff);

    // 6. Calculate stats
    computeStats(diff);

    return diff;
}

/**
 * Diff a scalar (flat object) section.
 * Compara secao de campos escalares.
 *
 * @param {Object} a - Section from model A
 * @param {Object} b - Section from model B
 * @param {string} sectionName - Name for path context
 * @returns {Object} - { changes: [...] }
 */
function diffScalarSection(a, b, sectionName) {
    // Filter out arrays (like project.areas) — handle separately
    const flatA = {};
    const flatB = {};
    const arrayChanges = [];

    for (const [key, val] of Object.entries(a)) {
        if (Array.isArray(val)) {
            // Compare arrays by deep equality
            if (!deepEqual(val, b[key])) {
                arrayChanges.push({
                    path: [sectionName, key],
                    type: 'modified',
                    valueA: val,
                    valueB: b[key] ?? undefined,
                });
            }
        } else {
            flatA[key] = val;
        }
    }
    for (const [key, val] of Object.entries(b)) {
        if (Array.isArray(val)) {
            if (!Object.prototype.hasOwnProperty.call(a, key)) {
                arrayChanges.push({
                    path: [sectionName, key],
                    type: 'added',
                    valueA: undefined,
                    valueB: val,
                });
            }
        } else {
            flatB[key] = val;
        }
    }

    const changes = diffFlatObjects(flatA, flatB, [sectionName]);
    return { changes: [...changes, ...arrayChanges] };
}

/**
 * Diff an ID-indexed collection (elements, edges, campaigns, scenes).
 * Compara colecao indexada por ID — match por ID, nao por posicao.
 *
 * @param {Array} arrayA - Collection from model A
 * @param {Array} arrayB - Collection from model B
 * @param {string} sectionName - Section name
 * @returns {Object} - { added: [], removed: [], modified: [] }
 */
function diffCollection(arrayA, arrayB, sectionName) {
    const mapA = buildIdMap(arrayA);
    const mapB = buildIdMap(arrayB);

    const added = [];
    const removed = [];
    const modified = [];

    // Items only in A (removed in B)
    for (const [id, itemA] of mapA) {
        if (!mapB.has(id)) {
            removed.push({ id, item: itemA });
        }
    }

    // Items only in B (added in B)
    for (const [id, itemB] of mapB) {
        if (!mapA.has(id)) {
            added.push({ id, item: itemB });
        }
    }

    // Items in both — check for modifications
    for (const [id, itemA] of mapA) {
        if (mapB.has(id)) {
            const itemB = mapB.get(id);
            if (!deepEqual(itemA, itemB)) {
                const changes = diffFlatObjects(itemA, itemB, [sectionName, id]);
                modified.push({ id, name: itemA.name || itemA.id, changes });
            }
        }
    }

    return { added, removed, modified };
}

/**
 * Diff families object (keyed by family ID).
 * Compara familias de elementos.
 *
 * @param {Object} famA - Families from model A
 * @param {Object} famB - Families from model B
 * @returns {Object} - { added: [], removed: [], modified: [] }
 */
function diffFamilies(famA, famB) {
    const added = [];
    const removed = [];
    const modified = [];

    const allKeys = new Set([...Object.keys(famA), ...Object.keys(famB)]);

    for (const key of allKeys) {
        const inA = Object.prototype.hasOwnProperty.call(famA, key);
        const inB = Object.prototype.hasOwnProperty.call(famB, key);

        if (inA && !inB) {
            removed.push({ id: key, item: famA[key] });
        } else if (!inA && inB) {
            added.push({ id: key, item: famB[key] });
        } else if (inA && inB && !deepEqual(famA[key], famB[key])) {
            const changes = diffFlatObjects(famA[key], famB[key], ['families', key]);
            modified.push({ id: key, changes });
        }
    }

    return { added, removed, modified };
}

// ----------------------------------------------------------------
// DEPENDENCY DETECTION
// ----------------------------------------------------------------

/**
 * Detect second-order dependencies that could cause orphan states.
 * Detecta dependencias de segunda ordem — edges orfaos, observacoes sem campanha.
 *
 * @param {Object} modelA - First model
 * @param {Object} modelB - Second model
 * @param {Object} diff - Current diff result
 * @returns {Array<Object>} - Dependency warnings
 */
function detectDependencies(modelA, modelB, diff) {
    const warnings = [];

    // Collect all element IDs that would be removed
    const removedElementIds = new Set();
    if (diff.sections.elements?.removed) {
        for (const item of diff.sections.elements.removed) {
            removedElementIds.add(item.id);
        }
    }

    // Check edges that reference removed elements
    const allEdges = [...(modelA?.edges || []), ...(modelB?.edges || [])];
    for (const edge of allEdges) {
        if (removedElementIds.has(edge.sourceId)) {
            warnings.push({
                type: 'orphan_edge',
                severity: 'warning',
                edgeId: edge.id,
                edgeType: edge.type,
                missingElementId: edge.sourceId,
                role: 'source',
                message: `Edge "${edge.id}" (${edge.type}) references removed element "${edge.sourceId}" as source`,
            });
        }
        if (removedElementIds.has(edge.targetId)) {
            warnings.push({
                type: 'orphan_edge',
                severity: 'warning',
                edgeId: edge.id,
                edgeType: edge.type,
                missingElementId: edge.targetId,
                role: 'target',
                message: `Edge "${edge.id}" (${edge.type}) references removed element "${edge.targetId}" as target`,
            });
        }
    }

    // Check campaigns referenced by observations in removed elements
    const removedCampaignIds = new Set();
    if (diff.sections.campaigns?.removed) {
        for (const item of diff.sections.campaigns.removed) {
            removedCampaignIds.add(item.id);
        }
    }

    if (removedCampaignIds.size > 0) {
        const allElements = [...(modelA?.elements || []), ...(modelB?.elements || [])];
        for (const el of allElements) {
            const obs = el?.data?.observations || [];
            for (const ob of obs) {
                if (ob.campaignId && removedCampaignIds.has(ob.campaignId)) {
                    warnings.push({
                        type: 'orphan_observation',
                        severity: 'warning',
                        elementId: el.id,
                        observationIndex: obs.indexOf(ob),
                        missingCampaignId: ob.campaignId,
                        message: `Observation in "${el.id}" references removed campaign "${ob.campaignId}"`,
                    });
                }
            }
        }
    }

    return warnings;
}

// ----------------------------------------------------------------
// STATS
// ----------------------------------------------------------------

/**
 * Compute summary statistics for the diff.
 * Calcula estatisticas do diff.
 *
 * @param {Object} diff - Diff object (mutated in place)
 */
function computeStats(diff) {
    let total = 0;
    let additions = 0;
    let removals = 0;
    let conflicts = 0;

    for (const [, section] of Object.entries(diff.sections)) {
        if (section.changes) {
            // Scalar section
            total += section.changes.length;
            conflicts += section.changes.length;
        }
        if (section.added) {
            total += section.added.length;
            additions += section.added.length;
        }
        if (section.removed) {
            total += section.removed.length;
            removals += section.removed.length;
        }
        if (section.modified) {
            for (const mod of section.modified) {
                const count = mod.changes ? mod.changes.length : 1;
                total += count;
                conflicts += count;
            }
        }
    }

    diff.stats = { total, additions, removals, conflicts };
}

// ----------------------------------------------------------------
// MERGE MODELS
// ----------------------------------------------------------------

/**
 * Merge two models using user decisions.
 * Mescla dois modelos aplicando decisoes do usuario.
 *
 * @param {Object} modelA - First model
 * @param {Object} modelB - Second model
 * @param {Object} decisions - Map of path → 'A' | 'B' | custom value
 *   Format: { 'section.id.field': 'A' | 'B' | { custom: value } }
 * @param {Object} diff - The diff result from diffModels()
 * @returns {Object} - { merged: Object, delta: Array }
 */
export function mergeModels(modelA, modelB, decisions, diff) {
    const merged = deepClone(modelA);
    const delta = [];

    // 1. Merge scalar sections
    for (const sectionName of ['project', 'coordinate']) {
        const section = diff.sections[sectionName];
        if (!section?.changes) continue;

        for (const change of section.changes) {
            const key = change.path.join('.');
            const decision = decisions[key] || 'A'; // Default: keep A

            if (decision === 'B') {
                setNestedValue(merged, change.path, deepClone(change.valueB));
                delta.push({ path: key, action: 'accept_B', from: change.valueA, to: change.valueB });
            } else if (decision === 'A') {
                delta.push({ path: key, action: 'keep_A', value: change.valueA });
            } else if (typeof decision === 'object' && decision.custom !== undefined) {
                setNestedValue(merged, change.path, deepClone(decision.custom));
                delta.push({ path: key, action: 'custom', from: change.valueA, to: decision.custom });
            }
        }
    }

    // 2. Merge collections
    for (const sectionName of ['elements', 'edges', 'campaigns', 'scenes', 'contracts', 'wbs']) {
        const section = diff.sections[sectionName];
        if (!section) continue;

        mergeCollection(merged, sectionName, section, decisions, delta, modelB);
    }

    // 3. Merge families
    if (diff.sections.families) {
        mergeFamilies(merged, diff.sections.families, decisions, delta, modelB);
    }

    // 4. Update metadata
    merged.timestamp = new Date().toISOString();

    return { merged, delta };
}

/**
 * Merge an ID-indexed collection section.
 * Mescla uma secao de colecao indexada por ID.
 */
function mergeCollection(merged, sectionName, section, decisions, delta, modelB) {
    if (!merged[sectionName]) merged[sectionName] = [];

    // Handle additions (items only in B)
    for (const item of section.added || []) {
        const key = `${sectionName}.${item.id}._add`;
        const decision = decisions[key] ?? 'B'; // Default: accept additions

        if (decision === 'B') {
            merged[sectionName].push(deepClone(item.item));
            delta.push({ path: key, action: 'add_from_B', id: item.id });
        } else {
            delta.push({ path: key, action: 'reject_addition', id: item.id });
        }
    }

    // Handle removals (items only in A)
    for (const item of section.removed || []) {
        const key = `${sectionName}.${item.id}._remove`;
        const decision = decisions[key] ?? 'A'; // Default: keep A (don't remove)

        if (decision === 'B') {
            // Accept removal: remove from merged
            const idx = merged[sectionName].findIndex((el) => el.id === item.id);
            if (idx !== -1) merged[sectionName].splice(idx, 1);
            delta.push({ path: key, action: 'remove_accepted', id: item.id });
        } else {
            delta.push({ path: key, action: 'keep_not_removed', id: item.id });
        }
    }

    // Handle modifications
    for (const mod of section.modified || []) {
        const mergedItem = merged[sectionName].find((el) => el.id === mod.id);
        if (!mergedItem) continue;

        for (const change of mod.changes || []) {
            const key = change.path.join('.');
            const decision = decisions[key] || 'A';

            if (decision === 'B') {
                setNestedValue(mergedItem, change.path.slice(2), deepClone(change.valueB));
                delta.push({ path: key, action: 'accept_B', from: change.valueA, to: change.valueB });
            } else if (typeof decision === 'object' && decision.custom !== undefined) {
                setNestedValue(mergedItem, change.path.slice(2), deepClone(decision.custom));
                delta.push({ path: key, action: 'custom', from: change.valueA, to: decision.custom });
            } else {
                delta.push({ path: key, action: 'keep_A', value: change.valueA });
            }
        }
    }
}

/**
 * Merge families section.
 * Mescla familias de elementos.
 */
function mergeFamilies(merged, section, decisions, delta, modelB) {
    if (!merged.families) merged.families = {};

    for (const item of section.added || []) {
        const key = `families.${item.id}._add`;
        const decision = decisions[key] ?? 'B';
        if (decision === 'B') {
            merged.families[item.id] = deepClone(item.item);
            delta.push({ path: key, action: 'add_from_B', id: item.id });
        }
    }

    for (const item of section.removed || []) {
        const key = `families.${item.id}._remove`;
        const decision = decisions[key] ?? 'A';
        if (decision === 'B') {
            delete merged.families[item.id];
            delta.push({ path: key, action: 'remove_accepted', id: item.id });
        }
    }

    for (const mod of section.modified || []) {
        for (const change of mod.changes || []) {
            const key = change.path.join('.');
            const decision = decisions[key] || 'A';
            if (decision === 'B') {
                setNestedValue(merged.families, change.path.slice(1), deepClone(change.valueB));
                delta.push({ path: key, action: 'accept_B', from: change.valueA, to: change.valueB });
            }
        }
    }
}

// ----------------------------------------------------------------
// BUILD DELTA LOG
// ----------------------------------------------------------------

/**
 * Build a human-readable delta log from merge decisions.
 * Gera log de transformacoes legivel a partir das decisoes.
 *
 * @param {Array} delta - Raw delta entries from mergeModels
 * @returns {Object} - Formatted delta with summary and entries
 */
export function buildDelta(delta) {
    const summary = {
        total: delta.length,
        accepted_A: delta.filter((d) => d.action === 'keep_A' || d.action === 'keep_not_removed').length,
        accepted_B: delta.filter(
            (d) => d.action === 'accept_B' || d.action === 'add_from_B' || d.action === 'remove_accepted',
        ).length,
        custom: delta.filter((d) => d.action === 'custom').length,
        rejected: delta.filter((d) => d.action === 'reject_addition').length,
    };

    const entries = delta.map((d) => ({
        ...d,
        description: describePath(d.path.split('.')),
    }));

    return {
        timestamp: new Date().toISOString(),
        summary,
        entries,
    };
}

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

/**
 * Set a nested value on an object by path array.
 * Define valor em caminho aninhado.
 *
 * @param {Object} obj - Target object
 * @param {string[]} path - Path segments
 * @param {*} value - Value to set
 */
function setNestedValue(obj, path, value) {
    if (!path || path.length === 0) return;

    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (current[key] == null || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key];
    }
    current[path[path.length - 1]] = value;
}
