// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Version: 0.1-beta
// Authorship: Calvin Stefan Iost
// Copyright (c) 2026 Calvin Stefan Iost

/* ================================================================
   COST CENTER HANDLERS — User actions for cost centers & allocations
   Acoes do usuario para centros de custo e alocacoes

   FUNCIONALIDADES:
   - CRUD de centros de custo
   - Orcamento por ano fiscal
   - Alocacao de custos (rateio entre centros)
   - Quick-assign (atalho 100% para um unico CC)
   ================================================================ */

import {
    addCostCenter,
    updateCostCenter,
    removeCostCenter,
    getCostCenter,
    getCostCenters,
    getCostCenterTree,
    addAllocation,
    removeAllocation,
    updateAllocation,
    getAllocationsForSource,
    validateAllocations,
    setBudget,
} from '../governance/costCenterManager.js';

import { renderCostCentersSection, renderCostCenterForm, renderCostAllocationForm } from '../ui/governancePanel.js';
import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';
import { openModal, closeModal } from '../ui/modals.js';

// ----------------------------------------------------------------
// STATE
// ----------------------------------------------------------------

let updateAllUIRef = null;
let editingCostCenterId = null;

export function setCostCenterUpdateAllUI(fn) {
    updateAllUIRef = fn;
}

// ----------------------------------------------------------------
// COST CENTER CRUD
// ----------------------------------------------------------------

function handleAddCostCenter() {
    const cc = addCostCenter({
        name: t('newCostCenter') || 'New Cost Center',
        type: 'custom',
    });

    if (updateAllUIRef) updateAllUIRef();
    showToast(`${t('costCenterSaved') || 'Cost center added'}: ${cc.name}`, 'success');
}

function handleEditCostCenter(id) {
    editingCostCenterId = id;
    renderCostCenterForm(id);
    openModal('cost-center-modal');
}

function handleRemoveCostCenter(id) {
    const cc = getCostCenter(id);
    if (!cc) return;

    removeCostCenter(id);
    if (updateAllUIRef) updateAllUIRef();
    showToast(t('costCenterRemoved') || 'Cost center removed', 'info');
}

function handleSaveCostCenter() {
    if (!editingCostCenterId) return;

    const name = document.getElementById('cc-name')?.value || '';
    const code = document.getElementById('cc-code')?.value || '';
    const type = document.getElementById('cc-type')?.value || 'custom';
    const parentId = document.getElementById('cc-parent')?.value || null;
    const responsiblePerson = document.getElementById('cc-responsible')?.value || '';
    const active = document.getElementById('cc-active')?.checked !== false;

    updateCostCenter(editingCostCenterId, {
        name,
        code,
        type,
        parentId: parentId || null,
        responsiblePerson,
        active,
    });

    closeModal('cost-center-modal');
    if (updateAllUIRef) updateAllUIRef();
    showToast(t('costCenterSaved') || 'Cost center saved', 'success');
}

// ----------------------------------------------------------------
// BUDGET
// ----------------------------------------------------------------

function handleAddCostCenterBudget(ccId) {
    const fy = new Date().getFullYear();
    setBudget(ccId, fy, { budgetCapex: 0, budgetOpex: 0, budgetTotal: 0, notes: '' });
    if (editingCostCenterId === ccId) {
        renderCostCenterForm(ccId);
    }
}

function handleRemoveCostCenterBudget(ccId, fiscalYear) {
    const cc = getCostCenter(ccId);
    if (!cc) return;
    cc.budgets = cc.budgets.filter((b) => b.fiscalYear !== fiscalYear);
    if (editingCostCenterId === ccId) {
        renderCostCenterForm(ccId);
    }
}

