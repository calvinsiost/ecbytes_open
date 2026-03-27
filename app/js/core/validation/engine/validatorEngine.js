/**
 * ecbyts — Domain Validator Engine v3 (generic, entity-model)
 *
 * Architecture:
 *   Record rules  — validate single record
 *   Batch rules   — validate across records (uniqueKey, cross-record)
 *   Dataset rules — validate across entities (referential integrity)
 *
 * Domains are 100% user-defined via JSON. No built-in domains.
 * Use domainLoader.js to register JSON domain definitions.
 *
 * @license AGPL-3.0-only
 */

import { CODES, hint } from './errorCodes.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * @typedef {'ingest'|'sign'|'export'} ValidationMode
 * @typedef {'error'|'warning'|'info'} Severity
 * @typedef {{ field: string, severity: Severity, message: string, rule: string, code: string, machine_hint?: import('./errorCodes.js').MachineHint, index?: number }} ValidationResult
 * @typedef {{ effective_from?: string, effective_until?: string, modes?: ValidationMode[], export_organs?: string[] }} RuleMeta
 * @typedef {(data: Record<string, any>, ctx: ValidationContext) => ValidationResult[]} ValidatorFn
 * @typedef {(records: Record<string, any>[], ctx: ValidationContext) => ValidationResult[]} BatchValidatorFn
 * @typedef {{ fn: ValidatorFn, meta: RuleMeta }} VersionedRule
 * @typedef {{ fn: BatchValidatorFn, meta: RuleMeta }} BatchRule
 * @typedef {{ name: string, rules: VersionedRule[], batchRules?: BatchRule[] }} DomainConfig
 * @typedef {{ mode: ValidationMode, reference_date: string, export_organ?: string }} ValidationContext
 */

const VALID_MODES = new Set(['ingest', 'sign', 'export']);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Registry ──────────────────────────────────────────────────────────────────

/** @type {Map<string, DomainConfig>} */
const _registry = new Map();

/** Register a domain configuration. */
export function registerDomain(domain, config) {
    _registry.set(domain.toUpperCase(), config);
}

/** Unregister a domain. */
export function unregisterDomain(domain) {
    _registry.delete(domain.toUpperCase());
}

/** Clear all registered domains. */
export function clearRegistry() {
    _registry.clear();
}

/** List all registered domain names. */
export function listDomains() {
    return [..._registry.keys()];
}

/** Get a domain config by name. */
export function getDomainConfig(domain) {
    return _registry.get(domain.toUpperCase());
}

// ── Input validation ──────────────────────────────────────────────────────────

function normalizeDate(d) {
    if (ISO_DATE_RE.test(d)) {
        const parsed = new Date(d + 'T00:00:00Z');
        if (isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== d) {
            throw new Error(`Invalid reference_date: "${d}". Not a real calendar date.`);
        }
        return d;
    }
    const parsed = new Date(d);
    if (isNaN(parsed.getTime())) {
        throw new Error(`Invalid reference_date: "${d}". Expected YYYY-MM-DD.`);
    }
    return parsed.toISOString().slice(0, 10);
}

function buildContext(opts) {
    const mode = opts.mode ?? 'ingest';
    if (!VALID_MODES.has(mode)) {
        throw new Error(`Invalid mode: "${mode}". Valid: ${[...VALID_MODES].join(', ')}`);
    }
    if (mode === 'export' && !opts.export_organ) {
        throw new Error('export mode requires export_organ.');
    }
    return {
        mode,
        reference_date: normalizeDate(opts.reference_date || new Date().toISOString().slice(0, 10)),
        export_organ: opts.export_organ,
    };
}

// ── Rule filtering ────────────────────────────────────────────────────────────

function filterByMeta(items, ctx) {
    return items.filter(({ meta }) => {
        if (meta.effective_from && ctx.reference_date < meta.effective_from) return false;
        if (meta.effective_until && ctx.reference_date > meta.effective_until) return false;
        if (meta.modes?.length && !meta.modes.includes(ctx.mode)) return false;
        if (meta.export_organs?.length) {
            if (ctx.mode !== 'export') return false;
            if (!meta.export_organs.includes(ctx.export_organ)) return false;
        }
        return true;
    });
}

function escalateSeverities(results, mode) {
    if (mode !== 'sign') return;
    for (const r of results) {
        if (r.severity === 'warning') {
            r.severity = 'error';
            r.message = `[SIGN] ${r.message}`;
        }
    }
}

