
// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
export async function checkQuota() { return { allowed: true, remaining: Infinity, total: Infinity }; }
export async function recordUsage() {}
export function getQuotaStatus() { return { open: true }; }
export function clearMeteringState() {}
export function getUsagePercentages() { return {}; }
export async function initMeteringCache() {}
export const ACTIVE_METRICS = [];
export const METRIC_LABELS = {};
