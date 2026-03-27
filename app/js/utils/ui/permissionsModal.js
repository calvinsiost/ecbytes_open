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
   PERMISSIONS MODAL — Manage access rules (RBAC)
   Modal para gerenciar regras de acesso por papel e acao

   Permite ao admin/owner:
   - Listar regras existentes (email, papel, area, overrides)
   - Adicionar novas regras com overrides por acao
   - Editar/remover regras existentes
   ================================================================ */

import { t } from '../i18n/translations.js';
import {
    getRules,
    addRule,
    updateRule,
    removeRule,
    VALID_ACTIONS,
    ROLE_HIERARCHY,
    isOwner,
    isAdmin,
} from '../auth/permissions.js';
import { showToast } from './toast.js';
import { escapeHtml } from '../helpers/html.js';

// ----------------------------------------------------------------
// STATE
// ----------------------------------------------------------------

let _overlay = null;
let _editingIndex = -1; // -1 = adding new, >= 0 = editing existing

// Roles available for assignment (owner is implicit, none means remove)
const ASSIGNABLE_ROLES = ['admin', 'editor', 'viewer', 'observer'];

// Actions available for override checkboxes
const OVERRIDE_ACTIONS = [...VALID_ACTIONS];

// ----------------------------------------------------------------
// PUBLIC API
// ----------------------------------------------------------------

/**
 * Open the permissions management modal.
 * Abre o modal de gerenciamento de permissoes.
 */
export function openPermissionsModal() {
    if (!isOwner() && !isAdmin()) {
        showToast(t('auth.actionDenied') || "You don't have permission to perform this action.", 'error');
        return;
    }

    if (_overlay) return; // Already open

    _overlay = document.createElement('div');
    _overlay.className = 'modal-overlay';
    _overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9000;display:flex;align-items:center;justify-content:center;';

    const modal = document.createElement('div');
    modal.className = 'modal-content permissions-modal';
    modal.style.cssText =
        'background:var(--bg-primary,#1e1e2e);color:var(--text-primary,#cdd6f4);border-radius:8px;padding:24px;max-width:720px;width:90%;max-height:80vh;overflow-y:auto;position:relative;';

    modal.innerHTML = _buildModalHTML();
    _overlay.appendChild(modal);
    document.body.appendChild(_overlay);

    // Event delegation
    modal.addEventListener('click', _handleClick);
    _overlay.addEventListener('click', (e) => {
        if (e.target === _overlay) _close();
    });

    // Escape to close
    _overlay._keyHandler = (e) => {
        if (e.key === 'Escape') _close();
    };
    document.addEventListener('keydown', _overlay._keyHandler);
}

// ----------------------------------------------------------------
// HTML BUILDERS
// ----------------------------------------------------------------

/**
 * Build the full modal HTML content.
 * @returns {string}
 */
