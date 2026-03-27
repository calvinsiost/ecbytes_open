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
   GOVERNANCE PANEL — Tab rendering for contracts, WBS, EVA
   Painel da aba Governanca — contratos, EAP, Valor Agregado

   SECOES:
   1. Contratos: lista de cards com resumo financeiro
   2. EAP / WBS: arvore com barras de progresso
   3. EVA Dashboard: grafico + indicadores SPI/CPI + desvios
   ================================================================ */

import {
    getContracts,
    getContract,
    getContractFinancialSummary,
    getEvidenceSummary,
    getInsuranceContracts,
    checkInsuranceExpiry,
} from '../governance/contractManager.js';
import { getInstalledLibraries } from '../libraries/manager.js';
import {
    getWbsItems,
    getWbsTree,
    calculateEVA,
    calculateProjectEVA,
    detectDeviations,
    getWbsTemplates,
    generateSCurveData,
    generatePhysicalSCurveData,
    getSnapshotSeries,
} from '../governance/wbsManager.js';
import { getProjects, getProjectProgress, getResources, getAllocations } from '../governance/projectManager.js';
import {
    getCostCenters,
    getCostCenter,
    getCostCenterTree,
    getAllocationsForSource,
    getBudget,
} from '../governance/costCenterManager.js';
import {
    renderEVAChart,
    renderSCurveChart,
    renderPhysicalSCurveChart,
    renderSPICPIGauge,
    renderDeviationTable,
    injectEVAStyles,
} from '../governance/evaChart.js';
import { renderAccessControlSection } from '../handlers/auth.js';
import { t, applyTranslations } from '../i18n/translations.js';
import { escapeHtml, escapeAttr } from '../helpers/html.js';
import { hydrateIcons } from './icons.js';

// ----------------------------------------------------------------
// MAIN RENDER
// ----------------------------------------------------------------

/**
 * Render the full governance tab.
 * Renderiza toda a aba de governanca.
 */
export function renderGovernanceTab() {
    const container = document.getElementById('governance-content');
    if (!container) return;

    injectEVAStyles();
    injectGovernanceStyles();

    let html = '';

    // Section 0: Access Control (autenticacao e permissoes)
    html += renderAccessControlSection();

    // Section 0.5: Projects (portfolio management)
    html += renderProjectsSection();

    // Section 1: Contracts
    html += renderContractsSection();

    // Section 2: WBS
    html += renderWBSSection();

    // Section 3: EVA Dashboard
    html += renderEVASection();

    container.innerHTML = html;
    hydrateIcons(container);
    applyTranslations(container);

    // Render charts after DOM update
    requestAnimationFrame(() => {
        renderEVACharts();
    });
}

// ----------------------------------------------------------------
// PROJECTS SECTION
// ----------------------------------------------------------------

function renderProjectsSection() {
    const projects = getProjects();
    const resources = getResources();

    const typeLabels = {
        remediation: t('projectTypeRemediation') || 'Remediation',
        monitoring: t('projectTypeMonitoring') || 'Monitoring',
        investigation: t('projectTypeInvestigation') || 'Investigation',
        decommissioning: t('projectTypeDecommissioning') || 'Decommissioning',
        custom: t('projectTypeCustom') || 'Custom',
    };

    const statusClasses = {
        planning: 'gov-status-draft',
        active: 'gov-status-active',
        on_hold: 'gov-status-draft',
        completed: 'gov-status-completed',
        cancelled: 'gov-status-terminated',
    };

    let html = `
        <div class="section">
            <div class="section-header" onclick="window.toggleSection && window.toggleSection(this)">
                <span>${t('projectsSection') || 'Projects'} (${projects.length})</span>
                <span class="section-chevron">&#9660;</span>
            </div>
            <div class="section-content">
                <div class="gov-actions">
                    <button class="btn btn-sm btn-primary" onclick="window.handleAddProject()">
                        + ${t('newProject') || 'New Project'}
                    </button>
                    ${
                        resources.length > 0
                            ? `<button class="btn btn-sm btn-secondary" onclick="window.handleAddResource()">
                        + ${t('team') || 'Team'} (${resources.filter((r) => r.active).length})
                    </button>`
                            : `<button class="btn btn-sm btn-secondary" onclick="window.handleAddResource()">
                        + ${t('team') || 'Team'}
                    </button>`
                    }
                </div>`;

    if (projects.length === 0) {
        html += `<div class="gov-empty">
            <div style="font-size:1.5rem;margin-bottom:0.3rem">&#9776;</div>
            ${t('noProjects') || 'No projects yet'}
        </div>`;
    } else {
        for (const project of projects) {
            const progress = getProjectProgress(project.id);
            const typeLabel = typeLabels[project.type] || project.type;
            const statusClass = statusClasses[project.status] || 'gov-status-draft';
            const statusLabel =
                t(`status${project.status.charAt(0).toUpperCase() + project.status.slice(1).replace('_', '')}`) ||
                project.status;
            const dateRange =
                project.dates.startDate && project.dates.endDate
                    ? `${project.dates.startDate} — ${project.dates.endDate}`
                    : '';
            // Contagem de recursos alocados neste projeto
            const projResCount = _getProjectResourceCount(project.id);

            html += `
                <div class="element-card gov-card">
                    <div class="element-card-header">
                        <span class="gov-card-title">${escapeHtml(project.name)}</span>
                        <span class="gov-badge ${statusClass}">${statusLabel}</span>
                    </div>
                    <div class="gov-card-body">
                        <div class="gov-card-info">
                            <span class="gov-card-type">${typeLabel}</span>
                            <span>${project.phases.length} ${t('phases') || 'phases'}${projResCount > 0 ? ` | ${projResCount} ${t('resourcesLabel') || 'resources'}` : ''}</span>
                            ${dateRange ? `<span>${dateRange}</span>` : ''}
                        </div>
                        <div class="wbs-progress-bar" style="margin:4px 0">
                            <div class="wbs-progress-fill" style="width:${progress}%"></div>
                            <span class="wbs-progress-label">${progress}%</span>
                        </div>
                    </div>
                    <div class="gov-card-actions">
                        <button class="btn btn-sm btn-secondary" onclick="window.handleOpenProjectGantt('${project.id}')" title="${t('schedule') || 'Schedule'}">
                            ${t('schedule') || 'Schedule'}
                        </button>
                        <button class="btn btn-sm btn-secondary" onclick="window.handleOpenProjectLoad('${project.id}')" title="${t('load') || 'Load'}">
                            ${t('load') || 'Load'}
                        </button>
                        <button class="btn btn-sm btn-secondary" onclick="window.handleOpenProjectTimesheet('${project.id}')" title="${t('timesheetButton') || 'Timesheet'}">
                            ${t('timesheetButton') || 'Timesheet'}
                        </button>
                        <button class="btn btn-sm btn-secondary" onclick="window.handleEditProject('${project.id}')">
                            ${t('edit') || 'Edit'}
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="window.handleRemoveProject('${project.id}')">
                            ${t('remove') || 'Remove'}
                        </button>
                    </div>
                </div>`;
        }
    }

    html += `</div></div>`;
    return html;
}