function buildOutput(all, ctx) {
    const errors = all.filter((r) => r.severity === 'error');
    const warnings = all.filter((r) => r.severity === 'warning');
    return {
        mode: ctx.mode,
        reference_date: ctx.reference_date,
        valid: errors.length === 0,
        errors,
        warnings,
        info: all.filter((r) => r.severity === 'info'),
        all,
        machine_summary: {
            blocking_codes: errors.map((e) => e.code),
            advisory_codes: warnings.map((w) => w.code),
            fix_hints: all.filter((r) => r.machine_hint).map((r) => r.machine_hint),
        },
    };
}

// ── Core: single record ───────────────────────────────────────────────────────

/**
 * Validate a single record against a registered domain.
 * @param {string} domain
 * @param {Record<string, any>} data
 * @param {Partial<ValidationContext>} [opts]
 */
export function validate(domain, data, opts = {}) {
    const key = domain.toUpperCase();
    const config = _registry.get(key);
    if (!config) throw new Error(`Domain not registered: ${key}. Available: ${listDomains().join(', ')}`);

    const ctx = buildContext(opts);
    const fns = filterByMeta(config.rules, ctx).map((r) => r.fn);
    const all = fns.flatMap((fn) => fn(data, ctx));
    escalateSeverities(all, ctx.mode);

    return { domain: key, ...buildOutput(all, ctx) };
}

// ── Core: batch ───────────────────────────────────────────────────────────────

/**
 * Validate a batch of records (record-level + batch rules).
 * @param {string} domain
 * @param {Record<string, any>[]} records
 * @param {Partial<ValidationContext>} [opts]
 */
export function validateBatch(domain, records, opts = {}) {
    const key = domain.toUpperCase();
    const config = _registry.get(key);
    if (!config) throw new Error(`Domain not registered: ${key}. Available: ${listDomains().join(', ')}`);

    const ctx = buildContext(opts);
    const recordFns = filterByMeta(config.rules, ctx).map((r) => r.fn);
    const batchFns = filterByMeta(config.batchRules || [], ctx).map((r) => r.fn);

    const perRecord = records.map((record, index) => {
        const all = recordFns.flatMap((fn) => fn(record, ctx));
        escalateSeverities(all, ctx.mode);
        return { index, ...buildOutput(all, ctx) };
    });

    const batchResults = batchFns.flatMap((fn) => fn(records, ctx));
    escalateSeverities(batchResults, ctx.mode);

    return {
        domain: key,
        mode: ctx.mode,
        reference_date: ctx.reference_date,
        totalRecords: records.length,
        validCount: perRecord.filter((r) => r.valid).length,
        invalidCount: perRecord.filter((r) => !r.valid).length,
        results: perRecord,
        batchErrors: batchResults.filter((r) => r.severity === 'error'),
        batchWarnings: batchResults.filter((r) => r.severity === 'warning'),
        batchAll: batchResults,
        allValid: perRecord.every((r) => r.valid) && batchResults.filter((r) => r.severity === 'error').length === 0,
    };
}

// ── Core: dataset (cross-entity referential integrity) ────────────────────────

/**
 * Validate referential integrity across entities.
 * @param {Record<string, Record<string, any>[]>} dataset
 * @param {Array<{from: string, fromField: string, to: string, toField: string, label: string}>} relations
 * @param {Partial<ValidationContext>} [opts]
 */
export function validateDataset(dataset, relations, opts = {}) {
    const ctx = buildContext(opts);
    const errors = [];

    for (const rel of relations) {
        const parentRecords = dataset[rel.to] || [];
        const childRecords = dataset[rel.from] || [];
        const parentKeys = new Set(parentRecords.map((r) => r[rel.toField]));

        childRecords.forEach((record, index) => {
            const val = record[rel.fromField];
            if (val && !parentKeys.has(val)) {
                errors.push({
                    field: rel.fromField,
                    severity: 'error',
                    rule: 'refIntegrity',
                    message: `${rel.label}: "${val}" not found in ${rel.to}.${rel.toField}`,
                    code: CODES.COMMON_REF_INTEGRITY,
                    machine_hint: hint(
                        CODES.COMMON_REF_INTEGRITY,
                        'check_reference',
                        rel.fromField,
                        `Value must exist in ${rel.to}.${rel.toField}`,
                    ),
                    index,
                });
            }
        });
    }

    escalateSeverities(errors, ctx.mode);
    return { valid: errors.length === 0, errors };
}

// ── Rule builders ─────────────────────────────────────────────────────────────

/** Wrap a validator function with metadata. */
export function rule(fn, meta = {}) {
    return { fn, meta };
}

/** Wrap a batch validator function with metadata. */
export function batchRule(fn, meta = {}) {
    return { fn, meta };
}