function _buildModalHTML() {
    const rules = getRules();
    const title = t('permissions.title') || 'Access Rules';
    const addBtn = t('permissions.addRule') || 'Add Rule';

    let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="margin:0;">${escapeHtml(title)}</h3>
        <button data-action="close" style="background:none;border:none;color:var(--text-primary,#cdd6f4);font-size:18px;cursor:pointer;" aria-label="Close">&#10005;</button>
    </div>`;

    // Rules list
    if (rules.length === 0) {
        html += `<p style="opacity:0.6;">${escapeHtml(t('permissions.noRules') || 'No access rules configured. All users have full access.')}</p>`;
    } else {
        html += '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">';
        for (let i = 0; i < rules.length; i++) {
            html += _buildRuleRow(rules[i], i);
        }
        html += '</div>';
    }

    // Add rule button
    html += `<button data-action="add" style="padding:6px 16px;border-radius:4px;border:1px solid var(--accent,#89b4fa);background:transparent;color:var(--accent,#89b4fa);cursor:pointer;">${escapeHtml(addBtn)}</button>`;

    // Form area (hidden initially)
    html += '<div id="perm-form-area" style="display:none;margin-top:16px;"></div>';

    return html;
}

/**
 * Build a single rule row.
 * @param {Object} rule
 * @param {number} index
 * @returns {string}
 */
function _buildRuleRow(rule, index) {
    const email = escapeHtml(rule.email || '(no email)');
    const role = escapeHtml(rule.role || 'viewer');
    const areas = rule.areas ? (Array.isArray(rule.areas) ? rule.areas.join(', ') : String(rule.areas)) : '*';
    const overrides = rule.actionOverrides || {};
    const overrideStr =
        Object.entries(overrides)
            .map(([a, v]) => `${a}:${v}`)
            .join(', ') || '--';

    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-secondary,#313244);border-radius:4px;" data-rule-index="${index}">
        <div style="flex:1;min-width:0;">
            <div style="font-weight:600;">${email} <span style="opacity:0.7;font-weight:400;">[${role}]</span></div>
            <div style="font-size:0.85em;opacity:0.6;">Areas: ${escapeHtml(areas)} | Overrides: ${escapeHtml(overrideStr)}</div>
        </div>
        <button data-action="edit" data-index="${index}" style="padding:4px 10px;border-radius:4px;border:1px solid var(--accent,#89b4fa);background:transparent;color:var(--accent,#89b4fa);cursor:pointer;font-size:0.85em;">${escapeHtml(t('edit') || 'Edit')}</button>
        <button data-action="remove" data-index="${index}" style="padding:4px 10px;border-radius:4px;border:1px solid #f38ba8;background:transparent;color:#f38ba8;cursor:pointer;font-size:0.85em;">${escapeHtml(t('remove') || 'Remove')}</button>
    </div>`;
}

/**
 * Build the add/edit form HTML.
 * @param {Object|null} rule - Existing rule for editing, null for new
 * @returns {string}
 */
function _buildForm(rule) {
    const email = rule?.email || '';
    const role = rule?.role || 'viewer';
    const areas = rule?.areas ? (Array.isArray(rule.areas) ? rule.areas.join(', ') : '') : '*';
    const overrides = rule?.actionOverrides || {};

    const saveLabel = escapeHtml(t('save') || 'Save');
    const cancelLabel = escapeHtml(t('cancel') || 'Cancel');

    let html = `<div style="border:1px solid var(--border,#45475a);border-radius:6px;padding:16px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
            <div>
                <label style="font-size:0.85em;opacity:0.7;">Email</label>
                <input id="perm-email" type="email" value="${escapeHtml(email)}" style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid var(--border,#45475a);background:var(--bg-primary,#1e1e2e);color:var(--text-primary,#cdd6f4);" />
            </div>
            <div>
                <label style="font-size:0.85em;opacity:0.7;">${escapeHtml(t('role') || 'Role')}</label>
                <select id="perm-role" style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid var(--border,#45475a);background:var(--bg-primary,#1e1e2e);color:var(--text-primary,#cdd6f4);">`;

    for (const r of ASSIGNABLE_ROLES) {
        const sel = r === role ? ' selected' : '';
        html += `<option value="${r}"${sel}>${r}</option>`;
    }

    html += `</select>
            </div>
        </div>
        <div style="margin-bottom:12px;">
            <label style="font-size:0.85em;opacity:0.7;">${escapeHtml(t('permissions.areas') || 'Areas (comma-separated, * = all)')}</label>
            <input id="perm-areas" type="text" value="${escapeHtml(areas)}" style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid var(--border,#45475a);background:var(--bg-primary,#1e1e2e);color:var(--text-primary,#cdd6f4);" />
        </div>
        <div style="margin-bottom:12px;">
            <label style="font-size:0.85em;opacity:0.7;">${escapeHtml(t('permissions.actionOverrides') || 'Action Overrides')}</label>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px;margin-top:6px;">`;

    for (const action of OVERRIDE_ACTIONS) {
        const current = overrides[action] || '';
        html += `<div style="display:flex;align-items:center;gap:6px;font-size:0.85em;">
            <span style="min-width:50px;">${escapeHtml(action)}</span>
            <select data-override-action="${action}" style="flex:1;padding:3px 6px;border-radius:3px;border:1px solid var(--border,#45475a);background:var(--bg-primary,#1e1e2e);color:var(--text-primary,#cdd6f4);font-size:0.9em;">
                <option value=""${current === '' ? ' selected' : ''}>(default)</option>
                <option value="grant"${current === 'grant' ? ' selected' : ''}>grant</option>
                <option value="deny"${current === 'deny' ? ' selected' : ''}>deny</option>
            </select>
        </div>`;
    }

    html += `</div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button data-action="cancel-form" style="padding:6px 16px;border-radius:4px;border:1px solid var(--border,#45475a);background:transparent;color:var(--text-primary,#cdd6f4);cursor:pointer;">${cancelLabel}</button>
            <button data-action="save-form" style="padding:6px 16px;border-radius:4px;border:none;background:var(--accent,#89b4fa);color:#1e1e2e;cursor:pointer;font-weight:600;">${saveLabel}</button>
        </div>
    </div>`;

    return html;
}

