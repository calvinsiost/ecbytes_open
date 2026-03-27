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
   ECBT — Domain Validator Editor Modal
   utils/ui/domainEditorModal.js

   Two-pane modal for user-defined validation domains.
   Left: domain list. Right: entity/rule editor.
   Uses createElement (no monolithic innerHTML).
   License: MPL 2.0
   ================================================================ */

import {
    listSavedDomains,
    getDomain,
    saveDomain,
    deleteDomain,
    duplicateDomain,
    getActiveDomainIds,
    setActiveDomainIds,
    testDomainAgainstData,
} from '../../core/validation/engine/index.js';
import { validateDomainDefinition } from '../../core/validation/engine/domainLoader.js';
import { showToast } from './toast.js';
import { escapeHtml } from '../helpers/html.js';
import { t } from '../i18n/translations.js';
import { buildModalShell } from './modals.js';

// ── State ─────────────────────────────────────────────────────────────────────

let _modalRoot = null;
let _currentDomainId = null;
let _draft = null; // Working copy of domain being edited
let _currentEntityIdx = 0; // Index of entity being edited
const _idCounter = 0;

const ROOT_ID = 'domain-editor-modal-root';

const RULE_TYPES = [
    { value: 'required', label: 'Required' },
    { value: 'ifAvailable', label: 'If Available' },
    { value: 'oneOf', label: 'One Of' },
    { value: 'numeric', label: 'Numeric' },
    { value: 'matchPattern', label: 'Pattern' },
    { value: 'custom', label: 'Custom' },
];

const BATCH_RULE_TYPES = [{ value: 'uniqueKey', label: 'Unique Key' }];

const CUSTOM_OPERATORS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'startsWith', 'endsWith'];

// ── Public API ────────────────────────────────────────────────────────────────

export async function openDomainEditorModal() {
    _modalRoot = document.getElementById(ROOT_ID);
    if (!_modalRoot) {
        _modalRoot = document.createElement('div');
        _modalRoot.id = ROOT_ID;
        document.body.appendChild(_modalRoot);
    }

    _currentDomainId = null;
    _draft = null;
    _currentEntityIdx = 0;

    _modalRoot.innerHTML = '';
    _modalRoot.appendChild(await _buildModal());
}

export function closeDomainEditorModal() {
    _draft = null;
    _currentDomainId = null;
    if (_modalRoot) _modalRoot.innerHTML = '';
    // Also remove any overlay created by buildModalShell
    const overlay = document.querySelector('.sym-overlay #domain-editor-modal')?.closest('.sym-overlay');
    if (overlay) overlay.remove();
}

export async function refreshDomainEditorModal() {
    if (!_modalRoot || !document.getElementById('domain-editor-modal')) return;
    _modalRoot.innerHTML = '';
    _modalRoot.appendChild(await _buildModal());
}

// ── Modal structure ───────────────────────────────────────────────────────────

async function _buildModal() {
    const { overlay, body } = buildModalShell({
        title: t('domainValidators') || 'Domain Validators',
        width: '960px',
        id: 'domain-editor-modal',
        twoPane: true,
        onClose: () => {
            _draft = null;
            _currentDomainId = null;
        },
    });

    // Remove footer — editor has its own inline actions
    const footer = overlay.querySelector('.sym-footer');
    if (footer) footer.remove();

    const sidebar = await _buildSidebar();
    const content = _draft ? _buildEditor() : _buildEmptyState();

    body.appendChild(sidebar);
    body.appendChild(content);

    return overlay;
}

// ── Sidebar (domain list) ─────────────────────────────────────────────────────

