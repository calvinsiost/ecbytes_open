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
   PROJECT REGISTRY HANDLERS — User actions for projects, resources, allocations
   Acoes do usuario para registro de projetos, equipe e alocacao

   FUNCIONALIDADES:
   - CRUD de projetos e fases (com milestones e dependencias)
   - Abertura de Gantt chart (modal)
   - CRUD de recursos com LGPD compliance
   - Alocacao de recursos a fases
   - Load view com granularidade configuravel
   ================================================================ */

import {
    addProject,
    updateProject,
    removeProject,
    getProjects,
    getProject,
    addPhase,
    updatePhase,
    removePhase,
    addPhaseDependency,
    removePhaseDependency,
    linkContract,
    unlinkContract,
    linkWbsRoot,
    unlinkWbsRoot,
    linkMacMeasure,
    unlinkMacMeasure,
    linkCampaign,
    unlinkCampaign,
    linkElement,
    unlinkElement,
    addResource,
    updateResource,
    removeResource,
    getResources,
    getResource,
    anonymizeResource,
    withdrawConsent,
    addAllocation,
    updateAllocation,
    removeAllocation,
    getProjectProgress,
    addTimesheetEntry,
    updateTimesheetEntry,
    removeTimesheetEntry,
    getTimesheetByProject,
    getTimesheetSummary,
} from '../governance/projectManager.js';

import { renderProjectGantt } from '../ui/ganttRenderer.js';
import { renderLoadGrid, renderAllocationForecast, destroyForecastChart } from '../ui/loadRenderer.js';
import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';
import { openModal, closeModal } from '../ui/modals.js';
import { escapeHtml, escapeAttr } from '../helpers/html.js';
import { asyncConfirm } from '../ui/asyncDialogs.js';
import { getContracts } from '../governance/contractManager.js';
import { getWbsItems } from '../governance/wbsManager.js';

// ----------------------------------------------------------------
// MODULE STATE
// ----------------------------------------------------------------

let updateAllUIRef = null;
let editingProjectId = null;
let editingResourceId = null;
let _currentLoadGranularity = 'week';
let _currentLoadProjectId = null;
let _currentTimesheetProjectId = null;
let _timesheetFilters = {};
let _editingTimesheetEntryId = null;
let _editingTimesheetDraft = {};
let _timesheetFormDraft = {};
let _timesheetCalendarMonth = '';

/**
 * Inject updateAllUI reference.
 * @param {Function} fn
 */
export function setProjectRegistryUpdateAllUI(fn) {
    updateAllUIRef = fn;
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('timesheets-changed', (event) => {
        if (!_currentTimesheetProjectId) return;
        const detail = event?.detail || {};
        if (detail.reason === 'project_removed' && detail.projectId === _currentTimesheetProjectId) {
            handleCloseProjectTimesheet();
            showToast(t('timesheetConflict') || 'Entry was removed by another operation', 'warning');
            return;
        }
        _renderProjectTimesheetModal(_currentTimesheetProjectId);
    });
}

// ----------------------------------------------------------------
// PROJECT HANDLERS
// ----------------------------------------------------------------

function handleAddProject() {
    const project = addProject({
        name: t('newProject') || 'New Project',
        type: 'custom',
        status: 'planning',
    });

    if (updateAllUIRef) updateAllUIRef();
    showToast(`${t('projectAdded') || 'Project added'}: ${project.name}`, 'success');
}

function handleEditProject(id) {
    editingProjectId = id;
    _renderProjectForm(id);
    openModal('project-edit-modal');
}

function handleRemoveProject(id) {
    const project = getProject(id);
    if (!project) return;

    removeProject(id);
    if (updateAllUIRef) updateAllUIRef();
    showToast(t('projectRemoved') || 'Project removed', 'info');
}

function handleSaveProject() {
    if (!editingProjectId) return;

    const name = document.getElementById('project-name')?.value || '';
    const type = document.getElementById('project-type')?.value || 'custom';
    const status = document.getElementById('project-status')?.value || 'planning';
    const description = document.getElementById('project-description')?.value || '';
    const startDate = document.getElementById('project-start-date')?.value || '';
    const endDate = document.getElementById('project-end-date')?.value || '';
    const notes = document.getElementById('project-notes')?.value || '';
    const dailyTargetRaw = parseFloat(document.getElementById('project-timesheet-daily-target')?.value || '');
    const timesheetDailyTargetHours = Number.isFinite(dailyTargetRaw) && dailyTargetRaw > 0 ? dailyTargetRaw : 8;

    updateProject(editingProjectId, {
        name,
        type,
        status,
        description,
        notes,
        dates: { startDate, endDate },
        timesheetDailyTargetHours,
    });

    closeModal('project-edit-modal');
    if (updateAllUIRef) updateAllUIRef();
    showToast(t('projectSaved') || 'Project saved', 'success');
}

// ----------------------------------------------------------------
// PHASE HANDLERS
// ----------------------------------------------------------------

function handleAddProjectPhase(projectId) {
    const phase = addPhase(projectId, {
        name: t('newPhase') || 'New Phase',
    });
    if (phase) {
        if (editingProjectId === projectId) _renderProjectForm(projectId);
        showToast(t('phaseAdded') || 'Phase added', 'success');
    }
}

function handleAddProjectMilestone(projectId) {
    const project = getProject(projectId);
    if (!project) return;

    const today = new Date().toISOString().slice(0, 10);
    const phase = addPhase(projectId, {
        name: t('newMilestone') || 'Milestone',
        isMilestone: true,
        startDate: today,
        endDate: today,
    });

    if (phase && editingProjectId === projectId) {
        _renderProjectForm(projectId);
    }
}

function handleUpdateProjectPhase(projectId, phaseId, field, value) {
    const parsed = field === 'percentComplete' ? parseFloat(value) || 0 : value;
    updatePhase(projectId, phaseId, { [field]: parsed });
    if (updateAllUIRef) updateAllUIRef();
}

function handleRemoveProjectPhase(projectId, phaseId) {
    removePhase(projectId, phaseId);
    if (editingProjectId === projectId) _renderProjectForm(projectId);
    showToast(t('phaseRemoved') || 'Phase removed', 'info');
}

// ----------------------------------------------------------------
// DEPENDENCY HANDLERS
// ----------------------------------------------------------------

