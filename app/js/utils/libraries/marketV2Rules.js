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

// Pure rules for Marketplace V2.

export const MARKET_STATE_MACHINES = {
    listing: {
        draft: ['pending_moderation', 'published', 'removed'],
        pending_moderation: ['published', 'rejected', 'under_review', 'removed'],
        published: ['paused', 'expired', 'sold_out', 'under_review', 'removed'],
        paused: ['published', 'expired', 'removed'],
        expired: ['published', 'removed'],
        sold_out: ['published', 'removed'],
        under_review: ['published', 'rejected', 'removed'],
        rejected: ['draft', 'removed'],
        removed: [],
    },
    rfq: {
        open: ['countered', 'accepted', 'rejected', 'expired', 'cancelled', 'closed'],
        countered: ['countered', 'accepted', 'rejected', 'expired', 'cancelled', 'closed'],
        accepted: ['closed'],
        rejected: ['closed'],
        expired: ['closed'],
        cancelled: ['closed'],
        closed: [],
    },
    order: {
        pending_payment: ['paid', 'cancelled'],
        paid: ['delivered', 'cancelled', 'refunded'],
        delivered: ['accepted', 'disputed', 'refunded'],
        accepted: [],
        disputed: ['refunded', 'accepted', 'cancelled'],
        refunded: [],
        cancelled: [],
        chargeback: [],
    },
    dispute: {
        opened: ['evidence', 'mediation', 'cancelled', 'closed'],
        evidence: ['mediation', 'seller_won', 'buyer_won', 'partial_refund', 'cancelled', 'closed'],
        mediation: ['seller_won', 'buyer_won', 'partial_refund', 'cancelled', 'closed'],
        seller_won: ['closed'],
        buyer_won: ['closed'],
        partial_refund: ['closed'],
        cancelled: ['closed'],
        closed: [],
    },
};

export function canTransition(machineName, currentState, nextState) {
    const machine = MARKET_STATE_MACHINES[machineName];
    if (!machine) return false;
    const allowed = machine[currentState] || [];
    return allowed.includes(nextState);
}

export function validateInstitutionSplit(institutionId, institutionPct) {
    const pct = Number(institutionPct || 0);
    if (!Number.isFinite(pct) || pct < 0 || pct > 50) {
        return { valid: false, error: 'invalid_institution_pct' };
    }
    if (!institutionId && pct !== 0) {
        return { valid: false, error: 'institution_pct_requires_institution' };
    }
    if (institutionId && (pct < 1 || pct > 50)) {
        return { valid: false, error: 'institution_pct_with_institution_must_be_1_to_50' };
    }
    return { valid: true, pct };
}

export function calculateSplit(amountCents, institutionPct, platformFeePct = 12) {
    const gross = Math.max(0, Math.round(Number(amountCents || 0)));
    const institution = Math.round(gross * (Math.max(0, Math.min(50, Number(institutionPct || 0))) / 100));
    const platform = Math.round(gross * (Math.max(0, Number(platformFeePct || 0)) / 100));
    const seller = Math.max(gross - institution - platform, 0);
    return {
        gross,
        institution_amount_cents: institution,
        platform_fee_cents: platform,
        seller_net_cents: seller,
    };
}

export function applyReputationDecay(baseScore, daysInactive, halfLifeDays = 90) {
    const score = Math.max(0, Math.min(100, Number(baseScore || 0)));
    const days = Math.max(0, Number(daysInactive || 0));
    const halfLife = Math.max(1, Number(halfLifeDays || 90));
    const factor = Math.pow(0.5, days / halfLife);
    return Math.max(0, Math.min(100, score * factor));
}

export function computeReputationScore(components, daysInactive = 0) {
    const completionRate = clamp01(components?.completion_rate ?? 0.5);
    const avgRating = clamp01(components?.avg_rating ?? 0); // already normalized 0..1
    const onTimeRate = clamp01(components?.on_time_rate ?? 1);
    const disputeRate = clamp01(components?.dispute_rate ?? 0);
    const responseSlaRate = clamp01(components?.response_sla_rate ?? 1);

    const baseScore =
        100 *
        (0.35 * completionRate + 0.25 * avgRating + 0.2 * onTimeRate + 0.1 * (1 - disputeRate) + 0.1 * responseSlaRate);
    const finalScore = applyReputationDecay(baseScore, daysInactive, 90);

    return {
        base_score: round2(baseScore),
        final_score: round2(finalScore),
        level: reputationLevel(finalScore),
    };
}

export function validatePayloadLimits(payload) {
    const json = JSON.stringify(payload || {});
    return {
        valid: json.length <= 65536,
        size: json.length,
        max: 65536,
    };
}

export function validateFileSpec(file, maxBytes, allowedMimes) {
    if (!file) return { valid: true };
    const mime = String(file.mime || '').toLowerCase();
    const size = Number(file.size_bytes || 0);
    if (!allowedMimes.includes(mime)) return { valid: false, error: 'invalid_mime' };
    if (!Number.isFinite(size) || size <= 0 || size > maxBytes) return { valid: false, error: 'invalid_size' };
    return { valid: true };
}

export function encodeCursor(payload) {
    return btoa(JSON.stringify(payload));
}

export function decodeCursor(cursor) {
    try {
        return JSON.parse(atob(cursor));
    } catch {
        return null;
    }
}

function clamp01(v) {
    return Math.max(0, Math.min(1, Number(v || 0)));
}

function round2(v) {
    return Math.round(Number(v || 0) * 100) / 100;
}

function reputationLevel(score) {
    if (score >= 90) return 'Vanguard';
    if (score >= 75) return 'Trusted';
    if (score >= 60) return 'Active';
    if (score >= 40) return 'Rising';
    return 'Seed';
}
