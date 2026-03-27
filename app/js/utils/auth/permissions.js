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
   PERMISSIONS — Area-scoped role-based access control
   Controle de acesso baseado em papeis por area

   PAPEIS (do mais privilegiado ao menos):
   - owner:    Dono do modelo — acesso total + gerencia permissoes
   - admin:    Administrador — edita tudo nas areas atribuidas + gerencia permissoes
   - editor:   Editor — edita elementos/observacoes nas areas atribuidas
   - viewer:   Visualizador — somente leitura nas areas atribuidas
   - observer: Observador — pode enviar observacoes/comentarios (pendente aprovacao)
   - none:     Sem acesso

   ARMAZENAMENTO:
   Configuracao de acesso viaja com o modelo (model.access).
   Se nao houver config (modelos antigos), tudo e permitido.
   ================================================================ */

import { getUserEmail, isLoggedIn } from './session.js';
import { getElementById } from '../../core/elements/manager.js';
import { findContainedElements } from '../edges/manager.js';
import { CONFIG } from '../../config.js';

// ----------------------------------------------------------------
// ACTION RBAC CONSTANTS
// Constantes para controle de acesso por tipo de acao
// ----------------------------------------------------------------

/**
 * Set de acoes validas para RBAC por acao.
 * Cada acao pode ter override 'deny' ou 'grant' por regra.
 */
export const VALID_ACTIONS = new Set(['view', 'edit', 'delete', 'export', 'admin', 'import', 'share', 'report']);

/**
 * Hierarquia de papeis, do mais ao menos privilegiado.
 * Indice menor = mais privilegiado.
 */
export const ROLE_HIERARCHY = ['owner', 'admin', 'editor', 'viewer', 'observer', 'none'];

/**
 * Papel minimo exigido por acao quando nao ha override especifico.
 * Define o comportamento padrao do sistema.
 */
export const ACTION_DEFAULTS = {
    view: 'observer', // Qualquer usuario com acesso pode visualizar
    edit: 'editor', // Editor e acima podem editar
    delete: 'editor', // Editor e acima podem deletar
    export: 'viewer', // Visualizador e acima podem exportar
    admin: 'admin', // Apenas admin e acima
    import: 'editor', // Editor e acima podem importar
    share: 'admin', // Apenas admin e acima podem compartilhar
    report: 'viewer', // Visualizador e acima podem gerar relatorios
};

// ----------------------------------------------------------------
// STATE
// ----------------------------------------------------------------

let accessConfig = {
    owner: null,
    observerMode: 'disabled', // 'disabled' | 'authenticated' | 'public'
    rules: [], // [{ email, role, areas: string[] }]
};

// ----------------------------------------------------------------
// INITIALIZATION & EXPORT
// ----------------------------------------------------------------

/**
 * Initialize permissions from model import.
 * Inicializa permissoes a partir dos dados do modelo importado.
 *
 * @param {Object} config - Access config from model.access
 */
export function initPermissions(config) {
    accessConfig = {
        owner: config?.owner || null,
        observerMode: config?.observerMode || 'disabled',
        rules: Array.isArray(config?.rules) ? config.rules : [],
    };
}

/**
 * Export permissions config for model export.
 * Exporta configuracao de permissoes para inclusao no modelo.
 *
 * @returns {Object} Access config
 */
export function exportPermissions() {
    return {
        owner: accessConfig.owner,
        observerMode: accessConfig.observerMode,
        rules: accessConfig.rules.map((r) => ({ ...r })),
    };
}

/**
 * Reset permissions to default (no restrictions).
 * Reseta permissoes para padrao (sem restricoes).
 */
export function resetPermissions() {
    accessConfig = { owner: null, observerMode: 'disabled', rules: [] };
}

// ----------------------------------------------------------------
// BACKWARD COMPATIBILITY CHECK
// ----------------------------------------------------------------

/**
 * Check if access control is configured.
 * Se nao houver owner nem regras, tudo e permitido (compatibilidade).
 *
 * @returns {boolean} true if access control is active
 */
export function isAccessControlActive() {
    return !!(accessConfig.owner || accessConfig.rules.length > 0);
}

// ----------------------------------------------------------------
// OWNERSHIP
// ----------------------------------------------------------------

/**
 * Check if current user is the model owner.
 * @returns {boolean}
 */
export function isOwner() {
    const email = getUserEmail();
    return !!email && accessConfig.owner === email;
}

/**
 * Claim ownership (only if no owner set).
 * Reivindica propriedade do modelo (so se nao houver dono).
 *
 * @param {string} email
 * @returns {boolean} true if claimed
 */
export function claimOwnership(email) {
    if (accessConfig.owner) return false;
    accessConfig.owner = email;
    return true;
}