function handleAddPhaseDependency(projectId, phaseId, depPhaseId) {
    const result = addPhaseDependency(projectId, phaseId, depPhaseId);
    if (!result.ok) {
        const msgs = {
            cycle_detected: t('depCycleError') || 'Cannot add: creates a cycle',
            self_dependency: t('depSelfError') || 'Cannot depend on itself',
            duplicate: t('depDuplicate') || 'Dependency already exists',
            phase_not_found: t('depPhaseNotFound') || 'Phase not found',
            project_not_found: t('depProjectNotFound') || 'Project not found',
        };
        showToast(msgs[result.error] || result.error, 'error');
        return;
    }
    if (editingProjectId === projectId) _renderProjectForm(projectId);
}

function handleRemovePhaseDependency(projectId, phaseId, depPhaseId) {
    removePhaseDependency(projectId, phaseId, depPhaseId);
    if (editingProjectId === projectId) _renderProjectForm(projectId);
}

// ----------------------------------------------------------------
// GANTT HANDLERS
// ----------------------------------------------------------------

function handleOpenProjectGantt(projectId) {
    openModal('project-gantt-modal');
    requestAnimationFrame(() => {
        renderProjectGantt(projectId);
    });
}

function handleCloseProjectGantt() {
    closeModal('project-gantt-modal');
}

// ----------------------------------------------------------------
// LINK HANDLERS
// ----------------------------------------------------------------

function handleLinkContractToProject(projectId, contractId) {
    linkContract(projectId, contractId);
    if (updateAllUIRef) updateAllUIRef();
}

function handleUnlinkContractFromProject(projectId, contractId) {
    unlinkContract(projectId, contractId);
    if (updateAllUIRef) updateAllUIRef();
}

function handleLinkWbsToProject(projectId, wbsId) {
    linkWbsRoot(projectId, wbsId);
    if (updateAllUIRef) updateAllUIRef();
}

function handleLinkMacToProject(projectId, measureId) {
    linkMacMeasure(projectId, measureId);
    if (updateAllUIRef) updateAllUIRef();
}

function handleLinkCampaignToProject(projectId, campaignId) {
    linkCampaign(projectId, campaignId);
    if (updateAllUIRef) updateAllUIRef();
}

function handleUnlinkCampaignFromProject(projectId, campaignId) {
    unlinkCampaign(projectId, campaignId);
    if (updateAllUIRef) updateAllUIRef();
}

// ----------------------------------------------------------------
// RESOURCE HANDLERS (LGPD)
// ----------------------------------------------------------------

function handleAddResource() {
    editingResourceId = null;
    _renderResourceForm(null);
    openModal('resource-edit-modal');
}

function handleEditResource(id) {
    editingResourceId = id;
    _renderResourceForm(id);
    openModal('resource-edit-modal');
}

function handleRemoveResource(id) {
    removeResource(id);
    if (updateAllUIRef) updateAllUIRef();
    showToast(t('resourceRemoved') || 'Resource removed', 'info');
}

function handleSaveResource() {
    const name = document.getElementById('resource-name')?.value || '';
    const role = document.getElementById('resource-role')?.value || '';
    const level = document.getElementById('resource-level')?.value || 'mid';
    const email = document.getElementById('resource-email')?.value || '';
    const hoursPerWeek = parseFloat(document.getElementById('resource-hours')?.value) || 40;
    const costPerHour = parseFloat(document.getElementById('resource-cost')?.value) || 0;
    const consentGiven = document.getElementById('resource-consent')?.checked || false;

    if (!consentGiven) {
        showToast(t('lgpdConsentRequired') || 'LGPD: Consent is required to store personal data', 'error');
        return;
    }

    if (editingResourceId) {
        updateResource(editingResourceId, { name, role, level, email, hoursPerWeek, costPerHour, consentGiven });
    } else {
        addResource({ name, role, level, email, hoursPerWeek, costPerHour, consentGiven });
    }

    closeModal('resource-edit-modal');
    if (updateAllUIRef) updateAllUIRef();
    showToast(t('resourceSaved') || 'Resource saved', 'success');
}

function handleAnonymizeResource(id) {
    anonymizeResource(id);
    if (updateAllUIRef) updateAllUIRef();
    showToast(t('resourceAnonymized') || 'Resource data anonymized (LGPD)', 'info');
}

function handleWithdrawResourceConsent(id) {
    withdrawConsent(id);
    if (updateAllUIRef) updateAllUIRef();
    showToast(t('consentWithdrawn') || 'Consent withdrawn — data anonymized', 'info');
}

// ----------------------------------------------------------------
// ALLOCATION HANDLERS
// ----------------------------------------------------------------

function handleAddAllocation(projectId, phaseId) {
    const resources = getResources().filter((r) => r.active && r.consentGiven);
    if (resources.length === 0) {
        showToast(t('noActiveResources') || 'No active resources available. Add resources first.', 'error');
        return;
    }

    // Aloca o primeiro recurso disponivel por padrao
    addAllocation({
        resourceId: resources[0].id,
        projectId,
        phaseId,
    });

    if (editingProjectId === projectId) _renderProjectForm(projectId);
    showToast(t('allocationAdded') || 'Allocation added', 'success');
}

function handleUpdateAllocation(allocId, field, value) {
    const parsed = field === 'hoursPerDay' ? parseFloat(value) || 0 : value;
    updateAllocation(allocId, { [field]: parsed });
    if (updateAllUIRef) updateAllUIRef();
}

function handleRemoveAllocation(allocId) {
    removeAllocation(allocId);
    if (updateAllUIRef) updateAllUIRef();
}

// ----------------------------------------------------------------
// LOAD VIEW HANDLERS
// ----------------------------------------------------------------

function handleOpenProjectLoad(projectId) {
    _currentLoadProjectId = projectId;
    openModal('project-load-modal');
    requestAnimationFrame(() => {
        renderLoadGrid(projectId, _currentLoadGranularity);
        renderAllocationForecast(projectId);
    });
}

function handleCloseProjectLoad() {
    destroyForecastChart();
    closeModal('project-load-modal');
    _currentLoadProjectId = null;
}

function handleSetLoadGranularity(granularity) {
    _currentLoadGranularity = granularity;
    if (_currentLoadProjectId) {
        renderLoadGrid(_currentLoadProjectId, granularity);
    }
    // Atualiza botoes ativos
    document.querySelectorAll('.load-gran-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.gran === granularity);
    });
}

