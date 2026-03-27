// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)

import { activateTabById } from '../ui/tabs.js';
import { showToast } from '../ui/toast.js';
import { asyncConfirm, asyncPrompt } from '../ui/asyncDialogs.js';
import { ERROR_CODE, getFileRegisterMode } from '../files/fileConstants.js';
import { openInlinePreview, renderFilesPanel, resetFilesFilter, updateFilesFilter } from '../files/filePanel.js';
import {
    get,
    getContent,
    getDownloadUrl,
    register,
    registerFromIngestion,
    softDelete,
    updateTags,
} from '../files/fileManager.js';
import { handleIngestionDirectFile, handleOpenIngestionModal } from './ingestion.js';
import { buildContoursFromGrid } from '../../core/interpolation/contours.js';
import { getAllLayers, recomputeLayer } from '../../core/interpolation/manager.js';
import { getOrigin, getEPSG, relativeToWGS84 } from '../../core/io/geo/coordinates.js';
import { getAllElements } from '../../core/elements/manager.js';

let _updateAllUI = null;
const CONTOUR_EXPORT_TYPES = new Set(['water_table', 'terrain', 'contamination']);

export function setFilesUpdateAllUI(fn) {
    _updateAllUI = fn;
}

export async function handleOpenFiles() {
    activateTabById('files');
    await renderFilesPanel();
    if (typeof _updateAllUI === 'function') _updateAllUI();
}

export async function handleFilesUploadInput(input) {
    const file = input?.files?.[0];
    if (!file) return;
    showToast(`Uploading ${file.name}...`, 'info');
    const res = await register(file, { source: 'manual' });
    _showResult(res, 'Arquivo registrado.');
    if (input) input.value = '';
    await _refresh();
}

export function handleFilesDragOver(event) {
    event.preventDefault();
}

export async function handleFilesDrop(event) {
    event.preventDefault();
    const files = [...(event?.dataTransfer?.files || [])];
    if (!files.length) return;
    showToast(`Uploading ${files.length} file(s)...`, 'info');
    let failures = 0;
    for (const file of files) {
        const res = await register(file, { source: 'manual' });
        if (!res.ok) failures++;
    }
    showToast(
        failures ? `${failures} upload(s) failed` : `${files.length} file(s) registered`,
        failures ? 'warning' : 'success',
    );
    await _refresh();
}

export async function handleFilesDelete(id) {
    const yes = await asyncConfirm('Soft delete this file?');
    if (!yes) return;
    const res = await softDelete(id);
    _showResult(res, 'Arquivo removido.');
    await _refresh();
}

export async function handleFilesDownload(id) {
    const signed = await getDownloadUrl(id, { expiresIn: 3600 });
    if (!signed.ok) {
        showToast(signed.error || 'Download failed', 'error');
        return;
    }
    window.open(signed.data.url, '_blank', 'noopener');
}

export async function handleFilesPreview(id) {
    const file = await get(id);
    if (!file.ok) {
        showToast(file.error || 'Preview unavailable', 'error');
        return;
    }
    await openInlinePreview(file.data);
}

export async function handleFilesEditTags(id) {
    const current = await get(id);
    if (!current.ok) {
        showToast(current.error || 'Tag edit failed', 'error');
        return;
    }
    const raw = await asyncPrompt('Comma separated tags', (current.data.tags || []).join(', '));
    if (raw == null) return;
    const tags = raw
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    const res = await updateTags(id, tags);
    _showResult(res, 'Tags atualizadas.');
    await _refresh();
}

export async function handleFilesReimport(id) {
    const meta = await get(id);
    if (!meta.ok) {
        showToast(meta.error || 'File not found', 'error');
        return;
    }
    const bufferRes = await getContent(id);
    if (!bufferRes.ok) {
        showToast(bufferRes.error || 'Read failed', 'error');
        return;
    }
    const file = new File([bufferRes.data], meta.data.filename || 'file.bin', {
        type: meta.data.mime_type || 'application/octet-stream',
    });
    handleOpenIngestionModal();
    await handleIngestionDirectFile(file);
}

export async function handleFilesFilter(key, value) {
    updateFilesFilter(key, value);
    await renderFilesPanel();
}

export async function handleFilesSort(value) {
    const [sortBy, sortOrder] = String(value || 'updated_at:desc').split(':');
    updateFilesFilter('sortBy', sortBy || 'updated_at');
    updateFilesFilter('sortOrder', sortOrder || 'desc');
    await renderFilesPanel();
}

export async function handleFilesClearFilters() {
    resetFilesFilter();
    await renderFilesPanel();
}

export async function handleFilesDismissWarning() {
    try {
        localStorage.removeItem('ecbyts-files-reconcile-warning');
    } catch (_) {
        /* noop */
    }
    await renderFilesPanel();
}

export async function handleFilesSaveContoursGeoJSON() {
    const built = await _buildContoursGeoJSON();
    if (!built.ok) {
        showToast(built.error, 'warning');
        return;
    }
    const { filename, blob } = built.data;
    const file = new File([blob], filename, { type: 'application/geo+json' });

    const res = await register(file, {
        source: 'manual',
        tags: ['contours', 'geojson', ...built.data.layerTypes],
    });
    if (!res.ok && res.code === ERROR_CODE.NOT_AUTHENTICATED) {
        _downloadBlob(blob, filename);
        showToast('Sem login no Files: GeoJSON baixado direto no navegador.', 'warning');
        return;
    }
    _showResult(res, `Curvas salvas em Arquivos (${built.data.featureCount} feições).`);
    await _refresh();
}

