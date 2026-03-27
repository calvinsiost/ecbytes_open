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

import { CONFIG } from '../../config.js';
import { getAllElements } from '../../core/elements/manager.js';
import {
    listValidationProfiles,
    saveCustomProfile,
    deleteCustomProfile,
    getActiveProfileIds,
    setActiveProfileIds,
    validateBatchWithProfile,
    getLastValidationResults,
} from '../../core/validation/profileEngine.js';
import {
    openValidationProfileModal,
    closeValidationProfileModal,
    refreshValidationProfileModal,
} from '../ui/validationProfileModal.js';
import { showToast } from '../ui/toast.js';

let _updateAllUI = null;

export function setValidationUpdateAllUI(fn) {
    _updateAllUI = fn;
}

function _enabled() {
    return CONFIG.FEATURES?.VALIDATION_PROFILES !== false;
}

function _collectObservations() {
    const rows = [];
    for (const element of getAllElements()) {
        const observations = Array.isArray(element?.data?.observations) ? element.data.observations : [];
        for (const obs of observations) {
            rows.push({
                ...obs,
                elementId: element.id,
            });
        }
    }
    return rows;
}

async function handleOpenValidationProfiles() {
    if (!_enabled()) {
        showToast('Validation Profiles is disabled by feature flag', 'warning');
        return;
    }
    await openValidationProfileModal();
}

function handleCloseValidationProfiles() {
    closeValidationProfileModal();
}

async function handleRunValidationProfile(profileId) {
    if (!_enabled()) return;
    const rows = _collectObservations();
    if (rows.length === 0) {
        showToast('No observations available for validation', 'warning');
        return {
            profileId: profileId || null,
            violations: [],
            interventionCandidates: [],
            summary: { totalObservations: 0, totalViolations: 0 },
        };
    }

    const result = await validateBatchWithProfile(rows, profileId);
    window.__ecbyts_validation = result;

    const msg = `Validation finished: ${result.summary.totalViolations} violation(s) in ${result.summary.totalObservations} observation(s)`;
    showToast(msg, result.summary.totalViolations > 0 ? 'warning' : 'success');

    if (typeof _updateAllUI === 'function') {
        _updateAllUI();
    }
    refreshValidationProfileModal().catch(() => {});
    return result;
}

async function handleCreateValidationProfile(profileJsonOrObject) {
    if (!_enabled()) return null;
    let profile = profileJsonOrObject;
    if (typeof profileJsonOrObject === 'string') {
        profile = JSON.parse(profileJsonOrObject);
    }
    const saved = await saveCustomProfile(profile);
    showToast(`Validation profile "${saved.name}" saved`, 'success');
    refreshValidationProfileModal().catch(() => {});
    return saved;
}

async function handleDeleteValidationProfile(profileId) {
    if (!_enabled()) return false;
    const ok = await deleteCustomProfile(profileId);
    if (ok) {
        showToast('Validation profile deleted', 'info');
        refreshValidationProfileModal().catch(() => {});
    }
    return ok;
}

async function handleSetActiveValidationProfiles(profileIds) {
    if (!_enabled()) return [];
    let ids = profileIds;
    if (typeof profileIds === 'string') {
        ids = profileIds
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean);
    }
    await setActiveProfileIds(ids);
    refreshValidationProfileModal().catch(() => {});
    return getActiveProfileIds();
}

function _toCsvValue(v) {
    const txt = String(v ?? '');
    return `"${txt.replace(/"/g, '""')}"`;
}

function _downloadCsv(filename, rows) {
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function handleExportValidationResultsCSV() {
    const result = getLastValidationResults();
    if (!result || !Array.isArray(result.violations) || result.violations.length === 0) {
        showToast('No validation results to export', 'warning');
        return false;
    }

    const header = [
        'profileId',
        'ruleId',
        'ruleType',
        'severity',
        'elementId',
        'observationId',
        'parameterId',
        'measuredValue',
        'thresholdValue',
        'unit',
        'message',
    ];
    const rows = [header.join(',')];
    for (const v of result.violations) {
        rows.push(
            [
                _toCsvValue(v.profileId),
                _toCsvValue(v.ruleId),
                _toCsvValue(v.ruleType),
                _toCsvValue(v.severity),
                _toCsvValue(v.elementId),
                _toCsvValue(v.observationId),
                _toCsvValue(v.parameterId),
                _toCsvValue(v.measuredValue),
                _toCsvValue(v.thresholdValue),
                _toCsvValue(v.unit),
                _toCsvValue(v.message),
            ].join(','),
        );
    }
    _downloadCsv('validation-results.csv', rows);
    showToast('Validation CSV exported', 'success');
    return true;
}

function handleCreateIssuesFromValidation() {
    const result = getLastValidationResults();
    const candidates = result?.interventionCandidates || [];
    if (candidates.length === 0) {
        showToast('No intervention candidates found', 'info');
        return [];
    }

    // Integração real com issues/manager entra no item 3 (Issues 3D).
    showToast(`Found ${candidates.length} intervention candidate(s). Issues module not enabled yet.`, 'warning');
    return candidates;
}

async function handleListValidationProfiles() {
    return listValidationProfiles();
}

export const validationHandlers = {
    handleOpenValidationProfiles,
    handleCloseValidationProfiles,
    handleRunValidationProfile,
    handleCreateValidationProfile,
    handleDeleteValidationProfile,
    handleSetActiveValidationProfiles,
    handleExportValidationResultsCSV,
    handleCreateIssuesFromValidation,
    handleListValidationProfiles,
};