// ----------------------------------------------------------------
// CONTRACTS SECTION
// ----------------------------------------------------------------

/** @type {'all'|'contracts'|'insurance'} */
let _contractFilter = 'all';

/**
 * Set contract filter (called from governance handler).
 * @param {'all'|'contracts'|'insurance'} filter
 */
export function setContractFilter(filter) {
    _contractFilter = filter;
}

function renderContractsSection() {
    // Lazy expiry check for insurance
    checkInsuranceExpiry();

    const allContracts = getContracts();
    const insuranceCount = getInsuranceContracts().length;
    const contractCount = allContracts.length - insuranceCount;
    const filtered =
        _contractFilter === 'insurance'
            ? allContracts.filter((c) => c.type === 'insurance')
            : _contractFilter === 'contracts'
              ? allContracts.filter((c) => c.type !== 'insurance')
              : allContracts;

    let html = `
        <div class="section">
            <div class="section-header" onclick="window.toggleSection && window.toggleSection(this)">
                <span>${t('contracts') || 'Contracts'} (${allContracts.length})</span>
                <span class="section-chevron">&#9660;</span>
            </div>
            <div class="section-content">
                <div class="gov-filter-tabs" style="margin-bottom:6px">
                    <button class="btn btn-xs ${_contractFilter === 'all' ? 'btn-primary' : 'btn-ghost'}" onclick="window.handleContractFilter('all')">${t('allContracts') || 'All'} (${allContracts.length})</button>
                    <button class="btn btn-xs ${_contractFilter === 'contracts' ? 'btn-primary' : 'btn-ghost'}" onclick="window.handleContractFilter('contracts')">${t('contracts') || 'Contracts'} (${contractCount})</button>
                    <button class="btn btn-xs ${_contractFilter === 'insurance' ? 'btn-primary' : 'btn-ghost'}" onclick="window.handleContractFilter('insurance')">${t('insuranceContracts') || 'Insurance'} (${insuranceCount})</button>
                </div>
                <div class="gov-actions">
                    <button class="btn btn-sm btn-primary" onclick="window.handleAddContract()">
                        + ${t('addContract') || 'Add Contract'}
                    </button>
                </div>`;

    if (filtered.length === 0) {
        const emptyMsg =
            _contractFilter === 'insurance'
                ? t('noInsurance') || 'No insurance policies'
                : t('noContracts') || 'No contracts yet';
        html += `<div class="gov-empty">
            <div style="font-size:1.5rem;margin-bottom:0.3rem">&#9776;</div>
            ${emptyMsg}
        </div>`;
    } else {
        for (const contract of filtered) {
            html += renderContractCard(contract);
        }
    }

    html += `</div></div>`;
    return html;
}

function renderContractCard(contract) {
    const summary = getContractFinancialSummary(contract.id);
    const statusClass = `gov-status-${contract.status}`;
    const typeLabel = contractTypeLabel(contract.type);
    const dateRange =
        contract.dates?.effectiveDate && contract.dates?.expirationDate
            ? `${contract.dates.effectiveDate} — ${contract.dates.expirationDate}`
            : '';
    const paidPct = summary && summary.totalValue > 0 ? Math.round((summary.totalPaid / summary.totalValue) * 100) : 0;

    return `
        <div class="element-card gov-card">
            <div class="element-card-header">
                <span class="gov-card-title">${escapeHtml(contract.name)}</span>
                <span class="gov-badge ${statusClass}">${contract.status}</span>
            </div>
            <div class="gov-card-body">
                <div class="gov-card-info">
                    <span class="gov-card-type">${typeLabel}</span>
                    <span>${contract.parties.length} ${t('parties') || 'parties'}</span>
                    ${dateRange ? `<span>${dateRange}</span>` : ''}
                </div>
                ${
                    summary
                        ? `
                <div class="gov-card-financial">
                    <span>${t('total') || 'Total'}: ${formatCurrency(summary.totalValue)}</span>
                    <span>${t('paid') || 'Paid'}: ${formatCurrency(summary.totalPaid)}</span>
                    ${summary.totalOverdue > 0 ? `<span class="eva-negative">${t('overdue') || 'Overdue'}: ${formatCurrency(summary.totalOverdue)}</span>` : ''}
                </div>
                <div class="wbs-progress-bar" style="margin:4px 0">
                    <div class="wbs-progress-fill" style="width:${paidPct}%;background:${paidPct >= 100 ? '#27ae60' : 'var(--accent, #3b6bff)'}"></div>
                    <span class="wbs-progress-label">${paidPct}% ${t('paid') || 'paid'}</span>
                </div>`
                        : ''
                }
                ${(() => {
                    const ev = getEvidenceSummary(contract.id);
                    return ev && ev.total > 0
                        ? `<div class="gov-card-evidence">${ev.delivered}/${ev.total} ${t('evidencesDelivered') || 'evidences delivered'}</div>`
                        : '';
                })()}
                ${
                    contract.type === 'insurance' && contract.insurance
                        ? (() => {
                              const ins = contract.insurance;
                              const claimLabel =
                                  ins.claimStatus === 'none'
                                      ? ''
                                      : t(
                                            'claim' +
                                                ins.claimStatus.charAt(0).toUpperCase() +
                                                ins.claimStatus.slice(1).replace(/_\w/g, (m) => m[1].toUpperCase()),
                                        ) || ins.claimStatus;
                              const statusBadge =
                                  contract.status === 'active'
                                      ? 'ins-badge--active'
                                      : contract.status === 'completed'
                                        ? 'ins-badge--expired'
                                        : 'ins-badge--cancelled';
                              const statusLabel =
                                  contract.status === 'active'
                                      ? t('insActive') || 'Active'
                                      : contract.status === 'completed'
                                        ? t('insExpired') || 'Expired'
                                        : t('insCancelled') || 'Cancelled';
                              return `<div class="gov-card-insurance">
                        <span>${t('policyNumber') || 'Policy'}: <strong>${escapeHtml(ins.policyNumber)}</strong></span>
                        <span class="ins-badge ${statusBadge}">${statusLabel}</span>
                        <span>${t('coverage') || 'Coverage'}: ${formatCurrency(ins.coverageValueCents / 100)} / ${ins.coveragePeriodMonths} ${t('months') || 'months'}</span>
                        ${claimLabel ? `<span>${claimLabel}</span>` : ''}
                    </div>`;
                          })()
                        : ''
                }
            </div>
            <div class="gov-card-actions">
                <button class="btn btn-sm btn-secondary" onclick="window.handleEditContract('${contract.id}')">
                    ${t('edit') || 'Edit'}
                </button>
                ${
                    contract.type === 'insurance' &&
                    contract.insurance?.claimStatus === 'none' &&
                    contract.status === 'active'
                        ? `<button class="btn btn-sm btn-warning" onclick="window.handleFileInsuranceClaim('${contract.id}')">${t('fileClaim') || 'File Claim'}</button>`
                        : ''
                }
                <button class="btn btn-sm btn-danger" onclick="window.handleRemoveContract('${contract.id}')">
                    ${t('remove') || 'Remove'}
                </button>
            </div>
        </div>`;
}