export async function handleFilesDownloadContoursGeoJSON() {
    const built = await _buildContoursGeoJSON();
    if (!built.ok) {
        showToast(built.error, 'warning');
        return;
    }
    _downloadBlob(built.data.blob, built.data.filename);
    showToast(`GeoJSON baixado (${built.data.featureCount} feições).`, 'success');
}

/**
 * Registra arquivo originado de importacao (ingestion pipeline).
 * @internal — chamado diretamente por outros modulos, nao exposto via window.*
 * @param {File} file
 * @param {object} metadata
 */
export async function handleFilesRegisterFromIngestion(file, metadata = {}) {
    const mode = metadata.mode || getFileRegisterMode();
    return registerFromIngestion(file, { ...metadata, mode });
}

async function _refresh() {
    await renderFilesPanel();
    if (typeof _updateAllUI === 'function') _updateAllUI();
}

function _showResult(result, successMessage) {
    if (result.ok) {
        showToast(successMessage, 'success');
        return;
    }
    showToast(result.error || 'Files operation failed', 'error');
}

export const filesHandlers = {
    handleOpenFiles,
    handleFilesUploadInput,
    handleFilesDragOver,
    handleFilesDrop,
    handleFilesDelete,
    handleFilesDownload,
    handleFilesPreview,
    handleFilesEditTags,
    handleFilesReimport,
    handleFilesFilter,
    handleFilesSort,
    handleFilesClearFilters,
    handleFilesDismissWarning,
    handleFilesSaveContoursGeoJSON,
    handleFilesDownloadContoursGeoJSON,
};

async function _buildContoursGeoJSON() {
    const baseLayers = getAllLayers().filter((l) => CONTOUR_EXPORT_TYPES.has(l?.type));
    const fallbackBounds = _computeBoundaryBoundsFromElements();
    for (const l of baseLayers) {
        if (l?.grid && l?.bounds && l?.gridSize) continue;
        if (!l.bounds && fallbackBounds) l.bounds = fallbackBounds;
        if (l.type === 'water_table' && !l.parameterId) l.parameterId = 'water_level';
        try {
            await recomputeLayer(l.id);
        } catch (_) {
            // Ignore and let validation below decide if layer is usable.
        }
    }
    const layers = getAllLayers().filter((l) => CONTOUR_EXPORT_TYPES.has(l?.type) && l.grid && l.bounds && l.gridSize);
    if (layers.length === 0) {
        return { ok: false, error: 'Nenhuma camada com curvas e grid para exportar.' };
    }

    const features = [];
    const origin = getOrigin();
    const exportedAt = new Date().toISOString();

    for (const layer of layers) {
        const levelCount = _contourLevelCount(layer.contourDensity);
        const contours = buildContoursFromGrid({
            grid: layer.grid,
            bounds: layer.bounds,
            gridSize: layer.gridSize,
            levelCount,
        });
        if (!Array.isArray(contours) || contours.length === 0) continue;

        for (let i = 0; i < contours.length; i++) {
            const line = contours[i];
            const pts = Array.isArray(line.points) ? line.points : [];
            if (pts.length < 2) continue;
            const coords = pts.map((p) => {
                const wgs = relativeToWGS84({ x: p.x, y: 0, z: p.z });
                return [_round(wgs.longitude, 7), _round(wgs.latitude, 7)];
            });

            features.push({
                type: 'Feature',
                id: `${layer.id}-contour-${i}`,
                geometry: { type: 'LineString', coordinates: coords },
                properties: {
                    layerId: layer.id,
                    layerName: layer.name || layer.id,
                    layerType: layer.type,
                    parameterId: layer.parameterId || null,
                    contourLevel: Number(line.level),
                    unit: _layerContourUnit(layer),
                    generatedAt: exportedAt,
                },
            });
        }
    }

    if (features.length === 0) {
        return { ok: false, error: 'Curvas de nível não disponíveis para exportação.' };
    }

    const payload = {
        type: 'FeatureCollection',
        name: 'ECByTS Contours',
        metadata: {
            exported: exportedAt,
            source: 'ecbyts',
            kind: 'interpolation_contours',
            utmOrigin: {
                easting: origin.easting,
                northing: origin.northing,
                elevation: origin.elevation,
                zone: origin.zone,
                hemisphere: origin.hemisphere,
                epsg: getEPSG(origin.zone, origin.hemisphere),
            },
            layerCount: layers.length,
            featureCount: features.length,
        },
        features,
    };

    const layerTypes = [...new Set(layers.map((l) => l.type))].sort();
    const stamp = exportedAt.slice(0, 19).replaceAll(':', '-');
    const filename = `contours-${layerTypes.join('-')}-${stamp}.geojson`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/geo+json' });
    return { ok: true, data: { filename, blob, featureCount: features.length, layerTypes } };
}

function _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function _computeBoundaryBoundsFromElements() {
    const boundary = getAllElements().find(
        (e) => e?.family === 'boundary' && Array.isArray(e?.data?.vertices) && e.data.vertices.length >= 3,
    );
    if (!boundary) return null;
    const xs = boundary.data.vertices.map((v) => Number(v?.x)).filter(Number.isFinite);
    const zs = boundary.data.vertices.map((v) => Number(v?.z)).filter(Number.isFinite);
    if (xs.length < 3 || zs.length < 3) return null;
    return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minZ: Math.min(...zs),
        maxZ: Math.max(...zs),
    };
}

function _contourLevelCount(density) {
    if (density === 'low') return 6;
    if (density === 'high') return 14;
    return 10;
}

function _layerContourUnit(layer) {
    if (layer?.type === 'terrain' || layer?.type === 'water_table') return 'm';
    return layer?.parameterId || 'value';
}

function _round(v, p = 7) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    const f = 10 ** p;
    return Math.round(n * f) / f;
}
