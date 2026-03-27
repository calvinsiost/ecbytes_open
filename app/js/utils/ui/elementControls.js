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
   CONTROLES ESPECÍFICOS POR FAMÍLIA DE ELEMENTO
   ================================================================

   Funções de renderização de controles especializados para
   famílias específicas no painel de detalhes.

   INCLUI:
   - renderBoundaryControls: overlay aéreo (opacidade, URL)
   - renderAreaControls: vínculo com Project Areas, H&S
   - renderSensorControls: config IoT, fetch, profile, leituras
   - renderSensorReadings: tabela multiparâmetro
   - renderSensorProfile: dados do proprietário
   - renderSensorEval: avaliação quantitativa
   - renderSensorWeather: condições climáticas

   Extraído de lists.js para reduzir tamanho do módulo principal.

   ================================================================ */

import { t } from '../i18n/translations.js';
import { getIcon } from './icons.js';
import { escapeHtml } from '../helpers/html.js';
import { CONFIG } from '../../config.js';
import { getAvailableImagery } from '../libraries/loader.js';

// ----------------------------------------------------------------
// BOUNDARY CONTROLS — Overlay de imagem aérea
// ----------------------------------------------------------------

export function renderBoundaryControls(element) {
    const id = element.id;
    const data = element.data || {};
    const opacity = data.overlayOpacity ?? 0.3;
    const overlayUrl = data.overlayUrl || '';

    // Calcula link do Google Earth a partir das coordenadas do elemento
    const lat = data.sourceLat || 0;
    const lon = data.sourceLon || 0;
    const earthUrl = lat && lon ? `https://earth.google.com/web/@${lat},${lon},0a,1000d,35y,0h,0t,0r` : '';

    return `
        <div class="section" style="margin-top: 12px;">
            <div class="section-header">
                <span>${getIcon('map', { size: '14px' })} ${t('overlaySettings') || 'Overlay Settings'}</span>
                <span class="chevron">▼</span>
            </div>
            <div class="section-content">
                <!-- Opacidade do overlay -->
                <div class="form-group" style="margin-bottom:8px;">
                    <label class="form-label">${t('overlayOpacity') || 'Overlay Opacity'}: <span id="opacity-val-${id}">${(opacity * 100).toFixed(0)}%</span></label>
                    <input type="range" min="0" max="1" step="0.05" value="${opacity}"
                           style="width:100%;"
                           oninput="document.getElementById('opacity-val-${id}').textContent = (this.value * 100).toFixed(0) + '%'; window.handleBoundaryFieldChange('${id}', 'overlayOpacity', parseFloat(this.value))">
                </div>

                <!-- URL da imagem aérea -->
                <div class="form-group" style="margin-bottom:8px;">
                    <label class="form-label">${t('overlayImageUrl') || 'Aerial Image URL'}</label>
                    <input class="form-input" type="url"
                           value="${escapeHtml(overlayUrl)}"
                           placeholder="https://..."
                           onchange="window.handleBoundaryFieldChange('${id}', 'overlayUrl', this.value)">
                    <div style="font-size:10px; color:var(--neutral-400); margin-top:2px;">
                        PNG/JPG. ${t('overlayCorsHint') || 'Must allow CORS for cross-origin images.'}
                    </div>
                </div>

                <!-- Upload de imagem personalizada -->
                <div class="form-group" style="margin-bottom:8px;">
                    <label class="form-label">${t('overlayUpload') || 'Upload Custom Image'}</label>
                    <input type="file" accept="image/png, image/jpeg, image/tiff"
                           style="display:none;" id="overlay-upload-${id}"
                           onchange="window.handleOverlayUpload('${id}', this)">
                    <button class="form-btn" style="width:100%; font-size:11px;"
                            onclick="document.getElementById('overlay-upload-${id}').click()">
                        ${getIcon('upload', { size: '14px' })} ${t('overlaySelectFile') || 'Select Image File'}
                    </button>
                    <div style="font-size:10px; color:var(--neutral-400); margin-top:2px;">
                        ${t('overlayUploadHint') || 'Image will be stretched to cover the study area. For best results, crop to match boundary and keep North up.'}
                    </div>
                </div>

                ${
                    earthUrl
                        ? `
                    <a href="${earthUrl}" target="_blank" rel="noopener noreferrer"
                       style="display:inline-flex; align-items:center; gap:4px; font-size:11px; color:var(--primary-500); text-decoration:none;">
                        ${getIcon('globe', { size: '14px' })} ${t('openGoogleEarth') || 'Open in Google Earth'}
                    </a>
                `
                        : ''
                }

                ${_renderAvailableImagery(id)}
            </div>
        </div>
    `;
}