// ----------------------------------------------------------------
// TIMESHEET HANDLERS
// ----------------------------------------------------------------

function handleOpenProjectTimesheet(projectId) {
    _currentTimesheetProjectId = projectId;
    _timesheetFilters = _getDefaultTimesheetFilters();
    _editingTimesheetEntryId = null;
    _editingTimesheetDraft = {};
    const today = _getTodayDateString();
    _timesheetFormDraft = { resourceId: '', phaseId: '', date: today, hours: '', notes: '' };
    _timesheetCalendarMonth = today.slice(0, 7);
    openModal('project-timesheet-modal');
    _renderProjectTimesheetModal(projectId);
}

function handleCloseProjectTimesheet() {
    closeModal('project-timesheet-modal');
    _currentTimesheetProjectId = null;
    _editingTimesheetEntryId = null;
    _editingTimesheetDraft = {};
    _timesheetFormDraft = {};
    _timesheetCalendarMonth = '';
}

function handleAddTimesheetEntry(projectId) {
    const resourceId =
        _timesheetFormDraft.resourceId || document.getElementById('timesheet-input-resource')?.value || '';
    const phaseId = _timesheetFormDraft.phaseId || document.getElementById('timesheet-input-phase')?.value || '';
    const date = _timesheetFormDraft.date || document.getElementById('timesheet-input-date')?.value || '';
    const hours = parseFloat(document.getElementById('timesheet-input-hours')?.value || '');
    const notes = document.getElementById('timesheet-input-notes')?.value || '';

    const result = addTimesheetEntry({ projectId, resourceId, phaseId, date, hours, notes });
    if (!result.ok) {
        showToast(_translateTimesheetError(result.code), 'error');
        return;
    }

    const hoursInput = document.getElementById('timesheet-input-hours');
    const notesInput = document.getElementById('timesheet-input-notes');
    if (hoursInput) hoursInput.value = '';
    if (notesInput) notesInput.value = '';
    _timesheetFormDraft = { ..._timesheetFormDraft, resourceId, phaseId, date, hours: '', notes: '' };
    if (date) _timesheetCalendarMonth = date.slice(0, 7);

    showToast(t('timesheetAddSuccess') || 'Entry added', 'success');
    _renderProjectTimesheetModal(projectId);
}

function handleUpdateTimesheetEntry(entryId, field, value) {
    if (_editingTimesheetEntryId !== entryId) {
        _editingTimesheetEntryId = entryId;
        _editingTimesheetDraft = {};
    }
    _editingTimesheetDraft[field] = value;
}

function handleEditTimesheetEntry(entryId) {
    _editingTimesheetEntryId = entryId;
    _editingTimesheetDraft = {};
    if (_currentTimesheetProjectId) _renderProjectTimesheetModal(_currentTimesheetProjectId);
}

function handleCancelTimesheetEdit() {
    _editingTimesheetEntryId = null;
    _editingTimesheetDraft = {};
    if (_currentTimesheetProjectId) _renderProjectTimesheetModal(_currentTimesheetProjectId);
}

function handleSaveTimesheetEntry(entryId) {
    if (!_currentTimesheetProjectId) return;
    const payload = { ..._editingTimesheetDraft };
    if (Object.prototype.hasOwnProperty.call(payload, 'hours')) {
        payload.hours = parseFloat(payload.hours);
    }

    const result = updateTimesheetEntry(entryId, payload);
    if (!result.ok) {
        showToast(_translateTimesheetError(result.code), 'error');
        if (result.code === 'ENTRY_NOT_FOUND') {
            _editingTimesheetEntryId = null;
            _editingTimesheetDraft = {};
        }
        _renderProjectTimesheetModal(_currentTimesheetProjectId);
        return;
    }

    _editingTimesheetEntryId = null;
    _editingTimesheetDraft = {};
    showToast(t('timesheetUpdateSuccess') || 'Entry updated', 'success');
    _renderProjectTimesheetModal(_currentTimesheetProjectId);
}

async function handleRemoveTimesheetEntry(entryId) {
    const confirmed = await asyncConfirm(t('timesheetRemoveConfirm') || 'Remove this entry?');
    if (!confirmed) return;

    const result = removeTimesheetEntry(entryId);
    if (!result.ok) {
        showToast(_translateTimesheetError(result.code), 'error');
        _renderProjectTimesheetModal(_currentTimesheetProjectId);
        return;
    }
    showToast(t('timesheetRemoveSuccess') || 'Entry removed', 'info');
    _renderProjectTimesheetModal(_currentTimesheetProjectId);
}

function handleSetTimesheetFilter(field, value) {
    _timesheetFilters[field] = value || '';
    if (_currentTimesheetProjectId) _renderProjectTimesheetModal(_currentTimesheetProjectId);
}

function handleClearTimesheetFilters() {
    _timesheetFilters = _getDefaultTimesheetFilters();
    if (_currentTimesheetProjectId) _renderProjectTimesheetModal(_currentTimesheetProjectId);
}

function handleSetTimesheetInput(field, value) {
    _timesheetFormDraft[field] = value ?? '';
    if (field === 'date' && value) {
        _timesheetCalendarMonth = String(value).slice(0, 7);
    }
}

function handleShiftTimesheetCalendar(offsetMonths) {
    const source = (_timesheetCalendarMonth || _getTodayDateString().slice(0, 7)) + '-01';
    const ref = new Date(`${source}T00:00:00`);
    ref.setMonth(ref.getMonth() + Number(offsetMonths || 0));
    const year = ref.getFullYear();
    const month = String(ref.getMonth() + 1).padStart(2, '0');
    _timesheetCalendarMonth = `${year}-${month}`;
    if (_currentTimesheetProjectId) _renderProjectTimesheetModal(_currentTimesheetProjectId);
}

function handleSelectTimesheetCalendarDate(date) {
    _timesheetFormDraft.date = date;
    _timesheetCalendarMonth = String(date).slice(0, 7);
    if (_currentTimesheetProjectId) _renderProjectTimesheetModal(_currentTimesheetProjectId);
}

// ----------------------------------------------------------------
// FORM RENDERING — Project
// ----------------------------------------------------------------

