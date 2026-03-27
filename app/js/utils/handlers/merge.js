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
   MERGE HANDLERS — User actions for diff/merge workflow
   Acoes do usuario para fluxo de diff/merge

   FUNCIONALIDADES:
   - Abrir modal de merge
   - Carregar modelos A e B (chave ECO ou estado atual)
   - Executar diff
   - Aceitar/rejeitar conflitos
   - Aplicar merge final
   - Exportar delta log
   ================================================================ */

import { diffModels, mergeModels, buildDelta } from '../../core/diff/engine.js';
import { deepClone } from '../../core/diff/helpers.js';
import { renderConflictList, updateMergeSummary, updateCardState, injectMergeStyles } from '../ui/mergePanel.js';
import { buildModel } from '../../core/io/export.js';
import { applyModel } from '../../core/io/import.js';
import { parseInputAsync, detectKeyVersion, decodeKeyV3 } from '../../core/io/decoder.js';
import { showToast } from '../ui/toast.js';
import { openModal, closeModal } from '../ui/modals.js';
import { t } from '../i18n/translations.js';
import { getIcon } from '../ui/icons.js';
import { escapeHtml } from '../helpers/html.js';
import { getUserRole } from '../auth/permissions.js';
import { getUserEmail } from '../auth/session.js';
import { requireOwnershipPermission } from '../../core/ownership/index.js';

// ----------------------------------------------------------------
// MODULE STATE
// ----------------------------------------------------------------

/** @type {Object|null} */
let modelA = null;
/** @type {Object|null} */
let modelB = null;
/** @type {Object|null} */
let currentDiff = null;
/** @type {Object} */
let decisions = {};
/** @type {Function|null} */
let updateAllUIRef = null;
/** @type {boolean} Indica se o merge foi aberto pelo wizard de ingestao */
let _mergeFromWizard = false;

function _appendMergeAudit(entry) {
    if (!window._mergeSecurityAudit) window._mergeSecurityAudit = [];
    window._mergeSecurityAudit.push({ ts: new Date().toISOString(), ...entry });
}

function _getStrictMergeMode() {
    const role = getUserRole();
    const actor = getUserEmail() || 'anonymous';
    const override = window.__ecbyts_mergeStrictOverride;
    if (override === false && role !== 'owner' && role !== 'admin') {
        _appendMergeAudit({
            actor,
            role,
            strict: true,
            deniedOverride: true,
            reason: 'strict_override_denied',
        });
        showToast(t('auth.actionDenied') || "You don't have permission to perform this action.", 'error');
        return true;
    }
    return override !== false;
}

async function _parseMergeInput(inputRaw) {
    const input = String(inputRaw || '').trim();
    if (!input) throw new Error('Empty input');

    const version = input.startsWith('ECO') ? detectKeyVersion(input) : null;
    const strict = _getStrictMergeMode();
    const role = getUserRole();
    const actor = getUserEmail() || 'anonymous';

    if (version === 3) {
        if (strict) {
            const model = await decodeKeyV3(input, { verifySignature: true, verifyMerkle: true });
            if (!model?._verification?.verified) {
                _appendMergeAudit({
                    actor,
                    role,
                    strict: true,
                    version,
                    status: model?._verification?.status || 'invalid',
                    blocked: true,
                });
                throw new Error('Blockchain verification failed for ECO3 key (strict mode).');
            }
            _appendMergeAudit({ actor, role, strict: true, version, status: 'verified', blocked: false });
            return model;
        }

        _appendMergeAudit({
            actor,
            role,
            strict: false,
            version,
            status: 'bypassed',
            blocked: false,
        });
    }

    return parseInputAsync(input);
}

// ----------------------------------------------------------------
// INIT
// ----------------------------------------------------------------

/**
 * Inject updateAllUI reference.
 * @param {Function} fn
 */
export function setMergeUpdateAllUI(fn) {
    updateAllUIRef = fn;
}

// ----------------------------------------------------------------
// HANDLERS
// ----------------------------------------------------------------

/**
 * Open the merge modal.
 * Abre o modal de diff/merge.
 */