// ----------------------------------------------------------------
// EVENT HANDLING
// ----------------------------------------------------------------

/**
 * Handle clicks inside the modal via delegation.
 * @param {MouseEvent} e
 */
function _handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const index = btn.dataset.index !== undefined ? parseInt(btn.dataset.index, 10) : -1;

    switch (action) {
        case 'close':
            _close();
            break;
        case 'add':
            _editingIndex = -1;
            _showForm(null);
            break;
        case 'edit':
            _editingIndex = index;
            _showForm(getRules()[index]);
            break;
        case 'remove':
            removeRule(index);
            _refresh();
            showToast(t('permissions.ruleRemoved') || 'Rule removed', 'info');
            break;
        case 'cancel-form':
            _hideForm();
            break;
        case 'save-form':
            _saveForm();
            break;
    }
}

/**
 * Show the add/edit form.
 * @param {Object|null} rule
 */
function _showForm(rule) {
    const area = _overlay?.querySelector('#perm-form-area');
    if (!area) return;
    area.style.display = 'block';
    area.innerHTML = _buildForm(rule);
}

/**
 * Hide the form area.
 */
function _hideForm() {
    const area = _overlay?.querySelector('#perm-form-area');
    if (area) {
        area.style.display = 'none';
        area.innerHTML = '';
    }
    _editingIndex = -1;
}

/**
 * Save form data as new or updated rule.
 */
function _saveForm() {
    const email = _overlay?.querySelector('#perm-email')?.value?.trim();
    const role = _overlay?.querySelector('#perm-role')?.value || 'viewer';
    const areasRaw = _overlay?.querySelector('#perm-areas')?.value?.trim() || '*';

    if (!email) {
        showToast(t('permissions.emailRequired') || 'Email is required', 'error');
        return;
    }

    const areas = areasRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    // Collect action overrides
    const actionOverrides = {};
    const selects = _overlay?.querySelectorAll('[data-override-action]') || [];
    for (const sel of selects) {
        const act = sel.dataset.overrideAction;
        const val = sel.value;
        if (val === 'grant' || val === 'deny') {
            actionOverrides[act] = val;
        }
    }

    const ruleData = { email, role, areas, actionOverrides };

    if (_editingIndex >= 0) {
        updateRule(_editingIndex, ruleData);
        showToast(t('permissions.ruleUpdated') || 'Rule updated', 'success');
    } else {
        addRule(ruleData);
        showToast(t('permissions.ruleAdded') || 'Rule added', 'success');
    }

    _hideForm();
    _refresh();
}

/**
 * Refresh the modal content (re-render rules list).
 */
function _refresh() {
    if (!_overlay) return;
    const modal = _overlay.querySelector('.permissions-modal');
    if (modal) {
        modal.innerHTML = _buildModalHTML();
    }
}

/**
 * Close the permissions modal.
 */
function _close() {
    if (_overlay) {
        if (_overlay._keyHandler) {
            document.removeEventListener('keydown', _overlay._keyHandler);
        }
        _overlay.remove();
        _overlay = null;
        _editingIndex = -1;
    }
}