/** Required field rule. */
export function required(field, label, meta = {}) {
    return rule((data) => {
        const val = data[field];
        if (val === undefined || val === null || val === '') {
            return [
                {
                    field,
                    severity: 'error',
                    rule: 'required',
                    message: `${label} is required`,
                    code: CODES.COMMON_REQUIRED,
                    machine_hint: hint(CODES.COMMON_REQUIRED, 'set_value', field, `Provide ${field}`),
                },
            ];
        }
        return [];
    }, meta);
}

/** Field expected but nullable (EPA 2.9 "If available"). */
export function ifAvailable(field, label, meta = {}) {
    return rule((data) => {
        if (!(field in data)) {
            return [
                {
                    field,
                    severity: 'warning',
                    rule: 'ifAvailable',
                    message: `${label} expected (if available). Field omitted.`,
                    code: CODES.COMMON_FIELD_OMITTED,
                    machine_hint: hint(
                        CODES.COMMON_FIELD_OMITTED,
                        'set_value',
                        field,
                        `Expected field, set null if unavailable`,
                    ),
                },
            ];
        }
        return [];
    }, meta);
}

/** Allowed values rule. */
export function oneOf(field, label, allowed, meta = {}) {
    const allowedSet = new Set(allowed);
    return rule((data) => {
        const val = data[field];
        if (val && !allowedSet.has(val)) {
            return [
                {
                    field,
                    severity: 'error',
                    rule: 'oneOf',
                    message: `${label} invalid: "${val}". Allowed: ${allowed.join(', ')}`,
                    code: CODES.COMMON_INVALID_ENUM,
                    machine_hint: hint(
                        CODES.COMMON_INVALID_ENUM,
                        'change_value',
                        field,
                        'Must be one of allowed values',
                        allowed,
                    ),
                },
            ];
        }
        return [];
    }, meta);
}

/** Numeric range rule. */
export function numeric(field, label, opts = {}, meta = {}) {
    const { min = -Infinity, max = Infinity } = opts;
    return rule((data) => {
        const val = data[field];
        if (val === undefined || val === null || val === '') return [];
        const num = Number(val);
        if (isNaN(num)) {
            return [
                {
                    field,
                    severity: 'error',
                    rule: 'numeric',
                    message: `${label} must be numeric`,
                    code: CODES.COMMON_INVALID_NUMERIC,
                    machine_hint: hint(CODES.COMMON_INVALID_NUMERIC, 'change_value', field, 'Must be a number'),
                },
            ];
        }
        if (num < min || num > max) {
            return [
                {
                    field,
                    severity: 'error',
                    rule: 'numeric.range',
                    message: `${label} out of range [${min}, ${max}]: ${num}`,
                    code: CODES.COMMON_OUT_OF_RANGE,
                    machine_hint: hint(
                        CODES.COMMON_OUT_OF_RANGE,
                        'change_value',
                        field,
                        `Must be between ${min} and ${max}`,
                    ),
                },
            ];
        }
        return [];
    }, meta);
}

/** Regex pattern rule. */
export function matchPattern(field, label, pattern, formatHint, meta = {}) {
    return rule((data) => {
        const val = data[field];
        if (val && !pattern.test(String(val))) {
            return [
                {
                    field,
                    severity: 'error',
                    rule: 'pattern',
                    message: `${label} invalid format. Expected: ${formatHint}`,
                    code: CODES.COMMON_INVALID_FORMAT,
                    machine_hint: hint(
                        CODES.COMMON_INVALID_FORMAT,
                        'change_value',
                        field,
                        `Expected format: ${formatHint}`,
                    ),
                },
            ];
        }
        return [];
    }, meta);
}

/** Batch rule: composite primary key uniqueness. */
export function uniqueKey(fields, label, meta = {}) {
    return batchRule((records, _ctx) => {
        const seen = new Map();
        const errors = [];
        for (let i = 0; i < records.length; i++) {
            const key = fields.map((f) => String(records[i][f] ?? '')).join('|');
            if (seen.has(key)) {
                errors.push({
                    field: fields.join('+'),
                    severity: 'error',
                    rule: 'uniqueKey',
                    message: `Duplicate PK [${label}]: rows ${seen.get(key)} and ${i}`,
                    code: CODES.COMMON_DUPLICATE_KEY,
                    machine_hint: hint(
                        CODES.COMMON_DUPLICATE_KEY,
                        'manual_review',
                        fields[0],
                        `Duplicate composite key: ${fields.join(', ')}`,
                    ),
                    index: i,
                });
            } else {
                seen.set(key, i);
            }
        }
        return errors;
    }, meta);
}