// ----------------------------------------------------------------
// AVAILABLE IMAGERY — Imagens de bibliotecas instaladas
// ----------------------------------------------------------------

/**
 * Render available imagery from installed libraries.
 * Mostra imagens georreferenciadas disponiveis para aplicar ao boundary.
 *
 * @param {string} elementId - Boundary element ID
 * @returns {string} HTML string
 */
function _renderAvailableImagery(elementId) {
    const imagery = getAvailableImagery();
    if (imagery.length === 0) return '';

    let items = '';
    for (const img of imagery) {
        const name = escapeHtml(img.name || img.id);
        const res = escapeHtml(img.resolution || '');
        const source = escapeHtml(img.source || img.url || '');
        const isSentinel = source === 'sentinel-tiles';

        items += `
            <div style="display:flex; align-items:center; gap:8px; padding:4px 0;">
                <span style="flex-shrink:0; color:var(--neutral-400);">${getIcon('image', { size: '14px' })}</span>
                <div style="flex:1; min-width:0;">
                    <div style="font-size:11px; font-weight:600; color:var(--neutral-200);">${name}</div>
                    ${res ? `<div style="font-size:10px; color:var(--neutral-500);">${t('imageryResolution') || 'Resolution'}: ${res}</div>` : ''}
                </div>
                <button class="form-btn" style="font-size:10px; padding:2px 8px; flex-shrink:0;"
                        onclick="window.handleApplyImagery('${elementId}', '${escapeHtml(img.id)}', ${isSentinel})">
                    ${t('imageryApply') || 'Apply'}
                </button>
            </div>`;
    }

    return `
        <div style="margin-top:10px; border-top:1px solid var(--neutral-800); padding-top:8px;">
            <div style="font-size:11px; font-weight:600; color:var(--neutral-300); margin-bottom:6px;">
                ${getIcon('lightbulb', { size: '12px' })} ${t('imageryAvailable') || 'Available Imagery'}
            </div>
            ${items}
        </div>`;
}

// ----------------------------------------------------------------
// AREA CONTROLS — Vínculo com Project Areas e H&S
// ----------------------------------------------------------------