// ----------------------------------------------------------------
// WBS SECTION
// ----------------------------------------------------------------

function renderWBSSection() {
    const items = getWbsItems();
    const tree = getWbsTree();
    const templates = getWbsTemplates();

    let html = `
        <div class="section">
            <div class="section-header" onclick="window.toggleSection && window.toggleSection(this)">
                <span>${t('wbs') || 'WBS / EAP'} (${items.length})</span>
                <span class="section-chevron">&#9660;</span>
            </div>
            <div class="section-content">
                <div class="gov-actions">
                    <button class="btn btn-sm btn-primary" onclick="window.handleAddWbsItem()">
                        + ${t('addTask') || 'Add Task'}
                    </button>
                    <select class="form-input gov-template-select" onchange="if(this.value){window.handleApplyWbsTemplate(this.value);this.value='';}">
                        <option value="">${t('applyTemplate') || 'Apply Template...'}</option>
                        ${templates.map((tmpl) => `<option value="${tmpl.id}">${tmpl.name}</option>`).join('')}
                    </select>
                </div>`;

    if (tree.length === 0) {
        html += `<div class="gov-empty">
            <div style="font-size:1.5rem;margin-bottom:0.3rem">&#9776;</div>
            ${t('noWbsItems') || 'No WBS items — add tasks or apply a template'}
        </div>`;
    } else {
        html += '<div class="wbs-tree">';
        for (const node of tree) {
            html += renderWbsNode(node, 0);
        }
        html += '</div>';
    }

    html += `</div></div>`;
    return html;
}

function renderWbsNode(node, depth) {
    const percent = node.actual?.percentComplete || 0;
    const statusClass = `eva-status-${node.status}`;
    const indent = depth * 1.2;
    const safeNodeId = (node.id || '').replace(/[^a-zA-Z0-9_-]/g, '_');

    let html = `
        <div class="wbs-node" style="padding-left:${indent}rem">
            <div class="wbs-node-header">
                <span class="wbs-code">${escapeHtml(node.code)}</span>
                <span class="wbs-name">${escapeHtml(node.name)}</span>
                <span class="eva-status-badge ${statusClass}">${(node.status || '').replace('_', ' ')}</span>
                <button class="btn btn-sm btn-danger wbs-delete-btn" onclick="window.handleRemoveWbsItem('${node.id}')" title="Remove" aria-label="Remove"><span data-icon="x" data-icon-size="12px"></span></button>
            </div>
            <div class="wbs-progress-bar">
                <div class="wbs-progress-fill" style="width:${percent}%"></div>
                <span class="wbs-progress-label">${percent}%</span>
            </div>
            <div class="wbs-node-fields">
                <label for="wbs-complete-${safeNodeId}">${t('percentComplete') || '% Complete'}:</label>
                    <input type="number" id="wbs-complete-${safeNodeId}" min="0" max="100" value="${percent}" class="form-input wbs-field-input"
                        aria-label="Percent complete"
                        onchange="window.handleEditWbsItem('${node.id}','percentComplete',this.value)">
                <label for="wbs-cost-${safeNodeId}">${t('actualCost') || 'Actual Cost'}:</label>
                    <input type="number" id="wbs-cost-${safeNodeId}" min="0" value="${node.actual?.cost || 0}" class="form-input wbs-field-input"
                        aria-label="Actual cost"
                        onchange="window.handleEditWbsItem('${node.id}','cost',this.value)">
                <label for="wbs-weight-${safeNodeId}">${t('baselineWeight') || 'Weight'}:</label>
                    <input type="number" id="wbs-weight-${safeNodeId}" min="0" value="${node.baseline?.weight || 0}" class="form-input wbs-field-input"
                        aria-label="Baseline weight"
                        onchange="window.handleEditWbsItem('${node.id}','weight',this.value)">

                <button class="btn btn-sm btn-secondary" onclick="window.handleAddWbsItem('${node.id}')">+ Sub</button>
            </div>
        </div>`;

    if (node.children && node.children.length > 0) {
        for (const child of node.children) {
            html += renderWbsNode(child, depth + 1);
        }
    }

    return html;
}

// ----------------------------------------------------------------
// EVA SECTION
// ----------------------------------------------------------------

function renderEVASection() {
    const snapCount = getSnapshotSeries().length;
    const snapLabel = snapCount === 0 ? 'No snapshots' : `${snapCount} snapshot${snapCount > 1 ? 's' : ''}`;

    return `
        <div class="section">
            <div class="section-header" onclick="window.toggleSection && window.toggleSection(this)">
                <span>${t('evaDashboard') || 'EVA Dashboard'}</span>
                <span class="section-chevron">&#9660;</span>
            </div>
            <div class="section-content">
                <div class="gov-actions">
                    <button class="btn btn-sm btn-primary" onclick="window.handleCalculateEVA()">
                        ${t('calculateEVA') || 'Calculate EVA'}
                    </button>
                    <button class="btn btn-sm btn-secondary" id="eva-save-snapshot" onclick="window.handleSaveSnapshot()">
                        Save Status Date
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="window.handleOpenWbsDataModal()">&#9881; ${t('viewData') || 'View Data'}</button>
                    <span id="eva-snapshot-count" style="font-size:0.75rem;color:var(--text-secondary);margin-left:0.3rem">${snapLabel}</span>
                </div>
                <div id="eva-gauges-container"></div>
                <div id="eva-chart-container"></div>
                <div id="eva-scurve-container"></div>
                <div id="eva-scurve-physical-container"></div>
                <div id="eva-deviations-container"></div>
            </div>
        </div>`;
}