async function _buildSidebar() {
    const sidebar = _el('div', 'domain-editor-sidebar');
    sidebar.style.cssText =
        'width:220px;min-width:220px;border-right:1px solid var(--border-color,#333);display:flex;flex-direction:column;overflow-y:auto;padding:12px;';

    const domains = await listSavedDomains();
    const activeIds = await getActiveDomainIds();
    const activeSet = new Set(activeIds);

    for (const d of domains) {
        const item = _el('div');
        item.style.cssText = `padding:8px 10px;margin-bottom:4px;border-radius:4px;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:13px;${_currentDomainId === d.id ? 'background:var(--accent,#3b6bff);color:#fff;' : 'background:var(--bg-secondary,#222);'}`;
        item.title = d.description || d.name;

        const dot = _el('span');
        dot.style.cssText = `width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${activeSet.has(d.id) ? '#4caf50' : '#666'};`;
        item.appendChild(dot);

        const label = _el('span');
        label.textContent = d.name;
        label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
        item.appendChild(label);

        const count = _el('span');
        count.textContent = `${d.ruleCount}`;
        count.title = `${d.ruleCount} rules, ${d.entityCount} entities`;
        count.style.cssText = 'font-size:11px;color:#888;flex-shrink:0;';
        item.appendChild(count);

        item.onclick = async () => {
            _currentDomainId = d.id;
            _draft = JSON.parse(JSON.stringify(await getDomain(d.id)));
            _currentEntityIdx = 0;
            await refreshDomainEditorModal();
        };

        sidebar.appendChild(item);
    }

    // New domain button
    const newBtn = _el('button');
    newBtn.textContent = '+ ' + (t('newDomain') || 'New Domain');
    newBtn.style.cssText =
        'margin-top:8px;padding:8px;background:var(--accent,#3b6bff);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;';
    newBtn.onclick = async () => {
        const id = `domain-${Date.now()}`;
        _draft = {
            id,
            name: 'New Domain',
            version: '1.0',
            description: '',
            entities: [{ name: 'RECORD', rules: [], batchRules: [] }],
            relations: [],
        };
        _currentDomainId = null;
        _currentEntityIdx = 0;
        await refreshDomainEditorModal();
    };
    sidebar.appendChild(newBtn);

    // Import button
    const importBtn = _el('button');
    importBtn.textContent = t('importDomain') || 'Import JSON';
    importBtn.style.cssText =
        'margin-top:4px;padding:8px;background:var(--bg-secondary,#222);color:var(--text-primary,#e0e0e0);border:1px solid var(--border-color,#444);border-radius:4px;cursor:pointer;font-size:13px;';
    importBtn.onclick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const domain = JSON.parse(text);
                await saveDomain(domain);
                showToast(`Domain "${domain.name}" imported`, 'success');
                await refreshDomainEditorModal();
            } catch (err) {
                showToast(`Import error: ${err.message}`, 'error');
            }
        };
        input.click();
    };
    sidebar.appendChild(importBtn);

    return sidebar;
}

// ── Empty state ───────────────────────────────────────────────────────────────

function _buildEmptyState() {
    const content = _el('div', 'domain-editor-content');
    content.style.cssText =
        'flex:1;display:flex;align-items:center;justify-content:center;color:#888;font-size:14px;padding:40px;text-align:center;';
    content.textContent = t('selectOrCreateDomain') || 'Select a domain from the list or create a new one.';
    return content;
}

// ── Editor (right pane) ───────────────────────────────────────────────────────

