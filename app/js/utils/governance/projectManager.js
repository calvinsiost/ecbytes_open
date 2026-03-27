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
   PROJECT MANAGER — CRUD, Gantt, Resources, Allocations
   Gerenciador de projetos ambientais com cronograma,
   recursos humanos e alocacao.

   ENTIDADES:
   - Projeto: Cronograma, fases, dependencias, milestones
   - Recurso: Membro da equipe com nivel e disponibilidade (LGPD)
   - Alocacao: Vinculacao de recurso a fase de projeto

   TIPOS DE PROJETO:
   - remediation: Remediacao ambiental
   - monitoring: Monitoramento periodico
   - investigation: Investigacao ambiental
   - decommissioning: Descomissionamento
   - custom: Projeto generico

   ALGORITMOS:
   - Critical Path Method (CPM): Forward + backward pass, float=0 = critico
   - Kahn's Algorithm: Deteccao de ciclos em dependencias (DAG validation)
   - Load Calculation: Alocacao cruzada entre projetos
   ================================================================ */

import { generateId } from '../helpers/id.js';

// ----------------------------------------------------------------
// MODULE STATE
// ----------------------------------------------------------------

/** @type {Array<Object>} */
let projects = [];

/** @type {Array<Object>} Pool global de recursos (cross-projeto) */
let resources = [];

/** @type {Array<Object>} Alocacoes recurso→fase (cross-projeto) */
let allocations = [];

/** @type {Array<Object>} Timesheet entries */
let timesheets = [];

// ----------------------------------------------------------------
// PROJECT CRUD
// ----------------------------------------------------------------

/**
 * Add a new project.
 * Adiciona novo projeto ambiental.
 *
 * @param {Object} data - Project data
 * @returns {Object} - Created project
 */
export function addProject(data = {}) {
    const project = {
        id: data.id || generateId('project'),
        name: data.name || 'New Project',
        type: data.type || 'custom',
        status: data.status || 'planning',
        description: data.description || '',
        dates: {
            startDate: data.dates?.startDate || '',
            endDate: data.dates?.endDate || '',
        },
        phases: data.phases || [],
        linkedContractIds: data.linkedContractIds || [],
        linkedWbsRootIds: data.linkedWbsRootIds || [],
        linkedMacMeasureIds: data.linkedMacMeasureIds || [],
        linkedCampaignIds: data.linkedCampaignIds || [],
        linkedElementIds: data.linkedElementIds || [],
        timesheetDailyTargetHours: _normalizeProjectDailyTargetHours(data.timesheetDailyTargetHours),
        notes: data.notes || '',
        costCenterId: data.costCenterId || null,
        createdAt: data.createdAt || new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
    };

    projects.push(project);
    return project;
}

/**
 * Update an existing project.
 * Atualiza projeto existente.
 *
 * @param {string} id - Project ID
 * @param {Object} updates - Fields to update
 * @returns {Object|null} - Updated project or null
 */
export function updateProject(id, updates) {
    const project = projects.find((p) => p.id === id);
    if (!project) return null;

    for (const [key, value] of Object.entries(updates)) {
        if (key === 'dates') {
            Object.assign(project.dates, value);
        } else if (key !== 'id' && key !== 'createdAt') {
            project[key] = value;
        }
    }

    project.modifiedAt = new Date().toISOString();
    return project;
}

/**
 * Remove a project and its allocations.
 * Remove projeto e alocacoes associadas.
 *
 * @param {string} id - Project ID
 * @returns {boolean}
 */
/**
 * Clear all projects, resources and allocations.
 * Remove todos os projetos, recursos e alocacoes.
 */
export function clearProjects() {
    projects = [];
    resources = [];
    allocations = [];
    timesheets = [];
    _emitTimesheetsChanged({ reason: 'clear' });
}

export function removeProject(id) {
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) return false;

    // Remove alocacoes vinculadas ao projeto
    allocations = allocations.filter((a) => a.projectId !== id);
    timesheets = timesheets.filter((e) => e.projectId !== id);

    projects.splice(idx, 1);
    _emitTimesheetsChanged({ reason: 'project_removed', projectId: id });
    return true;
}

/**
 * Get all projects.
 * @returns {Array<Object>}
 */
export function getProjects() {
    return projects;
}

/**
 * Get a project by ID.
 * @param {string} id
 * @returns {Object|null}
 */
export function getProject(id) {
    return projects.find((p) => p.id === id) || null;
}

// ----------------------------------------------------------------
// PHASE MANAGEMENT
// ----------------------------------------------------------------

/**
 * Add a phase to a project.
 * Adiciona fase ao cronograma do projeto.
 *
 * @param {string} projectId
 * @param {Object} phase - Phase data
 * @returns {Object|null} - Created phase
 */
export function addPhase(projectId, phase = {}) {
    const project = getProject(projectId);
    if (!project) return null;

    const newPhase = {
        id: phase.id || generateId('phase'),
        name: phase.name || 'New Phase',
        startDate: phase.startDate || project.dates.startDate || '',
        endDate: phase.endDate || project.dates.endDate || '',
        percentComplete: phase.percentComplete || 0,
        color: phase.color || '#3b6bff',
        isMilestone: phase.isMilestone || false,
        dependencies: phase.dependencies || [],
        linkedWbsItemId: phase.linkedWbsItemId || null,
    };

    project.phases.push(newPhase);
    project.modifiedAt = new Date().toISOString();
    return newPhase;
}

/**
 * Update a phase in a project.
 * @param {string} projectId
 * @param {string} phaseId
 * @param {Object} updates
 * @returns {Object|null}
 */
