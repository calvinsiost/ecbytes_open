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
   VALIDATION PROFILE ENGINE
   ================================================================

   Perfis plugaveis de validacao por JSON.
   - Built-ins carregados de /profiles/*.json
   - Perfis customizados persistidos em IDB
   - Validacao batch pura (sem side effects)

   ================================================================ */

import { CONFIG } from '../../config.js';
import { convert } from '../units/converter.js';
import { idbGetWithLegacy, idbSet } from '../../utils/storage/idbStore.js';
import { enqueueSync } from '../../utils/storage/syncQueue.js';
import { calculateStats, detectOutlierIQR, detectOutlierZScore } from './rules.js';

const STORAGE_KEY = 'ecbyts-validation-profiles';
const ACTIVE_IDS_KEY = 'ecbyts-validation-profile-active-ids';

const BUILTIN_FILES = ['./profiles/cetesb-dd256.json', './profiles/conama-420.json'];

let _builtins = [];
let _builtinsLoaded = false;
let _customProfiles = [];
let _customLoaded = false;
let _lastValidationResults = null;

/**
 * Lista perfis disponiveis (built-in + custom).
 * / List available validation profiles.
 *
 * @returns {Promise<Array<Object>>}
 */
export async function listValidationProfiles() {
    await _ensureLoaded();
    return [..._builtins, ..._customProfiles].map(_clone);
}

/**
 * Retorna perfil por ID.
 * / Get profile by ID.
 *
 * @param {string} profileId
 * @returns {Promise<Object|null>}
 */
export async function getValidationProfile(profileId) {
    await _ensureLoaded();
    const found = [..._builtins, ..._customProfiles].find((p) => p.id === profileId);
    return found ? _clone(found) : null;
}

/**
 * Persiste perfil customizado.
 * / Save custom validation profile.
 *
 * @param {Object} profile
 * @returns {Promise<Object>} Perfil salvo
 */
export async function saveCustomProfile(profile) {
    await _ensureLoaded();
    const normalized = _normalizeProfile(profile);
    _assertProfile(normalized);

    if (_builtins.some((p) => p.id === normalized.id)) {
        throw new Error(`Profile ID collision with builtin: ${normalized.id}`);
    }

    const idx = _customProfiles.findIndex((p) => p.id === normalized.id);
    if (idx >= 0) {
        _customProfiles[idx] = normalized;
    } else {
        _customProfiles.push(normalized);
    }

    await idbSet(STORAGE_KEY, _customProfiles);
    enqueueSync('validation_profiles', 'upsert', {
        profile_id: normalized.id,
        name: normalized.name,
        version: normalized.version || '1.0',
        jurisdiction: normalized.jurisdiction || null,
        is_shared: false,
        profile_data: normalized,
    }).catch(() => {});

    return _clone(normalized);
}

/**
 * Remove perfil customizado.
 * / Delete custom profile by ID.
 *
 * @param {string} profileId
 * @returns {Promise<boolean>}
 */
export async function deleteCustomProfile(profileId) {
    await _ensureLoaded();
    const before = _customProfiles.length;
    _customProfiles = _customProfiles.filter((p) => p.id !== profileId);
    if (_customProfiles.length === before) return false;
    await idbSet(STORAGE_KEY, _customProfiles);
    enqueueSync('validation_profiles', 'delete', { profile_id: profileId }, { match: { profile_id: profileId } }).catch(
        () => {},
    );
    return true;
}

/**
 * Define IDs ativos de perfis.
 * / Set active profile IDs.
 *
 * @param {string[]} profileIds
 * @returns {Promise<void>}
 */
export async function setActiveProfileIds(profileIds) {
    const ids = Array.isArray(profileIds)
        ? [...new Set(profileIds.map((v) => String(v || '').trim()).filter(Boolean))]
        : [];
    await idbSet(ACTIVE_IDS_KEY, ids);
}

/**
 * Retorna IDs de perfis ativos, com migração legacy localStorage -> IDB.
 * / Get active profile IDs with legacy migration.
 *
 * @returns {Promise<string[]>}
 */
export async function getActiveProfileIds() {
    const saved = await idbGetWithLegacy(ACTIVE_IDS_KEY);
    return Array.isArray(saved) ? saved.filter((v) => typeof v === 'string') : [];
}

/**
 * Valida lote de observacoes usando um perfil.
 * / Validate observation batch with selected profile.
 *
 * @param {Array<Object>} observations
 * @param {string|Object} profileRef - ID do perfil ou objeto de perfil
 * @param {Object} [options]
 * @param {boolean} [options.includeWarnings=true]
 * @returns {Promise<{profileId:string,violations:Array,interventionCandidates:Array,summary:Object}>}
 */