function renderEVACharts() {
    const items = getWbsItems();
    if (items.length === 0) return;

    const projectEVA = calculateProjectEVA();
    const itemEvas = items
        .filter((w) => !w.parentId)
        .map((w) => calculateEVA(w.id))
        .filter(Boolean);
    const deviations = detectDeviations();

    const gaugeContainer = document.getElementById('eva-gauges-container');
    const chartContainer = document.getElementById('eva-chart-container');
    const devContainer = document.getElementById('eva-deviations-container');

    if (gaugeContainer) renderSPICPIGauge(gaugeContainer, projectEVA.SPI, projectEVA.CPI);
    if (chartContainer) renderEVAChart(chartContainer, projectEVA, itemEvas);

    const scurveContainer = document.getElementById('eva-scurve-container');
    if (scurveContainer) {
        const scurveData = generateSCurveData();
        if (scurveData) {
            renderSCurveChart(scurveContainer, scurveData);
        } else {
            scurveContainer.innerHTML =
                '<div style="text-align:center;padding:1rem;color:var(--text-secondary)">S-Curve requires WBS items with baseline dates and costs</div>';
        }
    }

    const physContainer = document.getElementById('eva-scurve-physical-container');
    if (physContainer) {
        const physData = generatePhysicalSCurveData();
        if (physData) {
            renderPhysicalSCurveChart(physContainer, physData);
        } else {
            physContainer.innerHTML =
                '<div style="text-align:center;padding:1rem;color:var(--text-secondary)">Physical S-Curve requires WBS items with baseline dates and weights</div>';
        }
    }

    // Update snapshot count
    const snapCountEl = document.getElementById('eva-snapshot-count');
    if (snapCountEl) {
        const sc = getSnapshotSeries().length;
        snapCountEl.textContent = sc === 0 ? 'No snapshots' : `${sc} snapshot${sc > 1 ? 's' : ''}`;
    }

    if (devContainer) renderDeviationTable(devContainer, deviations);
}

// ----------------------------------------------------------------
// CONTRACT FORM (MODAL)
// ----------------------------------------------------------------

/**
 * Render contract edit form inside the modal.
 * Renderiza formulario de edicao de contrato no modal.
 *
 * @param {string} contractId
 */
export function renderContractForm(contractId) {
    const contract = getContract(contractId);
    if (!contract) return;

    const container = document.getElementById('contract-form-content');
    if (!container) return;

    // Libraries instaladas para dropdown de evidencia (DA PC3: apenas instaladas)
    const installedLibs = getInstalledLibraries();

    container.innerHTML = `
        <div class="form-group">
            <label class="form-label" for="contract-name">${t('contractName') || 'Name'}</label>
            <input type="text" id="contract-name" class="form-input" value="${escapeAttr(contract.name)}">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label" for="contract-type">${t('type') || 'Type'}</label>
                <select id="contract-type" class="form-input">
                    <option value="remediation" ${contract.type === 'remediation' ? 'selected' : ''}>Remediation</option>
                    <option value="monitoring" ${contract.type === 'monitoring' ? 'selected' : ''}>Monitoring</option>
                    <option value="investigation" ${contract.type === 'investigation' ? 'selected' : ''}>Investigation</option>
                    <option value="insurance" ${contract.type === 'insurance' ? 'selected' : ''}>${t('insuranceContracts') || 'Insurance'}</option>
                    <option value="custom" ${contract.type === 'custom' ? 'selected' : ''}>Custom</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label" for="contract-status">${t('status') || 'Status'}</label>
                <select id="contract-status" class="form-input">
                    <option value="draft" ${contract.status === 'draft' ? 'selected' : ''}>Draft</option>
                    <option value="active" ${contract.status === 'active' ? 'selected' : ''}>Active</option>
                    <option value="completed" ${contract.status === 'completed' ? 'selected' : ''}>Completed</option>
                    <option value="terminated" ${contract.status === 'terminated' ? 'selected' : ''}>Terminated</option>
                </select>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label" for="contract-total-value">${t('totalValue') || 'Total Value'}</label>
                <input type="number" id="contract-total-value" class="form-input" value="${contract.financial.totalValue}" min="0" step="100">
            </div>
            <div class="form-group">
                <label class="form-label" for="contract-currency">${t('currency') || 'Currency'}</label>
                <input type="text" id="contract-currency" class="form-input" value="${contract.financial.currency}" maxlength="3">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label" for="contract-effective-date">${t('effectiveDate') || 'Effective Date'}</label>
                <input type="date" id="contract-effective-date" class="form-input" value="${contract.dates.effectiveDate}">
            </div>
            <div class="form-group">
                <label class="form-label" for="contract-expiration-date">${t('expirationDate') || 'Expiration Date'}</label>
                <input type="date" id="contract-expiration-date" class="form-input" value="${contract.dates.expirationDate}">
            </div>
        </div>

        ${
            contract.type === 'insurance' && contract.insurance
                ? `
        <!-- Insurance Details / Detalhes do Seguro -->
        <div class="gov-subsection">
            <div class="gov-subsection-header">
                <span>${t('insuranceContracts') || 'Insurance'}</span>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">${t('policyNumber') || 'Policy Number'}</label>
                    <input type="text" class="form-input" value="${escapeAttr(contract.insurance.policyNumber)}" readonly>
                </div>
                <div class="form-group">
                    <label class="form-label">${t('envInsurance') || 'Category'}</label>
                    <input type="text" class="form-input" value="${contract.insurance.category}" readonly>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">${t('coverage') || 'Coverage'}</label>
                    <input type="text" class="form-input" value="${(contract.insurance.coverageValueCents / 100).toFixed(2)}" readonly>
                </div>
                <div class="form-group">
                    <label class="form-label">${t('coveragePeriod') || 'Coverage Period'}</label>
                    <input type="text" class="form-input" value="${contract.insurance.coveragePeriodMonths} ${t('months') || 'months'}" readonly>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">${t('premium') || 'Premium'}</label>
                    <input type="text" class="form-input" value="${(contract.insurance.premiumCents / 100).toFixed(2)}" readonly>
                </div>
                <div class="form-group">
                    <label class="form-label">Claim Status</label>
                    <input type="text" class="form-input" value="${contract.insurance.claimStatus}" readonly>
                </div>
            </div>
            ${
                contract.insurance.claimStatus === 'none' && contract.status === 'active'
                    ? `
            <button class="btn btn-sm btn-warning" onclick="window.handleFileInsuranceClaim('${contractId}')">
                ${t('fileClaim') || 'File Claim'}
            </button>`
                    : ''
            }
        </div>`
                : ''
        }

        <!-- Parties -->
        <div class="gov-subsection">
            <div class="gov-subsection-header">
                <span>${t('parties') || 'Parties'} (${contract.parties.length})</span>
                <button class="btn btn-sm btn-secondary" onclick="window.handleAddContractParty('${contractId}')">+ Add</button>
            </div>
            ${contract.parties
                .map(
                    (party, i) => `
                <div class="gov-party-row">
                    <select class="form-input" onchange="window.handleUpdateContractParty('${contractId}',${i},'role',this.value)">
                        <option value="contractor" ${party.role === 'contractor' ? 'selected' : ''}>Contractor</option>
                        <option value="client" ${party.role === 'client' ? 'selected' : ''}>Client</option>
                        <option value="regulator" ${party.role === 'regulator' ? 'selected' : ''}>Regulator</option>
                        <option value="witness" ${party.role === 'witness' ? 'selected' : ''}>Witness</option>
                    </select>
                    <input type="text" class="form-input" placeholder="${t('name') || 'Name'}" value="${escapeAttr(party.name)}"
                        onchange="window.handleUpdateContractParty('${contractId}',${i},'name',this.value)">
                    <input type="text" class="form-input" placeholder="${t('registry') || 'Registry'}" value="${escapeAttr(party.registry)}"
                        onchange="window.handleUpdateContractParty('${contractId}',${i},'registry',this.value)">
                    <button class="btn btn-sm btn-danger" onclick="window.handleRemoveContractParty('${contractId}',${i})" aria-label="Remove"><span data-icon="x" data-icon-size="12px"></span></button>
                </div>
            `,
                )
                .join('')}
        </div>

        <!-- Disbursements / Desembolsos -->
        <div class="gov-subsection">
            <div class="gov-subsection-header">
                <span>${t('disbursements') || 'Disbursements'} (${contract.financial.disbursements.length})</span>
                <button class="btn btn-sm btn-secondary" onclick="window.handleAddDisbursement('${contractId}')">+ ${t('addDisbursement') || 'Add'}</button>
            </div>
            ${contract.financial.disbursements
                .map(
                    (d) => `
                <div class="gov-disbursement-card">
                    <div class="gov-disbursement-row1">
                        <input type="date" class="form-input" value="${d.date}"
                            onchange="window.handleUpdateDisbursementField('${contractId}','${d.id}','date',this.value)">
                        <input type="number" class="form-input" value="${d.amount}" min="0" step="100"
                            onchange="window.handleUpdateDisbursementField('${contractId}','${d.id}','amount',parseFloat(this.value)||0)">
                        <select class="form-input"
                            onchange="window.handleUpdateDisbursementField('${contractId}','${d.id}','status',this.value)">
                            <option value="scheduled" ${d.status === 'scheduled' ? 'selected' : ''}>Scheduled</option>
                            <option value="paid" ${d.status === 'paid' ? 'selected' : ''}>Paid</option>
                        </select>
                        <button class="btn btn-sm btn-danger" onclick="window.handleRemoveDisbursement('${contractId}','${d.id}')" aria-label="Remove"><span data-icon="x" data-icon-size="12px"></span></button>
                    </div>
                    <div class="gov-disbursement-row2">
                        <input type="text" class="form-input" placeholder="${t('description') || 'Description'}" value="${escapeAttr(d.description)}"
                            onchange="window.handleUpdateDisbursementField('${contractId}','${d.id}','description',this.value)">
                        <select class="form-input gov-evidence-select"
                            onchange="window.handleLinkLibraryToDisbursement('${contractId}','${d.id}',this.value)">
                            <option value="">${t('noLinkedLibrary') || 'No linked library'}</option>
                            ${installedLibs
                                .map(
                                    (lib) => `
                                <option value="${escapeAttr(lib.manifest.id)}"
                                    ${d.linkedLibrary && d.linkedLibrary.libraryId === lib.manifest.id ? 'selected' : ''}>
                                    ${escapeHtml(lib.manifest.name)}
                                </option>
                            `,
                                )
                                .join('')}
                        </select>
                        ${
                            d.linkedLibrary
                                ? `
                            <span class="gov-evidence-badge gov-evidence-${d.linkedLibrary.evidenceStatus}">
                                &#9679; ${
                                    d.linkedLibrary.evidenceStatus === 'delivered'
                                        ? t('evidenceDelivered') || 'Delivered'
                                        : t('evidencePending') || 'Pending'
                                }
                            </span>`
                                : ''
                        }
                    </div>
                </div>
            `,
                )
                .join('')}
        </div>

        <div class="form-group">
            <label class="form-label" for="contract-notes">${t('notes') || 'Notes'}</label>
            <textarea id="contract-notes" class="form-input" rows="3">${escapeHtml(contract.notes)}</textarea>
        </div>
    `;
}