export function updatePhase(projectId, phaseId, updates) {
    const project = getProject(projectId);
    if (!project) return null;

    const phase = project.phases.find((p) => p.id === phaseId);
    if (!phase) return null;

    for (const [key, value] of Object.entries(updates)) {
        if (key !== 'id') {
            phase[key] = value;
        }
    }

    project.modifiedAt = new Date().toISOString();
    return phase;
}

/**
 * Remove a phase from a project.
 * Remove fase e limpa dependencias orfas.
 *
 * @param {string} projectId
 * @param {string} phaseId
 * @returns {boolean}
 */
export function removePhase(projectId, phaseId) {
    const project = getProject(projectId);
    if (!project) return false;

    const idx = project.phases.findIndex((p) => p.id === phaseId);
    if (idx === -1) return false;

    project.phases.splice(idx, 1);

    // Limpa referencias de dependencia orfas
    for (const phase of project.phases) {
        const depIdx = phase.dependencies.indexOf(phaseId);
        if (depIdx !== -1) {
            phase.dependencies.splice(depIdx, 1);
        }
    }

    // Remove alocacoes da fase
    allocations = allocations.filter((a) => a.phaseId !== phaseId);
    timesheets = timesheets.filter((e) => e.phaseId !== phaseId);

    project.modifiedAt = new Date().toISOString();
    _emitTimesheetsChanged({ reason: 'phase_removed', projectId, phaseId });
    return true;
}

// ----------------------------------------------------------------
// DEPENDENCY MANAGEMENT (DAG validation)
// ----------------------------------------------------------------

/**
 * Add a dependency (finish-to-start) between phases.
 * Valida DAG com Kahn's algorithm antes de aceitar.
 *
 * @param {string} projectId
 * @param {string} phaseId - Fase dependente (successor)
 * @param {string} depPhaseId - Fase predecessora
 * @returns {{ ok: boolean, error?: string }}
 */
export function addPhaseDependency(projectId, phaseId, depPhaseId) {
    const project = getProject(projectId);
    if (!project) return { ok: false, error: 'project_not_found' };

    if (phaseId === depPhaseId) return { ok: false, error: 'self_dependency' };

    const phase = project.phases.find((p) => p.id === phaseId);
    const depPhase = project.phases.find((p) => p.id === depPhaseId);
    if (!phase || !depPhase) return { ok: false, error: 'phase_not_found' };

    if (phase.dependencies.includes(depPhaseId)) {
        return { ok: false, error: 'duplicate' };
    }

    // Testa DAG temporariamente adicionando a dependencia
    phase.dependencies.push(depPhaseId);
    const hasCycle = _detectCycle(project.phases);

    if (hasCycle) {
        phase.dependencies.pop(); // Reverte
        return { ok: false, error: 'cycle_detected' };
    }

    project.modifiedAt = new Date().toISOString();
    return { ok: true };
}

/**
 * Remove a dependency between phases.
 * @param {string} projectId
 * @param {string} phaseId
 * @param {string} depPhaseId
 * @returns {boolean}
 */
export function removePhaseDependency(projectId, phaseId, depPhaseId) {
    const project = getProject(projectId);
    if (!project) return false;

    const phase = project.phases.find((p) => p.id === phaseId);
    if (!phase) return false;

    const idx = phase.dependencies.indexOf(depPhaseId);
    if (idx === -1) return false;

    phase.dependencies.splice(idx, 1);
    project.modifiedAt = new Date().toISOString();
    return true;
}

/**
 * Detect cycle in phase dependency graph (Kahn's algorithm).
 * Detecta ciclo no grafo de dependencias usando ordenacao topologica.
 *
 * @param {Array<Object>} phases
 * @returns {boolean} true if cycle exists
 */
function _detectCycle(phases) {
    const ids = new Set(phases.map((p) => p.id));
    const inDegree = new Map();
    const adjacency = new Map();

    for (const phase of phases) {
        inDegree.set(phase.id, 0);
        adjacency.set(phase.id, []);
    }

    for (const phase of phases) {
        for (const dep of phase.dependencies) {
            if (!ids.has(dep)) continue;
            adjacency.get(dep).push(phase.id);
            inDegree.set(phase.id, inDegree.get(phase.id) + 1);
        }
    }

    const queue = [];
    for (const [id, deg] of inDegree) {
        if (deg === 0) queue.push(id);
    }

    let visited = 0;
    while (queue.length > 0) {
        const node = queue.shift();
        visited++;
        for (const neighbor of adjacency.get(node)) {
            const newDeg = inDegree.get(neighbor) - 1;
            inDegree.set(neighbor, newDeg);
            if (newDeg === 0) queue.push(neighbor);
        }
    }

    return visited < phases.length;
}

// ----------------------------------------------------------------
// CRITICAL PATH METHOD (CPM)
// ----------------------------------------------------------------

/**
 * Calculate critical path for a project.
 * Calcula caminho critico usando CPM (forward + backward pass).
 *
 * @param {string} projectId
 * @returns {Set<string>} Set of phase IDs on the critical path
 */