function handleOpenMergeModal() {
    injectMergeStyles();
    modelA = null;
    modelB = null;
    currentDiff = null;
    decisions = {};
    _mergeFromWizard = false;
    // Cleanup de state de sessoes anteriores
    delete window._postMergeActions;
    delete window._lastVirtualModel;
    delete window._lastCurrentModel;

    // Reset UI
    const inputA = document.getElementById('merge-input-a');
    const inputB = document.getElementById('merge-input-b');
    const conflictList = document.getElementById('merge-conflict-list');
    const applyBtn = document.getElementById('merge-apply-btn');
    const statusA = document.getElementById('merge-status-a');
    const statusB = document.getElementById('merge-status-b');

    if (inputA) inputA.value = '';
    if (inputB) inputB.value = '';
    if (conflictList) conflictList.innerHTML = '';
    if (applyBtn) applyBtn.disabled = true;
    if (statusA) statusA.textContent = '';
    if (statusB) statusB.textContent = '';

    openModal('merge-modal');
}

/**
 * Load current browser state as Model A.
 * Carrega estado atual do navegador como Modelo A.
 */
function handleLoadCurrentAsA() {
    try {
        modelA = buildModel();
        const statusA = document.getElementById('merge-status-a');
        if (statusA) {
            statusA.innerHTML = `${getIcon('check', { size: '12px' })} ${t('currentModel') || 'Current model'} (${modelA.elements?.length || 0} elements)`;
            statusA.className = 'merge-status merge-status-ok';
        }
        const inputA = document.getElementById('merge-input-a');
        if (inputA) inputA.value = '[Current Model State]';
        inputA?.setAttribute('readonly', true);
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    }
}

/**
 * Parse and load Model A from textarea.
 * Decodifica e carrega Modelo A a partir do textarea.
 */
async function handleLoadModelA() {
    const inputA = document.getElementById('merge-input-a');
    if (!inputA?.value?.trim()) {
        showToast(t('emptyInput') || 'Please paste a key or JSON', 'warning');
        return;
    }

    try {
        modelA = await _parseMergeInput(inputA.value.trim());
        const statusA = document.getElementById('merge-status-a');
        if (statusA) {
            statusA.innerHTML = `${getIcon('check', { size: '12px' })} ${t('modelLoaded') || 'Model loaded'} (${modelA.elements?.length || 0} elements)`;
            statusA.className = 'merge-status merge-status-ok';
        }
    } catch (error) {
        const statusA = document.getElementById('merge-status-a');
        if (statusA) {
            statusA.innerHTML = `${getIcon('x', { size: '12px' })} ${escapeHtml(error.message)}`;
            statusA.className = 'merge-status merge-status-error';
        }
    }
}

/**
 * Parse and load Model B from textarea.
 * Decodifica e carrega Modelo B a partir do textarea.
 */
async function handleLoadModelB() {
    const inputB = document.getElementById('merge-input-b');
    if (!inputB?.value?.trim()) {
        showToast(t('emptyInput') || 'Please paste a key or JSON', 'warning');
        return;
    }

    try {
        modelB = await _parseMergeInput(inputB.value.trim());
        const statusB = document.getElementById('merge-status-b');
        if (statusB) {
            statusB.innerHTML = `${getIcon('check', { size: '12px' })} ${t('modelLoaded') || 'Model loaded'} (${modelB.elements?.length || 0} elements)`;
            statusB.className = 'merge-status merge-status-ok';
        }
    } catch (error) {
        const statusB = document.getElementById('merge-status-b');
        if (statusB) {
            statusB.innerHTML = `${getIcon('x', { size: '12px' })} ${escapeHtml(error.message)}`;
            statusB.className = 'merge-status merge-status-error';
        }
    }
}

/**
 * Execute diff between loaded models.
 * Executa diferenciacao entre modelos carregados.
 */
function handleRunDiff() {
    if (!modelA || !modelB) {
        showToast(t('loadBothModels') || 'Load both models before comparing', 'warning');
        return;
    }

    try {
        decisions = {};
        currentDiff = diffModels(modelA, modelB);
        renderConflictList(currentDiff, decisions, handleDecisionChange);

        if (currentDiff.stats.total === 0) {
            showToast(t('noConflicts') || 'Models are identical', 'info');
        } else {
            showToast(`${currentDiff.stats.total} ${t('differencesFound') || 'differences found'}`, 'info');
        }

        const applyBtn = document.getElementById('merge-apply-btn');
        if (applyBtn) applyBtn.disabled = false;
    } catch (error) {
        showToast(`Diff error: ${error.message}`, 'error');
        console.error('[Merge] Diff error:', error);
    }
}

