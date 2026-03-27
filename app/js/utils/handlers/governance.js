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
   GOVERNANCE HANDLERS — User actions for contracts, WBS, EVA
   Acoes do usuario para contratos, EAP e Valor Agregado

   FUNCIONALIDADES:
   - CRUD de contratos e itens WBS
   - Aplicacao de templates WBS
   - Calculo e exibicao de EVA
   - Vinculacao de elementos a contratos
   ================================================================ */

import {
    addContract,
    updateContract,
    removeContract,
    getContracts,
    getContract,
    addParty,
    removeParty,
    addDisbursement,
    removeDisbursement,
    updateDisbursement,
    linkLibraryToDisbursement,
    unlinkLibraryFromDisbursement,
    syncLibraryEvidence,
    getContractFinancialSummary,
    evaluateKPIs,
    linkElement,
    unlinkElement,
    fileInsuranceClaim,
} from '../governance/contractManager.js';

import { getInstalledLibraries, isLibraryActive } from '../libraries/manager.js';

import {
    addWbsItem,
    updateWbsItem,
    removeWbsItem,
    getWbsItems,
    getWbsTree,
    calculateEVA,
    calculateProjectEVA,
    detectDeviations,
    getWbsTemplates,
    applyTemplate,
    saveSnapshot,
} from '../governance/wbsManager.js';

import { renderGovernanceTab, renderContractForm, renderWbsDataModal } from '../ui/governancePanel.js';
import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';
import { openModal, closeModal } from '../ui/modals.js';

// ----------------------------------------------------------------
// MODULE STATE
// ----------------------------------------------------------------

let updateAllUIRef = null;
let editingContractId = null;

/**
 * Inject updateAllUI reference.
 * @param {Function} fn
 */
export function setGovernanceUpdateAllUI(fn) {
    updateAllUIRef = fn;
}

// ----------------------------------------------------------------
// CONTRACT HANDLERS
// ----------------------------------------------------------------

function handleAddContract() {
    const contract = addContract({
        name: t('newContract') || 'New Contract',
        type: 'custom',
        status: 'draft',
    });

    if (updateAllUIRef) updateAllUIRef();
    showToast(`${t('contractAdded') || 'Contract added'}: ${contract.name}`, 'success');
}

function handleEditContract(id) {
    editingContractId = id;
    renderContractForm(id);
    openModal('contract-modal');
}

function handleRemoveContract(id) {
    const contract = getContract(id);
    if (!contract) return;

    removeContract(id);
    if (updateAllUIRef) updateAllUIRef();
    showToast(`${t('contractRemoved') || 'Contract removed'}`, 'info');
}

function handleSaveContract() {
    if (!editingContractId) return;

    const name = document.getElementById('contract-name')?.value || '';
    const type = document.getElementById('contract-type')?.value || 'custom';
    const status = document.getElementById('contract-status')?.value || 'draft';
    const totalValue = parseFloat(document.getElementById('contract-total-value')?.value) || 0;
    const currency = document.getElementById('contract-currency')?.value || 'BRL';
    const effectiveDate = document.getElementById('contract-effective-date')?.value || '';
    const expirationDate = document.getElementById('contract-expiration-date')?.value || '';
    const notes = document.getElementById('contract-notes')?.value || '';

    updateContract(editingContractId, {
        name,
        type,
        status,
        notes,
        financial: { totalValue, currency },
        dates: { effectiveDate, expirationDate },
    });

    closeModal('contract-modal');
    if (updateAllUIRef) updateAllUIRef();
    showToast(t('contractSaved') || 'Contract saved', 'success');
}

function handleAddContractParty(contractId) {
    addParty(contractId, {
        role: 'contractor',
        name: '',
        registry: '',
    });
    if (editingContractId === contractId) {
        renderContractForm(contractId);
    }
}

function handleRemoveContractParty(contractId, index) {
    removeParty(contractId, index);
    if (editingContractId === contractId) {
        renderContractForm(contractId);
    }
}

function handleUpdateContractParty(contractId, index, field, value) {
    const contract = getContract(contractId);
    if (!contract || !contract.parties[index]) return;
    contract.parties[index][field] = value;
}

function handleAddDisbursement(contractId) {
    addDisbursement(contractId, {
        date: new Date().toISOString().split('T')[0],
        amount: 0,
        description: '',
        status: 'scheduled',
    });
    if (editingContractId === contractId) {
        renderContractForm(contractId);
    }
}