export function calculateCriticalPath(projectId) {
    const project = getProject(projectId);
    if (!project || project.phases.length === 0) return new Set();

    const phases = project.phases.filter((p) => !p.isMilestone || p.startDate !== p.endDate);
    const phaseMap = new Map(project.phases.map((p) => [p.id, p]));

    // Calcula duracao em dias
    function getDuration(phase) {
        if (phase.isMilestone) return 0;
        if (!phase.startDate || !phase.endDate) return 0;
        const start = new Date(phase.startDate);
        const end = new Date(phase.endDate);
        return Math.max(0, Math.ceil((end - start) / 86400000));
    }

    // Forward pass: Early Start (ES) e Early Finish (EF)
    const ES = new Map();
    const EF = new Map();

    // Ordenacao topologica
    const sorted = _topologicalSort(project.phases);
    if (!sorted) return new Set(); // Ciclo detectado

    for (const phase of sorted) {
        let earlyStart = 0;
        for (const depId of phase.dependencies) {
            const depEF = EF.get(depId);
            if (depEF !== undefined && depEF > earlyStart) {
                earlyStart = depEF;
            }
        }
        ES.set(phase.id, earlyStart);
        EF.set(phase.id, earlyStart + getDuration(phase));
    }

    // Backward pass: Late Start (LS) e Late Finish (LF)
    const LS = new Map();
    const LF = new Map();

    const maxEF = Math.max(...[...EF.values()], 0);

    for (let i = sorted.length - 1; i >= 0; i--) {
        const phase = sorted[i];
        // Encontra successors
        let lateFinish = maxEF;
        for (const other of project.phases) {
            if (other.dependencies.includes(phase.id)) {
                const otherLS = LS.get(other.id);
                if (otherLS !== undefined && otherLS < lateFinish) {
                    lateFinish = otherLS;
                }
            }
        }
        LF.set(phase.id, lateFinish);
        LS.set(phase.id, lateFinish - getDuration(phase));
    }

    // Float = LS - ES. Float == 0 = caminho critico
    const critical = new Set();
    for (const phase of project.phases) {
        const float = (LS.get(phase.id) || 0) - (ES.get(phase.id) || 0);
        if (Math.abs(float) < 0.001) {
            critical.add(phase.id);
        }
    }

    return critical;
}

/**
 * Topological sort of phases.
 * @param {Array<Object>} phases
 * @returns {Array<Object>|null} Sorted phases or null if cycle
 */
function _topologicalSort(phases) {
    const ids = new Set(phases.map((p) => p.id));
    const inDegree = new Map();
    const adjacency = new Map();
    const phaseMap = new Map();

    for (const phase of phases) {
        inDegree.set(phase.id, 0);
        adjacency.set(phase.id, []);
        phaseMap.set(phase.id, phase);
    }

    for (const phase of phases) {
        for (const dep of phase.dependencies) {
            if (!ids.has(dep)) continue;
            adjacency.get(dep).push(phase.id);
            inDegree.set(phase.id, inDegree.get(phase.id) + 1);
        }
    }

    const queue = [];
    for (const [id, deg] of inDegree) {
        if (deg === 0) queue.push(id);
    }

    const sorted = [];
    while (queue.length > 0) {
        const node = queue.shift();
        sorted.push(phaseMap.get(node));
        for (const neighbor of adjacency.get(node)) {
            const newDeg = inDegree.get(neighbor) - 1;
            inDegree.set(neighbor, newDeg);
            if (newDeg === 0) queue.push(neighbor);
        }
    }

    return sorted.length === phases.length ? sorted : null;
}

// ----------------------------------------------------------------
// LINK MANAGEMENT
// ----------------------------------------------------------------

/**
 * Link a contract to a project.
 * @param {string} projectId
 * @param {string} contractId
 */
export function linkContract(projectId, contractId) {
    const project = getProject(projectId);
    if (!project) return;
    if (!project.linkedContractIds.includes(contractId)) {
        project.linkedContractIds.push(contractId);
        project.modifiedAt = new Date().toISOString();
    }
}

export function unlinkContract(projectId, contractId) {
    const project = getProject(projectId);
    if (!project) return;
    const idx = project.linkedContractIds.indexOf(contractId);
    if (idx !== -1) {
        project.linkedContractIds.splice(idx, 1);
        project.modifiedAt = new Date().toISOString();
    }
}

export function linkWbsRoot(projectId, wbsId) {
    const project = getProject(projectId);
    if (!project) return;
    if (!project.linkedWbsRootIds.includes(wbsId)) {
        project.linkedWbsRootIds.push(wbsId);
        project.modifiedAt = new Date().toISOString();
    }
}

export function unlinkWbsRoot(projectId, wbsId) {
    const project = getProject(projectId);
    if (!project) return;
    const idx = project.linkedWbsRootIds.indexOf(wbsId);
    if (idx !== -1) {
        project.linkedWbsRootIds.splice(idx, 1);
        project.modifiedAt = new Date().toISOString();
    }
}

export function linkMacMeasure(projectId, measureId) {
    const project = getProject(projectId);
    if (!project) return;
    if (!project.linkedMacMeasureIds.includes(measureId)) {
        project.linkedMacMeasureIds.push(measureId);
        project.modifiedAt = new Date().toISOString();
    }
}

export function unlinkMacMeasure(projectId, measureId) {
    const project = getProject(projectId);
    if (!project) return;
    const idx = project.linkedMacMeasureIds.indexOf(measureId);
    if (idx !== -1) {
        project.linkedMacMeasureIds.splice(idx, 1);
        project.modifiedAt = new Date().toISOString();
    }
}

export function linkCampaign(projectId, campaignId) {
    const project = getProject(projectId);
    if (!project) return;
    if (!project.linkedCampaignIds.includes(campaignId)) {
        project.linkedCampaignIds.push(campaignId);
        project.modifiedAt = new Date().toISOString();
    }
}

export function unlinkCampaign(projectId, campaignId) {
    const project = getProject(projectId);
    if (!project) return;
    const idx = project.linkedCampaignIds.indexOf(campaignId);
    if (idx !== -1) {
        project.linkedCampaignIds.splice(idx, 1);
        project.modifiedAt = new Date().toISOString();
    }
}

export function linkElement(projectId, elementId) {
    const project = getProject(projectId);
    if (!project) return;
    if (!project.linkedElementIds.includes(elementId)) {
        project.linkedElementIds.push(elementId);
        project.modifiedAt = new Date().toISOString();
    }
}

