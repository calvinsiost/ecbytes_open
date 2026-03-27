// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)

import { parseFile } from '../../core/ingestion/parser.js';
import { ERROR_CODE } from './fileConstants.js';

const PREVIEW_ROWS = 20;

export async function buildPreview(file, extension) {
    const ext = String(extension || '').toLowerCase();
    if (ext === 'dxf') {
        return ok({ type: 'message', message: 'DXF preview not available yet.' });
    }
    if (ext !== 'csv' && ext !== 'xlsx' && ext !== 'xls') {
        return fail('Preview indisponivel para este formato.', ERROR_CODE.PREVIEW_UNAVAILABLE);
    }
    try {
        const parsed = await parseFile(file);
        const firstSheet = parsed.sheets?.[0];
        if (!firstSheet) return ok({ type: 'table', headers: [], rows: [] });
        const headers = firstSheet.headers || Object.keys(firstSheet.rows?.[0] || {});
        const rows = (firstSheet.rows || []).slice(0, PREVIEW_ROWS).map((row) => headers.map((h) => row?.[h] ?? ''));
        return ok({ type: 'table', headers, rows });
    } catch (err) {
        return fail(`Falha ao gerar preview: ${err.message}`, ERROR_CODE.PARSE_FAILED);
    }
}

function ok(data) {
    return { ok: true, data };
}

function fail(error, code) {
    return { ok: false, error, code };
}