/**
 * Accept Input A's value for a specific conflict.
 * Aceita valor do Input A para um conflito especifico.
 *
 * @param {string} key - Conflict key path
 */
function handleMergeAcceptA(key) {
    decisions[key] = 'A';
    updateCardState(key, 'A');
    if (currentDiff) updateMergeSummary(currentDiff, decisions);
}

/**
 * Accept Input B's value for a specific conflict.
 * Aceita valor do Input B para um conflito especifico.
 *
 * @param {string} key - Conflict key path
 */
function handleMergeAcceptB(key) {
    decisions[key] = 'B';
    updateCardState(key, 'B');
    if (currentDiff) updateMergeSummary(currentDiff, decisions);
}

/**
 * Accept all conflicts as A.
 * Aceita todos os conflitos como A.
 */
function handleAcceptAllA() {
    if (!currentDiff) return;
    fillAllDecisions('A');
    renderConflictList(currentDiff, decisions, handleDecisionChange);
    showToast(t('allAcceptedA') || 'All conflicts resolved as Input A', 'success');
}

/**
 * Accept all conflicts as B.
 * Aceita todos os conflitos como B.
 */
function handleAcceptAllB() {
    if (!currentDiff) return;
    fillAllDecisions('B');
    renderConflictList(currentDiff, decisions, handleDecisionChange);
    showToast(t('allAcceptedB') || 'All conflicts resolved as Input B', 'success');
}

/**
 * Apply the merged model to the current state.
 * Aplica o modelo mesclado ao estado atual.
 */
function handleApplyMerge() {
    if (!modelA || !modelB || !currentDiff) {
        showToast(t('runDiffFirst') || 'Run diff first', 'warning');
        return;
    }

    const ownership = requireOwnershipPermission('merge');
    if (!ownership.ok) {
        _appendMergeAudit({
            actor: ownership.actor || 'anonymous',
            role: ownership.role,
            strict: window.__ecbyts_mergeStrictOverride !== false,
            blocked: true,
            reason: 'ownership_denied',
        });
        showToast(t('auth.actionDenied') || ownership.error, 'error');
        return;
    }

    try {
        const { merged, delta } = mergeModels(modelA, modelB, decisions, currentDiff);
        applyModel(merged);

        if (updateAllUIRef) updateAllUIRef();

        closeModal('merge-modal');
        showToast(t('mergeComplete') || 'Merge applied successfully', 'success');

        // Store delta for potential export
        window._lastMergeDelta = buildDelta(delta);

        // D18/D19: executar acoes pos-merge (terreno, aerial) se wizard solicitou
        const postActions = window._postMergeActions;
        if (postActions?.generateTerrain) {
            showToast(t('generatingTerrain') || 'Generating terrain surface...', 'info');
            import('../../core/interpolation/manager.js')
                .then((mod) => {
                    const terrainOpts = postActions.generateAerial === false ? { textureMode: 'colorRamp' } : {};
                    mod.createTerrainLayer(terrainOpts)
                        .then(() => {
                            mod.applyTerrainElevationToElements?.();
                            window.fitAllElements?.();
                            showToast(t('terrainReady') || 'Terrain surface ready', 'success');
                        })
                        .catch((err) => {
                            console.warn('[ecbyts] Terrain generation failed:', err.message);
                            showToast('Terrain generation failed: ' + err.message, 'warning');
                        });
                })
                .catch((err) => {
                    console.warn('[ecbyts] Terrain module load failed:', err.message);
                    showToast(t('terrainModuleError') || 'Terrain module unavailable', 'warning');
                });
        }
        delete window._postMergeActions;
        delete window._lastVirtualModel;
        delete window._lastCurrentModel;
    } catch (error) {
        showToast(`Merge error: ${error.message}`, 'error');
        console.error('[Merge] Apply error:', error);
    }
}

/**
 * Export the last merge delta log as JSON file.
 * Exporta log de transformacoes do ultimo merge.
 */