export function unlinkElement(projectId, elementId) {
    const project = getProject(projectId);
    if (!project) return;
    const idx = project.linkedElementIds.indexOf(elementId);
    if (idx !== -1) {
        project.linkedElementIds.splice(idx, 1);
        project.modifiedAt = new Date().toISOString();
    }
}

// ----------------------------------------------------------------
// RESOURCE MANAGEMENT (Global pool — LGPD)
// ----------------------------------------------------------------

/**
 * Add a resource (team member).
 * Adiciona recurso ao pool global. Requer consentimento LGPD.
 *
 * @param {Object} data
 * @returns {Object} - Created resource
 */
export function addResource(data = {}) {
    const resource = {
        id: data.id || generateId('resource'),
        name: data.consentGiven ? data.name || '' : 'Anonymous',
        role: data.role || '',
        level: data.level || 'mid',
        email: data.consentGiven ? data.email || '' : '',
        hoursPerWeek: data.hoursPerWeek || 40,
        costPerHour: data.costPerHour || 0,
        consentGiven: data.consentGiven || false,
        consentDate: data.consentGiven ? new Date().toISOString() : null,
        consentPurpose: 'Gerenciamento de alocacao de recursos em projetos ambientais',
        consentWithdrawn: false,
        active: data.active !== undefined ? data.active : true,
    };

    resources.push(resource);
    return resource;
}

/**
 * Update a resource.
 * @param {string} id
 * @param {Object} updates
 * @returns {Object|null}
 */
export function updateResource(id, updates) {
    const resource = resources.find((r) => r.id === id);
    if (!resource) return null;

    for (const [key, value] of Object.entries(updates)) {
        if (key !== 'id' && key !== 'consentPurpose') {
            resource[key] = value;
        }
    }

    return resource;
}

/**
 * Remove a resource and its allocations.
 * @param {string} id
 * @returns {boolean}
 */
export function removeResource(id) {
    const idx = resources.findIndex((r) => r.id === id);
    if (idx === -1) return false;

    allocations = allocations.filter((a) => a.resourceId !== id);
    timesheets = timesheets.filter((e) => e.resourceId !== id);
    resources.splice(idx, 1);
    _emitTimesheetsChanged({ reason: 'resource_removed', resourceId: id });
    return true;
}

/**
 * Anonymize a resource (LGPD).
 * Remove dados pessoais mantendo alocacoes.
 *
 * @param {string} id
 * @returns {Object|null}
 */
export function anonymizeResource(id) {
    const resource = resources.find((r) => r.id === id);
    if (!resource) return null;

    resource.name = `Resource-${resource.id.slice(-4)}`;
    resource.email = '';
    resource.consentWithdrawn = true;
    resource.consentGiven = false;
    return resource;
}

/**
 * Withdraw consent (LGPD Art. 7-10).
 * Revoga consentimento — anonimiza dados pessoais.
 *
 * @param {string} id
 * @returns {Object|null}
 */
export function withdrawConsent(id) {
    return anonymizeResource(id);
}

/**
 * Get all resources.
 * @returns {Array<Object>}
 */
export function getResources() {
    return resources;
}

/**
 * Get a resource by ID.
 * @param {string} id
 * @returns {Object|null}
 */
export function getResource(id) {
    return resources.find((r) => r.id === id) || null;
}

// ----------------------------------------------------------------
// ALLOCATION MANAGEMENT
// ----------------------------------------------------------------

/**
 * Add an allocation (resource → phase).
 * Valida datas dentro do range da fase (DA-8).
 *
 * @param {Object} data
 * @returns {Object|null} - Created allocation or null if invalid
 */
export function addAllocation(data = {}) {
    // Valida existencia de fase
    let phaseObj = null;
    for (const proj of projects) {
        phaseObj = proj.phases.find((p) => p.id === data.phaseId);
        if (phaseObj) break;
    }

    const allocation = {
        id: data.id || generateId('alloc'),
        resourceId: data.resourceId || '',
        projectId: data.projectId || '',
        phaseId: data.phaseId || '',
        hoursPerDay: data.hoursPerDay || 8,
        startDate: data.startDate || phaseObj?.startDate || '',
        endDate: data.endDate || phaseObj?.endDate || '',
        notes: data.notes || '',
    };

    // DA-8: Valida datas dentro do range da fase
    if (phaseObj && allocation.startDate && allocation.endDate) {
        if (phaseObj.startDate && allocation.startDate < phaseObj.startDate) {
            allocation.startDate = phaseObj.startDate;
        }
        if (phaseObj.endDate && allocation.endDate > phaseObj.endDate) {
            allocation.endDate = phaseObj.endDate;
        }
    }

    allocations.push(allocation);
    return allocation;
}

/**
 * Update an allocation.
 * @param {string} id
 * @param {Object} updates
 * @returns {Object|null}
 */
export function updateAllocation(id, updates) {
    const allocation = allocations.find((a) => a.id === id);
    if (!allocation) return null;

    for (const [key, value] of Object.entries(updates)) {
        if (key !== 'id') {
            allocation[key] = value;
        }
    }

    return allocation;
}

/**
 * Remove an allocation.
 * @param {string} id
 * @returns {boolean}
 */
export function removeAllocation(id) {
    const idx = allocations.findIndex((a) => a.id === id);
    if (idx === -1) return false;
    allocations.splice(idx, 1);
    return true;
}

/**
 * Get allocations for a resource in a period.
 * @param {string} resourceId
 * @param {string} [startDate]
 * @param {string} [endDate]
 * @returns {Array<Object>}
 */
export function getAllocationsForResource(resourceId, startDate, endDate) {
    return allocations.filter((a) => {
        if (a.resourceId !== resourceId) return false;
        if (startDate && a.endDate && a.endDate < startDate) return false;
        if (endDate && a.startDate && a.startDate > endDate) return false;
        return true;
    });
}