/**
 * Get model owner email.
 * @returns {string|null}
 */
export function getOwner() {
    return accessConfig.owner;
}

/**
 * Set model owner (admin action).
 * @param {string} email
 */
export function setOwner(email) {
    accessConfig.owner = email || null;
}

// ----------------------------------------------------------------
// ROLE CHECKS
// ----------------------------------------------------------------

/**
 * Get current user's effective role for a specific area.
 * Retorna o papel efetivo do usuario na area especificada.
 *
 * @param {string} [areaId] - Area ID (from areasTreeData). Null = global check.
 * @returns {'owner'|'admin'|'editor'|'viewer'|'observer'|'none'}
 */
export function getUserRole(areaId) {
    // No access control → everything allowed (backward compat)
    if (!isAccessControlActive()) return 'owner';

    // Owner has full access everywhere
    if (isOwner()) return 'owner';

    const email = getUserEmail();
    if (email) {
        // Check explicit rules for this user
        const userRules = accessConfig.rules.filter((r) => r.email === email);

        // Find highest role that applies to this area
        const roleHierarchy = ['admin', 'editor', 'viewer'];
        for (const role of roleHierarchy) {
            for (const rule of userRules) {
                if (rule.role !== role) continue;
                if (!areaId || rule.areas.includes('*') || rule.areas.includes(areaId)) {
                    return role;
                }
            }
        }
    }

    // Fallback: check observer mode
    if (accessConfig.observerMode === 'public') return 'observer';
    if (accessConfig.observerMode === 'authenticated' && isLoggedIn()) return 'observer';

    return 'none';
}

/**
 * Check if the user's role meets or exceeds the minimum required role.
 * Verifica se o papel do usuario e suficiente para a acao.
 *
 * @param {string} role - User's current role
 * @param {string} minRole - Minimum role required
 * @returns {boolean}
 */
function _roleAtLeast(role, minRole) {
    const i = ROLE_HIERARCHY.indexOf(role);
    const j = ROLE_HIERARCHY.indexOf(minRole);
    if (i === -1 || j === -1) return false;
    return i <= j; // Menor indice = mais privilegiado
}

/**
 * Check if current user can perform a specific action in an area.
 * Resolution order: owner bypass -> actionOverrides (deny > grant) -> role default.
 * Verifica se o usuario pode executar a acao, com suporte a overrides por regra.
 *
 * @param {string} action - Action name (from VALID_ACTIONS)
 * @param {string} [areaId] - Area ID for scoped check
 * @param {string} [orgId] - Reserved for future org-scoped RBAC
 * @returns {boolean}
 */
export function canDo(action, areaId, orgId) {
     
    // Compatibilidade: sem controle de acesso ativo -> tudo permitido
    if (!isAccessControlActive()) return true;

    // Owner tem acesso irrestrito
    if (isOwner()) return true;

    const email = getUserEmail();
    const userRole = getUserRole(areaId);

    // Verifica actionOverrides apenas se RBAC por acao estiver habilitado
    if (CONFIG.ENABLE_ACTION_RBAC && email) {
        const userRules = accessConfig.rules.filter((r) => {
            if (r.email !== email) return false;
            if (!areaId || !r.areas || r.areas.includes('*') || r.areas.includes(areaId)) return true;
            return false;
        });

        let hasDeny = false;
        let hasGrant = false;
        for (const rule of userRules) {
            const override = rule.actionOverrides?.[action];
            if (override === 'deny') hasDeny = true;
            if (override === 'grant') hasGrant = true;
        }

        // Deny tem prioridade sobre grant; ambos tem prioridade sobre default
        if (hasDeny) return false;
        if (hasGrant) return true;
    }

    // Resolucao padrao: verifica papel minimo para a acao
    const defaultMinRole = ACTION_DEFAULTS[action] ?? 'editor';
    return _roleAtLeast(userRole, defaultMinRole);
}

/**
 * Sanitize actionOverrides object from ECO1 import.
 * Remove entries with invalid action names or non-'deny'/'grant' values.
 * Sanitiza overrides importados — garante que nao ha valores maliciosos.
 *
 * @param {*} overrides - Raw actionOverrides from imported rule
 * @returns {Object} Clean actionOverrides object
 */
export function sanitizeActionOverrides(overrides) {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
        return {};
    }
    const clean = {};
    for (const [action, value] of Object.entries(overrides)) {
        if (VALID_ACTIONS.has(action) && (value === 'deny' || value === 'grant')) {
            clean[action] = value;
        }
    }
    return clean;
}

/**
 * Check if current user can edit in a specific area.
 * Wrapper over canDo('edit') for backward compatibility.
 * @param {string} [areaId]
 * @returns {boolean}
 */