function handleSaveCostCenterBudget() {
    if (!editingCostCenterId) return;

    const cc = getCostCenter(editingCostCenterId);
    if (!cc) return;

    // Coleta budgets do formulario
    const rows = document.querySelectorAll('.cc-budget-row');
    for (const row of rows) {
        const fy = parseInt(row.querySelector('.cc-budget-fy')?.value) || new Date().getFullYear();
        const budgetCapex = parseFloat(row.querySelector('.cc-budget-capex')?.value) || 0;
        const budgetOpex = parseFloat(row.querySelector('.cc-budget-opex')?.value) || 0;
        const budgetTotal = parseFloat(row.querySelector('.cc-budget-total')?.value) || budgetCapex + budgetOpex;
        const notes = row.querySelector('.cc-budget-notes')?.value || '';

        setBudget(editingCostCenterId, fy, { budgetCapex, budgetOpex, budgetTotal, notes });
    }

    if (updateAllUIRef) updateAllUIRef();
    showToast(t('costCenterSaved') || 'Budget saved', 'success');
}

// ----------------------------------------------------------------
// ALLOCATION
// ----------------------------------------------------------------

function handleAddCostAllocation(sourceType, sourceId) {
    renderCostAllocationForm(sourceType, sourceId);
    openModal('cost-allocation-modal');
}

function handleRemoveCostAllocation(allocationId) {
    removeAllocation(allocationId);
    if (updateAllUIRef) updateAllUIRef();
    showToast(t('allocationRemoved') || 'Allocation removed', 'info');
}

function handleSaveCostAllocation() {
    const sourceType = document.getElementById('ca-source-type')?.value || '';
    const sourceId = document.getElementById('ca-source-id')?.value || '';

    if (!sourceType || !sourceId) return;

    // Coleta alocacoes do formulario
    const rows = document.querySelectorAll('.ca-alloc-row');
    const newAllocs = [];
    for (const row of rows) {
        const costCenterId = row.querySelector('.ca-cc-select')?.value || '';
        const percentage = parseFloat(row.querySelector('.ca-pct-input')?.value) || 0;
        const notes = row.querySelector('.ca-notes-input')?.value || '';
        if (costCenterId && percentage > 0) {
            newAllocs.push({ costCenterId, percentage, notes });
        }
    }

    // Validar soma <= 100
    const totalPct = newAllocs.reduce((s, a) => s + a.percentage, 0);
    if (totalPct > 100) {
        showToast(t('allocationMustNotExceed100') || 'Total allocation must not exceed 100%', 'error');
        return;
    }

    // Remover alocacoes existentes para esta source
    const existing = getAllocationsForSource(sourceType, sourceId);
    for (const a of existing) {
        removeAllocation(a.id);
    }

    // Adicionar novas
    for (const a of newAllocs) {
        addAllocation({
            sourceType,
            sourceId,
            costCenterId: a.costCenterId,
            percentage: a.percentage,
            notes: a.notes,
        });
    }

    closeModal('cost-allocation-modal');
    if (updateAllUIRef) updateAllUIRef();
    showToast(t('costAllocationSaved') || 'Allocation saved', 'success');
}

function handleAssignCostCenter(sourceType, sourceId, costCenterId) {
    // Quick-assign: remove alocacoes existentes e atribui 100% a um CC
    const existing = getAllocationsForSource(sourceType, sourceId);
    for (const a of existing) {
        removeAllocation(a.id);
    }

    addAllocation({
        sourceType,
        sourceId,
        costCenterId,
        percentage: 100,
    });

    if (updateAllUIRef) updateAllUIRef();
    showToast(t('costCenterAssigned') || 'Cost center assigned', 'success');
}

function handleCostCenterVarianceReport() {
    // Dispara re-render do cost analysis panel com foco em cost centers
    if (updateAllUIRef) updateAllUIRef();
    showToast(t('varianceReportGenerated') || 'Variance report generated', 'info');
}

// ----------------------------------------------------------------
// EXPORT
// ----------------------------------------------------------------

export const costCenterHandlers = {
    handleAddCostCenter,
    handleEditCostCenter,
    handleRemoveCostCenter,
    handleSaveCostCenter,
    handleAddCostCenterBudget,
    handleRemoveCostCenterBudget,
    handleSaveCostCenterBudget,
    handleAddCostAllocation,
    handleRemoveCostAllocation,
    handleSaveCostAllocation,
    handleAssignCostCenter,
    handleCostCenterVarianceReport,
};