/**
 * Get allocations for a phase.
 * @param {string} phaseId
 * @returns {Array<Object>}
 */
export function getAllocationsForPhase(phaseId) {
    return allocations.filter((a) => a.phaseId === phaseId);
}

/**
 * Get all allocations.
 * @returns {Array<Object>}
 */
export function getAllocations() {
    return allocations;
}

// ----------------------------------------------------------------
// LOAD CALCULATION
// ----------------------------------------------------------------

/**
 * Calculate resource load for a period.
 * Calcula carga de trabalho cross-projeto.
 *
 * @param {string} resourceId
 * @param {string} startDate - ISO date string
 * @param {string} endDate - ISO date string
 * @param {'hour'|'day'|'week'|'month'|'year'} granularity
 * @returns {Array<{period: string, allocated: number, capacity: number, loadPct: number}>}
 */
export function getResourceLoad(resourceId, startDate, endDate, granularity = 'week') {
    const resource = getResource(resourceId);
    if (!resource) return [];

    const periods = _generatePeriods(startDate, endDate, granularity);
    const resAllocs = getAllocationsForResource(resourceId, startDate, endDate);
    const capacityPerDay = resource.hoursPerWeek / 5;

    return periods.map((period) => {
        let allocated = 0;
        for (const alloc of resAllocs) {
            const overlap = _getOverlapDays(alloc.startDate, alloc.endDate, period.start, period.end);
            if (overlap > 0) {
                allocated += alloc.hoursPerDay * overlap;
            }
        }

        const periodDays = _getBusinessDays(period.start, period.end);
        const capacity = capacityPerDay * periodDays;
        const loadPct = capacity > 0 ? (allocated / capacity) * 100 : 0;

        return {
            period: period.label,
            start: period.start,
            end: period.end,
            allocated: Math.round(allocated * 10) / 10,
            capacity: Math.round(capacity * 10) / 10,
            loadPct: Math.round(loadPct),
        };
    });
}

/**
 * Calculate team load (aggregated across all resources for a project).
 * @param {string} projectId
 * @param {string} startDate
 * @param {string} endDate
 * @param {'hour'|'day'|'week'|'month'|'year'} granularity
 * @returns {Array<Object>}
 */
export function getTeamLoad(projectId, startDate, endDate, granularity = 'week') {
    const projectAllocs = allocations.filter((a) => a.projectId === projectId);
    const resourceIds = [...new Set(projectAllocs.map((a) => a.resourceId))];

    const periods = _generatePeriods(startDate, endDate, granularity);

    return periods.map((period) => {
        let totalAllocated = 0;
        let totalCapacity = 0;

        for (const resId of resourceIds) {
            const resource = getResource(resId);
            if (!resource) continue;

            const capacityPerDay = resource.hoursPerWeek / 5;
            const periodDays = _getBusinessDays(period.start, period.end);
            totalCapacity += capacityPerDay * periodDays;

            // Todas as alocacoes do recurso (cross-projeto)
            const resAllocs = getAllocationsForResource(resId, period.start, period.end);
            for (const alloc of resAllocs) {
                const overlap = _getOverlapDays(alloc.startDate, alloc.endDate, period.start, period.end);
                totalAllocated += alloc.hoursPerDay * overlap;
            }
        }

        return {
            period: period.label,
            start: period.start,
            end: period.end,
            allocated: Math.round(totalAllocated * 10) / 10,
            capacity: Math.round(totalCapacity * 10) / 10,
            loadPct: totalCapacity > 0 ? Math.round((totalAllocated / totalCapacity) * 100) : 0,
        };
    });
}

// ----------------------------------------------------------------
// PROJECT PROGRESS
// ----------------------------------------------------------------

/**
 * Calculate project progress (weighted average of phase completion).
 * Calcula progresso geral do projeto.
 *
 * @param {string} projectId
 * @returns {number} - 0-100
 */
export function getProjectProgress(projectId) {
    const project = getProject(projectId);
    if (!project || project.phases.length === 0) return 0;

    const nonMilestones = project.phases.filter((p) => !p.isMilestone);
    if (nonMilestones.length === 0) return 0;

    const total = nonMilestones.reduce((sum, p) => sum + (p.percentComplete || 0), 0);
    return Math.round(total / nonMilestones.length);
}

// ----------------------------------------------------------------
// TIMESHEET MANAGEMENT
// ----------------------------------------------------------------

/**
 * Add a timesheet entry.
 * @param {Object} data
 * @returns {{ok: boolean, entry?: Object, code?: string}}
 */
export function addTimesheetEntry(data = {}) {
    const normalized = _normalizeTimesheetInput(data);
    const validation = _validateTimesheetEntry(normalized);
    if (!validation.ok) return validation;

    const now = new Date().toISOString();
    const entry = {
        id: normalized.id || generateId('timesheet'),
        projectId: normalized.projectId,
        phaseId: normalized.phaseId,
        resourceId: normalized.resourceId,
        date: normalized.date,
        hours: normalized.hours,
        notes: normalized.notes,
        createdAt: normalized.createdAt || now,
        updatedAt: now,
    };

    timesheets.push(entry);
    _emitTimesheetsChanged({
        reason: 'add',
        projectId: entry.projectId,
        entryId: entry.id,
        phaseId: entry.phaseId,
        resourceId: entry.resourceId,
    });
    return { ok: true, entry: { ...entry } };
}

/**
 * Update a timesheet entry by id.
 * @param {string} id
 * @param {Object} updates
 * @returns {{ok: boolean, entry?: Object, code?: string}}
 */