export async function validateBatchWithProfile(observations, profileRef, options = {}) {
    const includeWarnings = options.includeWarnings !== false;
    const profile = await _resolveProfile(profileRef);
    if (!profile) {
        throw new Error('Validation profile not found');
    }

    const rows = Array.isArray(observations) ? observations : [];
    const byParam = _groupByParameter(rows);
    const violations = [];
    const interventionCandidates = [];

    for (const row of rows) {
        const context = _normalizeObservation(row);
        for (const rule of profile.rules || []) {
            const result = _runRule(rule, context, byParam);
            if (!result) continue;
            if (result.severity === 'warning' && !includeWarnings) continue;

            const violation = {
                profileId: profile.id,
                profileName: profile.name,
                ruleId: rule.ruleId || '',
                ruleType: rule.type,
                severity: result.severity || 'warning',
                message: result.message || '',
                elementId: context.elementId || null,
                observationId: context.id || null,
                campaignId: context.campaignId || null,
                parameterId: context.parameterId || null,
                measuredValue: Number.isFinite(context.value) ? context.value : null,
                thresholdValue: Number.isFinite(result.thresholdValue) ? result.thresholdValue : null,
                unit: result.unit || context.unitId || null,
                metadata: result.metadata || {},
            };

            violations.push(violation);
            if (violation.severity === 'intervention' || violation.severity === 'critical') {
                interventionCandidates.push({
                    ...violation,
                    title: `${context.parameterId || 'parameter'} exceeds threshold`,
                    description: violation.message,
                });
            }
        }
    }

    const summary = _buildSummary(rows.length, violations);
    const payload = {
        profileId: profile.id,
        violations,
        interventionCandidates,
        summary,
    };
    _lastValidationResults = _clone(payload);
    return payload;
}

/**
 * Obtem ultimo resultado de validacao em memoria.
 * / Get latest validation results from memory.
 *
 * @returns {Object|null}
 */
export function getLastValidationResults() {
    return _lastValidationResults ? _clone(_lastValidationResults) : null;
}

async function _ensureLoaded() {
    if (!_builtinsLoaded) {
        _builtins = await _loadBuiltins();
        _builtinsLoaded = true;
    }
    if (!_customLoaded) {
        const stored = await idbGetWithLegacy(STORAGE_KEY);
        _customProfiles = Array.isArray(stored) ? stored.map(_normalizeProfile).filter((p) => _isProfileValid(p)) : [];
        _customLoaded = true;
    }
}

async function _loadBuiltins() {
    const profiles = [];
    for (const relPath of BUILTIN_FILES) {
        try {
            const url = new URL(relPath, import.meta.url);
            const res = await fetch(url);
            if (!res.ok) continue;
            const json = await res.json();
            const normalized = _normalizeProfile(json);
            if (_isProfileValid(normalized)) {
                profiles.push(normalized);
            }
        } catch {
            // no-op
        }
    }
    return profiles;
}

async function _resolveProfile(profileRef) {
    if (profileRef && typeof profileRef === 'object') {
        return _normalizeProfile(profileRef);
    }
    const profileId = String(profileRef || '').trim();
    if (!profileId) return null;
    return getValidationProfile(profileId);
}

function _runRule(rule, obs, groupedByParam) {
    if (!rule || typeof rule !== 'object') return null;
    switch (rule.type) {
        case 'threshold':
            return _runThresholdRule(rule, obs);
        case 'required_field':
            return _runRequiredFieldRule(rule, obs);
        case 'unit_check':
            return _runUnitCheckRule(rule, obs);
        case 'outlier_zscore':
            return _runOutlierZScoreRule(rule, obs, groupedByParam);
        case 'outlier_iqr':
            return _runOutlierIQRRule(rule, obs, groupedByParam);
        default:
            return null;
    }
}

function _runThresholdRule(rule, obs) {
    if (!Number.isFinite(obs.value)) return null;
    if (rule.parameterId && rule.parameterId !== obs.parameterId) return null;
    if (rule.casNumber && rule.casNumber !== obs.parameter?.casNumber) return null;
    if (rule.matrix && rule.matrix !== obs.matrix) return null;

    const thresholds = Array.isArray(rule.thresholds) ? rule.thresholds : [];
    if (thresholds.length === 0) return null;

    const targetUnit = thresholds[0].unit || obs.unitId;
    const converted = convert(obs.value, obs.unitId, targetUnit);
    if (!converted.success) {
        return {
            severity: 'warning',
            message: 'Unit conversion failed for threshold check',
            unit: obs.unitId,
        };
    }

    const sorted = [...thresholds].sort((a, b) => Number(b.value) - Number(a.value));
    for (const th of sorted) {
        if (!Number.isFinite(th.value)) continue;
        if (converted.value >= th.value) {
            const severity = th.severity || _severityByType(th.type);
            return {
                severity,
                message: `Exceeded ${String(th.type || 'threshold').toUpperCase()}: ${converted.value.toFixed(3)} > ${th.value} ${th.unit}`,
                thresholdValue: th.value,
                unit: th.unit || targetUnit,
                metadata: { thresholdType: th.type || 'custom' },
            };
        }
    }
    return null;
}