function handleRemoveDisbursement(contractId, disbursementId) {
    removeDisbursement(contractId, disbursementId);
    if (editingContractId === contractId) {
        renderContractForm(contractId);
    }
}

function handleUpdateDisbursementField(contractId, disbursementId, field, value) {
    updateDisbursement(contractId, disbursementId, { [field]: value });
}

function handleLinkLibraryToDisbursement(contractId, disbursementId, libraryId) {
    if (!libraryId) {
        unlinkLibraryFromDisbursement(contractId, disbursementId);
    } else {
        const libs = getInstalledLibraries();
        const lib = libs.find((l) => l.manifest.id === libraryId);
        if (!lib) return;
        linkLibraryToDisbursement(contractId, disbursementId, {
            libraryId: lib.manifest.id,
            libraryName: lib.manifest.name,
            evidenceStatus: isLibraryActive(libraryId) ? 'delivered' : 'pending',
        });
    }
    if (editingContractId === contractId) {
        renderContractForm(contractId);
    }
}

function handleLinkElementToContract(elementId, contractId) {
    linkElement(contractId, elementId);
    if (updateAllUIRef) updateAllUIRef();
}

function handleUnlinkElementFromContract(elementId, contractId) {
    unlinkElement(contractId, elementId);
    if (updateAllUIRef) updateAllUIRef();
}

// ----------------------------------------------------------------
// WBS HANDLERS
// ----------------------------------------------------------------

function handleAddWbsItem(parentId = null) {
    const item = addWbsItem({
        parentId,
        name: t('newTask') || 'New Task',
    });
    if (updateAllUIRef) updateAllUIRef();
    showToast(`${t('wbsItemAdded') || 'WBS item added'}: ${item.code}`, 'success');
}

function handleEditWbsItem(id, field, value) {
    const parsed =
        field === 'percentComplete' || field === 'cost' || field === 'weight' ? parseFloat(value) || 0 : value;

    // Route to the correct nested object
    if (field === 'weight') {
        // Weight always maps to baseline (peso fisico)
        updateWbsItem(id, { baseline: { weight: parsed } });
    } else if (['cost', 'startDate', 'endDate'].includes(field)) {
        // Determine which sub-object based on prefix
        const prefix = document.querySelector(`[data-wbs-field-prefix="${id}"]`)?.value || 'actual';
        updateWbsItem(id, { [prefix]: { [field]: parsed } });
    } else if (field === 'percentComplete') {
        updateWbsItem(id, { actual: { percentComplete: parsed } });
    } else {
        updateWbsItem(id, { [field]: parsed });
    }

    if (updateAllUIRef) updateAllUIRef();
}

function handleRemoveWbsItem(id) {
    removeWbsItem(id);
    if (updateAllUIRef) updateAllUIRef();
    showToast(t('wbsItemRemoved') || 'WBS item removed', 'info');
}

function handleApplyWbsTemplate(templateId) {
    const created = applyTemplate(templateId);
    if (updateAllUIRef) updateAllUIRef();
    showToast(`${t('templateApplied') || 'Template applied'}: ${created.length} items`, 'success');
}

// ----------------------------------------------------------------
// EVA HANDLERS
// ----------------------------------------------------------------

function handleCalculateEVA() {
    if (updateAllUIRef) updateAllUIRef();
    showToast(t('evaCalculated') || 'EVA calculated', 'success');
}

function handleSaveSnapshot() {
    const snap = saveSnapshot(new Date(), 'manual');
    if (updateAllUIRef) updateAllUIRef();
    showToast(`${t('snapshotSaved') || 'Snapshot saved'}: ${snap.snapshotDate}`, 'success');
}

// ----------------------------------------------------------------
// LIBRARY EVIDENCE SYNC
// Sincroniza evidenceStatus quando libraries mudam
// ----------------------------------------------------------------

// Evento: library instalada/desinstalada/ativada/desativada
window.addEventListener('librariesChanged', () => {
    syncLibraryEvidence(isLibraryActive);
    if (updateAllUIRef) updateAllUIRef();
});

// Startup sync (DA PF1): initLibraries() nao dispara librariesChanged
setTimeout(() => {
    try {
        syncLibraryEvidence(isLibraryActive);
    } catch (_) {
        /* libraries nao carregadas — evento cobre depois */
    }
}, 500);