// ----------------------------------------------------------------
// COST CENTERS SECTION
// ----------------------------------------------------------------

function renderCostCentersSection() {
    const ccs = getCostCenters();
    const tree = getCostCenterTree();
    const currentFY = new Date().getFullYear();

    const typeLabels = {
        production: t('costCenterTypeProduction') || 'Production',
        administrative: t('costCenterTypeAdministrative') || 'Administrative',
        support: t('costCenterTypeSupport') || 'Support',
        project: t('costCenterTypeProject') || 'Project',
        custom: t('costCenterTypeCustom') || 'Custom',
    };

    let html = `
        <div class="section">
            <div class="section-header" onclick="window.toggleSection && window.toggleSection(this)">
                <span>${t('costCenters') || 'Cost Centers'} (${ccs.length})</span>
                <span class="section-chevron">&#9660;</span>
            </div>
            <div class="section-content">
                <div class="gov-actions">
                    <button class="btn btn-sm btn-primary" onclick="window.handleAddCostCenter()">
                        + ${t('newCostCenter') || 'New Cost Center'}
                    </button>
                </div>`;

    if (ccs.length === 0) {
        html += `<div class="gov-empty">
            <div style="font-size:1.5rem;margin-bottom:0.3rem">&#9632;</div>
            ${t('noCostCenters') || 'No cost centers yet'}
        </div>`;
    } else {
        html += _renderCCTree(tree, typeLabels, currentFY, 0);
    }

    html += `</div></div>`;
    return html;
}

export { renderCostCentersSection };

/**
 * Bind event listeners for CC tree edit/remove buttons (data-* pattern).
 * Deve ser chamado apos inserir o HTML de renderCostCentersSection no DOM.
 * @param {HTMLElement} container
 */
export function bindCostCenterTreeListeners(container) {
    if (!container) return;
    container.querySelectorAll('.cc-edit-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (window.handleEditCostCenter) window.handleEditCostCenter(btn.dataset.ccId);
        });
    });
    container.querySelectorAll('.cc-remove-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (window.handleRemoveCostCenter) window.handleRemoveCostCenter(btn.dataset.ccId);
        });
    });
}