export function canEdit(areaId) {
    return canDo('edit', areaId);
}

/**
 * Check if current user can view in a specific area.
 * Wrapper over canDo('view') for backward compatibility.
 * @param {string} [areaId]
 * @returns {boolean}
 */
export function canView(areaId) {
    return canDo('view', areaId);
}

/**
 * Check if current user can delete in a specific area.
 * @param {string} [areaId]
 * @returns {boolean}
 */
export function canDelete(areaId) {
    return canDo('delete', areaId);
}

/**
 * Check if current user can export in a specific area.
 * @param {string} [areaId]
 * @returns {boolean}
 */
export function canExport(areaId) {
    return canDo('export', areaId);
}

/**
 * Check if current user is admin (any area).
 * @returns {boolean}
 */
export function isAdmin() {
    if (!isAccessControlActive()) return true;
    if (isOwner()) return true;

    const email = getUserEmail();
    if (!email) return false;

    return accessConfig.rules.some((r) => r.email === email && r.role === 'admin');
}

/**
 * Check if current user is in observer mode.
 * @returns {boolean}
 */
export function isObserver() {
    if (!isAccessControlActive()) return false;

    const role = getUserRole();
    return role === 'observer';
}

// ----------------------------------------------------------------
// ELEMENT-LEVEL PERMISSIONS
// ----------------------------------------------------------------

/**
 * Check if user can edit a specific element.
 * Verifica se o usuario pode editar um elemento especifico.
 *
 * @param {string} elementId
 * @returns {boolean}
 */
export function canEditElement(elementId) {
    if (!isAccessControlActive()) return true;
    if (isOwner()) return true;

    const areaId = getElementArea(elementId);
    // Elements not in any area: only owner/admin can edit
    if (!areaId) return isAdmin();

    return canEdit(areaId);
}

/**
 * Check if user can view a specific element.
 * @param {string} elementId
 * @returns {boolean}
 */
export function canViewElement(elementId) {
    if (!isAccessControlActive()) return true;
    if (isOwner()) return true;

    const areaId = getElementArea(elementId);
    // Elements not in any area: visible to everyone
    if (!areaId) return true;

    return canView(areaId);
}

/**
 * Determine which area an element belongs to.
 * Determina a qual area um elemento pertence via edges.
 *
 * @param {string} elementId
 * @returns {string|null} Area ID or null
 */
function getElementArea(elementId) {
    const element = getElementById(elementId);
    if (element?.data?.areaId) return element.data.areaId;

    // Check spatial containment via edges
    const allAreas = window.areasTreeData || [];
    for (const area of flattenTree(allAreas)) {
        const contained = findContainedElements(area.id);
        if (contained && contained.includes(elementId)) {
            return area.id;
        }
    }

    return null;
}

/**
 * Flatten tree to array of nodes.
 * @param {Array} nodes
 * @returns {Array}
 */
function flattenTree(nodes) {
    const result = [];
    function walk(node) {
        result.push(node);
        if (Array.isArray(node.children)) {
            node.children.forEach(walk);
        }
    }
    nodes.forEach(walk);
    return result;
}

// ----------------------------------------------------------------
// OBSERVER MODE
// ----------------------------------------------------------------

/**
 * Set observer mode.
 * @param {'disabled'|'authenticated'|'public'} mode
 */
export function setObserverMode(mode) {
    if (['disabled', 'authenticated', 'public'].includes(mode)) {
        accessConfig.observerMode = mode;
    }
}

/**
 * Get observer mode.
 * @returns {'disabled'|'authenticated'|'public'}
 */
export function getObserverMode() {
    return accessConfig.observerMode;
}

// ----------------------------------------------------------------
// RULE MANAGEMENT
// ----------------------------------------------------------------

/**
 * Get all access rules.
 * @returns {Array<{ email: string, role: string, areas: string[] }>}
 */
export function getRules() {
    return accessConfig.rules.map((r) => ({ ...r }));
}

/**
 * Add an access rule.
 * @param {{ email: string, role: string, areas: string[] }} rule
 */
export function addRule(rule) {
    accessConfig.rules.push({
        email: rule.email || '',
        role: rule.role || 'viewer',
        areas: Array.isArray(rule.areas) ? [...rule.areas] : ['*'],
    });
}

/**
 * Remove an access rule by index.
 * @param {number} index
 */
export function removeRule(index) {
    if (index >= 0 && index < accessConfig.rules.length) {
        accessConfig.rules.splice(index, 1);
    }
}

/**
 * Update an access rule.
 * @param {number} index
 * @param {Object} updates - Fields to update
 */
export function updateRule(index, updates) {
    if (index >= 0 && index < accessConfig.rules.length) {
        Object.assign(accessConfig.rules[index], updates);
    }
}