function _buildEditor() {
    const content = _el('div', 'domain-editor-content');
    content.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow-y:auto;padding:16px;';

    // Domain metadata
    const metaRow = _el('div');
    metaRow.style.cssText = 'display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;';

    metaRow.appendChild(
        _labeledInput(
            'Name',
            _draft.name,
            (v) => {
                _draft.name = v;
            },
            { width: '200px' },
        ),
    );
    metaRow.appendChild(
        _labeledInput(
            'Version',
            _draft.version || '1.0',
            (v) => {
                _draft.version = v;
            },
            { width: '80px' },
        ),
    );
    metaRow.appendChild(
        _labeledInput(
            'Description',
            _draft.description || '',
            (v) => {
                _draft.description = v;
            },
            { width: '300px' },
        ),
    );
    content.appendChild(metaRow);

    // Entity tabs
    const entityTabs = _el('div');
    entityTabs.style.cssText = 'display:flex;gap:4px;margin-bottom:12px;flex-wrap:wrap;align-items:center;';

    (_draft.entities || []).forEach((entity, idx) => {
        const tab = _el('button');
        tab.textContent = entity.name;
        tab.style.cssText = `padding:6px 12px;border:1px solid var(--border-color,#444);border-radius:4px 4px 0 0;cursor:pointer;font-size:12px;${idx === _currentEntityIdx ? 'background:var(--accent,#3b6bff);color:#fff;border-bottom:none;' : 'background:var(--bg-secondary,#222);color:var(--text-primary,#e0e0e0);'}`;
        tab.onclick = () => {
            _currentEntityIdx = idx;
            refreshDomainEditorModal();
        };

        // Double-click to rename
        tab.ondblclick = () => {
            const newName = prompt('Entity name:', entity.name);
            if (newName && newName.trim()) {
                _draft.entities[idx].name = newName.trim().toUpperCase();
                refreshDomainEditorModal();
            }
        };
        entityTabs.appendChild(tab);
    });

    // Add entity button
    const addEntityBtn = _el('button');
    addEntityBtn.textContent = '+';
    addEntityBtn.title = 'Add entity';
    addEntityBtn.style.cssText =
        'padding:6px 10px;border:1px dashed var(--border-color,#555);border-radius:4px;cursor:pointer;font-size:12px;background:none;color:var(--text-primary,#e0e0e0);';
    addEntityBtn.onclick = () => {
        _draft.entities.push({ name: `ENTITY_${_draft.entities.length + 1}`, rules: [], batchRules: [] });
        _currentEntityIdx = _draft.entities.length - 1;
        refreshDomainEditorModal();
    };
    entityTabs.appendChild(addEntityBtn);

    // Delete entity button (if >1)
    if (_draft.entities.length > 1) {
        const delEntityBtn = _el('button');
        delEntityBtn.textContent = '\u2212';
        delEntityBtn.title = 'Remove current entity';
        delEntityBtn.style.cssText =
            'padding:6px 10px;border:1px solid #c62828;border-radius:4px;cursor:pointer;font-size:12px;background:none;color:#c62828;';
        delEntityBtn.onclick = () => {
            _draft.entities.splice(_currentEntityIdx, 1);
            _currentEntityIdx = Math.min(_currentEntityIdx, _draft.entities.length - 1);
            refreshDomainEditorModal();
        };
        entityTabs.appendChild(delEntityBtn);
    }
    content.appendChild(entityTabs);

    // Entity rules
    const entity = _draft.entities[_currentEntityIdx];
    if (entity) {
        content.appendChild(_buildRulesSection(entity));
        content.appendChild(_buildBatchRulesSection(entity));
    }

    // Relations section (collapsible)
    content.appendChild(_buildRelationsSection());

    // Footer: actions
    const footer = _el('div');
    footer.style.cssText =
        'display:flex;gap:8px;margin-top:16px;padding-top:12px;border-top:1px solid var(--border-color,#333);flex-wrap:wrap;';

    const saveBtn = _actionBtn('Save', 'var(--accent,#3b6bff)', async () => {
        const check = validateDomainDefinition(_draft);
        if (!check.valid) {
            showToast(`Validation: ${check.errors[0]}`, 'error');
            return;
        }
        await saveDomain(_draft);
        _currentDomainId = _draft.id;
        showToast(`Domain "${_draft.name}" saved`, 'success');
        await refreshDomainEditorModal();
    });

    const testBtn = _actionBtn('Test Data', '#666', () => {
        _openTestPanel(content);
    });

    const exportBtn = _actionBtn('Export', '#555', () => {
        const json = JSON.stringify(_draft, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `domain-${_draft.id}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Exported', 'success');
    });

    const dupBtn = _actionBtn('Duplicate', '#555', async () => {
        if (!_currentDomainId) {
            showToast('Save the domain first', 'warning');
            return;
        }
        await duplicateDomain(_currentDomainId);
        showToast('Duplicated', 'success');
        await refreshDomainEditorModal();
    });

    const delBtn = _actionBtn('Delete', '#c62828', async () => {
        if (!_currentDomainId) return;
        if (!confirm(`Delete domain "${_draft.name}"?`)) return;
        await deleteDomain(_currentDomainId);
        _currentDomainId = null;
        _draft = null;
        showToast('Deleted', 'success');
        await refreshDomainEditorModal();
    });

    footer.appendChild(saveBtn);
    footer.appendChild(testBtn);
    footer.appendChild(exportBtn);
    if (_currentDomainId) {
        footer.appendChild(dupBtn);
        footer.appendChild(delBtn);
    }
    content.appendChild(footer);

    return content;
}

// ── Rules section ─────────────────────────────────────────────────────────────

function _buildRulesSection(entity) {
    const section = _el('div');

    const heading = _el('h4');
    heading.textContent = `Rules (${(entity.rules || []).length})`;
    heading.style.cssText = 'margin:0 0 8px;font-size:13px;color:#aaa;';
    section.appendChild(heading);

    const table = _el('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;';

    // Header
    const thead = _el('thead');
    const hRow = _el('tr');
    for (const h of ['Field', 'Type', 'Parameters', 'Severity', '']) {
        const th = _el('th');
        th.textContent = h;
        th.style.cssText =
            'text-align:left;padding:6px 8px;border-bottom:1px solid var(--border-color,#444);color:#888;font-weight:500;';
        hRow.appendChild(th);
    }
    thead.appendChild(hRow);
    table.appendChild(thead);

    // Body
    const tbody = _el('tbody');
    (entity.rules || []).forEach((rule, idx) => {
        tbody.appendChild(_buildRuleRow(entity, rule, idx));
    });
    table.appendChild(tbody);
    section.appendChild(table);

    // Add rule button
    const addBtn = _el('button');
    addBtn.textContent = '+ ' + (t('addRule') || 'Add Rule');
    addBtn.style.cssText =
        'margin-top:6px;padding:4px 12px;background:none;border:1px dashed var(--border-color,#555);border-radius:4px;cursor:pointer;font-size:12px;color:var(--text-primary,#e0e0e0);';
    addBtn.onclick = () => {
        if (!entity.rules) entity.rules = [];
        entity.rules.push({ type: 'required', field: '', label: '' });
        refreshDomainEditorModal();
    };
    section.appendChild(addBtn);

    return section;
}

function _buildRuleRow(entity, rule, idx) {
    const tr = _el('tr');
    tr.style.cssText = 'border-bottom:1px solid var(--border-color,#333);';

    // Field
    const tdField = _el('td');
    tdField.style.cssText = 'padding:4px 6px;';
    const fieldInput = _el('input');
    fieldInput.type = 'text';
    fieldInput.value = rule.field || '';
    fieldInput.placeholder = 'field_name';
    fieldInput.style.cssText =
        'width:120px;padding:4px 6px;background:var(--bg-secondary,#222);border:1px solid var(--border-color,#444);border-radius:3px;color:var(--text-primary,#e0e0e0);font-size:12px;';
    fieldInput.onchange = (e) => {
        rule.field = e.target.value.trim();
        if (!rule.label) rule.label = rule.field;
    };
    tdField.appendChild(fieldInput);
    tr.appendChild(tdField);

    // Type
    const tdType = _el('td');
    tdType.style.cssText = 'padding:4px 6px;';
    const typeSelect = _el('select');
    typeSelect.style.cssText =
        'padding:4px 6px;background:var(--bg-secondary,#222);border:1px solid var(--border-color,#444);border-radius:3px;color:var(--text-primary,#e0e0e0);font-size:12px;';
    for (const rt of RULE_TYPES) {
        const opt = _el('option');
        opt.value = rt.value;
        opt.textContent = rt.label;
        if (rt.value === rule.type) opt.selected = true;
        typeSelect.appendChild(opt);
    }
    typeSelect.onchange = (e) => {
        rule.type = e.target.value;
        refreshDomainEditorModal();
    };
    tdType.appendChild(typeSelect);
    tr.appendChild(tdType);

    // Parameters (contextual)
    const tdParams = _el('td');
    tdParams.style.cssText = 'padding:4px 6px;';
    tdParams.appendChild(_buildParamsInput(rule));
    tr.appendChild(tdParams);

    // Severity
    const tdSev = _el('td');
    tdSev.style.cssText = 'padding:4px 6px;';
    const sevSelect = _el('select');
    sevSelect.style.cssText =
        'padding:4px 6px;background:var(--bg-secondary,#222);border:1px solid var(--border-color,#444);border-radius:3px;color:var(--text-primary,#e0e0e0);font-size:12px;';
    for (const sev of ['error', 'warning', 'info']) {
        const opt = _el('option');
        opt.value = sev;
        opt.textContent = sev;
        if ((rule.severity || 'error') === sev) opt.selected = true;
        sevSelect.appendChild(opt);
    }
    sevSelect.onchange = (e) => {
        rule.severity = e.target.value;
    };
    tdSev.appendChild(sevSelect);
    tr.appendChild(tdSev);

    // Delete
    const tdDel = _el('td');
    tdDel.style.cssText = 'padding:4px 6px;';
    const delBtn = _el('button');
    delBtn.textContent = '\u2715';
    delBtn.title = 'Remove rule';
    delBtn.style.cssText = 'background:none;border:none;color:#c62828;cursor:pointer;font-size:14px;padding:2px 6px;';
    delBtn.onclick = () => {
        entity.rules.splice(idx, 1);
        refreshDomainEditorModal();
    };
    tdDel.appendChild(delBtn);
    tr.appendChild(tdDel);

    return tr;
}

function _buildParamsInput(rule) {
    const wrapper = _el('div');
    wrapper.style.cssText = 'display:flex;gap:4px;align-items:center;';
    const inputStyle =
        'padding:4px 6px;background:var(--bg-secondary,#222);border:1px solid var(--border-color,#444);border-radius:3px;color:var(--text-primary,#e0e0e0);font-size:12px;';

    switch (rule.type) {
        case 'required':
        case 'ifAvailable':
            // Sem parametros adicionais
            wrapper.textContent = '\u2014';
            break;

        case 'oneOf': {
            const input = _el('input');
            input.type = 'text';
            input.value = (rule.allowed || []).join(', ');
            input.placeholder = 'value1, value2, ...';
            input.style.cssText = inputStyle + 'width:180px;';
            input.onchange = (e) => {
                rule.allowed = e.target.value
                    .split(',')
                    .map((v) => v.trim())
                    .filter(Boolean);
            };
            wrapper.appendChild(input);
            break;
        }

        case 'numeric': {
            if (!rule.opts) rule.opts = {};
            const minInput = _el('input');
            minInput.type = 'number';
            minInput.value = rule.opts.min ?? '';
            minInput.placeholder = 'min';
            minInput.style.cssText = inputStyle + 'width:70px;';
            minInput.onchange = (e) => {
                rule.opts.min = e.target.value !== '' ? Number(e.target.value) : undefined;
            };
            const maxInput = _el('input');
            maxInput.type = 'number';
            maxInput.value = rule.opts.max ?? '';
            maxInput.placeholder = 'max';
            maxInput.style.cssText = inputStyle + 'width:70px;';
            maxInput.onchange = (e) => {
                rule.opts.max = e.target.value !== '' ? Number(e.target.value) : undefined;
            };
            wrapper.appendChild(minInput);
            wrapper.appendChild(_el('span'));
            wrapper.lastChild.textContent = '\u2013';
            wrapper.appendChild(maxInput);
            break;
        }

        case 'matchPattern': {
            const input = _el('input');
            input.type = 'text';
            input.value = rule.pattern || '';
            input.placeholder = 'regex pattern';
            input.style.cssText = inputStyle + 'width:140px;';
            input.onchange = (e) => {
                rule.pattern = e.target.value;
            };

            const hintInput = _el('input');
            hintInput.type = 'text';
            hintInput.value = rule.formatHint || '';
            hintInput.placeholder = 'hint';
            hintInput.style.cssText = inputStyle + 'width:80px;';
            hintInput.onchange = (e) => {
                rule.formatHint = e.target.value;
            };

            wrapper.appendChild(input);
            wrapper.appendChild(hintInput);
            break;
        }

        case 'custom': {
            const opSelect = _el('select');
            opSelect.style.cssText = inputStyle;
            for (const op of CUSTOM_OPERATORS) {
                const opt = _el('option');
                opt.value = op;
                opt.textContent = op;
                if ((rule.operator || 'eq') === op) opt.selected = true;
                opSelect.appendChild(opt);
            }
            opSelect.onchange = (e) => {
                rule.operator = e.target.value;
            };

            const valInput = _el('input');
            valInput.type = 'text';
            valInput.value = rule.value ?? '';
            valInput.placeholder = 'value';
            valInput.style.cssText = inputStyle + 'width:80px;';
            valInput.onchange = (e) => {
                rule.value = e.target.value;
            };

            wrapper.appendChild(opSelect);
            wrapper.appendChild(valInput);
            break;
        }
    }

    return wrapper;
}

// ── Batch rules section ───────────────────────────────────────────────────────

function _buildBatchRulesSection(entity) {
    const section = _el('div');
    section.style.cssText = 'margin-top:16px;';

    const heading = _el('h4');
    heading.textContent = `Batch Rules (${(entity.batchRules || []).length})`;
    heading.style.cssText = 'margin:0 0 8px;font-size:13px;color:#aaa;';
    section.appendChild(heading);

    (entity.batchRules || []).forEach((br, idx) => {
        const row = _el('div');
        row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:4px;';

        const label = _el('span');
        label.textContent = 'uniqueKey:';
        label.style.cssText = 'font-size:12px;color:#888;';
        row.appendChild(label);

        const input = _el('input');
        input.type = 'text';
        input.value = (br.fields || []).join(', ');
        input.placeholder = 'field1, field2, ...';
        input.style.cssText =
            'padding:4px 6px;background:var(--bg-secondary,#222);border:1px solid var(--border-color,#444);border-radius:3px;color:var(--text-primary,#e0e0e0);font-size:12px;width:200px;';
        input.onchange = (e) => {
            br.fields = e.target.value
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean);
            br.label = br.fields.join('+');
        };
        row.appendChild(input);

        const delBtn = _el('button');
        delBtn.textContent = '\u2715';
        delBtn.style.cssText = 'background:none;border:none;color:#c62828;cursor:pointer;font-size:14px;';
        delBtn.onclick = () => {
            entity.batchRules.splice(idx, 1);
            refreshDomainEditorModal();
        };
        row.appendChild(delBtn);

        section.appendChild(row);
    });

    const addBtn = _el('button');
    addBtn.textContent = '+ ' + (t('addBatchRule') || 'Add Batch Rule');
    addBtn.style.cssText =
        'margin-top:4px;padding:4px 12px;background:none;border:1px dashed var(--border-color,#555);border-radius:4px;cursor:pointer;font-size:12px;color:var(--text-primary,#e0e0e0);';
    addBtn.onclick = () => {
        if (!entity.batchRules) entity.batchRules = [];
        entity.batchRules.push({ type: 'uniqueKey', fields: [], label: '' });
        refreshDomainEditorModal();
    };
    section.appendChild(addBtn);

    return section;
}

// ── Relations section ─────────────────────────────────────────────────────────

function _buildRelationsSection() {
    const section = _el('div');
    section.style.cssText = 'margin-top:16px;';

    const heading = _el('h4');
    heading.textContent = `Relations (${(_draft.relations || []).length})`;
    heading.style.cssText = 'margin:0 0 8px;font-size:13px;color:#aaa;cursor:pointer;';
    heading.title = 'Cross-entity referential integrity';
    section.appendChild(heading);

    const inputStyle =
        'padding:4px 6px;background:var(--bg-secondary,#222);border:1px solid var(--border-color,#444);border-radius:3px;color:var(--text-primary,#e0e0e0);font-size:12px;width:100px;';

    (_draft.relations || []).forEach((rel, idx) => {
        const row = _el('div');
        row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:4px;font-size:12px;';

        for (const [prop, placeholder] of [
            ['from', 'from entity'],
            ['fromField', 'from field'],
            ['to', 'to entity'],
            ['toField', 'to field'],
            ['label', 'label'],
        ]) {
            const input = _el('input');
            input.type = 'text';
            input.value = rel[prop] || '';
            input.placeholder = placeholder;
            input.style.cssText = inputStyle;
            input.onchange = (e) => {
                rel[prop] = e.target.value.trim();
            };
            row.appendChild(input);
        }

        const delBtn = _el('button');
        delBtn.textContent = '\u2715';
        delBtn.style.cssText = 'background:none;border:none;color:#c62828;cursor:pointer;font-size:14px;';
        delBtn.onclick = () => {
            _draft.relations.splice(idx, 1);
            refreshDomainEditorModal();
        };
        row.appendChild(delBtn);
        section.appendChild(row);
    });

    const addBtn = _el('button');
    addBtn.textContent = '+ Add Relation';
    addBtn.style.cssText =
        'margin-top:4px;padding:4px 12px;background:none;border:1px dashed var(--border-color,#555);border-radius:4px;cursor:pointer;font-size:12px;color:var(--text-primary,#e0e0e0);';
    addBtn.onclick = () => {
        if (!_draft.relations) _draft.relations = [];
        _draft.relations.push({ from: '', fromField: '', to: '', toField: '', label: '' });
        refreshDomainEditorModal();
    };
    section.appendChild(addBtn);

    return section;
}

// ── Test panel ────────────────────────────────────────────────────────────────

function _openTestPanel(container) {
    // Remove existing test panel if present
    const existing = document.getElementById('domain-test-panel');
    if (existing) {
        existing.remove();
        return;
    }

    const panel = _el('div', 'domain-test-panel');
    panel.style.cssText =
        'margin-top:16px;padding:12px;border:1px solid var(--border-color,#444);border-radius:6px;background:var(--bg-secondary,#222);';

    const heading = _el('h4');
    heading.textContent = t('testAgainstData') || 'Test Against Data';
    heading.style.cssText = 'margin:0 0 8px;font-size:13px;';
    panel.appendChild(heading);

    const hint = _el('p');
    hint.textContent = 'Paste JSON array of records or upload CSV/JSON:';
    hint.style.cssText = 'font-size:12px;color:#888;margin:0 0 8px;';
    panel.appendChild(hint);

    const textarea = _el('textarea');
    textarea.placeholder = '[{"field1": "value1", "field2": 42}, ...]';
    textarea.style.cssText =
        'width:100%;height:100px;padding:8px;background:var(--bg-primary,#1a1a2e);border:1px solid var(--border-color,#444);border-radius:4px;color:var(--text-primary,#e0e0e0);font-family:monospace;font-size:12px;resize:vertical;';
    panel.appendChild(textarea);

    const btnRow = _el('div');
    btnRow.style.cssText = 'display:flex;gap:8px;margin-top:8px;';

    const runBtn = _actionBtn('Run Test', 'var(--accent,#3b6bff)', async () => {
        const resultsDiv = document.getElementById('domain-test-results');
        if (resultsDiv) resultsDiv.remove();

        let data;
        try {
            data = JSON.parse(textarea.value);
            if (!Array.isArray(data)) data = [data];
        } catch (e) {
            showToast('Invalid JSON', 'error');
            return;
        }

        const result = testDomainAgainstData(_draft, data);
        const div = _el('div', 'domain-test-results');
        div.style.cssText = 'margin-top:12px;max-height:200px;overflow-y:auto;';

        if (!result.valid && result.definitionErrors) {
            div.innerHTML = `<p style="color:#c62828;font-size:12px;">Definition errors: ${escapeHtml(result.definitionErrors.join('; '))}</p>`;
        } else {
            let totalViolations = 0;
            for (const er of result.entityResults || []) {
                totalViolations += (er.violations || []).length;
            }

            if (totalViolations === 0) {
                div.innerHTML = '<p style="color:#4caf50;font-size:12px;">All records valid. No violations found.</p>';
            } else {
                const tbl = _el('table');
                tbl.style.cssText = 'width:100%;border-collapse:collapse;font-size:11px;';
                tbl.innerHTML =
                    '<thead><tr><th style="text-align:left;padding:4px 6px;color:#888;">Row</th><th style="text-align:left;padding:4px 6px;color:#888;">Field</th><th style="text-align:left;padding:4px 6px;color:#888;">Severity</th><th style="text-align:left;padding:4px 6px;color:#888;">Message</th></tr></thead>';
                const tbody = _el('tbody');
                for (const er of result.entityResults || []) {
                    for (const v of er.violations || []) {
                        const row = _el('tr');
                        const sevColor =
                            v.severity === 'error' ? '#c62828' : v.severity === 'warning' ? '#f9a825' : '#2196f3';
                        row.innerHTML = `<td style="padding:4px 6px;">${v.rowIndex ?? '-'}</td><td style="padding:4px 6px;">${escapeHtml(v.field)}</td><td style="padding:4px 6px;color:${sevColor};">${escapeHtml(v.severity)}</td><td style="padding:4px 6px;">${escapeHtml(v.message)}</td>`;
                        tbody.appendChild(row);
                    }
                }
                tbl.appendChild(tbody);
                div.appendChild(tbl);
            }
        }
        panel.appendChild(div);
    });

    const uploadBtn = _actionBtn('Upload File', '#555', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,.csv';
        input.onchange = async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            textarea.value = await file.text();
        };
        input.click();
    });

    btnRow.appendChild(runBtn);
    btnRow.appendChild(uploadBtn);
    panel.appendChild(btnRow);

    container.appendChild(panel);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _el(tag, id) {
    const el = document.createElement(tag);
    if (id) el.id = id;
    return el;
}

function _labeledInput(label, value, onChange, opts = {}) {
    const wrapper = _el('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
    const lbl = _el('label');
    lbl.textContent = label;
    lbl.style.cssText = 'font-size:11px;color:#888;';
    const input = _el('input');
    input.type = 'text';
    input.value = value;
    input.style.cssText = `padding:6px 8px;background:var(--bg-secondary,#222);border:1px solid var(--border-color,#444);border-radius:4px;color:var(--text-primary,#e0e0e0);font-size:13px;width:${opts.width || '160px'};`;
    input.onchange = (e) => onChange(e.target.value);
    wrapper.appendChild(lbl);
    wrapper.appendChild(input);
    return wrapper;
}

function _actionBtn(text, bg, onClick) {
    const btn = _el('button');
    btn.textContent = text;
    btn.style.cssText = `padding:6px 14px;background:${bg};color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;`;
    btn.onclick = onClick;
    return btn;
}