function _renderProjectForm(projectId) {
    const container = document.getElementById('project-form-content');
    if (!container) return;

    const project = getProject(projectId);
    if (!project) return;

    const contracts = getContracts();
    const wbsItems = getWbsItems().filter((w) => !w.parentId); // Raizes

    container.innerHTML = `
        <div class="form-group">
            <label class="form-label">${t('projectName') || 'Name'}</label>
            <input type="text" id="project-name" class="form-input" value="${escapeAttr(project.name)}">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('projectType') || 'Type'}</label>
                <select id="project-type" class="form-input">
                    <option value="remediation" ${project.type === 'remediation' ? 'selected' : ''}>${t('projectTypeRemediation') || 'Remediation'}</option>
                    <option value="monitoring" ${project.type === 'monitoring' ? 'selected' : ''}>${t('projectTypeMonitoring') || 'Monitoring'}</option>
                    <option value="investigation" ${project.type === 'investigation' ? 'selected' : ''}>${t('projectTypeInvestigation') || 'Investigation'}</option>
                    <option value="decommissioning" ${project.type === 'decommissioning' ? 'selected' : ''}>${t('projectTypeDecommissioning') || 'Decommissioning'}</option>
                    <option value="custom" ${project.type === 'custom' ? 'selected' : ''}>${t('projectTypeCustom') || 'Custom'}</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">${t('projectStatus') || 'Status'}</label>
                <select id="project-status" class="form-input">
                    <option value="planning" ${project.status === 'planning' ? 'selected' : ''}>${t('statusPlanning') || 'Planning'}</option>
                    <option value="active" ${project.status === 'active' ? 'selected' : ''}>${t('statusActive') || 'Active'}</option>
                    <option value="on_hold" ${project.status === 'on_hold' ? 'selected' : ''}>${t('statusOnHold') || 'On Hold'}</option>
                    <option value="completed" ${project.status === 'completed' ? 'selected' : ''}>${t('statusCompleted') || 'Completed'}</option>
                    <option value="cancelled" ${project.status === 'cancelled' ? 'selected' : ''}>${t('statusCancelled') || 'Cancelled'}</option>
                </select>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('startDate') || 'Start Date'}</label>
                <input type="date" id="project-start-date" class="form-input" value="${project.dates.startDate}">
            </div>
            <div class="form-group">
                <label class="form-label">${t('endDate') || 'End Date'}</label>
                <input type="date" id="project-end-date" class="form-input" value="${project.dates.endDate}">
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">${t('timesheetDailyTargetProject') || 'Daily target hours (Timesheet)'}</label>
            <input type="number" id="project-timesheet-daily-target" class="form-input" min="0.25" step="0.25" value="${Number.isFinite(Number(project.timesheetDailyTargetHours)) && Number(project.timesheetDailyTargetHours) > 0 ? Number(project.timesheetDailyTargetHours) : 8}">
        </div>
        <div class="form-group">
            <label class="form-label">${t('description') || 'Description'}</label>
            <textarea id="project-description" class="form-input" rows="2">${escapeHtml(project.description)}</textarea>
        </div>

        <!-- Phases -->
        <div class="gov-subsection">
            <div class="gov-subsection-header">
                <span>${t('phases') || 'Phases'} (${project.phases.length})</span>
                <div style="display:flex;gap:4px">
                    <button class="btn btn-sm btn-primary" onclick="window.handleAddProjectPhase('${projectId}')">+ ${t('phase') || 'Phase'}</button>
                    <button class="btn btn-sm btn-secondary" onclick="window.handleAddProjectMilestone('${projectId}')">&#9670; ${t('milestone') || 'Milestone'}</button>
                </div>
            </div>
            ${project.phases.map((phase) => _renderPhaseRow(projectId, phase, project.phases)).join('')}
        </div>

        <!-- Link contracts -->
        ${
            contracts.length > 0
                ? `
        <div class="gov-subsection">
            <div class="gov-subsection-header">
                <span>${t('linkContract') || 'Link Contract'}</span>
                <select class="form-input gov-template-select" onchange="if(this.value){window.handleLinkContractToProject('${projectId}',this.value);this.value='';}">
                    <option value="">${t('selectContract') || 'Select...'}</option>
                    ${contracts
                        .filter((c) => !project.linkedContractIds.includes(c.id))
                        .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
                        .join('')}
                </select>
            </div>
            ${project.linkedContractIds
                .map((cid) => {
                    const c = contracts.find((x) => x.id === cid);
                    return c
                        ? `<div class="gov-party-row"><span>${escapeHtml(c.name)}</span>
                    <button class="btn btn-sm btn-danger" onclick="window.handleUnlinkContractFromProject('${projectId}','${cid}')" aria-label="Remove"><span data-icon="x" data-icon-size="12px"></span></button></div>`
                        : '';
                })
                .join('')}
        </div>`
                : ''
        }

        <div class="form-group">
            <label class="form-label">${t('notes') || 'Notes'}</label>
            <textarea id="project-notes" class="form-input" rows="2">${escapeHtml(project.notes)}</textarea>
        </div>
    `;
}