function handleExportDelta() {
    const delta = window._lastMergeDelta;
    if (!delta) {
        showToast(t('noDelta') || 'No merge delta available', 'warning');
        return;
    }

    const json = JSON.stringify(delta, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `merge-delta-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);

    showToast(t('deltaExported') || 'Delta log exported', 'success');
}

// ----------------------------------------------------------------
// INTERNAL HELPERS
// ----------------------------------------------------------------

function handleDecisionChange(key, decision) {
    decisions[key] = decision;
    if (currentDiff) updateMergeSummary(currentDiff, decisions);
}

/**
 * Fill all conflict decisions with a single choice.
 */
function fillAllDecisions(choice) {
    if (!currentDiff) return;

    for (const [, section] of Object.entries(currentDiff.sections)) {
        if (section.changes) {
            for (const change of section.changes) {
                decisions[change.path.join('.')] = choice;
            }
        }
        if (section.added) {
            for (const item of section.added) {
                const sectionName = findSectionName(currentDiff, section);
                decisions[`${sectionName}.${item.id}._add`] = choice;
            }
        }
        if (section.removed) {
            for (const item of section.removed) {
                const sectionName = findSectionName(currentDiff, section);
                decisions[`${sectionName}.${item.id}._remove`] = choice;
            }
        }
        if (section.modified) {
            for (const mod of section.modified) {
                for (const change of mod.changes || []) {
                    decisions[change.path.join('.')] = choice;
                }
            }
        }
    }
}

function findSectionName(diff, section) {
    for (const [name, sec] of Object.entries(diff.sections)) {
        if (sec === section) return name;
    }
    return 'unknown';
}

// ----------------------------------------------------------------
// PROGRAMMATIC PRELOAD — Usado pelo wizard de ingestao para
// alimentar o merge com modelo atual vs modelo importado.
// ----------------------------------------------------------------

/**
 * Pre-carrega dois modelos no estado do merge e executa diff automaticamente.
 * Deve ser chamado APOS handleOpenMergeModal() (que reseta o estado).
 *
 * @param {Object} a - Modelo A (estado atual)
 * @param {Object} b - Modelo B (dados importados)
 */
function preloadMergeModels(a, b) {
    if (!a || !b) {
        showToast(t('mergeLoadBothModels') || 'Cannot open merge: model data missing', 'error');
        return;
    }
    _mergeFromWizard = true;

    modelA = a;
    modelB = b;

    // Atualiza UI de status
    const statusA = document.getElementById('merge-status-a');
    if (statusA) {
        statusA.innerHTML = `${getIcon('check', { size: '12px' })} ${t('currentModel') || 'Current model'} (${a.elements?.length || 0} elements)`;
        statusA.className = 'merge-status merge-status-ok';
    }

    const statusB = document.getElementById('merge-status-b');
    if (statusB) {
        statusB.innerHTML = `${getIcon('check', { size: '12px' })} ${t('importedData') || 'Imported data'} (${b.elements?.length || 0} elements, ${b.campaigns?.length || 0} campaigns)`;
        statusB.className = 'merge-status merge-status-ok';
    }

    // Desabilita textareas (modelos carregados programaticamente)
    const inputA = document.getElementById('merge-input-a');
    const inputB = document.getElementById('merge-input-b');
    if (inputA) {
        inputA.value = '[Current Model]';
        inputA.setAttribute('readonly', 'true');
    }
    if (inputB) {
        inputB.value = '[Imported Data]';
        inputB.setAttribute('readonly', 'true');
    }

    // Labels contextuais no footer (wizard: Keep/Accept em vez de A/B)
    const btnAllA = document.querySelector('[onclick*="handleAcceptAllA"]');
    const btnAllB = document.querySelector('[onclick*="handleAcceptAllB"]');
    if (btnAllA) btnAllA.textContent = t('keepAllCurrent') || 'Keep All Current';
    if (btnAllB) btnAllB.textContent = t('acceptAllImported') || 'Accept All Imported';

    // Auto-trigger diff after modal is painted (avoid layout reads on transitioning modal)
    requestAnimationFrame(() => handleRunDiff());
}

/**
 * Retorna se o merge foi aberto pelo wizard de ingestao.
 * Usado pelo mergePanel para labels contextuais.
 */
export function isMergeFromWizard() {
    return _mergeFromWizard;
}

// ----------------------------------------------------------------
// EXPORTS
// ----------------------------------------------------------------

export const mergeHandlers = {
    handleOpenMergeModal,
    handleLoadCurrentAsA,
    handleLoadModelA,
    handleLoadModelB,
    handleRunDiff,
    handleMergeAcceptA,
    handleMergeAcceptB,
    handleAcceptAllA,
    handleAcceptAllB,
    handleApplyMerge,
    handleExportDelta,
    preloadMergeModels,
};
