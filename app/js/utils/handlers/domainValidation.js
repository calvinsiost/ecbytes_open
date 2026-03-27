// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt

import { CONFIG } from '../../config.js';
import { getAllElements } from '../../core/elements/manager.js';
import {
    listSavedDomains,
    getDomain,
    saveDomain,
    deleteDomain,
    duplicateDomain,
    setActiveDomainIds,
    getActiveDomainIds,
    runActiveDomainValidation,
    testDomainAgainstData,
} from '../../core/validation/engine/index.js';
import { openDomainEditorModal, closeDomainEditorModal, refreshDomainEditorModal } from '../ui/domainEditorModal.js';
import { showToast } from '../ui/toast.js';

let _updateAllUI = null;

export function setDomainValidationUpdateAllUI(fn) {
    _updateAllUI = fn;
}

function _enabled() {
    return CONFIG.FEATURES?.DOMAIN_VALIDATORS !== false;
}

async function handleOpenDomainEditor() {
    if (!_enabled()) {
        showToast('Domain Validators disabled', 'warning');
        return;
    }
    await openDomainEditorModal();
}

function handleCloseDomainEditor() {
    closeDomainEditorModal();
}

async function handleCreateDomain(domainObj) {
    if (!_enabled()) return null;
    try {
        const saved = await saveDomain(typeof domainObj === 'string' ? JSON.parse(domainObj) : domainObj);
        showToast(`Domain "${saved.name}" saved`, 'success');
        refreshDomainEditorModal().catch(() => {});
        return saved;
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
        return null;
    }
}

async function handleDeleteDomain(domainId) {
    if (!_enabled()) return;
    const ok = await deleteDomain(domainId);
    if (ok) {
        showToast('Domain deleted', 'success');
        refreshDomainEditorModal().catch(() => {});
    } else {
        showToast('Domain not found', 'warning');
    }
}

async function handleDuplicateDomain(domainId) {
    if (!_enabled()) return null;
    try {
        const copy = await duplicateDomain(domainId);
        showToast(`Domain duplicated as "${copy.name}"`, 'success');
        refreshDomainEditorModal().catch(() => {});
        return copy;
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
        return null;
    }
}

async function handleSaveDomain(domainObj) {
    return handleCreateDomain(domainObj);
}

async function handleExportDomain(domainId) {
    if (!_enabled()) return;
    const domain = await getDomain(domainId);
    if (!domain) {
        showToast('Domain not found', 'warning');
        return;
    }

    const json = JSON.stringify(domain, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `domain-${domain.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Domain exported', 'success');
}

async function handleImportDomain(jsonStringOrFile) {
    if (!_enabled()) return null;
    try {
        let domainObj;
        if (typeof jsonStringOrFile === 'string') {
            domainObj = JSON.parse(jsonStringOrFile);
        } else if (jsonStringOrFile instanceof File) {
            const text = await jsonStringOrFile.text();
            domainObj = JSON.parse(text);
        } else {
            domainObj = jsonStringOrFile;
        }

        const saved = await saveDomain(domainObj);
        showToast(`Domain "${saved.name}" imported`, 'success');
        refreshDomainEditorModal().catch(() => {});
        return saved;
    } catch (e) {
        showToast(`Import error: ${e.message}`, 'error');
        return null;
    }
}

async function handleRunDomainValidation() {
    if (!_enabled()) return null;
    const rows = [];
    for (const element of getAllElements()) {
        const observations = Array.isArray(element?.data?.observations) ? element.data.observations : [];
        for (const obs of observations) {
            rows.push({ ...obs, elementId: element.id });
        }
    }

    if (rows.length === 0) {
        showToast('No data to validate', 'warning');
        return { domainResults: [], totalViolations: 0 };
    }

    const result = await runActiveDomainValidation(rows);
    window.__ecbyts_domain_validation = result;

    if (result.totalViolations === 0) {
        showToast('All records valid', 'success');
    } else {
        showToast(`${result.totalViolations} violation(s) found`, 'warning');
    }

    if (typeof _updateAllUI === 'function') _updateAllUI();
    refreshDomainEditorModal().catch(() => {});
    return result;
}

async function handleTestDomainRules(domainObj, sampleData) {
    if (!_enabled()) return null;
    try {
        const domain = typeof domainObj === 'string' ? JSON.parse(domainObj) : domainObj;
        const data = typeof sampleData === 'string' ? JSON.parse(sampleData) : sampleData;
        const result = testDomainAgainstData(domain, Array.isArray(data) ? data : [data]);
        return result;
    } catch (e) {
        showToast(`Test error: ${e.message}`, 'error');
        return null;
    }
}

async function handleListDomains() {
    return listSavedDomains();
}

async function handleSetActiveDomains(ids) {
    if (!_enabled()) return;
    await setActiveDomainIds(Array.isArray(ids) ? ids : [ids]);
    showToast('Active domains updated', 'success');
    refreshDomainEditorModal().catch(() => {});
}

export const domainValidationHandlers = {
    handleOpenDomainEditor,
    handleCloseDomainEditor,
    handleCreateDomain,
    handleDeleteDomain,
    handleDuplicateDomain,
    handleSaveDomain,
    handleExportDomain,
    handleImportDomain,
    handleRunDomainValidation,
    handleTestDomainRules,
    handleListDomains,
    handleSetActiveDomains,
};