function _renderPhaseRow(projectId, phase, allPhases) {
    const otherPhases = allPhases.filter((p) => p.id !== phase.id);
    const deps = phase.dependencies || [];

    return `
        <div class="wbs-node" style="border-left: 3px solid ${phase.color || '#3b6bff'}">
            <div class="wbs-node-header">
                <span class="wbs-name">${phase.isMilestone ? '&#9670; ' : ''}
                    <input type="text" value="${escapeAttr(phase.name)}" class="form-input" style="width:140px;display:inline;font-size:0.8rem"
                        onchange="window.handleUpdateProjectPhase('${projectId}','${phase.id}','name',this.value)">
                </span>
                <button class="btn btn-sm btn-danger wbs-delete-btn" onclick="window.handleRemoveProjectPhase('${projectId}','${phase.id}')" title="Remove" aria-label="Remove"><span data-icon="x" data-icon-size="12px"></span></button>
            </div>
            <div class="wbs-node-fields">
                <label>${t('start') || 'Start'}:
                    <input type="date" value="${phase.startDate}" class="form-input wbs-field-input" style="width:120px"
                        onchange="window.handleUpdateProjectPhase('${projectId}','${phase.id}','startDate',this.value)">
                </label>
                <label>${t('end') || 'End'}:
                    <input type="date" value="${phase.endDate}" class="form-input wbs-field-input" style="width:120px"
                        onchange="window.handleUpdateProjectPhase('${projectId}','${phase.id}','endDate',this.value)">
                </label>
                ${
                    !phase.isMilestone
                        ? `
                <label>%:
                    <input type="number" min="0" max="100" value="${phase.percentComplete || 0}" class="form-input wbs-field-input" style="width:55px"
                        onchange="window.handleUpdateProjectPhase('${projectId}','${phase.id}','percentComplete',this.value)">
                </label>`
                        : ''
                }
                <label>${t('color') || 'Color'}:
                    <input type="color" value="${phase.color || '#3b6bff'}" style="width:28px;height:22px;padding:0;border:none;cursor:pointer"
                        onchange="window.handleUpdateProjectPhase('${projectId}','${phase.id}','color',this.value)">
                </label>
            </div>
            ${
                otherPhases.length > 0
                    ? `
            <div class="wbs-node-fields" style="margin-top:2px">
                <label>${t('dependsOn') || 'Depends on'}:
                    <select class="form-input" style="font-size:0.75rem;max-width:140px"
                        onchange="if(this.value){window.handleAddPhaseDependency('${projectId}','${phase.id}',this.value);this.value='';}">
                        <option value="">+</option>
                        ${otherPhases
                            .filter((p) => !deps.includes(p.id))
                            .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
                            .join('')}
                    </select>
                </label>
                ${deps
                    .map((depId) => {
                        const dep = allPhases.find((p) => p.id === depId);
                        return dep
                            ? `<span class="gov-badge gov-status-active" style="cursor:pointer" title="${t('removeDep') || 'Click to remove'}"
                        onclick="window.handleRemovePhaseDependency('${projectId}','${phase.id}','${depId}')">
                        ${escapeHtml(dep.name)} &#215;
                    </span>`
                            : '';
                    })
                    .join('')}
            </div>`
                    : ''
            }
        </div>`;
}

// ----------------------------------------------------------------
// FORM RENDERING — Resource
// ----------------------------------------------------------------

function _renderResourceForm(resourceId) {
    const container = document.getElementById('resource-form-content');
    if (!container) return;

    const resource = resourceId ? getResource(resourceId) : null;

    const levels = [
        { key: 'intern', label: t('resourceLevel_intern') || 'Intern' },
        { key: 'trainee', label: t('resourceLevel_trainee') || 'Trainee' },
        { key: 'junior', label: t('resourceLevel_junior') || 'Junior' },
        { key: 'mid', label: t('resourceLevel_mid') || 'Mid-level' },
        { key: 'senior', label: t('resourceLevel_senior') || 'Senior' },
        { key: 'specialist', label: t('resourceLevel_specialist') || 'Specialist' },
        { key: 'coordinator', label: t('resourceLevel_coordinator') || 'Coordinator' },
        { key: 'manager', label: t('resourceLevel_manager') || 'Manager' },
    ];

    container.innerHTML = `
        <div class="form-group">
            <label class="form-label">${t('resourceName') || 'Name'}</label>
            <input type="text" id="resource-name" class="form-input" value="${escapeAttr(resource?.name || '')}">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('resourceRole') || 'Role'}</label>
                <input type="text" id="resource-role" class="form-input" value="${escapeAttr(resource?.role || '')}" placeholder="${t('resourceRolePlaceholder') || 'e.g. Geologist'}">
            </div>
            <div class="form-group">
                <label class="form-label">${t('resourceLevel') || 'Level'}</label>
                <select id="resource-level" class="form-input">
                    ${levels.map((l) => `<option value="${l.key}" ${(resource?.level || 'mid') === l.key ? 'selected' : ''}>${l.label}</option>`).join('')}
                </select>
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">${t('email') || 'Email'}</label>
            <input type="email" id="resource-email" class="form-input" value="${escapeAttr(resource?.email || '')}">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('hoursPerWeek') || 'Hours/Week'}</label>
                <input type="number" id="resource-hours" class="form-input" value="${resource?.hoursPerWeek || 40}" min="1" max="80">
            </div>
            <div class="form-group">
                <label class="form-label">${t('costPerHour') || 'Cost/Hour'}</label>
                <input type="number" id="resource-cost" class="form-input" value="${resource?.costPerHour || 0}" min="0" step="10">
            </div>
        </div>

        <!-- LGPD Consent -->
        <div class="gov-subsection" style="background:var(--bg-tertiary,#f8f9fa);padding:8px;border-radius:4px;margin-top:8px">
            <div style="font-size:0.75rem;color:var(--text-secondary);margin-bottom:6px">
                <strong>LGPD — ${t('lgpdDisclaimer') || 'Lei Geral de Protecao de Dados'}</strong><br>
                ${t('lgpdPurpose') || 'Personal data (name, email) will be stored solely for the purpose of managing resource allocation in environmental projects. You have the right to withdraw consent at any time.'}
            </div>
            <label style="display:flex;align-items:center;gap:6px;font-size:0.8rem;cursor:pointer">
                <input type="checkbox" id="resource-consent" ${resource?.consentGiven ? 'checked' : ''}>
                ${t('lgpdConsentLabel') || 'I consent to the storage of my personal data for this purpose'}
            </label>
        </div>
    `;
}

/**
 * Render timesheet modal content for a project.
 * @param {string} projectId
 */
