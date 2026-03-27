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
   DOCX XML SANITIZER
   ================================================================

   Removes characters that are invalid in XML 1.0 documents.
   This protects generated DOCX files (ZIP/XML) from Word corruption
   errors caused by hidden control characters.

   Allowed XML 1.0 ranges:
   - #x9 | #xA | #xD
   - #x20-#xD7FF
   - #xE000-#xFFFD
   - #x10000-#x10FFFF
   ================================================================ */

/**
 * @typedef {Object} DocxSanitizeResult
 * @property {string} text
 * @property {number} removedInvalidChars
 * @property {boolean} hadInvalidChars
 */

function _isValidXml10CodePoint(codePoint) {
    return (
        codePoint === 0x9 ||
        codePoint === 0xa ||
        codePoint === 0xd ||
        (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
        (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
        (codePoint >= 0x10000 && codePoint <= 0x10ffff)
    );
}

/**
 * Sanitize a single value for XML 1.0 text contexts.
 *
 * @param {unknown} input
 * @returns {DocxSanitizeResult}
 */
export function sanitizeDocxXmlText(input) {
    const source = input == null ? '' : String(input);
    let removedInvalidChars = 0;
    let result = '';

    for (const ch of source) {
        const codePoint = ch.codePointAt(0);
        if (codePoint != null && _isValidXml10CodePoint(codePoint)) {
            result += ch;
        } else {
            removedInvalidChars++;
        }
    }

    return {
        text: result,
        removedInvalidChars,
        hadInvalidChars: removedInvalidChars > 0,
    };
}

/**
 * Sanitize an array of values for XML 1.0 text contexts.
 *
 * @param {unknown[]} inputs
 * @returns {{ values: string[], removedInvalidChars: number, hadInvalidChars: boolean }}
 */
export function sanitizeDocxXmlTextList(inputs) {
    const safeInputs = Array.isArray(inputs) ? inputs : [];
    const values = [];
    let removedInvalidChars = 0;

    for (const item of safeInputs) {
        const sanitized = sanitizeDocxXmlText(item);
        values.push(sanitized.text);
        removedInvalidChars += sanitized.removedInvalidChars;
    }

    return {
        values,
        removedInvalidChars,
        hadInvalidChars: removedInvalidChars > 0,
    };
}

/**
 * Deeply sanitize all string values in arrays/objects.
 * Useful for sanitizing dynamic payloads before DOCX assembly.
 *
 * @param {unknown} input
 * @returns {{ value: unknown, removedInvalidChars: number, hadInvalidChars: boolean }}
 */
export function sanitizeDocxXmlData(input) {
    /** @type {WeakMap<object, unknown>} */
    const seen = new WeakMap();
    let removedInvalidChars = 0;

    function visit(node) {
        if (node == null) return node;

        if (typeof node === 'string') {
            const sanitized = sanitizeDocxXmlText(node);
            removedInvalidChars += sanitized.removedInvalidChars;
            return sanitized.text;
        }

        if (Array.isArray(node)) {
            if (seen.has(node)) return seen.get(node);
            const clone = [];
            seen.set(node, clone);
            for (const item of node) clone.push(visit(item));
            return clone;
        }

        if (typeof node === 'object') {
            if (seen.has(node)) return seen.get(node);
            const clone = {};
            seen.set(node, clone);
            for (const [key, value] of Object.entries(node)) {
                clone[key] = visit(value);
            }
            return clone;
        }

        return node;
    }

    const value = visit(input);
    return {
        value,
        removedInvalidChars,
        hadInvalidChars: removedInvalidChars > 0,
    };
}