export function updateTimesheetEntry(id, updates = {}) {
    const existing = timesheets.find((e) => e.id === id);
    if (!existing) return { ok: false, code: 'ENTRY_NOT_FOUND' };

    const merged = _normalizeTimesheetInput({
        ...existing,
        ...updates,
        id: existing.id,
        createdAt: existing.createdAt,
    });
    const validation = _validateTimesheetEntry(merged);
    if (!validation.ok) return validation;

    existing.projectId = merged.projectId;
    existing.phaseId = merged.phaseId;
    existing.resourceId = merged.resourceId;
    existing.date = merged.date;
    existing.hours = merged.hours;
    existing.notes = merged.notes;
    existing.updatedAt = new Date().toISOString();

    _emitTimesheetsChanged({
        reason: 'update',
        projectId: existing.projectId,
        entryId: existing.id,
        phaseId: existing.phaseId,
        resourceId: existing.resourceId,
    });
    return { ok: true, entry: { ...existing } };
}

/**
 * Remove timesheet entry by id.
 * @param {string} id
 * @returns {{ok: boolean, code?: string}}
 */
export function removeTimesheetEntry(id) {
    const idx = timesheets.findIndex((e) => e.id === id);
    if (idx === -1) return { ok: false, code: 'ENTRY_NOT_FOUND' };

    const entry = timesheets[idx];
    timesheets.splice(idx, 1);
    _emitTimesheetsChanged({
        reason: 'remove',
        projectId: entry.projectId,
        entryId: entry.id,
        phaseId: entry.phaseId,
        resourceId: entry.resourceId,
    });
    return { ok: true };
}

/**
 * Get all timesheet entries sorted.
 * @returns {Array<Object>}
 */
export function getTimesheetEntries() {
    return _sortTimesheetEntries(timesheets).map((e) => ({ ...e }));
}

/**
 * Get timesheet entries by project.
 * @param {string} projectId
 * @param {Object} filters
 * @returns {Array<Object>}
 */
export function getTimesheetByProject(projectId, filters = {}) {
    const filtered = _applyTimesheetFilters(
        timesheets.filter((e) => e.projectId === projectId),
        filters,
    );
    return _sortTimesheetEntries(filtered).map((e) => ({ ...e }));
}

/**
 * Get timesheet entries by resource.
 * @param {string} resourceId
 * @param {Object} filters
 * @returns {Array<Object>}
 */
export function getTimesheetByResource(resourceId, filters = {}) {
    const filtered = _applyTimesheetFilters(
        timesheets.filter((e) => e.resourceId === resourceId),
        filters,
    );
    return _sortTimesheetEntries(filtered).map((e) => ({ ...e }));
}

/**
 * Get timesheet entries by phase.
 * @param {string} phaseId
 * @param {Object} filters
 * @returns {Array<Object>}
 */
export function getTimesheetByPhase(phaseId, filters = {}) {
    const filtered = _applyTimesheetFilters(
        timesheets.filter((e) => e.phaseId === phaseId),
        filters,
    );
    return _sortTimesheetEntries(filtered).map((e) => ({ ...e }));
}

/**
 * Get timesheet summary for a project.
 * @param {string} projectId
 * @param {Object} filters
 * @returns {Object}
 */
export function getTimesheetSummary(projectId, filters = {}) {
    const entries = getTimesheetByProject(projectId, filters);
    const byResourceMap = new Map();
    const byPhaseMap = new Map();
    const byDateMap = new Map();

    let totalHours = 0;
    for (const entry of entries) {
        totalHours += entry.hours;
        const resource = getResource(entry.resourceId);
        const phase = getProject(entry.projectId)?.phases?.find((p) => p.id === entry.phaseId) || null;

        const resRow = byResourceMap.get(entry.resourceId) || {
            id: entry.resourceId,
            name: resource?.name || entry.resourceId,
            hours: 0,
        };
        resRow.hours += entry.hours;
        byResourceMap.set(entry.resourceId, resRow);

        const phaseRow = byPhaseMap.get(entry.phaseId) || {
            id: entry.phaseId,
            name: phase?.name || entry.phaseId,
            hours: 0,
        };
        phaseRow.hours += entry.hours;
        byPhaseMap.set(entry.phaseId, phaseRow);

        byDateMap.set(entry.date, (byDateMap.get(entry.date) || 0) + entry.hours);
    }

    const byResource = [...byResourceMap.values()]
        .map((row) => ({ ...row, hours: _round2(row.hours) }))
        .sort((a, b) => b.hours - a.hours);

    const byPhase = [...byPhaseMap.values()]
        .map((row) => ({ ...row, hours: _round2(row.hours) }))
        .sort((a, b) => b.hours - a.hours);

    const byDate = [...byDateMap.entries()]
        .map(([date, hours]) => ({ date, hours: _round2(hours) }))
        .sort((a, b) => a.date.localeCompare(b.date));

    return {
        totalHours: _round2(totalHours),
        entryCount: entries.length,
        byResource,
        byPhase,
        byDate,
    };
}

// ----------------------------------------------------------------
// SERIALIZATION
// ----------------------------------------------------------------

/**
 * Export projects, resources, and allocations.
 * @returns {Object}
 */
export function exportProjects() {
    return {
        projects: projects.map((p) => ({
            ...p,
            phases: p.phases.map((ph) => ({ ...ph })),
        })),
        resources: resources.map((r) => {
            // LGPD: nao exporta dados pessoais se consentimento foi revogado
            if (r.consentWithdrawn) {
                return { ...r, name: r.name, email: '' };
            }
            return { ...r };
        }),
        allocations: allocations.map((a) => ({ ...a })),
        timesheets: timesheets.map((e) => ({ ...e })),
    };
}

/**
 * Import projects, resources, and allocations.
 * @param {Object} data - { projects, resources, allocations }
 */