function _renderProjectTimesheetModal(projectId) {
    const container = document.getElementById('project-timesheet-content');
    if (!container) return;
    _injectTimesheetStyles();

    const project = getProject(projectId);
    if (!project) {
        container.innerHTML = `<div class="gov-empty">${t('loadNoProject') || 'Project not found.'}</div>`;
        return;
    }

    const title = document.getElementById('project-timesheet-title');
    if (title) {
        title.textContent = `${t('projectTimesheetTitle') || 'Timesheet'} — ${project.name || ''}`;
    }

    const resources = getResources().filter((r) => r.active && r.consentGiven);
    const phases = project.phases.filter((p) => !p.isMilestone);
    const entries = getTimesheetByProject(projectId, _timesheetFilters);
    const summary = getTimesheetSummary(projectId, _timesheetFilters);
    const overloads = _computeDailyOverloads(entries);
    const allProjectEntries = getTimesheetByProject(projectId, {});
    const createDisabled = resources.length === 0 || phases.length === 0;

    const today = _getTodayDateString();
    if (!_timesheetFormDraft.date) _timesheetFormDraft.date = today;
    if (!_timesheetFormDraft.resourceId && resources[0]) _timesheetFormDraft.resourceId = resources[0].id;
    if (!_timesheetFormDraft.phaseId && phases[0]) _timesheetFormDraft.phaseId = phases[0].id;
    if (!_timesheetCalendarMonth) _timesheetCalendarMonth = String(_timesheetFormDraft.date || today).slice(0, 7);

    const selectedDate = _timesheetFormDraft.date || today;
    const selectedResource = resources.find((r) => r.id === _timesheetFormDraft.resourceId) || null;
    const dayLoggedHours = allProjectEntries
        .filter(
            (e) =>
                e.date === selectedDate &&
                (!_timesheetFormDraft.resourceId || e.resourceId === _timesheetFormDraft.resourceId),
        )
        .reduce((sum, e) => sum + e.hours, 0);
    const dailyTargetHours = _getProjectDailyTargetHours(project);
    const dailyRemainingHours = Math.max(0, _round2(dailyTargetHours - dayLoggedHours));
    const dailyProgressPercent =
        dailyTargetHours > 0 ? Math.min(100, Math.round((dayLoggedHours / dailyTargetHours) * 100)) : 0;
    const calendar = _buildTimesheetCalendar(projectId, _timesheetCalendarMonth, selectedDate, {
        resourceId: _timesheetFilters.resourceId,
        phaseId: _timesheetFilters.phaseId,
    });

    const warningEntries =
        entries.length > 500
            ? `<div class="gov-badge gov-status-terminated" style="display:inline-block;margin-bottom:8px">${t('timesheetEntryLimitWarning') || 'Project has many entries. Consider exporting.'}</div>`
            : '';

    const overloadWarning =
        overloads.length > 0
            ? `<div class="gov-badge gov-status-terminated" style="display:inline-block;margin-left:8px">${t('timesheetDailyOverloadWarning') || 'Resource with daily sum above 24h detected.'}</div>`
            : '';

    container.innerHTML = `
        ${warningEntries}${overloadWarning}
        <div class="gov-subsection">
            <div class="gov-subsection-header"><span>${t('timesheetCalendar') || 'Calendar'}</span></div>
            <div class="timesheet-calendar-topbar">
                <button class="btn btn-sm btn-secondary" onclick="window.handleShiftTimesheetCalendar(-1)" aria-label="${t('previous') || 'Previous'}">&larr;</button>
                <strong>${escapeHtml(calendar.label)}</strong>
                <button class="btn btn-sm btn-secondary" onclick="window.handleShiftTimesheetCalendar(1)" aria-label="${t('next') || 'Next'}">&rarr;</button>
            </div>
            <div class="timesheet-calendar-weekdays">
                <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
            </div>
            <div class="timesheet-calendar-grid">
                ${calendar.days
                    .map(
                        (day) => `
                    <button class="timesheet-calendar-day ${day.isCurrentMonth ? '' : 'is-outside'} ${day.isToday ? 'is-today' : ''} ${day.isSelected ? 'is-selected' : ''}"
                        onclick="window.handleSelectTimesheetCalendarDate('${day.date}')">
                        <span class="day-num">${day.day}</span>
                        <span class="day-hours">${day.totalHours > 0 ? `${day.totalHours}h` : ''}</span>
                    </button>
                `,
                    )
                    .join('')}
            </div>
            <div class="gov-card-info">
                <span><strong>${t('timesheetDate') || 'Date'}:</strong> ${escapeHtml(selectedDate)} | <strong>${t('timesheetResource') || 'Resource'}:</strong> ${escapeHtml(selectedResource?.name || t('all') || 'All')}</span>
            </div>
            <div class="gov-card-info">
                <span><strong>${t('timesheetDailyTarget') || 'Daily target'}:</strong> ${dailyTargetHours}h | <strong>${t('timesheetDayLogged') || 'Logged'}:</strong> ${_round2(dayLoggedHours)}h (${dailyProgressPercent}%) | <strong>${t('timesheetDayRemaining') || 'Remaining'}:</strong> ${dailyRemainingHours}h</span>
            </div>
        </div>
        <div class="gov-subsection">
            <div class="gov-subsection-header"><span>${t('timesheetFilterApply') || 'Apply'} / ${t('timesheetFilterClear') || 'Clear filters'}</span></div>
            <div class="gov-party-row" style="flex-wrap:wrap">
                <input type="date" class="form-input" value="${escapeAttr(_timesheetFilters.startDate || '')}"
                    onchange="window.handleSetTimesheetFilter('startDate', this.value)" title="${t('timesheetFilterStartDate') || 'Start date'}">
                <input type="date" class="form-input" value="${escapeAttr(_timesheetFilters.endDate || '')}"
                    onchange="window.handleSetTimesheetFilter('endDate', this.value)" title="${t('timesheetFilterEndDate') || 'End date'}">
                <select class="form-input" onchange="window.handleSetTimesheetFilter('resourceId', this.value)">
                    <option value="">${t('timesheetResource') || 'Resource'}: *</option>
                    ${resources.map((r) => `<option value="${r.id}" ${_timesheetFilters.resourceId === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('')}
                </select>
                <select class="form-input" onchange="window.handleSetTimesheetFilter('phaseId', this.value)">
                    <option value="">${t('timesheetPhase') || 'Phase'}: *</option>
                    ${phases.map((p) => `<option value="${p.id}" ${_timesheetFilters.phaseId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                </select>
                <button class="btn btn-sm btn-secondary" onclick="window.handleClearTimesheetFilters()">${t('timesheetFilterClear') || 'Clear filters'}</button>
            </div>
        </div>

        <div class="gov-subsection">
            <div class="gov-subsection-header"><span>${t('timesheetAdd') || 'Add'}</span></div>
            ${
                createDisabled
                    ? `<div class="gov-empty">${t('timesheetNoEligibleResources') || 'No active eligible resources available'}</div>`
                    : `
                <div class="gov-party-row" style="flex-wrap:wrap">
                    <select class="form-input" id="timesheet-input-resource" onchange="window.handleSetTimesheetInput('resourceId', this.value)">
                        ${resources.map((r) => `<option value="${r.id}" ${_timesheetFormDraft.resourceId === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('')}
                    </select>
                    <select class="form-input" id="timesheet-input-phase" onchange="window.handleSetTimesheetInput('phaseId', this.value)">
                        ${phases.map((p) => `<option value="${p.id}" ${_timesheetFormDraft.phaseId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                    </select>
                    <input type="date" class="form-input" id="timesheet-input-date" value="${escapeAttr(selectedDate)}" onchange="window.handleSetTimesheetInput('date', this.value)">
                    <input type="number" class="form-input" id="timesheet-input-hours" min="0.25" max="24" step="0.25" placeholder="${t('timesheetHours') || 'Hours'}" value="${escapeAttr(String(_timesheetFormDraft.hours || ''))}" onchange="window.handleSetTimesheetInput('hours', this.value)">
                    <input type="text" class="form-input" id="timesheet-input-notes" maxlength="500" placeholder="${t('timesheetNotes') || 'Notes'}" value="${escapeAttr(_timesheetFormDraft.notes || '')}" onchange="window.handleSetTimesheetInput('notes', this.value)">
                    <button class="btn btn-sm btn-primary" onclick="window.handleAddTimesheetEntry('${projectId}')">${t('timesheetAdd') || 'Add'}</button>
                </div>
            `
            }
        </div>

        <div class="gov-subsection">
            <div class="gov-subsection-header"><span>${t('timesheetTotalHours') || 'Total hours'}: ${summary.totalHours}h | ${t('timesheetEntryCount') || 'Entries'}: ${summary.entryCount}</span></div>
            <div class="gov-card-info">
                <span><strong>${t('timesheetByResource') || 'By resource'}:</strong> ${summary.byResource.map((r) => `${escapeHtml(r.name)} (${r.hours}h)`).join(', ') || '-'}</span>
            </div>
            <div class="gov-card-info">
                <span><strong>${t('timesheetByPhase') || 'By phase'}:</strong> ${summary.byPhase.map((p) => `${escapeHtml(p.name)} (${p.hours}h)`).join(', ') || '-'}</span>
            </div>
        </div>

        <div class="gov-subsection">
            <div class="gov-subsection-header"><span>${t('timesheetEntryCount') || 'Entries'} (${entries.length})</span></div>
            <div class="timesheet-table-wrap">
                <table class="timesheet-table">
                    <thead>
                        <tr>
                            <th>${t('timesheetDate') || 'Date'}</th>
                            <th>${t('timesheetResource') || 'Resource'}</th>
                            <th>${t('timesheetPhase') || 'Phase'}</th>
                            <th>${t('timesheetHours') || 'Hours'}</th>
                            <th>${t('timesheetNotes') || 'Notes'}</th>
                            <th>${t('actions') || 'Actions'}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${entries.map((entry) => _renderTimesheetRow(entry, resources, phases)).join('') || `<tr><td colspan="6" class="gov-empty">-</td></tr>`}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function _renderTimesheetRow(entry, resources, phases) {
    const isEditing = _editingTimesheetEntryId === entry.id;
    const draft = isEditing ? { ...entry, ..._editingTimesheetDraft } : entry;
    const resourceName = resources.find((r) => r.id === entry.resourceId)?.name || entry.resourceId;
    const phaseName = phases.find((p) => p.id === entry.phaseId)?.name || entry.phaseId;

    if (!isEditing) {
        return `
            <tr>
                <td>${escapeHtml(entry.date)}</td>
                <td>${escapeHtml(resourceName)}</td>
                <td>${escapeHtml(phaseName)}</td>
                <td>${entry.hours}</td>
                <td>${escapeHtml(entry.notes || '')}</td>
                <td>
                    <button class="btn btn-sm btn-secondary" onclick="window.handleEditTimesheetEntry('${entry.id}')">${t('timesheetEdit') || 'Edit'}</button>
                    <button class="btn btn-sm btn-danger" onclick="window.handleRemoveTimesheetEntry('${entry.id}')">${t('timesheetRemove') || 'Remove'}</button>
                </td>
            </tr>`;
    }

    return `
        <tr>
            <td><input type="date" class="form-input" value="${escapeAttr(draft.date || '')}" onchange="window.handleUpdateTimesheetEntry('${entry.id}', 'date', this.value)"></td>
            <td>
                <select class="form-input" onchange="window.handleUpdateTimesheetEntry('${entry.id}', 'resourceId', this.value)">
                    ${resources.map((r) => `<option value="${r.id}" ${draft.resourceId === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('')}
                </select>
            </td>
            <td>
                <select class="form-input" onchange="window.handleUpdateTimesheetEntry('${entry.id}', 'phaseId', this.value)">
                    ${phases.map((p) => `<option value="${p.id}" ${draft.phaseId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                </select>
            </td>
            <td><input type="number" class="form-input" min="0.25" max="24" step="0.25" value="${draft.hours}" onchange="window.handleUpdateTimesheetEntry('${entry.id}', 'hours', this.value)"></td>
            <td><input type="text" class="form-input" maxlength="500" value="${escapeAttr(draft.notes || '')}" onchange="window.handleUpdateTimesheetEntry('${entry.id}', 'notes', this.value)"></td>
            <td>
                <button class="btn btn-sm btn-primary" onclick="window.handleSaveTimesheetEntry('${entry.id}')">${t('timesheetSave') || 'Save'}</button>
                <button class="btn btn-sm btn-secondary" onclick="window.handleCancelTimesheetEdit()">${t('timesheetCancel') || 'Cancel'}</button>
            </td>
        </tr>`;
}

function _computeDailyOverloads(entries) {
    const map = new Map();
    for (const e of entries) {
        const key = `${e.resourceId}|${e.date}`;
        map.set(key, (map.get(key) || 0) + e.hours);
    }
    return [...map.entries()].filter(([, hours]) => hours > 24);
}

function _getTodayDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function _round2(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function _getProjectDailyTargetHours(project) {
    const parsed = Number(project?.timesheetDailyTargetHours);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 8;
}

function _buildTimesheetCalendar(projectId, monthIso, selectedDate, filters = {}) {
    const safeMonth = /^\d{4}-\d{2}$/.test(monthIso || '') ? monthIso : _getTodayDateString().slice(0, 7);
    const year = Number(safeMonth.slice(0, 4));
    const monthIndex = Number(safeMonth.slice(5, 7)) - 1;
    const firstDay = new Date(year, monthIndex, 1);
    const lastDay = new Date(year, monthIndex + 1, 0);
    const monthStart = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
    const monthEnd = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;
    const filtered = getTimesheetByProject(projectId, {
        startDate: monthStart,
        endDate: monthEnd,
        resourceId: filters.resourceId || '',
        phaseId: filters.phaseId || '',
    });

    const totalsByDate = new Map();
    for (const entry of filtered) {
        totalsByDate.set(entry.date, _round2((totalsByDate.get(entry.date) || 0) + entry.hours));
    }

    const mondayIndex = (firstDay.getDay() + 6) % 7;
    const daysInMonth = lastDay.getDate();
    const days = [];
    const today = _getTodayDateString();

    for (let i = 0; i < 42; i += 1) {
        const relativeDay = i - mondayIndex + 1;
        const date = new Date(year, monthIndex, relativeDay);
        const dateIso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const isCurrentMonth = relativeDay >= 1 && relativeDay <= daysInMonth;
        days.push({
            date: dateIso,
            day: date.getDate(),
            isCurrentMonth,
            isToday: dateIso === today,
            isSelected: dateIso === selectedDate,
            totalHours: totalsByDate.get(dateIso) || 0,
        });
    }

    const label = firstDay.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    return { label, days };
}

function _getDefaultTimesheetFilters() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
        startDate: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
        endDate: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`,
        resourceId: '',
        phaseId: '',
    };
}

function _translateTimesheetError(code) {
    const map = {
        INVALID_PROJECT: t('timesheetErrorInvalidProject') || 'Invalid project',
        INVALID_PHASE: t('timesheetErrorInvalidPhase') || 'Invalid phase',
        PHASE_PROJECT_MISMATCH: t('timesheetErrorPhaseProjectMismatch') || 'Phase does not belong to project',
        INVALID_RESOURCE: t('timesheetErrorInvalidResource') || 'Invalid resource',
        MILESTONE_NOT_ALLOWED: t('timesheetErrorMilestoneNotAllowed') || 'Cannot log hours on milestone',
        INVALID_DATE_FORMAT: t('timesheetErrorInvalidDateFormat') || 'Invalid date format',
        INVALID_DATE: t('timesheetErrorInvalidDate') || 'Invalid date',
        DATE_OUT_OF_RANGE: t('timesheetErrorDateOutOfRange') || 'Date outside phase/project range',
        INVALID_HOURS: t('timesheetErrorInvalidHours') || 'Invalid hours',
        HOURS_NOT_POSITIVE: t('timesheetErrorHoursNotPositive') || 'Hours must be greater than zero',
        HOURS_EXCEEDS_MAX: t('timesheetErrorHoursExceedsMax') || 'Maximum 24 hours per entry',
        HOURS_NOT_QUARTER: t('timesheetErrorHoursNotQuarter') || 'Hours must be a multiple of 0.25',
        ENTRY_NOT_FOUND: t('timesheetConflict') || 'Entry was removed by another operation',
    };
    return map[code] || code || t('timesheetErrorInvalidHours') || 'Invalid entry';
}

function _injectTimesheetStyles() {
    if (document.getElementById('timesheet-styles')) return;

    const style = document.createElement('style');
    style.id = 'timesheet-styles';
    style.textContent = `
        .timesheet-calendar-topbar { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; }
        .timesheet-calendar-weekdays { display:grid; grid-template-columns:repeat(7, minmax(0, 1fr)); gap:4px; margin-bottom:4px; font-size:0.7rem; color:var(--text-secondary,#666); text-align:center; }
        .timesheet-calendar-grid { display:grid; grid-template-columns:repeat(7, minmax(0, 1fr)); gap:4px; margin-bottom:8px; }
        .timesheet-calendar-day { border:1px solid var(--border-color,#e6e6e6); border-radius:6px; background:var(--bg-primary,#fff); padding:6px 4px; min-height:56px; display:flex; flex-direction:column; align-items:flex-start; gap:4px; cursor:pointer; }
        .timesheet-calendar-day .day-num { font-size:0.75rem; font-weight:600; }
        .timesheet-calendar-day .day-hours { font-size:0.7rem; color:var(--text-secondary,#666); }
        .timesheet-calendar-day.is-outside { opacity:0.45; }
        .timesheet-calendar-day.is-today { border-color:var(--warning-color,#d48806); }
        .timesheet-calendar-day.is-selected { outline:2px solid var(--primary-color,#3b6bff); }
        .timesheet-table-wrap { overflow: auto; max-height: 360px; border: 1px solid var(--border-color, #e6e6e6); border-radius: 4px; }
        .timesheet-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
        .timesheet-table th, .timesheet-table td { border-bottom: 1px solid var(--border-color, #eee); padding: 6px; vertical-align: middle; }
        .timesheet-table thead th { position: sticky; top: 0; background: var(--bg-primary, #fff); z-index: 1; }
        .timesheet-table td input, .timesheet-table td select { min-width: 100px; }
    `;
    document.head.appendChild(style);
}

// ----------------------------------------------------------------
// EXPORTS
// ----------------------------------------------------------------

export const projectRegistryHandlers = {
    handleAddProject,
    handleEditProject,
    handleRemoveProject,
    handleSaveProject,
    handleAddProjectPhase,
    handleAddProjectMilestone,
    handleUpdateProjectPhase,
    handleRemoveProjectPhase,
    handleAddPhaseDependency,
    handleRemovePhaseDependency,
    handleOpenProjectGantt,
    handleCloseProjectGantt,
    handleLinkContractToProject,
    handleUnlinkContractFromProject,
    handleLinkWbsToProject,
    handleLinkMacToProject,
    handleLinkCampaignToProject,
    handleUnlinkCampaignFromProject,
    handleAddResource,
    handleEditResource,
    handleRemoveResource,
    handleSaveResource,
    handleAnonymizeResource,
    handleWithdrawResourceConsent,
    handleAddAllocation,
    handleUpdateAllocation,
    handleRemoveAllocation,
    handleOpenProjectLoad,
    handleCloseProjectLoad,
    handleSetLoadGranularity,
    handleOpenProjectTimesheet,
    handleCloseProjectTimesheet,
    handleAddTimesheetEntry,
    handleUpdateTimesheetEntry,
    handleEditTimesheetEntry,
    handleSaveTimesheetEntry,
    handleCancelTimesheetEdit,
    handleRemoveTimesheetEntry,
    handleSetTimesheetFilter,
    handleClearTimesheetFilters,
    handleSetTimesheetInput,
    handleShiftTimesheetCalendar,
    handleSelectTimesheetCalendarDate,
};
