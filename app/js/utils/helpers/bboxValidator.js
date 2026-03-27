// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// @since v0.2

/**
 * bboxValidator.js — Validates bounding box objects for document assets.
 *
 * @module utils/validators/bboxValidator
 */

/**
 * Validate and sanitize a bbox object.
 * Returns a clean {x, y, width, height} or null if invalid.
 *
 * @param {any} bbox — raw bbox from OCR or classification
 * @returns {{ x: number, y: number, width: number, height: number }|null}
 */
export function validateBbox(bbox) {
    if (!bbox || typeof bbox !== 'object') return null;

    const { x, y, width, height } = bbox;

    if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number')
        return null;

    if (x < 0 || y < 0) return null;
    if (width <= 0 || height <= 0) return null;
    if (!isFinite(x) || !isFinite(y) || !isFinite(width) || !isFinite(height)) return null;

    return {
        x: Math.round(x * 100) / 100,
        y: Math.round(y * 100) / 100,
        width: Math.round(width * 100) / 100,
        height: Math.round(height * 100) / 100,
    };
}