export function renderAreaControls(element) {
    const id = element.id;
    const data = element.data || {};
    const projectAreas = Array.isArray(window.projectAreas) ? window.projectAreas : [];
    const currentArea = data.projectArea || '';
    const areaTypeLabels = {
        production: 'Production',
        warehouse: 'Warehouse',
        office: 'Office',
        maintenance: 'Maintenance',
    };

    return `
        <div class="section" style="margin-top: 12px;">
            <div class="section-header">
                <span>${getIcon('layers', { size: '14px' })} ${t('organizationalArea') || 'Organizational Area'}</span>
                <span class="chevron">▼</span>
            </div>
            <div class="section-content">
                <div class="form-group" style="margin-bottom:8px;">
                    <label class="form-label">${t('projectArea') || 'Project Area'}</label>
                    <select class="form-input"
                            onchange="window.handleAreaFieldChange('${id}', 'projectArea', this.value)">
                        <option value="">— ${t('none') || 'None'} —</option>
                        ${projectAreas
                            .map(
                                (pa) =>
                                    `<option value="${escapeHtml(pa.area)}" ${pa.area === currentArea ? 'selected' : ''}>${escapeHtml(pa.area)}${pa.subarea ? ' / ' + escapeHtml(pa.subarea) : ''}</option>`,
                            )
                            .join('')}
                    </select>
                </div>
                <div class="form-group" style="margin-bottom:8px;">
                    <label class="form-label">${t('areaType') || 'Area Type'}</label>
                    <select class="form-input"
                            onchange="window.handleAreaFieldChange('${id}', 'areaType', this.value)">
                        ${Object.entries(areaTypeLabels)
                            .map(
                                ([val, label]) =>
                                    `<option value="${val}" ${data.areaType === val ? 'selected' : ''}>${label}</option>`,
                            )
                            .join('')}
                    </select>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px;">
                    <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" style="font-size:10px;">${t('headcount') || 'Headcount'}</label>
                        <input class="form-input" type="number" min="0"
                               value="${data.headcount || 0}"
                               onchange="window.handleAreaFieldChange('${id}', 'headcount', parseInt(this.value))">
                    </div>
                    <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" style="font-size:10px;">${t('workedHours') || 'Worked Hours'}</label>
                        <input class="form-input" type="number" min="0"
                               value="${data.workedHours || 0}"
                               onchange="window.handleAreaFieldChange('${id}', 'workedHours', parseInt(this.value))">
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ----------------------------------------------------------------
// ORG UNIT DROPDOWN — Vinculo elemento ↔ no da arvore Org/Op
// Disponivel para TODAS as familias de elementos.
// ----------------------------------------------------------------

/**
 * Render organizational unit dropdown for any element.
 * Dropdown que permite vincular o elemento a um no da arvore organizacional.
 *
 * @param {Object} element
 * @returns {string} HTML string
 */
export function renderOrgUnitDropdown(element) {
    const id = element.id;
    const currentAreaId = element.data?.areaId || '';

    // Achata a arvore em lista plana
    const nodes = [];
    function walk(node, depth) {
        nodes.push({ id: node.id, name: node.name, registryNumber: node.registryNumber || '', depth });
        if (Array.isArray(node.children)) node.children.forEach((c) => walk(c, depth + 1));
    }
    (window.areasTreeData || []).forEach((n) => walk(n, 0));

    if (nodes.length === 0) return '';

    const options = nodes
        .map((n) => {
            const indent = '\u00A0\u00A0'.repeat(n.depth);
            const registry = n.registryNumber ? ` (${escapeHtml(n.registryNumber)})` : '';
            return `<option value="${escapeHtml(n.id)}" ${n.id === currentAreaId ? 'selected' : ''}>${indent}${escapeHtml(n.name)}${registry}</option>`;
        })
        .join('');

    return `
        <div class="section" style="margin-top: 12px;">
            <div class="section-header">
                <span>${getIcon('building', { size: '14px' })} ${t('orgUnit') || 'Organizational Unit'}</span>
                <span class="chevron">\u25BC</span>
            </div>
            <div class="section-content">
                <div class="form-group" style="margin-bottom:0;">
                    <label class="form-label">${t('selectOrgUnit') || 'Select org unit'}</label>
                    <select class="form-input"
                            onchange="window.handleElementOrgUnitChange('${escapeHtml(id)}', this.value)">
                        <option value="">\u2014 ${t('noOrgUnit') || 'No org unit assigned'} \u2014</option>
                        ${options}
                    </select>
                </div>
            </div>
        </div>
    `;
}

// ----------------------------------------------------------------
// SENSOR CONTROLS — Config IoT, fetch, profile, leituras
// ----------------------------------------------------------------

export function renderSensorSummaryControls(element) {
    const id = element.id;
    const data = element.data || {};
    const readings = Array.isArray(data.latestReadings) ? data.latestReadings : [];
    const tempReading = readings.find((r) => r?.parameterId === 'temperature');
    const temperatureRaw =
        typeof tempReading?.value === 'number'
            ? tempReading.value
            : typeof data.weather?.temperatureRaw === 'number'
              ? data.weather.temperatureRaw
              : null;
    const temperatureText = Number.isFinite(temperatureRaw) ? `${temperatureRaw.toFixed(1)} °C` : '—';
    const sourceText = tempReading?.source || data.weather?.source || '—';
    const hasErrors = Array.isArray(data.errors) && data.errors.length > 0;
    const status = hasErrors
        ? t('sensorCenterStatusError') || 'Error'
        : data._autoRefreshActive
          ? t('sensorCenterStatusLive') || 'Live'
          : t('sensorCenterStatusIdle') || 'Idle';
    const statusColor = hasErrors ? '#dc2626' : data._autoRefreshActive ? '#22c55e' : 'var(--neutral-500)';
    const lastFetchText = data.lastFetch ? new Date(data.lastFetch).toLocaleString() : '—';

    return `
        <div class="section" style="margin-top: 12px;">
            <div class="section-header">
                <span>${getIcon('radio', { size: '14px' })} ${t('sensorCenterSummaryTitle') || 'Sensor Summary'}</span>
                <span class="chevron">▼</span>
            </div>
            <div class="section-content">
                <div class="sensor-summary-grid">
                    <div>
                        <span class="sensor-summary-label">${t('sensorCenterSummaryStatus') || 'Status'}</span>
                        <span class="sensor-summary-value" style="color:${statusColor};">${escapeHtml(status)}</span>
                    </div>
                    <div>
                        <span class="sensor-summary-label">${t('sensorCenterSummaryLastFetch') || 'Last fetch'}</span>
                        <span class="sensor-summary-value">${escapeHtml(lastFetchText)}</span>
                    </div>
                    <div>
                        <span class="sensor-summary-label">${t('sensorCenterSummaryTemperature') || 'Temperature'}</span>
                        <span class="sensor-summary-value">${escapeHtml(temperatureText)}</span>
                    </div>
                    <div>
                        <span class="sensor-summary-label">${t('sensorCenterSummaryAutoRefresh') || 'Auto-refresh'}</span>
                        <span class="sensor-summary-value">${data._autoRefreshActive ? t('sensorCenterStatusLive') || 'Live' : t('sensorCenterStatusIdle') || 'Idle'}</span>
                    </div>
                    <div>
                        <span class="sensor-summary-label">${t('sensorCenterColSource') || 'Source'}</span>
                        <span class="sensor-summary-value">${escapeHtml(sourceText)}</span>
                    </div>
                </div>
                <div style="display:flex; gap:6px; margin-top:8px;">
                    <button type="button" class="btn btn-primary" style="flex:1;"
                            onclick="window.handleFetchSensorData('${id}')">
                        ${getIcon('refresh-cw', { size: '14px' })}
                        <span data-i18n="sensorRefresh">${t('sensorRefresh') || 'Refresh Data'}</span>
                    </button>
                    <button type="button" class="btn btn-secondary" style="flex:1;"
                            onclick="window.handleOpenSensorsCenter('${id}')">
                        ${getIcon('grid', { size: '14px' })}
                        <span>${t('sensorCenterOpen') || 'Open Sensors Center'}</span>
                    </button>
                </div>
            </div>
        </div>
    `;
}

export function renderSensorControls(element) {
    const id = element.id;
    const data = element.data || {};
    const profile = data.profile;
    const evaluation = data.evaluation;
    const weather = data.weather;
    const lastFetch = data.lastFetch;
    const errors = data.errors || [];
    const sensorType = data.sensorType || 'multiparameter';
    const monitoredParams = Array.isArray(data.monitoredParameters)
        ? data.monitoredParameters
        : ['temperature', 'pH', 'conductivity', 'water_level'];
    const allParams = CONFIG.PARAMETERS || [];

    // Sensor types
    const sensorTypes = [
        { id: 'temperature', label: t('temperature') || 'Temperature' },
        { id: 'multiparameter', label: t('multiparameter') || 'Multiparameter' },
        { id: 'level', label: t('waterLevel') || 'Level' },
        { id: 'flow', label: t('flowRate') || 'Flow' },
        { id: 'air_quality', label: t('categoryAirQuality') || 'Air Quality' },
        { id: 'custom', label: t('custom') || 'Custom' },
    ];

    return `
        <div class="section" style="margin-top: 12px;">
            <div class="section-header">
                <span>${getIcon('radio', { size: '14px' })} Sensor IoT</span>
                <span class="chevron">▼</span>
            </div>
            <div class="section-content">
                <!-- Config do sensor -->
                <div class="form-group" style="margin-bottom:8px;">
                    <label class="form-label">${t('sensorType') || 'Sensor Type'}</label>
                    <select class="form-input"
                            onchange="window.handleSensorFieldChange('${id}', 'sensorType', this.value)">
                        ${sensorTypes
                            .map(
                                (st) => `
                            <option value="${st.id}" ${st.id === sensorType ? 'selected' : ''}>${escapeHtml(st.label)}</option>
                        `,
                            )
                            .join('')}
                    </select>
                </div>

                <!-- Parâmetros monitorados -->
                <div class="form-group" style="margin-bottom:8px;">
                    <label class="form-label">${t('sensorMonitoredParams') || 'Monitored Parameters'}</label>
                    <div style="max-height:120px; overflow-y:auto; border:1px solid var(--neutral-200); border-radius:4px; padding:4px;">
                        ${allParams
                            .slice(0, 30)
                            .map(
                                (p) => `
                            <label style="display:flex; align-items:center; gap:4px; font-size:11px; padding:2px 4px; cursor:pointer;">
                                <input type="checkbox" ${monitoredParams.includes(p.id) ? 'checked' : ''}
                                       onchange="window.handleSensorParameterToggle('${id}', '${p.id}', this.checked)">
                                <span>${escapeHtml(p.name)}</span>
                            </label>
                        `,
                            )
                            .join('')}
                    </div>
                </div>

                <!-- Botões de ação -->
                <div style="display:flex; gap:6px; margin-bottom:8px;">
                    <button type="button" class="btn btn-primary" style="flex:1;"
                            onclick="window.handleFetchSensorData('${id}')">
                        ${getIcon('refresh-cw', { size: '14px' })}
                        <span data-i18n="sensorRefresh">${t('sensorRefresh') || 'Refresh Data'}</span>
                    </button>
                    <button type="button" class="btn btn-secondary" style="flex:1;"
                            onclick="window.handleSensorToObservation('${id}')">
                        ${getIcon('plus', { size: '14px' })}
                        <span>${t('sensorAddObservation') || 'Add Reading'}</span>
                    </button>
                </div>

                <!-- Auto-refresh controls -->
                <div style="display:flex; align-items:center; gap:6px; margin-bottom:8px;">
                    <label style="display:flex; align-items:center; gap:4px; font-size:11px; cursor:pointer;">
                        <input type="checkbox" ${data._autoRefreshActive ? 'checked' : ''}
                               onchange="window.handleToggleAutoRefresh('${id}', this.checked,
                                   document.getElementById('auto-refresh-interval-${id}')?.value || '15min')">
                        <span data-i18n="sensorAutoRefresh">${t('sensorAutoRefresh') || 'Auto-refresh'}</span>
                    </label>
                    <select id="auto-refresh-interval-${id}" class="form-input"
                            style="width:auto; padding:2px 6px; font-size:11px;"
                            title="${t('sensorWeatherNote') || 'Weather data updates every ~15 min'}"
                            onchange="window.handleAutoRefreshIntervalChange('${id}', this.value)">
                        <option value="5min" ${data._autoRefreshInterval === '5min' ? 'selected' : ''}>5 min</option>
                        <option value="15min" ${!data._autoRefreshInterval || data._autoRefreshInterval === '15min' ? 'selected' : ''}>15 min</option>
                        <option value="30min" ${data._autoRefreshInterval === '30min' ? 'selected' : ''}>30 min</option>
                    </select>
                </div>

                <div data-sensor-lastfetch="${id}" style="font-size:10px; color:var(--neutral-400); margin-bottom:6px; display:flex; align-items:center; gap:6px;">
                    ${data._autoRefreshActive ? '<span class="sensor-pulse"></span>' : ''}
                    ${data._autoRefreshActive ? `<span style="color:#22c55e; font-weight:500;">${t('sensorLiveData') || 'Live'}</span>` : ''}
                    ${lastFetch ? `Last: ${new Date(lastFetch).toLocaleString()}` : ''}
                </div>

                <!-- Leituras multiparâmetro (FakerAPI) -->
                ${data.latestReadings && data.latestReadings.length > 0 ? renderSensorReadings(data.latestReadings) : ''}

                <!-- Perfil (genérico) -->
                ${profile ? renderSensorProfile(id, profile) : ''}
                ${evaluation ? renderSensorEval(id, evaluation) : ''}
                ${weather && weather.operationalStatus ? renderSensorWeather(weather) : ''}

                <!-- Erros -->
                ${
                    errors.length > 0
                        ? `
                    <div style="margin-top:6px; padding:6px; background:#fff3cd; border-radius:4px; font-size:10px; color:#856404;">
                        ${errors.map((e) => `<div>${escapeHtml(e)}</div>`).join('')}
                    </div>
                `
                        : ''
                }

                <!-- Conector externo (opcional) -->
                <details style="margin-top:8px; font-size:11px;">
                    <summary style="cursor:pointer; color:var(--neutral-400);">${t('sensorConnector') || 'External Connector'} (${t('optional') || 'optional'})</summary>
                    <input class="form-input" type="password" style="margin-top:4px;"
                           value="${escapeHtml(data.connectorKey || '')}"
                           oninput="window.handleSetSensorApiKey('${id}', this.value)"
                           placeholder="${t('sensorConnectorKey') || 'API Key'}">
                    <div style="font-size:10px; color:var(--neutral-400); margin-top:2px;">
                        ${t('sensorConnectorHint') || 'Optional: connect to weather or telemetry APIs'}
                    </div>
                </details>

                <!-- Endpoints editáveis -->
                <details style="margin-top:8px; font-size:11px;">
                    <summary style="cursor:pointer; color:var(--neutral-400);">
                        ${getIcon('link', { size: '12px' })} ${t('sensorEndpoints') || 'API Endpoints'}
                    </summary>
                    <div style="margin-top:6px;">
                        <div class="form-group" style="margin-bottom:6px;">
                            <label class="form-label" style="font-size:10px; color:var(--neutral-500);">
                                ${t('sensorEndpointIdentity') || 'Identity (Stage 1)'}
                            </label>
                            <input class="form-input" type="text" style="font-size:10px; font-family:monospace;"
                                   value="${escapeHtml(data.endpoints?.identity || '')}"
                                   oninput="window.handleSensorEndpointChange('${id}', 'identity', this.value)"
                                   placeholder="https://jsonplaceholder.typicode.com/users/{userId}">
                        </div>
                        <div class="form-group" style="margin-bottom:6px;">
                            <label class="form-label" style="font-size:10px; color:var(--neutral-500);">
                                ${t('sensorEndpointMetadata') || 'Metadata (Stage 2)'}
                            </label>
                            <input class="form-input" type="text" style="font-size:10px; font-family:monospace;"
                                   value="${escapeHtml(data.endpoints?.metadata || '')}"
                                   oninput="window.handleSensorEndpointChange('${id}', 'metadata', this.value)"
                                   placeholder="https://fakerapi.it/api/v1/custom?...">
                        </div>
                        <div class="form-group" style="margin-bottom:4px;">
                            <label class="form-label" style="font-size:10px; color:var(--neutral-500);">
                                ${t('sensorEndpointReadings') || 'Readings (Stage 2B)'}
                            </label>
                            <input class="form-input" type="text" style="font-size:10px; font-family:monospace;"
                                   value="${escapeHtml(data.endpoints?.readings || '')}"
                                   oninput="window.handleSensorEndpointChange('${id}', 'readings', this.value)"
                                   placeholder="https://fakerapi.it/api/v1/custom?_quantity=1&{fields}">
                        </div>
                        <div style="font-size:9px; color:var(--neutral-400); margin-top:4px; line-height:1.4;">
                            ${t('sensorEndpointsHint') || 'Use {userId} and {fields} as placeholders. Changes take effect on next Refresh.'}
                        </div>
                    </div>
                </details>
            </div>
        </div>
    `;
}

// ----------------------------------------------------------------
// SENSOR SUB-RENDERERS
// ----------------------------------------------------------------

function renderSensorReadings(readings) {
    if (!readings || readings.length === 0) return '';

    const allParams = CONFIG.PARAMETERS || [];

    return `
        <div style="margin-top:8px; padding:8px; background:linear-gradient(135deg, var(--neutral-50), #e8f5e9); border-radius:6px; border:1px solid #c8e6c9;">
            <div style="font-weight:600; font-size:11px; margin-bottom:6px; color:#2e7d32;">
                ${getIcon('activity', { size: '12px' })} ${t('sensorMonitoredParams') || 'Readings'} (${readings.length})
            </div>
            <div style="display:grid; grid-template-columns:1fr auto auto; gap:2px 8px; font-size:11px;">
                ${readings
                    .map((r) => {
                        const param = allParams.find((p) => p.id === r.parameterId);
                        const paramName = param ? escapeHtml(param.name) : escapeHtml(r.parameterId);
                        return `
                        <div style="color:var(--neutral-600); font-weight:500;">${paramName}</div>
                        <div style="font-family:monospace; font-weight:600; color:var(--neutral-800); text-align:right;">${r.value}</div>
                        <div style="color:var(--neutral-400); font-size:10px;">${escapeHtml(r.unit)}</div>
                    `;
                    })
                    .join('')}
            </div>
        </div>
    `;
}

function renderSensorProfile(elementId, profile) {
    return `
        <div style="margin-top:8px; padding:8px; background:var(--neutral-50); border-radius:6px; font-size:11px;">
            <div style="font-weight:600; margin-bottom:6px;">${getIcon('user', { size: '12px' })} ${t('sensorProfile') || 'Sensor Profile'}</div>
            <div class="form-group" style="margin-bottom:4px;">
                <label class="form-label" style="font-size:10px; color:var(--neutral-500);">${t('name') || 'Name'}</label>
                <input class="form-input" type="text" style="font-size:11px;"
                       value="${escapeHtml(profile.ownerName || '')}"
                       oninput="window.handleSensorProfileChange('${elementId}', 'ownerName', this.value)"
                       placeholder="${t('name') || 'Owner name'}">
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; margin-bottom:4px;">
                <div class="form-group" style="margin-bottom:0;">
                    <label class="form-label" style="font-size:10px; color:var(--neutral-500);">City</label>
                    <input class="form-input" type="text" style="font-size:11px;"
                           value="${escapeHtml(profile.city || '')}"
                           oninput="window.handleSensorProfileChange('${elementId}', 'city', this.value)"
                           placeholder="City">
                </div>
                <div class="form-group" style="margin-bottom:0;">
                    <label class="form-label" style="font-size:10px; color:var(--neutral-500);">Serial</label>
                    <input class="form-input" type="text" style="font-size:11px;"
                           value="${escapeHtml(profile.serial || '')}"
                           oninput="window.handleSensorProfileChange('${elementId}', 'serial', this.value)"
                           placeholder="SN-000">
                </div>
            </div>
            <div class="form-group" style="margin-bottom:0;">
                <label class="form-label" style="font-size:10px; color:var(--neutral-500);">UUID</label>
                <input class="form-input" type="text" style="font-size:10px; font-family:monospace;"
                       value="${escapeHtml(profile.uuid || '')}"
                       oninput="window.handleSensorProfileChange('${elementId}', 'uuid', this.value)"
                       placeholder="UUID">
            </div>
        </div>
    `;
}

function renderSensorEval(elementId, evaluation) {
    return `
        <div style="margin-top:6px; padding:8px; background:var(--neutral-50); border-radius:6px; font-size:11px;">
            <div style="font-weight:600; margin-bottom:6px;">${getIcon('hash', { size: '12px' })} ${t('sensorEvaluation') || 'Evaluation'}</div>
            <div class="form-group" style="margin-bottom:4px;">
                <label class="form-label" style="font-size:10px; color:var(--neutral-500);">id_modelo</label>
                <input class="form-input" type="text" style="font-size:10px; font-family:monospace;"
                       value="${escapeHtml(evaluation.modelId || '')}"
                       oninput="window.handleSensorEvalChange('${elementId}', 'modelId', this.value)"
                       placeholder="model-id">
            </div>
            <div class="form-group" style="margin-bottom:4px;">
                <label class="form-label" style="font-size:10px; color:var(--neutral-500);">quantitativo</label>
                <input class="form-input" type="number" step="any" style="font-size:10px; font-family:monospace;"
                       value="${evaluation.quantitative ?? ''}"
                       oninput="window.handleSensorEvalChange('${elementId}', 'quantitative', this.value)"
                       placeholder="0">
            </div>
            <div class="form-group" style="margin-bottom:0;">
                <label class="form-label" style="font-size:10px; color:var(--neutral-500);">chave</label>
                <input class="form-input" type="text" style="font-size:10px; font-family:monospace;"
                       value="${escapeHtml(evaluation.key || '')}"
                       oninput="window.handleSensorEvalChange('${elementId}', 'key', this.value)"
                       placeholder="key">
            </div>
        </div>
    `;
}

function renderSensorWeather(weather) {
    return `
        <div style="margin-top:6px; padding:8px; background:var(--neutral-50); border-radius:6px; font-size:11px;">
            <div style="font-weight:600; margin-bottom:4px;">${getIcon('cloud', { size: '12px' })} ${escapeHtml(weather.temperature || '-')}</div>
            <div style="color:var(--neutral-500);">
                ${t('humidity') || 'Humidity'}: ${weather.humidity ?? '-'}% ·
                ${t('pressure') || 'Pressure'}: ${weather.pressure ?? '-'} hPa
            </div>
            <div style="color:var(--neutral-400); font-size:10px;">${escapeHtml(weather.description || '')}</div>
        </div>
    `;
}