function _renderCCTree(nodes, typeLabels, currentFY, depth) {
    let html = '';
    for (const node of nodes) {
        const indent = depth * 20;
        const typeLabel = typeLabels[node.type] || node.type;
        const budget = node.budgets?.find((b) => b.fiscalYear === currentFY);
        const budgetTotal = budget?.budgetTotal || 0;
        const activeClass = node.active ? '' : ' style="opacity:0.5"';

        html += `
        <div class="gov-card" ${activeClass}>
            <div class="gov-card-header" style="padding-left:${indent + 8}px">
                <div>
                    <strong>${escapeHtml(node.code || '-')}</strong>
                    <span style="margin-left:6px">${escapeHtml(node.name)}</span>
                    <span class="gov-status-badge gov-status-active" style="font-size:0.7rem;margin-left:6px">${escapeHtml(typeLabel)}</span>
                    ${!node.active ? `<span class="gov-status-badge gov-status-terminated" style="font-size:0.7rem;margin-left:4px">${t('inactive') || 'Inactive'}</span>` : ''}
                </div>
                <div class="gov-card-actions">
                    <button class="btn btn-sm cc-edit-btn" data-cc-id="${escapeAttr(node.id)}" title="${t('editCostCenter') || 'Edit'}">&#9998;</button>
                    <button class="btn btn-sm btn-danger cc-remove-btn" data-cc-id="${escapeAttr(node.id)}" title="${t('removeCostCenter') || 'Remove'}">&#10005;</button>
                </div>
            </div>
            <div class="gov-card-body" style="padding-left:${indent + 8}px">
                ${node.responsiblePerson ? `<div style="font-size:0.78rem;color:var(--text-muted)">${t('costCenterResponsible') || 'Responsible'}: ${escapeHtml(node.responsiblePerson)}</div>` : ''}
                ${budgetTotal > 0 ? `<div style="font-size:0.78rem;color:var(--text-muted)">${t('costCenterBudget') || 'Budget'} ${currentFY}: ${budgetTotal.toLocaleString()}</div>` : ''}
            </div>
        </div>`;

        if (node.children?.length > 0) {
            html += _renderCCTree(node.children, typeLabels, currentFY, depth + 1);
        }
    }
    return html;
}

/**
 * Render cost center edit form inside modal.
 * @param {string} ccId
 */
export function renderCostCenterForm(ccId) {
    const cc = getCostCenter(ccId);
    if (!cc) return;

    const allCCs = getCostCenters().filter((c) => c.id !== ccId);
    const container = document.getElementById('cost-center-form');
    if (!container) return;

    const parentOpts = allCCs
        .map(
            (c) =>
                `<option value="${c.id}" ${c.id === cc.parentId ? 'selected' : ''}>${escapeHtml(c.code || '-')} - ${escapeHtml(c.name)}</option>`,
        )
        .join('');

    const budgetRows = cc.budgets
        .map(
            (b) => `
        <div class="cc-budget-row" style="display:flex;gap:6px;margin-bottom:4px;align-items:center">
            <input class="cc-budget-fy input-sm" type="number" value="${b.fiscalYear}" style="width:70px" />
            <input class="cc-budget-capex input-sm" type="number" value="${b.budgetCapex || 0}" placeholder="CAPEX" style="width:80px" />
            <input class="cc-budget-opex input-sm" type="number" value="${b.budgetOpex || 0}" placeholder="OPEX" style="width:80px" />
            <input class="cc-budget-total input-sm" type="number" value="${b.budgetTotal || 0}" placeholder="Total" style="width:90px" />
            <input class="cc-budget-notes input-sm" type="text" value="${escapeAttr(b.notes || '')}" placeholder="${t('notes') || 'Notes'}" style="flex:1" />
            <button class="btn btn-sm btn-danger cc-remove-budget-btn" data-cc-id="${escapeAttr(ccId)}" data-fy="${b.fiscalYear}">&#10005;</button>
        </div>
    `,
        )
        .join('');

    container.innerHTML = `
        <div class="form-group">
            <label>${t('costCenterCode') || 'Code'}</label>
            <input id="cc-code" class="input" type="text" value="${escapeAttr(cc.code)}" />
        </div>
        <div class="form-group">
            <label>${t('costCenterName') || 'Name'}</label>
            <input id="cc-name" class="input" type="text" value="${escapeAttr(cc.name)}" />
        </div>
        <div class="form-group">
            <label>${t('costCenterType') || 'Type'}</label>
            <select id="cc-type" class="input">
                <option value="production" ${cc.type === 'production' ? 'selected' : ''}>${t('costCenterTypeProduction') || 'Production'}</option>
                <option value="administrative" ${cc.type === 'administrative' ? 'selected' : ''}>${t('costCenterTypeAdministrative') || 'Administrative'}</option>
                <option value="support" ${cc.type === 'support' ? 'selected' : ''}>${t('costCenterTypeSupport') || 'Support'}</option>
                <option value="project" ${cc.type === 'project' ? 'selected' : ''}>${t('costCenterTypeProject') || 'Project'}</option>
                <option value="custom" ${cc.type === 'custom' ? 'selected' : ''}>${t('costCenterTypeCustom') || 'Custom'}</option>
            </select>
        </div>
        <div class="form-group">
            <label>${t('costCenterParent') || 'Parent'}</label>
            <select id="cc-parent" class="input">
                <option value="">(${t('none') || 'None'})</option>
                ${parentOpts}
            </select>
        </div>
        <div class="form-group">
            <label>${t('costCenterResponsible') || 'Responsible'}</label>
            <input id="cc-responsible" class="input" type="text" value="${escapeAttr(cc.responsiblePerson)}" />
        </div>
        <div class="form-group">
            <label><input id="cc-active" type="checkbox" ${cc.active ? 'checked' : ''} /> ${t('active') || 'Active'}</label>
        </div>
        <div class="form-group">
            <label>${t('costCenterBudget') || 'Budget'}</label>
            ${budgetRows || `<div style="color:var(--text-muted);font-size:0.8rem">${t('noBudgets') || 'No budgets'}</div>`}
            <button class="btn btn-sm btn-secondary cc-add-budget-btn" style="margin-top:4px" data-cc-id="${escapeAttr(ccId)}">
                + ${t('addBudget') || 'Add Budget'}
            </button>
        </div>
        <div style="margin-top:10px;text-align:right">
            <button class="btn btn-primary" id="cc-save-btn">
                ${t('save') || 'Save'}
            </button>
        </div>
    `;

    // Bind buttons via JS (avoids inline onclick with interpolated IDs)
    container.querySelector('#cc-save-btn')?.addEventListener('click', () => {
        if (window.handleSaveCostCenterBudget) window.handleSaveCostCenterBudget();
        if (window.handleSaveCostCenter) window.handleSaveCostCenter();
    });
    container.querySelectorAll('.cc-remove-budget-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (window.handleRemoveCostCenterBudget) {
                window.handleRemoveCostCenterBudget(btn.dataset.ccId, Number(btn.dataset.fy));
            }
        });
    });
    container.querySelector('.cc-add-budget-btn')?.addEventListener('click', () => {
        if (window.handleAddCostCenterBudget) window.handleAddCostCenterBudget(ccId);
    });
}