// ----------------------------------------------------------------
// WBS DATA MODAL — Consolidated S-Curve data editor
// ----------------------------------------------------------------

/**
 * Open WBS data table modal.
 * Abre modal com tabela editavel dos dados WBS folha.
 */
function handleOpenWbsDataModal() {
    renderWbsDataModal();
    openModal('wbs-data-modal-overlay');
}

/**
 * Close WBS data table modal.
 * Fecha modal de dados WBS.
 */
function handleCloseWbsDataModal() {
    closeModal('wbs-data-modal-overlay');
}

/**
 * Save all edits from WBS data modal.
 * Salva todas as edicoes do modal de dados WBS.
 */
function handleSaveWbsDataModal() {
    const rows = document.querySelectorAll('.wbs-data-table tbody tr');
    let count = 0;

    rows.forEach((row) => {
        const id = row.dataset.wbsId;
        if (!id) return;
        const updates = _collectWbsRowUpdates(row);
        updateWbsItem(id, updates);
        count++;
    });

    closeModal('wbs-data-modal-overlay');
    if (updateAllUIRef) updateAllUIRef();
    showToast(`${count} ${t('wbsDataSaved') || 'WBS items updated'}`, 'success');
}

/**
 * Collect updates from a single WBS data table row.
 * Coleta valores editados de uma linha da tabela WBS.
 * @param {HTMLElement} row
 * @returns {Object}
 */
function _collectWbsRowUpdates(row) {
    const updates = { baseline: {}, planned: {}, actual: {} };
    const inputs = row.querySelectorAll('input:not([readonly]), select');

    inputs.forEach((el) => {
        const field = el.dataset.field;
        const raw = el.value;
        if (!field) return;

        if (field.startsWith('baseline.')) {
            updates.baseline[field.split('.')[1]] = _parseWbsField(field.split('.')[1], raw);
        } else if (field.startsWith('planned.')) {
            updates.planned[field.split('.')[1]] = _parseWbsField(field.split('.')[1], raw);
        } else if (field.startsWith('actual.')) {
            updates.actual[field.split('.')[1]] = _parseWbsField(field.split('.')[1], raw);
        } else {
            updates[field] = raw;
        }
    });

    return updates;
}

/**
 * Parse a WBS field value to the correct type.
 * Converte valor string para numero quando necessario.
 * @param {string} key
 * @param {string} raw
 * @returns {number|string}
 */
function _parseWbsField(key, raw) {
    if (['cost', 'weight', 'percentComplete'].includes(key)) {
        return parseFloat(raw) || 0;
    }
    return raw;
}

// ----------------------------------------------------------------
// INSURANCE HANDLERS — Acoes de seguro
// ----------------------------------------------------------------

function handleFileInsuranceClaimAction(contractId) {
    const notes = prompt(t('fileClaim') || 'Describe the claim:');
    if (notes == null) return;
    const result = fileInsuranceClaim(contractId, notes);
    if (result) {
        showToast(t('insClaimRegistered') || 'Claim registered', 'success');
        if (updateAllUIRef) updateAllUIRef();
    } else {
        showToast('Cannot file claim on this contract', 'error');
    }
}

function handleContractFilter(filter) {
    // Delegate to governance panel — set filter and re-render
    import('../ui/governancePanel.js').then((mod) => {
        if (mod.setContractFilter) mod.setContractFilter(filter);
        if (updateAllUIRef) updateAllUIRef();
    });
}

// ----------------------------------------------------------------
// EXPORTS
// ----------------------------------------------------------------

export const governanceHandlers = {
    handleAddContract,
    handleEditContract,
    handleRemoveContract,
    handleSaveContract,
    handleAddContractParty,
    handleRemoveContractParty,
    handleUpdateContractParty,
    handleAddDisbursement,
    handleRemoveDisbursement,
    handleUpdateDisbursementField,
    handleLinkLibraryToDisbursement,
    handleLinkElementToContract,
    handleUnlinkElementFromContract,
    handleAddWbsItem,
    handleEditWbsItem,
    handleRemoveWbsItem,
    handleApplyWbsTemplate,
    handleCalculateEVA,
    handleSaveSnapshot,
    handleOpenWbsDataModal,
    handleCloseWbsDataModal,
    handleSaveWbsDataModal,
    handleFileInsuranceClaim: handleFileInsuranceClaimAction,
    handleContractFilter,
};