function _runRequiredFieldRule(rule, obs) {
    const value = _getByPath(obs, rule.field);
    if (value === null || value === undefined || value === '') {
        return {
            severity: 'warning',
            message: `Required field missing: ${rule.field || '(unknown)'}`,
        };
    }
    return null;
}

function _runUnitCheckRule(rule, obs) {
    if (rule.parameterId && rule.parameterId !== obs.parameterId) return null;
    const allowed = Array.isArray(rule.allowedUnits) ? rule.allowedUnits : [];
    if (allowed.length === 0) return null;
    if (!allowed.includes(obs.unitId)) {
        return {
            severity: 'warning',
            message: `Unit ${obs.unitId || '(none)'} not allowed. Expected: ${allowed.join(', ')}`,
            unit: obs.unitId,
        };
    }
    return null;
}

function _runOutlierZScoreRule(rule, obs, groupedByParam) {
    if (!Number.isFinite(obs.value) || !obs.parameterId) return null;
    const values = groupedByParam.get(obs.parameterId) || [];
    const stats = calculateStats(values);
    const threshold = Number.isFinite(rule.threshold) ? rule.threshold : 3;
    const result = detectOutlierZScore(obs.value, stats.mean, stats.stdDev, threshold);
    if (!result) return null;
    return {
        severity: 'warning',
        message: result.message,
        metadata: { method: 'zscore', zscore: result.zscore },
    };
}

function _runOutlierIQRRule(rule, obs, groupedByParam) {
    if (!Number.isFinite(obs.value) || !obs.parameterId) return null;
    const values = groupedByParam.get(obs.parameterId) || [];
    const stats = calculateStats(values);
    const factor = Number.isFinite(rule.factor) ? rule.factor : 1.5;
    const result = detectOutlierIQR(obs.value, stats.q1, stats.q3, factor);
    if (!result) return null;
    return {
        severity: 'warning',
        message: result.message,
        metadata: { method: 'iqr', lowerBound: result.lowerBound, upperBound: result.upperBound },
    };
}

function _groupByParameter(observations) {
    const byParam = new Map();
    for (const row of observations) {
        const obs = _normalizeObservation(row);
        if (!obs.parameterId || !Number.isFinite(obs.value)) continue;
        const arr = byParam.get(obs.parameterId) || [];
        arr.push(obs.value);
        byParam.set(obs.parameterId, arr);
    }
    return byParam;
}

function _normalizeObservation(row) {
    const parameterId = row.parameterId || row.parameter?.id || null;
    const fromConfig = parameterId ? CONFIG.PARAMETERS.find((p) => p.id === parameterId) : null;
    return {
        id: row.id || row.observationId || null,
        elementId: row.elementId || null,
        campaignId: row.campaignId || null,
        parameterId,
        parameter: row.parameter || fromConfig || null,
        value: Number(row.value),
        unitId: row.unitId || fromConfig?.defaultUnitId || 'none',
        matrix: row.matrix || row.parameter?.matrix || 'groundwater',
    };
}

function _buildSummary(totalObs, violations) {
    const bySeverity = { info: 0, warning: 0, prevention: 0, intervention: 0, critical: 0 };
    for (const v of violations) {
        bySeverity[v.severity] = (bySeverity[v.severity] || 0) + 1;
    }
    return {
        totalObservations: totalObs,
        totalViolations: violations.length,
        bySeverity,
    };
}

function _normalizeProfile(profile) {
    const rules = Array.isArray(profile?.rules) ? profile.rules.filter((r) => r && typeof r === 'object') : [];
    return {
        id: String(profile?.id || '').trim(),
        name: String(profile?.name || '').trim(),
        version: String(profile?.version || '1.0').trim(),
        jurisdiction: String(profile?.jurisdiction || '').trim(),
        matrices: Array.isArray(profile?.matrices) ? profile.matrices.map((v) => String(v)) : [],
        rules,
    };
}

function _assertProfile(profile) {
    if (!_isProfileValid(profile)) {
        throw new Error('Invalid validation profile');
    }
}

function _isProfileValid(profile) {
    return !!(profile && profile.id && profile.name && Array.isArray(profile.rules));
}

function _severityByType(type) {
    if (type === 'vi' || type === 'cma') return 'intervention';
    if (type === 'vp') return 'prevention';
    if (type === 'vr') return 'warning';
    return 'warning';
}

function _getByPath(obj, path) {
    if (!path || typeof path !== 'string') return undefined;
    const parts = path.split('.');
    let current = obj;
    for (const key of parts) {
        if (!current || typeof current !== 'object') return undefined;
        current = current[key];
    }
    return current;
}

function _clone(value) {
    return JSON.parse(JSON.stringify(value));
}