export function importProjects(data) {
    projects = [];
    resources = [];
    allocations = [];
    timesheets = [];

    if (!data) return;

    const projectArr = data.projects || data;
    if (Array.isArray(projectArr)) {
        for (const item of projectArr) {
            projects.push({
                id: item.id || generateId('project'),
                name: item.name || '',
                type: item.type || 'custom',
                status: item.status || 'planning',
                description: item.description || '',
                dates: item.dates || { startDate: '', endDate: '' },
                phases: (item.phases || []).map((ph) => ({
                    id: ph.id || generateId('phase'),
                    name: ph.name || '',
                    startDate: ph.startDate || '',
                    endDate: ph.endDate || '',
                    percentComplete: ph.percentComplete || 0,
                    color: ph.color || '#3b6bff',
                    isMilestone: ph.isMilestone || false,
                    dependencies: ph.dependencies || [],
                    linkedWbsItemId: ph.linkedWbsItemId || null,
                })),
                linkedContractIds: item.linkedContractIds || [],
                linkedWbsRootIds: item.linkedWbsRootIds || [],
                linkedMacMeasureIds: item.linkedMacMeasureIds || [],
                linkedCampaignIds: item.linkedCampaignIds || [],
                linkedElementIds: item.linkedElementIds || [],
                timesheetDailyTargetHours: _normalizeProjectDailyTargetHours(item.timesheetDailyTargetHours),
                notes: item.notes || '',
                createdAt: item.createdAt || new Date().toISOString(),
                modifiedAt: item.modifiedAt || new Date().toISOString(),
            });
        }
    }

    if (Array.isArray(data.resources)) {
        for (const item of data.resources) {
            resources.push({
                id: item.id || generateId('resource'),
                name: item.name || '',
                role: item.role || '',
                level: item.level || 'mid',
                email: item.email || '',
                hoursPerWeek: item.hoursPerWeek || 40,
                costPerHour: item.costPerHour || 0,
                consentGiven: item.consentGiven || false,
                consentDate: item.consentDate || null,
                consentPurpose: item.consentPurpose || 'Gerenciamento de alocacao de recursos em projetos ambientais',
                consentWithdrawn: item.consentWithdrawn || false,
                active: item.active !== undefined ? item.active : true,
            });
        }
    }

    if (Array.isArray(data.allocations)) {
        for (const item of data.allocations) {
            allocations.push({
                id: item.id || generateId('alloc'),
                resourceId: item.resourceId || '',
                projectId: item.projectId || '',
                phaseId: item.phaseId || '',
                hoursPerDay: item.hoursPerDay || 8,
                startDate: item.startDate || '',
                endDate: item.endDate || '',
                notes: item.notes || '',
            });
        }
    }

    if (Array.isArray(data.timesheets)) {
        for (const item of data.timesheets) {
            const normalized = _normalizeTimesheetInput({
                id: item.id,
                projectId: item.projectId,
                phaseId: item.phaseId,
                resourceId: item.resourceId,
                date: item.date,
                hours: item.hours,
                notes: item.notes,
                createdAt: item.createdAt,
            });
            const validation = _validateTimesheetEntry(normalized);
            if (!validation.ok) {
                console.warn('[projectManager] Dropping invalid timesheet entry during import:', validation.code);
                continue;
            }

            timesheets.push({
                id: normalized.id || generateId('timesheet'),
                projectId: normalized.projectId,
                phaseId: normalized.phaseId,
                resourceId: normalized.resourceId,
                date: normalized.date,
                hours: normalized.hours,
                notes: normalized.notes,
                createdAt: normalized.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });
        }
    }

    _emitTimesheetsChanged({ reason: 'import' });
}

// ----------------------------------------------------------------
// PERIOD HELPERS
// ----------------------------------------------------------------

/**
 * Generate period intervals for load calculation.
 * @param {string} startDate
 * @param {string} endDate
 * @param {string} granularity
 * @returns {Array<{start: string, end: string, label: string}>}
 */
function _generatePeriods(startDate, endDate, granularity) {
    const periods = [];
    let current = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(current.getTime()) || isNaN(end.getTime())) return periods;

    const MAX_PERIODS = 365;
    let count = 0;

    while (current <= end && count < MAX_PERIODS) {
        let periodEnd;
        let label;

        switch (granularity) {
            case 'hour':
                periodEnd = new Date(current);
                periodEnd.setHours(periodEnd.getHours() + 1);
                label = current.toISOString().slice(0, 13) + 'h';
                break;
            case 'day':
                periodEnd = new Date(current);
                periodEnd.setDate(periodEnd.getDate() + 1);
                label = current.toISOString().slice(0, 10);
                break;
            case 'week': {
                periodEnd = new Date(current);
                periodEnd.setDate(periodEnd.getDate() + 7);
                const weekNum = Math.ceil(current.getDate() / 7);
                label = `${current.toISOString().slice(0, 7)} W${weekNum}`;
                break;
            }
            case 'month':
                periodEnd = new Date(current.getFullYear(), current.getMonth() + 1, 1);
                label = current.toISOString().slice(0, 7);
                break;
            case 'year':
                periodEnd = new Date(current.getFullYear() + 1, 0, 1);
                label = String(current.getFullYear());
                break;
            default:
                periodEnd = new Date(current);
                periodEnd.setDate(periodEnd.getDate() + 7);
                label = current.toISOString().slice(0, 10);
        }

        if (periodEnd > end) periodEnd = new Date(end);

        periods.push({
            start: current.toISOString().slice(0, 10),
            end: periodEnd.toISOString().slice(0, 10),
            label,
        });

        current = periodEnd;
        count++;
    }

    return periods;
}