/**
 * Render cost allocation form inside modal.
 * @param {string} sourceType
 * @param {string} sourceId
 */
export function renderCostAllocationForm(sourceType, sourceId) {
    const allCCs = getCostCenters();
    const existing = getAllocationsForSource(sourceType, sourceId);
    const container = document.getElementById('cost-allocation-form');
    if (!container) return;

    const rows = existing
        .map((a) => {
            const ccOpts = allCCs
                .map(
                    (cc) =>
                        `<option value="${cc.id}" ${cc.id === a.costCenterId ? 'selected' : ''}>${escapeHtml(cc.code || '-')} - ${escapeHtml(cc.name)}</option>`,
                )
                .join('');
            return `
            <div class="ca-alloc-row" style="display:flex;gap:6px;margin-bottom:4px;align-items:center">
                <select class="ca-cc-select input-sm" style="flex:1">${ccOpts}</select>
                <input class="ca-pct-input input-sm" type="number" min="0" max="100" value="${a.percentage}" style="width:70px" />
                <span style="font-size:0.8rem">%</span>
                <input class="ca-notes-input input-sm" type="text" value="${escapeAttr(a.notes || '')}" style="flex:1" placeholder="${t('notes') || 'Notes'}" />
                <button class="btn btn-sm btn-danger" onclick="this.closest('.ca-alloc-row').remove()">&#10005;</button>
            </div>
        `;
        })
        .join('');

    const ccSelectHtml = allCCs
        .map((cc) => `<option value="${cc.id}">${escapeHtml(cc.code || '-')} - ${escapeHtml(cc.name)}</option>`)
        .join('');

    container.innerHTML = `
        <input type="hidden" id="ca-source-type" value="${sourceType}" />
        <input type="hidden" id="ca-source-id" value="${sourceId}" />
        <div id="ca-rows">${rows}</div>
        <button class="btn btn-sm btn-secondary" style="margin-bottom:8px" id="ca-add-row-btn">
            + ${t('addAllocation') || 'Add Allocation'}
        </button>
        <div style="text-align:right">
            <button class="btn btn-primary" onclick="window.handleSaveCostAllocation()">
                ${t('save') || 'Save'}
            </button>
        </div>
    `;

    // Bind add-row via JS (evita inline script complexo)
    document.getElementById('ca-add-row-btn')?.addEventListener('click', () => {
        const row = document.createElement('div');
        row.className = 'ca-alloc-row';
        row.style.cssText = 'display:flex;gap:6px;margin-bottom:4px;align-items:center';
        row.innerHTML = `
            <select class="ca-cc-select input-sm" style="flex:1">${ccSelectHtml}</select>
            <input class="ca-pct-input input-sm" type="number" min="0" max="100" value="0" style="width:70px" />
            <span style="font-size:0.8rem">%</span>
            <input class="ca-notes-input input-sm" type="text" style="flex:1" placeholder="${t('notes') || 'Notes'}" />
            <button class="btn btn-sm btn-danger" onclick="this.closest('.ca-alloc-row').remove()">&#10005;</button>
        `;
        document.getElementById('ca-rows')?.appendChild(row);
    });
}

// ----------------------------------------------------------------
// STYLES
// ----------------------------------------------------------------

function injectGovernanceStyles() {
    if (document.getElementById('governance-styles')) return;

    const style = document.createElement('style');
    style.id = 'governance-styles';
    style.textContent = `
        .gov-actions { display: flex; gap: 0.4rem; margin-bottom: 0.5rem; flex-wrap: wrap; align-items: center; }
        .gov-template-select { max-width: 180px; font-size: 0.8rem; }
        .gov-empty { text-align: center; padding: 1rem; color: var(--text-secondary); font-size: 0.85rem; }
        .gov-card { margin-bottom: 0.5rem; }
        .gov-card-title { font-weight: 600; }
        .gov-card-body { padding: 0.3rem 0.75rem; font-size: 0.8rem; }
        .gov-card-info { display: flex; gap: 1rem; margin-bottom: 0.2rem; }
        .gov-card-type { font-style: italic; color: var(--text-secondary); }
        .gov-card-financial { display: flex; gap: 0.75rem; }
        .gov-card-actions { display: flex; gap: 0.3rem; padding: 0.3rem 0.75rem 0.4rem; justify-content: flex-end; }
        .gov-badge {
            font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 3px; text-transform: capitalize;
        }
        .gov-status-draft { background: #e0e0e0; }
        .gov-status-active { background: #d9edf7; color: #31708f; }
        .gov-status-completed { background: #dff0d8; color: #3c763d; }
        .gov-status-terminated { background: #f2dede; color: #a94442; }
        .gov-subsection { margin: 0.5rem 0; }
        .gov-subsection-header {
            display: flex; justify-content: space-between; align-items: center;
            font-weight: 600; font-size: 0.85rem; margin-bottom: 0.3rem;
        }
        .gov-party-row {
            display: flex; gap: 0.3rem; margin-bottom: 0.3rem; align-items: center;
        }
        .gov-party-row select { max-width: 110px; }
        .gov-party-row input { flex: 1; }
        .form-row { display: flex; gap: 0.5rem; }
        .form-row .form-group { flex: 1; }
        .wbs-tree { margin: 0.3rem 0; }
        .wbs-node {
            border: 1px solid var(--border-color, #eee); border-radius: 4px;
            margin-bottom: 0.3rem; padding: 0.4rem 0.5rem;
        }
        .wbs-node-header { display: flex; align-items: center; gap: 0.4rem; }
        .wbs-code { font-weight: 700; font-size: 0.8rem; color: var(--accent, #3b6bff); min-width: 2rem; }
        .wbs-name { flex: 1; font-size: 0.85rem; }
        .wbs-delete-btn { padding: 0 0.3rem; font-size: 0.7rem; }
        .wbs-progress-bar {
            height: 6px; background: var(--bg-tertiary, #eee);
            border-radius: 3px; margin: 0.2rem 0; position: relative; overflow: visible;
        }
        .wbs-progress-fill {
            height: 100%; background: var(--accent, #3b6bff); border-radius: 3px;
            transition: width 0.3s;
        }
        .wbs-progress-label {
            position: absolute; right: 0; top: -0.1rem; font-size: 0.65rem;
            color: var(--text-secondary);
        }
        .wbs-node-fields {
            display: flex; gap: 0.4rem; align-items: center; margin-top: 0.2rem; font-size: 0.8rem;
        }
        .wbs-node-fields label { display: flex; align-items: center; gap: 0.2rem; }
        .wbs-field-input { width: 70px; font-size: 0.8rem; padding: 0.1rem 0.3rem; }

        /* Disbursement rows */
        .gov-disbursement-card {
            margin-bottom: 0.4rem; border: 1px solid var(--border-color, #eee);
            border-radius: 4px; padding: 0.4rem;
        }
        .gov-disbursement-row1, .gov-disbursement-row2 {
            display: flex; gap: 0.3rem; align-items: center;
        }
        .gov-disbursement-row2 { margin-top: 0.3rem; }
        .gov-disbursement-row1 input[type="date"] { max-width: 140px; }
        .gov-disbursement-row1 input[type="number"] { max-width: 100px; }
        .gov-disbursement-row1 select { max-width: 110px; }
        .gov-disbursement-row2 input[type="text"] { flex: 1; }
        .gov-evidence-select { max-width: 200px; }

        /* Evidence badges */
        .gov-evidence-badge {
            font-size: 0.7rem; padding: 0.1rem 0.4rem;
            border-radius: 3px; white-space: nowrap;
        }
        .gov-evidence-pending { background: #fef3cd; color: #856404; }
        .gov-evidence-delivered { background: #d4edda; color: #155724; }
        .gov-card-evidence { font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.2rem; }

        /* Dark theme — governance badges */
        [data-theme="dark"] .gov-status-draft { background: #3a3a4e; color: #b0b0c0; }
        [data-theme="dark"] .gov-status-active { background: #1a3a5c; color: #7cb9e8; }
        [data-theme="dark"] .gov-status-completed { background: #1a3c1a; color: #7cd47c; }
        [data-theme="dark"] .gov-status-terminated { background: #3c1a1a; color: #d47c7c; }
        [data-theme="dark"] .gov-evidence-pending { background: #3d3520; color: #f0c040; }
        [data-theme="dark"] .gov-evidence-delivered { background: #1a3c1a; color: #7cd47c; }
        [data-theme="dark"] .gov-disbursement-card { border-color: var(--border-color, #444); }
    `;
    document.head.appendChild(style);
}

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

export function formatCurrency(value) {
    return (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function _getProjectResourceCount(projectId) {
    const allocs = getAllocations();
    const resourceIds = new Set(allocs.filter((a) => a.projectId === projectId).map((a) => a.resourceId));
    return resourceIds.size;
}

function contractTypeLabel(type) {
    const labels = {
        remediation: 'Remediation',
        monitoring: 'Monitoring',
        investigation: 'Investigation',
        insurance: t('insuranceContracts') || 'Insurance',
        custom: 'Custom',
    };
    return labels[type] || type;
}

// ----------------------------------------------------------------
// WBS DATA MODAL — Tabela editavel consolidada para Curva S
// ----------------------------------------------------------------

/**
 * Render the WBS data table modal.
 * Renderiza modal com tabela editavel dos itens folha da EAP.
 */
export function renderWbsDataModal() {
    const content = document.getElementById('wbs-data-modal-content');
    if (!content) return;

    const items = getWbsItems();
    const parentIds = new Set(items.filter((i) => i.parentId).map((i) => i.parentId));
    const leaves = items.filter((i) => !parentIds.has(i.id));

    content.innerHTML = `
        <div class="wbs-data-modal-header">
            <h3 id="wbs-data-modal-title">${escapeHtml(t('wbsDataTitle') || 'WBS Data — S-Curve Inputs')}</h3>
            <button class="btn btn-sm" onclick="handleCloseWbsDataModal()">&times;</button>
        </div>
        <div class="wbs-data-modal-body">
            ${
                leaves.length === 0
                    ? '<p class="wbs-data-empty">' +
                      escapeHtml(t('wbsDataEmpty') || 'No leaf WBS items found.') +
                      '</p>'
                    : _buildWbsDataTable(leaves)
            }
        </div>
        <div class="wbs-data-modal-footer">
            <button class="btn btn-sm btn-secondary" onclick="handleCloseWbsDataModal()">${escapeHtml(t('cancel') || 'Cancel')}</button>
            <button class="btn btn-sm btn-primary" onclick="handleSaveWbsDataModal()">${escapeHtml(t('save') || 'Save')}</button>
        </div>`;
}

/**
 * Build WBS data table HTML.
 * Constroi tabela HTML com headers e linhas de itens folha.
 * @param {Array} leaves
 * @returns {string}
 */
function _buildWbsDataTable(leaves) {
    const headers = [
        'Code',
        'Name',
        'B.Cost',
        'B.Start',
        'B.End',
        'B.Weight',
        'P.Cost',
        'P.Start',
        'P.End',
        'A.Cost',
        'A.Start',
        'A.End',
        '% Done',
        'Status',
    ];
    const ths = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
    const rows = leaves.map((item) => _buildWbsDataRow(item)).join('');

    return `<table class="wbs-data-table" role="grid">
        <thead><tr>${ths}</tr></thead>
        <tbody>${rows}</tbody>
    </table>`;
}

/**
 * Build a single WBS data row.
 * Constroi uma linha editavel para um item WBS folha.
 * @param {Object} item
 * @returns {string}
 */
function _buildWbsDataRow(item) {
    const num = (field, value, extra = '') =>
        `<input type="number" data-field="${escapeAttr(field)}" value="${escapeAttr(String(value || 0))}" ${extra}>`;
    const date = (field, value) =>
        `<input type="date" data-field="${escapeAttr(field)}" value="${escapeAttr(value || '')}">`;

    const statuses = ['not_started', 'in_progress', 'completed', 'delayed'];
    const sel = `<select data-field="status">${statuses
        .map(
            (s) =>
                `<option value="${escapeAttr(s)}" ${item.status === s ? 'selected' : ''}>${escapeHtml(s.replace(/_/g, ' '))}</option>`,
        )
        .join('')}</select>`;

    return `<tr data-wbs-id="${escapeAttr(item.id)}">
        <td><input type="text" data-field="code" value="${escapeAttr(item.code)}" readonly tabindex="-1"></td>
        <td><input type="text" data-field="name" value="${escapeAttr(item.name)}"></td>
        <td>${num('baseline.cost', item.baseline?.cost, 'step="100"')}</td>
        <td>${date('baseline.startDate', item.baseline?.startDate)}</td>
        <td>${date('baseline.endDate', item.baseline?.endDate)}</td>
        <td>${num('baseline.weight', item.baseline?.weight, 'step="1"')}</td>
        <td>${num('planned.cost', item.planned?.cost, 'step="100"')}</td>
        <td>${date('planned.startDate', item.planned?.startDate)}</td>
        <td>${date('planned.endDate', item.planned?.endDate)}</td>
        <td>${num('actual.cost', item.actual?.cost, 'step="100"')}</td>
        <td>${date('actual.startDate', item.actual?.startDate)}</td>
        <td>${date('actual.endDate', item.actual?.endDate)}</td>
        <td>${num('actual.percentComplete', item.actual?.percentComplete, 'min="0" max="100" step="1"')}</td>
        <td>${sel}</td>
    </tr>`;
}