/**
 * Calculate overlap in business days between two date ranges.
 * @param {string} start1
 * @param {string} end1
 * @param {string} start2
 * @param {string} end2
 * @returns {number}
 */
function _getOverlapDays(start1, end1, start2, end2) {
    if (!start1 || !end1 || !start2 || !end2) return 0;
    const overlapStart = start1 > start2 ? start1 : start2;
    const overlapEnd = end1 < end2 ? end1 : end2;
    if (overlapStart > overlapEnd) return 0;
    return _getBusinessDays(overlapStart, overlapEnd);
}

/**
 * Calculate business days between two dates.
 * @param {string} start
 * @param {string} end
 * @returns {number}
 */
function _getBusinessDays(start, end) {
    const s = new Date(start);
    const e = new Date(end);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;

    let days = 0;
    const current = new Date(s);
    while (current <= e) {
        const day = current.getDay();
        if (day !== 0 && day !== 6) days++;
        current.setDate(current.getDate() + 1);
    }
    return Math.max(days, 1);
}

/**
 * Emit browser event after timesheet mutation.
 * @param {Object} detail
 */
function _emitTimesheetsChanged(detail = {}) {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    if (typeof CustomEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent('timesheets-changed', { detail }));
}

/**
 * Normalize raw timesheet input.
 * @param {Object} data
 * @returns {Object}
 */
function _normalizeTimesheetInput(data = {}) {
    return {
        id: data.id || '',
        projectId: data.projectId || '',
        phaseId: data.phaseId || '',
        resourceId: data.resourceId || '',
        date: typeof data.date === 'string' ? data.date.trim() : '',
        hours: Number(data.hours),
        notes: String(data.notes || '').slice(0, 500),
        createdAt: data.createdAt || '',
    };
}

/**
 * Validate timesheet according to business rules.
 * @param {Object} entry
 * @returns {{ok: boolean, code?: string}}
 */
function _validateTimesheetEntry(entry) {
    const project = getProject(entry.projectId);
    if (!project) return { ok: false, code: 'INVALID_PROJECT' };

    const phase = project.phases.find((p) => p.id === entry.phaseId);
    if (!phase) {
        const phaseExistsElsewhere = projects.some((p) => p.phases.some((ph) => ph.id === entry.phaseId));
        return { ok: false, code: phaseExistsElsewhere ? 'PHASE_PROJECT_MISMATCH' : 'INVALID_PHASE' };
    }
    if (phase.isMilestone === true) return { ok: false, code: 'MILESTONE_NOT_ALLOWED' };

    const resource = getResource(entry.resourceId);
    if (!resource) return { ok: false, code: 'INVALID_RESOURCE' };

    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
        return { ok: false, code: 'INVALID_DATE_FORMAT' };
    }
    if (!_isValidISODate(entry.date)) {
        return { ok: false, code: 'INVALID_DATE' };
    }

    const windowRange = _resolveTimesheetDateWindow(project, phase);
    if (windowRange && (entry.date < windowRange.start || entry.date > windowRange.end)) {
        return { ok: false, code: 'DATE_OUT_OF_RANGE' };
    }

    if (!Number.isFinite(entry.hours)) return { ok: false, code: 'INVALID_HOURS' };
    if (entry.hours <= 0) return { ok: false, code: 'HOURS_NOT_POSITIVE' };
    if (entry.hours > 24) return { ok: false, code: 'HOURS_EXCEEDS_MAX' };
    if (!_isQuarterStep(entry.hours)) return { ok: false, code: 'HOURS_NOT_QUARTER' };

    return { ok: true };
}

/**
 * Resolve accepted date window for timesheet entries.
 * @param {Object} project
 * @param {Object} phase
 * @returns {{start: string, end: string}|null}
 */
function _resolveTimesheetDateWindow(project, phase) {
    if (phase?.startDate && phase?.endDate) {
        return { start: phase.startDate, end: phase.endDate };
    }
    if (project?.dates?.startDate && project?.dates?.endDate) {
        return { start: project.dates.startDate, end: project.dates.endDate };
    }
    return null;
}

/**
 * Filter timesheet entries using AND semantics.
 * @param {Array<Object>} entries
 * @param {Object} filters
 * @returns {Array<Object>}
 */
function _applyTimesheetFilters(entries, filters = {}) {
    const startDate = filters.startDate || '';
    const endDate = filters.endDate || '';
    const resourceId = filters.resourceId || '';
    const phaseId = filters.phaseId || '';

    return entries.filter((entry) => {
        if (startDate && entry.date < startDate) return false;
        if (endDate && entry.date > endDate) return false;
        if (resourceId && entry.resourceId !== resourceId) return false;
        if (phaseId && entry.phaseId !== phaseId) return false;
        return true;
    });
}

/**
 * Normalize project daily target hours for timesheet progress.
 * @param {*} value
 * @returns {number}
 */
function _normalizeProjectDailyTargetHours(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 8;
}

/**
 * Sort by date desc then createdAt desc.
 * @param {Array<Object>} entries
 * @returns {Array<Object>}
 */
function _sortTimesheetEntries(entries) {
    return [...entries].sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
}

/**
 * Validate YYYY-MM-DD as real date.
 * @param {string} dateStr
 * @returns {boolean}
 */
function _isValidISODate(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    if (!year || !month || !day) return false;
    const dt = new Date(Date.UTC(year, month - 1, day));
    return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

/**
 * Check quarter-hour granularity.
 * @param {number} value
 * @returns {boolean}
 */
function _isQuarterStep(value) {
    return Math.abs(Math.round(value * 4) - value * 4) < 1e-9;
}

/**
 * Round to 2 decimal places.
 * @param {number} value
 * @returns {number}
 */
function _round2(value) {
    return Math.round((value || 0) * 100) / 100;
}
