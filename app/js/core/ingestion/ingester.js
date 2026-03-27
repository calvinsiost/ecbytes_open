// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)

/* ================================================================
   INGESTION INGESTER — Bulk creation of elements, campaigns, obs
   Execucao final da ingestao: cria elementos, campanhas e
   observacoes no modelo a partir do IngestionPlan.

   Usa as APIs existentes do manager de elementos e campanhas.
   ================================================================ */

import {
    addElement,
    getAllElements,
    getElementById,
    removeElement,
    removeElementsByFamily,
    clearAllElements,
} from '../elements/manager.js';
import { addCampaign, getAllCampaigns, removeCampaign, clearCampaigns } from '../campaigns/manager.js';
import { resolveChemical, resolveLocType, resolveUnit } from './mapper.js';
import { transformData } from './validator.js';
import { projectLocations } from '../../utils/helpers/geoProjection.js';
import { addElementGroup, setElementGroup } from '../../utils/groups/manager.js';
import { canonicalizeWellId, matchExistingWell } from './documents/wellIdCanon.js';

// ----------------------------------------------------------------
// CONCURRENCY GUARD — Impede ingestoes simultaneas
// Evita race conditions se o usuario clicar duas vezes.
// ----------------------------------------------------------------

let isIngesting = false;

// ----------------------------------------------------------------
// MAIN INGESTION FUNCTION
// ----------------------------------------------------------------

/**
 * Executa a ingestao completa: cria elements, campaigns e observations.
 * Suporte a opts.onProgress(phase, current, total) para barra de progresso.
 *
 * @param {IngestionPlan} plan - Plano de ingestao aprovado pelo wizard
 * @param {Object} [opts] - Opcoes de execucao (onProgress, etc.)
 * @returns {Promise<IngestionReport>}
 */
export async function ingest(plan, opts = {}) {
    // D10: guard de concorrencia — um import por vez
    if (isIngesting) throw new Error('Import em andamento. Aguarde o termino antes de iniciar outro.');
    isIngesting = true;
    try {
        const report = plan.domain === 'ohs' ? await ingestOHS(plan, opts) : await ingestEnvironmental(plan, opts);

        // Atualiza storyboard (clusters + scenes) apos ingestao bem-sucedida
        if (report.success) {
            import('../sequencer/manager.js').then((mod) => mod.refreshItems()).catch(() => {});
        }

        return report;
    } finally {
        isIngesting = false;
    }
}

// ----------------------------------------------------------------
// BUILD VIRTUAL MODEL — Constroi modelo em memoria sem side effects.
// Usado para alimentar o Diff/Merge modal: o wizard produz um
// modelo virtual, o usuario revisa via diff e aplica via merge.
// ----------------------------------------------------------------

/**
 * Constroi um modelo virtual a partir do plano de ingestao.
 * PURO — nao modifica estado dos managers, nao chama addElement/addCampaign.
 * O modelo retornado e compativel com diffModels() do core/diff/engine.js.
 *
 * @param {IngestionPlan} plan - Plano de ingestao aprovado pelo wizard
 * @param {Object} [opts] - { onProgress(phase, current, total) }
 * @returns {Promise<{model: object, stats: object, warnings: string[]}>}
 */
export async function buildVirtualModel(plan, opts = {}) {
    const warnings = [];

    // 1. Transforma dados brutos a partir do mapeamento final (com overrides do usuario).
    // Nota: re-computa transformData() intencionalmente — o mapeamento pode ter sido
    // alterado pelo usuario (column overrides, ambiguity resolution) apos o parse inicial.
    const transformed = transformData(plan.parsed, plan.mapping, {
        dateLocale: plan.decisions?.dateLocale || 'dd/mm',
    });

    // 2. Projeta coordenadas
    const locations = transformed.locations || [];
    const geoPoints = locations
        .filter((loc) => loc.latitude != null && loc.longitude != null)
        .map((loc) => ({
            latitude: Number(loc.latitude),
            longitude: Number(loc.longitude),
            elevation: Number(loc.elevation || 0),
        }));

    let projected = null;
    if (geoPoints.length > 0) {
        const customOrigin =
            typeof plan.decisions?.coordinateOrigin === 'object' ? plan.decisions.coordinateOrigin : null;
        const result = projectLocations(geoPoints, customOrigin);
        projected = result.projected;
    }

    // 3. Resolve coordinate system origin — zone/hemisphere derivados dos dados, nao hardcoded
    let coordOrigin = { easting: 0, northing: 0, elevation: 0 };
    let utmZone = 23;
    let utmHemisphere = 'S';
    if (plan.decisions?.applyOrigin !== false && plan.decisions?.suggestedOrigin) {
        try {
            const { wgs84ToUTM } = await import('../io/geo/coordinates.js');
            const { lat, lon } = plan.decisions.suggestedOrigin;
            const utm = wgs84ToUTM({ latitude: lat, longitude: lon });
            coordOrigin = { easting: utm.easting, northing: utm.northing, elevation: 0 };
            utmZone = utm.zone;
            utmHemisphere = utm.hemisphere;
        } catch (_) {
            /* geo module optional */
        }
    }

    // G2: calcular centroide de projecao para referencia futura
    let projectionCentroid = null;
    if (geoPoints.length > 0) {
        const latSum = geoPoints.reduce((s, p) => s + p.latitude, 0);
        const lonSum = geoPoints.reduce((s, p) => s + p.longitude, 0);
        projectionCentroid = {
            lat: latSum / geoPoints.length,
            lon: lonSum / geoPoints.length,
            count: geoPoints.length,
        };
    }

    // 4. Cria campanhas virtuais (sem addCampaign)
    const virtualCampaigns = [];
    const campaignMap = {};
    const decisions = plan.decisions || {};
    const samples = transformed.samples || [];
    // Slug deterministico do nome do arquivo — garante que re-imports matcham no diff
    const fileSlug = (plan.format?.fileName || 'import')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .slice(0, 20);

    if (decisions.campaignStrategy === 'single') {
        const id = `campaign-${fileSlug}`;
        virtualCampaigns.push({
            id,
            name: 'Campanha Importada',
            startDate: new Date().toISOString().slice(0, 10),
            endDate: null,
            color: '#3b6bff',
            visible: true,
            plannedReadings: [],
            costs: null,
        });
        campaignMap['_default'] = id;
    } else {
        // D1: prioridade para task_code
        const taskCodes = [...new Set(samples.map((s) => s.taskCode).filter(Boolean))].sort();
        const customNames = decisions.campaignNames || [];
        if (taskCodes.length > 0) {
            taskCodes.forEach((code, i) => {
                const cSamples = samples.filter((s) => s.taskCode === code);
                const dates = cSamples
                    .map((s) => s.sampleDate)
                    .filter(Boolean)
                    .map((d) => new Date(d))
                    .filter((d) => !isNaN(d.getTime()))
                    .sort((a, b) => a - b);
                const startDate =
                    dates.length > 0 ? dates[0].toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
                const endDate = dates.length > 1 ? dates[dates.length - 1].toISOString().slice(0, 10) : startDate;
                const name = customNames[i] || code;
                const id = `campaign-${code.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
                virtualCampaigns.push({
                    id,
                    name,
                    startDate,
                    endDate,
                    color: '#3b6bff',
                    visible: true,
                    plannedReadings: [],
                    costs: null,
                });
                campaignMap[code] = id;
            });
        } else {
            // Fallback: prefixo YYYYMMDD
            const prefixes = new Set();
            for (const sample of samples) {
                const prefix = String(sample.sampleCode || '').split('_')[0];
                if (/^\d{8}$/.test(prefix)) prefixes.add(prefix);
            }
            if (prefixes.size > 0) {
                [...prefixes].sort().forEach((prefix, i) => {
                    const cSamples = samples.filter((s) => String(s.sampleCode || '').startsWith(prefix + '_'));
                    const dates = cSamples
                        .map((s) => s.sampleDate)
                        .filter(Boolean)
                        .map((d) => new Date(d))
                        .filter((d) => !isNaN(d.getTime()))
                        .sort((a, b) => a - b);
                    const startDate =
                        dates.length > 0
                            ? dates[0].toISOString().slice(0, 10)
                            : `${prefix.slice(0, 4)}-${prefix.slice(4, 6)}-${prefix.slice(6, 8)}`;
                    const endDate = dates.length > 1 ? dates[dates.length - 1].toISOString().slice(0, 10) : startDate;
                    const name = customNames[i] || `Campanha ${i + 1} (${prefix.slice(0, 4)}-${prefix.slice(4, 6)})`;
                    const id = `campaign-${prefix}`;
                    virtualCampaigns.push({
                        id,
                        name,
                        startDate,
                        endDate,
                        color: '#3b6bff',
                        visible: true,
                        plannedReadings: [],
                        costs: null,
                    });
                    campaignMap[prefix] = id;
                });
            } else {
                const id = `campaign-${fileSlug}`;
                virtualCampaigns.push({
                    id,
                    name: 'Campanha Importada',
                    startDate: new Date().toISOString().slice(0, 10),
                    endDate: null,
                    color: '#3b6bff',
                    visible: true,
                    plannedReadings: [],
                    costs: null,
                });
                campaignMap['_default'] = id;
            }
        }
    }

    // 5. Cria elementos virtuais (sem addElement)
    const virtualElements = [];
    const elementByName = {};
    let projIdx = 0;

    for (const loc of locations) {
        const eddName = String(loc.elementName || '').trim();
        const hasCoords = loc.latitude != null && loc.longitude != null;
        // Nome vazio: pular mas manter projIdx sincronizado
        if (!eddName) {
            if (projected && hasCoords) projIdx++;
            continue;
        }

        // Guard: localidade duplicada — mantém apenas a primeira ocorrencia
        if (elementByName[eddName]) {
            warnings.push(`Localidade duplicada ignorada: '${eddName}'`);
            if (projected && hasCoords) projIdx++;
            continue;
        }

        const locType = String(loc.locType || '').trim();
        const familyId = resolveLocType(locType) || 'well';
        // ID deterministico — mesmo arquivo gera mesmos IDs para match no diff
        const id = `${familyId}-${eddName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

        // D16: flags de proveniencia de coordenadas e cota
        // Nota: elevation=0 e valido (sites ao nivel do mar) — ausente = null/empty string
        const hasElevation = loc.elevation != null && String(loc.elevation).trim() !== '';

        // D16b: estrategia para pontos sem coordenadas
        if (!hasCoords && decisions.missingCoordsStrategy === 'exclude') {
            warnings.push(`Local '${eddName}' sem coordenadas — excluido conforme decisao do usuario`);
            continue;
        }

        let x = 0,
            y = 0,
            z = 0;
        if (projected && hasCoords) {
            const p = projected[projIdx++];
            x = Math.round(p.x * 100) / 100;
            y = p.y;
            z = Math.round(p.z * 100) / 100;
        } else if (!hasCoords && decisions.missingCoordsStrategy === 'grid') {
            // Distribui em grade ao redor do centroide
            const noCoordIdx = virtualElements.filter((e) => e.data?.is_coordinates_available === 'no').length;
            const noCoordCount = locations.filter((l) => l.latitude == null || l.longitude == null).length;
            const gridSize = Math.ceil(Math.sqrt(noCoordCount || 1));
            const spacing = 5; // metros
            x = (noCoordIdx % gridSize) * spacing - (gridSize * spacing) / 2;
            z = Math.floor(noCoordIdx / gridSize) * spacing - (gridSize * spacing) / 2;
        }

        // D20: cota default
        if (!hasElevation) {
            y = decisions.defaultElevation ?? 0;
        }

        // D15: profundidade e diametro — usa dado da planilha ou default do usuario
        const depthFromData = loc.totalDepth != null ? Number(loc.totalDepth) : null;
        const diamFromData = loc.boreholeDiameter != null ? Number(loc.boreholeDiameter) : null;
        const depth = depthFromData ?? decisions.defaultWellDepth ?? 50;
        const diameter = diamFromData ?? decisions.defaultWellDiameter ?? 4;

        const data = {
            coordinates: { easting: x, northing: z, elevation: y },
            construction: { totalDepth: depth, diameter },
            observations: [],
            latitude: loc.latitude != null ? Number(loc.latitude) : null,
            longitude: loc.longitude != null ? Number(loc.longitude) : null,
            coordinate_datum: loc.datum || null,
            loc_type_detail: locType || null,
            thresholds: [],
            // D15/D16: tags de proveniencia — indicam se o dado veio do arquivo ou e default
            is_depth_available: depthFromData != null ? 'yes' : 'no',
            is_coordinates_available: hasCoords ? 'yes' : 'no',
            is_z_available: hasElevation ? 'yes' : 'no',
        };

        if (familyId !== 'well') {
            data.position = { x, y, z };
            delete data.coordinates;
            delete data.construction;
        }

        const element = {
            family: familyId,
            id,
            name: eddName,
            visible: true,
            iconClass: `icon-${familyId}`,
            color: '',
            description: '',
            label: eddName,
            labels: {},
            autoLabel: false,
            data,
            hierarchy: { parentId: null, order: 0 },
            stamps: [],
            messages: [],
        };

        virtualElements.push(element);
        elementByName[eddName] = { eddName, elementId: id, element };
    }

    // D17: gerar boundary automatico (convex hull) se solicitado
    if (decisions.generateBoundary) {
        const coordPoints = virtualElements
            .filter((el) => el.data?.is_coordinates_available === 'yes')
            .map((el) => ({
                x: el.data.coordinates?.easting ?? el.data.position?.x ?? 0,
                z: el.data.coordinates?.northing ?? el.data.position?.z ?? 0,
            }));
        if (coordPoints.length >= 3) {
            const hull = _convexHull2D(coordPoints);
            if (hull.length >= 3) {
                // Buffer de 10% para margem visual
                const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length;
                const cz = hull.reduce((s, p) => s + p.z, 0) / hull.length;
                const buffered = hull.map((p) => ({
                    x: cx + (p.x - cx) * 1.1,
                    z: cz + (p.z - cz) * 1.1,
                }));
                virtualElements.push({
                    family: 'boundary',
                    id: 'boundary-auto-import',
                    name: 'Area de Estudo',
                    visible: true,
                    iconClass: 'icon-boundary',
                    color: '#ff8c00',
                    description: 'Contorno automatico (convex hull)',
                    label: 'Area de Estudo',
                    labels: {},
                    autoLabel: false,
                    data: {
                        vertices: buffered,
                        center: { x: cx, y: 0, z: cz },
                    },
                    hierarchy: { parentId: null, order: 0 },
                    stamps: [],
                    messages: [],
                });
            }
        }
    }

    // 6. Cria observacoes e atribui aos elementos virtuais
    const results = transformed.results || [];
    const sampleMap = {};
    for (const s of samples) {
        if (s.sampleCode) sampleMap[s.sampleCode] = s;
    }

    let totalObs = 0;
    for (let i = 0; i < results.length; i++) {
        if (opts.onProgress && i % 50 === 0) {
            opts.onProgress('observations', i, results.length);
            await new Promise((r) => setTimeout(r, 0));
        }

        const result = results[i];
        const sampleCode = result.sampleCode;
        const sample = sampleMap[sampleCode] || {};
        const elementName = result.elementName || sample.elementName;
        if (!elementName) {
            warnings.push(`Resultado sem local: sample '${sampleCode}'`);
            continue;
        }

        const elInfo = elementByName[elementName];
        if (!elInfo) {
            warnings.push(`Local '${elementName}' nao encontrado para sample '${sampleCode}'`);
            continue;
        }

        const chemName = String(result.chemicalName || '').trim();
        const cas = String(result.casNumber || '').trim();
        const parameterId = resolveChemical(chemName, cas);
        const unitId = resolveUnit(String(result.resultUnit || ''));
        const detectFlagRaw = String(result.detectFlag || '').toUpperCase();
        const isNonDetect = detectFlagRaw === 'N';

        let value = null;
        if (!isNonDetect && result.resultValue != null && result.resultValue !== '') {
            value = Number(result.resultValue);
            if (isNaN(value)) value = null;
        } else if (isNonDetect) {
            const dl = result.detectionLimit != null ? Number(result.detectionLimit) : null;
            switch (decisions.nonDetectStrategy) {
                case 'flag_null':
                    value = null;
                    break;
                case 'half_lq':
                    value = dl != null ? dl / 2 : null;
                    break;
                case 'full_lq':
                    value = dl;
                    break;
                case 'discard':
                    continue;
            }
        }

        let campaignId = null;
        const taskCode = sample.taskCode || result.taskCode;
        if (taskCode && campaignMap[taskCode]) campaignId = campaignMap[taskCode];
        if (!campaignId && sampleCode) {
            const prefix = sampleCode.split('_')[0];
            if (/^\d{8}$/.test(prefix) && campaignMap[prefix]) campaignId = campaignMap[prefix];
        }
        if (!campaignId && campaignMap['_default']) campaignId = campaignMap['_default'];

        const date = sample.sampleDate
            ? new Date(sample.sampleDate).toISOString().slice(0, 10)
            : new Date().toISOString().slice(0, 10);

        const el = elInfo.element;
        const obsX = el?.data?.coordinates?.easting || el?.data?.position?.x || 0;
        const obsZ = el?.data?.coordinates?.northing || el?.data?.position?.z || 0;

        el.data.observations.push({
            x: obsX,
            y: 0,
            z: obsZ,
            date,
            campaignId,
            parameterId: parameterId || chemName.toLowerCase().replace(/\s+/g, '_'),
            value,
            unitId: unitId || 'ug_L',
            autoConvert: false,
            additionalReadings: [],
            variables: {},
            detect_flag: isNonDetect ? 'N' : value != null ? 'Y' : null,
            qualifier: result.qualifier || null,
            detection_limit: result.detectionLimit != null ? Number(result.detectionLimit) : null,
            cas_number: cas || null,
            lab_name: result.labName || sample.labName || null,
            sample_code: sampleCode || null,
            analytical_method: result.method || null,
            dilution_factor: result.dilution != null ? Number(result.dilution) : null,
            sample_matrix: result.matrix || sample.matrix || null,
            credentialLevel: 'common',
            createdBy: null,
        });
        totalObs++;
    }

    // 7. Aplica thresholds aos elementos virtuais
    let totalThresholds = 0;
    if (decisions.importThresholds !== false && transformed.actionLevels?.length > 0) {
        // Converte createdElements para formato esperado por applyThresholds
        const elInfoArray = virtualElements.map((el) => ({ element: el }));
        totalThresholds = applyThresholds(transformed.actionLevels, elInfoArray, warnings);
    }

    // 8. Monta families usadas
    const usedFamilies = {};
    for (const el of virtualElements) {
        usedFamilies[el.family] = usedFamilies[el.family] || { name: el.family };
    }

    // 9. Modelo virtual compativel com diffModels()
    const model = {
        ecbyts: '0.1-beta',
        schemaVersion: 2,
        timestamp: new Date().toISOString(),
        modelId: `import-${Date.now().toString(36)}`,
        project: {
            name: plan.format?.fileName || 'Imported Data',
            description: 'Dados importados via wizard de ingestao',
        },
        coordinate: {
            system: 'UTM',
            zone: utmZone,
            hemisphere: utmHemisphere,
            origin: coordOrigin,
            projectionCentroid,
        },
        families: usedFamilies,
        elements: virtualElements,
        edges: [],
        campaigns: virtualCampaigns,
        scenes: [],
        // NOTA: sections nao incluidas intencionalmente (interpolation, nn, calculator,
        // storyboard, report, libraries, etc.) — o diff engine ignora keys ausentes e
        // mergeModels() preserva os valores do Model A para essas sections.
        // Incluir arrays/objects vazios faria "Accept All B" apagar dados existentes.
    };

    return {
        model,
        stats: {
            elements: virtualElements.length,
            campaigns: virtualCampaigns.length,
            observations: totalObs,
            thresholds: totalThresholds,
        },
        warnings,
    };
}

// ----------------------------------------------------------------
// DIRECT INGESTION (legacy pipeline — chamado se merge desabilitado)
// ----------------------------------------------------------------

/**
 * Ingestao de dados ambientais (fluxo principal).
 * Suporta rollback em caso de falha parcial (D10),
 * clear strategy pre-ingestao (D3), aplicacao de origem (D2)
 * e progress callback (D9).
 *
 * @param {IngestionPlan} plan
 * @param {Object} [opts] - { onProgress(phase, current, total) }
 * @returns {Promise<IngestionReport>}
 */
async function ingestEnvironmental(plan, opts = {}) {
    const startTime = performance.now();
    const warnings = [];
    const errors = [];

    // D10: rastrea IDs criados para rollback em falha parcial
    const created = { elements: [], campaigns: [] };

    // Snapshot do modelo antes do clear para restore em caso de falha
    let preSnapshot = null;

    try {
        // D3: snapshot + clear ANTES de criar novos dados
        if (plan.decisions.clearStrategy && plan.decisions.clearStrategy !== 'none') {
            const { buildModel } = await import('../io/export.js');
            preSnapshot = buildModel();
            executeClearStrategy(plan.decisions.clearStrategy);
        }

        // D2: aplicar origem geografica se solicitado
        if (plan.decisions.applyOrigin && plan.decisions.suggestedOrigin) {
            const { setOrigin, wgs84ToUTM } = await import('../io/geo/coordinates.js');
            const { lat, lon } = plan.decisions.suggestedOrigin;
            const utm = wgs84ToUTM({ latitude: lat, longitude: lon });
            setOrigin({ easting: utm.easting, northing: utm.northing, zone: utm.zone, hemisphere: utm.hemisphere });
        }

        // 1. Transforma dados brutos usando mapeamento final
        const transformed = transformData(plan.parsed, plan.mapping, {
            dateLocale: plan.decisions?.dateLocale || 'dd/mm',
        });

        // 2. Cria campanhas
        const campaignsCreated = createCampaigns(transformed, plan.decisions, created);

        // 3. Cria elementos com coordenadas projetadas
        const elementsCreated = createElements(transformed, plan.decisions, warnings, created);

        // 4. Cria observacoes em bulk (com progress callback D9)
        const obsCreated = await createObservations(
            transformed,
            plan.decisions,
            elementsCreated,
            campaignsCreated,
            warnings,
            opts.onProgress,
        );

        // 5. D5: aplica thresholds (action levels) a todos os elementos se toggle habilitado
        let thresholdsCreated = 0;
        if (plan.decisions.importThresholds !== false && transformed.actionLevels?.length > 0) {
            thresholdsCreated = applyThresholds(transformed.actionLevels, elementsCreated, warnings);
        }

        const duration = Math.round(performance.now() - startTime);

        return {
            success: true,
            created: {
                elements: elementsCreated.length,
                campaigns: Object.keys(campaignsCreated).length,
                observations: obsCreated,
                thresholds: thresholdsCreated,
            },
            warnings,
            errors,
            duration,
        };
    } catch (err) {
        // D10: desfazer criações parciais em caso de falha
        rollback(created);
        // Restaurar modelo anterior se clear foi executado
        if (preSnapshot) {
            try {
                const { applyModel } = await import('../io/import.js');
                applyModel(preSnapshot);
                console.warn('[ecbyts] Model restored after failed ingestion');
            } catch (restoreErr) {
                console.error('[ecbyts] Failed to restore model after ingestion error:', restoreErr.message);
            }
        }
        errors.push(`Erro fatal na ingestao: ${err.message}`);
        return {
            success: false,
            created: { elements: 0, campaigns: 0, observations: 0 },
            warnings,
            errors,
            duration: Math.round(performance.now() - startTime),
        };
    }
}

/**
 * D10: Desfaz criações parciais em caso de falha.
 * Remove campanhas e elementos criados antes do erro.
 *
 * @param {{ elements: string[], campaigns: string[] }} created
 */
function rollback(created) {
    console.warn('[ecbyts] ingestion rollback: removing', created);
    for (const id of created.campaigns || []) {
        try {
            removeCampaign(id);
        } catch (_) {}
    }
    for (const id of created.elements || []) {
        try {
            if (getElementById(id)) removeElement(id);
        } catch (_) {}
    }
}

/**
 * D3: Executa a estrategia de limpeza de modelo antes da ingestao.
 * Suporta: 'all' (limpa tudo), 'family:X' (limpa apenas familia X).
 *
 * @param {string} strategy - 'all' | 'family:wellId'
 */
function executeClearStrategy(strategy) {
    if (strategy === 'all') {
        clearAllElements();
        clearCampaigns();
    } else if (strategy.startsWith('family:')) {
        const familyId = strategy.replace('family:', '');
        removeElementsByFamily(familyId);
    }
}

// ----------------------------------------------------------------
// THRESHOLD APPLICATION (D5)
// ----------------------------------------------------------------

/**
 * D5: Aplica action levels (niveis de acao) como thresholds a todos os elementos.
 * Thresholds sao globais ao site — cada nivel e replicado a todos os elementos criados.
 * Formato ThresholdEntry: { type, value, matrix, unit, severity, source, meta }
 *
 * @param {Array} actionLevels - Rows da aba ref_Niveis de Acao (transformados)
 * @param {Array} createdElements - Array de {eddName, elementId, element}
 * @param {Array} warnings
 * @returns {number} Total de thresholds aplicados por elemento (contagem global)
 */
function applyThresholds(actionLevels, createdElements, warnings) {
    if (!actionLevels?.length || !createdElements?.length) return 0;

    // Converte cada action level row em um ThresholdEntry
    const entries = [];
    for (const row of actionLevels) {
        const rawValue = row.actionLevel ?? row.resultValue ?? row.value;
        const value = rawValue != null ? Number(rawValue) : null;
        if (value == null || isNaN(value)) {
            warnings.push(`Action level sem valor numerico: ${JSON.stringify(row)}`);
            continue;
        }

        const code = String(row.actionLevelCode || '')
            .toUpperCase()
            .trim();
        // Mapeia codigo para tipo padrao: VI, VP, VR, CMA → type identico; outros → 'screening'
        const type = /^(vi|vp|vr|cma)$/i.test(code) ? code.toLowerCase() : 'screening';

        const chemName = String(row.chemicalName || '').trim();
        const cas = String(row.casNumber || '').trim();
        const unit = resolveUnit(String(row.resultUnit || '')) || String(row.resultUnit || '').trim() || 'ug_L';

        // Normaliza matrix: AS/água subterrânea → 'groundwater', solo/SS → 'soil'
        const rawMatrix = String(row.matrix || '')
            .trim()
            .toLowerCase();
        const matrix =
            rawMatrix === 'as' || rawMatrix.includes('sub')
                ? 'groundwater'
                : rawMatrix === 'ss' || rawMatrix.includes('solo')
                  ? 'soil'
                  : rawMatrix || 'groundwater';

        entries.push({
            type,
            value,
            matrix,
            unit,
            severity: type === 'vi' ? 'critical' : type === 'vp' ? 'warning' : 'info',
            source: row.actionLevelNote || 'EDD import',
            meta: {
                parameterId: resolveChemical(chemName, cas) || chemName.toLowerCase().replace(/\s+/g, '_'),
                chemicalName: chemName || null,
                casNumber: cas || null,
            },
        });
    }

    if (!entries.length) return 0;

    // Aplica os thresholds a cada elemento criado
    let totalApplied = 0;
    for (const elInfo of createdElements) {
        if (!elInfo?.element?.data) continue;
        if (!Array.isArray(elInfo.element.data.thresholds)) {
            elInfo.element.data.thresholds = [];
        }
        elInfo.element.data.thresholds.push(...entries);
        totalApplied += entries.length;
    }

    return totalApplied;
}

// ----------------------------------------------------------------
// OHS INGESTION
// ----------------------------------------------------------------

/**
 * Ingestao de dados ocupacionais (OHS).
 * Cria individuals, areas, groups (GHE) e observacoes.
 *
 * @param {IngestionPlan} plan
 * @param {Object} [opts]
 * @returns {Promise<IngestionReport>}
 */
async function ingestOHS(plan, opts = {}) {
    const startTime = performance.now();
    const warnings = [];
    const errors = [];

    try {
        const transformed = transformData(plan.parsed, plan.mapping, {
            dateLocale: plan.decisions?.dateLocale || 'dd/mm',
        });
        const d = plan.decisions;

        // 1. Campanhas
        const campaignsCreated = createCampaigns(transformed, d);

        // 2. Coleta trabalhadores e setores unicos dos dados
        const workerMap = {}; // workerId → element info
        const areaMap = {}; // department/sector → element info
        const gheMap = {}; // gheId → group info

        for (const result of transformed.results || []) {
            const workerId = String(result.workerId || '').trim();
            const workerName = String(result.workerName || '').trim();
            const dept = String(result.department || '').trim();
            const gheId = String(result.gheId || '').trim();
            const sampleType = String(result.sampleTypeOHS || '')
                .toLowerCase()
                .trim();

            // Trabalhadores (family='individual')
            if (workerId && !workerMap[workerId]) {
                const displayName =
                    d.lgpdStrategy === 'pseudonymize'
                        ? pseudonymize(workerName || workerId)
                        : d.lgpdStrategy === 'anonymize'
                          ? `Trab-${Object.keys(workerMap).length + 1}`
                          : workerName || workerId;

                workerMap[workerId] = { displayName, jobTitle: result.jobTitle || null };
            }

            // Setores/areas (family='area') — so se sampleType inclui 'area'
            if (
                dept &&
                !areaMap[dept] &&
                (d.sampleTypeStrategy === 'separate'
                    ? sampleType === 'area' || sampleType === 'area_sample' || sampleType === 'ambiental'
                    : false)
            ) {
                areaMap[dept] = { displayName: dept };
            }

            // GHE
            if (gheId && !gheMap[gheId] && d.gheStrategy === 'create_groups') {
                gheMap[gheId] = { workers: new Set() };
            }
            if (gheId && gheMap[gheId] && workerId) {
                gheMap[gheId].workers.add(workerId);
            }
        }

        // 3. Cria elementos individual
        const createdWorkers = {};
        for (const [wId, info] of Object.entries(workerMap)) {
            const elId = `individual-${wId.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
            try {
                const element = addElement('individual', elId, info.displayName, {
                    observations: [],
                    jobTitle: info.jobTitle,
                    originalId: d.lgpdStrategy === 'keep_identified' ? wId : null,
                });
                createdWorkers[wId] = { elementId: elId, element };
            } catch (err) {
                warnings.push(`Erro ao criar trabalhador '${info.displayName}': ${err.message}`);
            }
        }

        // 4. Cria elementos area
        const createdAreas = {};
        for (const [areaName, info] of Object.entries(areaMap)) {
            const elId = `area-${areaName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
            try {
                const element = addElement('area', elId, info.displayName, {
                    observations: [],
                });
                createdAreas[areaName] = { elementId: elId, element };
            } catch (err) {
                warnings.push(`Erro ao criar area '${info.displayName}': ${err.message}`);
            }
        }

        // 5. Cria groups para GHE
        let groupsCreated = 0;
        for (const [gheId, info] of Object.entries(gheMap)) {
            try {
                const group = addElementGroup({ name: `GHE: ${gheId}` });
                // Vincula trabalhadores ao grupo
                for (const workerId of info.workers) {
                    const worker = createdWorkers[workerId];
                    if (worker) {
                        setElementGroup(worker.elementId, group.id);
                    }
                }
                groupsCreated++;
            } catch (err) {
                warnings.push(`Erro ao criar GHE '${gheId}': ${err.message}`);
            }
        }

        // 6. Cria observacoes OHS
        const obsCreated = createOHSObservations(
            transformed,
            d,
            createdWorkers,
            createdAreas,
            campaignsCreated,
            warnings,
        );

        const totalElements = Object.keys(createdWorkers).length + Object.keys(createdAreas).length;
        const duration = Math.round(performance.now() - startTime);

        return {
            success: true,
            created: {
                elements: totalElements,
                campaigns: Object.keys(campaignsCreated).length,
                observations: obsCreated,
                groups: groupsCreated,
                workers: Object.keys(createdWorkers).length,
                areas: Object.keys(createdAreas).length,
            },
            warnings,
            errors,
            duration,
        };
    } catch (err) {
        errors.push(`Erro fatal na ingestao OHS: ${err.message}`);
        return {
            success: false,
            created: { elements: 0, campaigns: 0, observations: 0, groups: 0, workers: 0, areas: 0 },
            warnings,
            errors,
            duration: Math.round(performance.now() - startTime),
        };
    }
}

// ----------------------------------------------------------------
// CAMPAIGN CREATION
// ----------------------------------------------------------------

/**
 * Cria campanhas a partir dos dados transformados.
 * D1: prioriza agrupamento por task_code se disponivel.
 * Fallback: agrupamento por prefixo YYYYMMDD do codigo de amostra.
 *
 * @param {Object} transformed
 * @param {Object} decisions
 * @param {{ campaigns: string[] }} [createdTracker] - Rastreia IDs para rollback D10
 * @returns {Object} mapa { prefixo_ou_taskCode: campaignId }
 */
function createCampaigns(transformed, decisions, createdTracker) {
    const campaignMap = {};

    // Helper para registrar campanha e rastrear ID para rollback
    function registerCampaign(data) {
        const campaign = addCampaign(data);
        if (createdTracker) createdTracker.campaigns.push(campaign.id);
        return campaign;
    }

    if (decisions.campaignStrategy === 'single') {
        // Uma unica campanha
        const campaign = registerCampaign({
            name: 'Campanha Importada',
            startDate: new Date().toISOString().slice(0, 10),
        });
        campaignMap['_default'] = campaign.id;
        return campaignMap;
    }

    // D1: prioridade para task_code se disponivel nos dados
    const taskCodes = [...new Set(transformed.samples.map((s) => s.taskCode).filter(Boolean))];
    if (taskCodes.length > 0) {
        taskCodes.sort();
        const customNames = decisions.campaignNames || [];
        taskCodes.forEach((code, i) => {
            const campaignSamples = transformed.samples.filter((s) => s.taskCode === code);
            const dates = campaignSamples
                .map((s) => s.sampleDate)
                .filter(Boolean)
                .map((d) => new Date(d))
                .filter((d) => !isNaN(d.getTime()))
                .sort((a, b) => a - b);
            const startDate =
                dates.length > 0 ? dates[0].toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
            const endDate = dates.length > 1 ? dates[dates.length - 1].toISOString().slice(0, 10) : startDate;
            const name = customNames[i] || code;
            const campaign = registerCampaign({ name, startDate, endDate });
            campaignMap[code] = campaign.id;
        });
        return campaignMap;
    }

    // Fallback: detecta campanhas por prefixo de amostra (YYYYMMDD)
    const prefixes = new Set();
    for (const sample of transformed.samples) {
        const code = String(sample.sampleCode || '');
        const prefix = code.split('_')[0];
        if (/^\d{8}$/.test(prefix)) {
            prefixes.add(prefix);
        }
    }

    if (prefixes.size === 0) {
        // Nenhum prefixo detectado — campanha unica
        const campaign = registerCampaign({
            name: 'Campanha Importada',
            startDate: new Date().toISOString().slice(0, 10),
        });
        campaignMap['_default'] = campaign.id;
        return campaignMap;
    }

    // Cria uma campanha por prefixo YYYYMMDD
    const sortedPrefixes = [...prefixes].sort();
    const customNames = decisions.campaignNames || [];

    sortedPrefixes.forEach((prefix, i) => {
        // Encontra date range para esta campanha
        const campaignSamples = transformed.samples.filter((s) => {
            const code = String(s.sampleCode || '');
            return code.startsWith(prefix + '_');
        });
        const dates = campaignSamples
            .map((s) => s.sampleDate)
            .filter((d) => d != null)
            .map((d) => new Date(d))
            .filter((d) => !isNaN(d.getTime()))
            .sort((a, b) => a - b);

        const startDate =
            dates.length > 0
                ? dates[0].toISOString().slice(0, 10)
                : `${prefix.slice(0, 4)}-${prefix.slice(4, 6)}-${prefix.slice(6, 8)}`;
        const endDate = dates.length > 1 ? dates[dates.length - 1].toISOString().slice(0, 10) : startDate;

        const name = customNames[i] || `Campanha ${i + 1} (${prefix.slice(0, 4)}-${prefix.slice(4, 6)})`;

        const campaign = registerCampaign({ name, startDate, endDate });
        campaignMap[prefix] = campaign.id;
    });

    return campaignMap;
}

// ----------------------------------------------------------------
// ELEMENT CREATION
// ----------------------------------------------------------------

/**
 * Cria elementos a partir dos locais transformados.
 * Projeta coordenadas lat/long para XYZ local.
 * D6: aplica estrategia de duplicatas (replace | append | skip).
 * D10: rastreia IDs criados para rollback.
 *
 * @param {Object} transformed
 * @param {Object} decisions
 * @param {Array} warnings
 * @param {{ elements: string[] }} [createdTracker] - Rastreia IDs para rollback
 * @returns {Array<{eddName, elementId, element}>}
 */
function createElements(transformed, decisions, warnings, createdTracker) {
    const locations = transformed.locations;
    if (!locations.length) return [];

    // Extrai coordenadas para projecao
    const geoPoints = locations
        .filter((loc) => loc.latitude != null && loc.longitude != null)
        .map((loc) => ({
            latitude: Number(loc.latitude),
            longitude: Number(loc.longitude),
            elevation: Number(loc.elevation || 0),
        }));

    // Calcula projecao
    let projected = null;
    let origin = null;
    if (geoPoints.length > 0) {
        const customOrigin = typeof decisions.coordinateOrigin === 'object' ? decisions.coordinateOrigin : null;
        const result = projectLocations(geoPoints, customOrigin);
        projected = result.projected;
        origin = result.origin;
    }

    // Cria cada elemento
    const created = [];
    let projIdx = 0;

    for (const loc of locations) {
        const rawName = String(loc.elementName || '').trim();
        if (!rawName) continue;

        // D22: canonicalizar Well IDs (PM 01 → PM-01) se habilitado
        let eddName = rawName;
        if (decisions.canonicalize !== false) {
            const canon = canonicalizeWellId(rawName);
            if (canon) eddName = canon; // non-well elements pass through
        }

        // Resolve familia
        const locType = String(loc.locType || '').trim();
        const familyId = resolveLocType(locType) || 'well';

        // Gera ID unico
        const id = `${familyId}-${eddName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

        // D16: flags de proveniencia
        const hasCoords = loc.latitude != null && loc.longitude != null;
        const hasElevation = loc.elevation != null && String(loc.elevation).trim() !== '';

        // Coordenadas projetadas ou default
        let x = 0,
            y = 0,
            z = 0;
        if (projected && hasCoords) {
            const p = projected[projIdx++];
            x = Math.round(p.x * 100) / 100;
            y = p.y;
            z = Math.round(p.z * 100) / 100;
        }
        // D20: cota default
        if (!hasElevation) y = decisions.defaultElevation ?? 0;

        // D15: profundidade e diametro
        const depthFromData = loc.totalDepth != null ? Number(loc.totalDepth) : null;
        const diamFromData = loc.boreholeDiameter != null ? Number(loc.boreholeDiameter) : null;
        const depth = depthFromData ?? decisions.defaultWellDepth ?? 50;
        const diameter = diamFromData ?? decisions.defaultWellDiameter ?? 4;

        // Dados da familia
        const data = {
            coordinates: { easting: x, northing: z, elevation: y },
            construction: { totalDepth: depth, diameter },
            observations: [],
            // Metadados EDD preservados
            latitude: loc.latitude != null ? Number(loc.latitude) : null,
            longitude: loc.longitude != null ? Number(loc.longitude) : null,
            coordinate_datum: loc.datum || null,
            loc_type_detail: locType || null,
            // D22: preservar nome original se canonicalizado
            original_loc_code: rawName !== eddName ? rawName : null,
            // D15/D16: tags de proveniencia
            is_depth_available: depthFromData != null ? 'yes' : 'no',
            is_coordinates_available: hasCoords ? 'yes' : 'no',
            is_z_available: hasElevation ? 'yes' : 'no',
        };

        if (familyId !== 'well') {
            data.position = { x, y, z };
            delete data.coordinates;
            delete data.construction;
        }

        // D6: verificar duplicatas — canonicalizacao bidirecional (D22)
        if (decisions.duplicateStrategy && decisions.duplicateStrategy !== 'append') {
            const existingNames = getAllElements().map((e) => e.name);
            // Tenta match canonico primeiro, depois raw
            const canonMatch = decisions.canonicalize !== false ? matchExistingWell(eddName, existingNames) : null;
            const existing = canonMatch
                ? getAllElements().find((e) => e.name === canonMatch)
                : getAllElements().find((e) => e.data?.sys_loc_code === eddName || e.name === eddName);
            if (existing) {
                if (decisions.duplicateStrategy === 'replace') {
                    try {
                        removeElement(existing.id);
                    } catch (_) {}
                } else if (decisions.duplicateStrategy === 'skip') {
                    continue;
                }
            }
        }

        try {
            const element = addElement(familyId, id, eddName, data, {
                iconClass: `icon-${familyId}`,
                color: '',
                label: eddName,
            });
            created.push({ eddName, elementId: id, element });
            // D10: rastrear ID para rollback
            if (createdTracker) createdTracker.elements.push(id);
        } catch (err) {
            warnings.push(`Erro ao criar elemento '${eddName}': ${err.message}`);
        }
    }

    return created;
}

// ----------------------------------------------------------------
// OBSERVATION CREATION (BULK)
// ----------------------------------------------------------------

/**
 * Cria observacoes em bulk para todos os resultados.
 * Vincula cada resultado ao elemento e campanha corretos.
 * D9: emite callbacks de progresso a cada 50 resultados.
 * D1: usa taskCode como chave de lookup no campaignMap.
 *
 * @param {Object} transformed
 * @param {Object} decisions
 * @param {Array} createdElements - Array de {eddName, elementId, element}
 * @param {Object} campaignMap - {prefix: campaignId}
 * @param {Array} warnings
 * @param {Function} [onProgress] - Callback(phase, current, total)
 * @returns {Promise<number>} total de observacoes criadas
 */
async function createObservations(transformed, decisions, createdElements, campaignMap, warnings, onProgress) {
    const results = transformed.results;
    const samples = transformed.samples;

    // Mapa de sample → {elementName, sampleDate, matrix, ...}
    const sampleMap = {};
    for (const s of samples) {
        if (s.sampleCode) sampleMap[s.sampleCode] = s;
    }

    // Mapa de elementName → element
    const elementByName = {};
    for (const e of createdElements) {
        elementByName[e.eddName] = e;
    }

    // Agrupa resultados por elemento
    const obsByElement = {};
    let totalCreated = 0;
    const allResults = results;

    for (let i = 0; i < allResults.length; i++) {
        const result = allResults[i];

        // D9: emite progresso a cada 50 resultados para atualizar a barra
        if (onProgress && i % 50 === 0) {
            onProgress('observations', i, allResults.length);
            await new Promise((r) => setTimeout(r, 0));
        }

        const sampleCode = result.sampleCode;
        const sample = sampleMap[sampleCode] || {};
        const elementName = result.elementName || sample.elementName;

        if (!elementName) {
            warnings.push(`Resultado sem local: sample '${sampleCode}'`);
            continue;
        }

        const elInfo = elementByName[elementName];
        if (!elInfo) {
            warnings.push(`Local '${elementName}' nao encontrado para sample '${sampleCode}'`);
            continue;
        }

        // Resolve parametro
        const chemName = String(result.chemicalName || '').trim();
        const cas = String(result.casNumber || '').trim();
        const parameterId = resolveChemical(chemName, cas);

        // Resolve unidade
        const unitId = resolveUnit(String(result.resultUnit || ''));

        // Detect flag
        const detectFlagRaw = String(result.detectFlag || '').toUpperCase();
        const isNonDetect = detectFlagRaw === 'N';

        // Valor
        let value = null;
        if (!isNonDetect && result.resultValue != null && result.resultValue !== '') {
            value = Number(result.resultValue);
            if (isNaN(value)) value = null;
        } else if (isNonDetect) {
            // Aplica estrategia de nao-detectado
            const dl = result.detectionLimit != null ? Number(result.detectionLimit) : null;
            switch (decisions.nonDetectStrategy) {
                case 'flag_null':
                    value = null;
                    break;
                case 'half_lq':
                    value = dl != null ? dl / 2 : null;
                    break;
                case 'full_lq':
                    value = dl;
                    break;
                case 'discard':
                    continue; // pula esta observacao
            }
        }

        // Resolve campanha: D1 tenta taskCode primeiro, depois prefixo YYYYMMDD
        let campaignId = null;
        const taskCode = sample.taskCode || result.taskCode;
        if (taskCode && campaignMap[taskCode]) {
            campaignId = campaignMap[taskCode];
        }
        if (!campaignId && sampleCode) {
            const prefix = sampleCode.split('_')[0];
            if (/^\d{8}$/.test(prefix) && campaignMap[prefix]) {
                campaignId = campaignMap[prefix];
            }
        }
        if (!campaignId && campaignMap['_default']) {
            campaignId = campaignMap['_default'];
        }

        // Data de coleta
        const date = sample.sampleDate
            ? new Date(sample.sampleDate).toISOString().slice(0, 10)
            : new Date().toISOString().slice(0, 10);

        // Posicao do elemento
        const el = elInfo.element;
        const obsX = el?.data?.coordinates?.easting || el?.data?.position?.x || 0;
        const obsZ = el?.data?.coordinates?.northing || el?.data?.position?.z || 0;

        // Constroi observacao
        const obs = {
            x: obsX,
            y: 0,
            z: obsZ,
            date,
            campaignId,
            parameterId: parameterId || chemName.toLowerCase().replace(/\s+/g, '_'),
            value,
            unitId: unitId || 'ug_L',
            autoConvert: false,
            additionalReadings: [],
            variables: {},
            // Campos EDD
            detect_flag: isNonDetect ? 'N' : value != null ? 'Y' : null,
            qualifier: result.qualifier || null,
            detection_limit: result.detectionLimit != null ? Number(result.detectionLimit) : null,
            cas_number: cas || null,
            lab_name: result.labName || sample.labName || null,
            sample_code: sampleCode || null,
            analytical_method: result.method || null,
            dilution_factor: result.dilution != null ? Number(result.dilution) : null,
            sample_matrix: result.matrix || sample.matrix || null,
            // Carimbo de credencial — dados importados sem verificacao de autor
            credentialLevel: 'common',
            createdBy: null,
        };

        // Acumula por elemento
        if (!obsByElement[elInfo.elementId]) {
            obsByElement[elInfo.elementId] = [];
        }
        obsByElement[elInfo.elementId].push(obs);
        totalCreated++;
    }

    // Aplica observacoes em bulk a cada elemento
    for (const [elementId, observations] of Object.entries(obsByElement)) {
        const elInfo = createdElements.find((e) => e.elementId === elementId);
        if (!elInfo?.element) continue;

        const existingObs = Array.isArray(elInfo.element.data?.observations) ? elInfo.element.data.observations : [];

        // Atualiza data do elemento diretamente (sem updateElement para performance)
        elInfo.element.data.observations = [...existingObs, ...observations];
    }

    return totalCreated;
}

// ----------------------------------------------------------------
// OHS OBSERVATION CREATION
// ----------------------------------------------------------------

/**
 * Cria observacoes OHS vinculando ao trabalhador ou area.
 */
function createOHSObservations(transformed, decisions, createdWorkers, createdAreas, campaignMap, warnings) {
    const results = transformed.results || [];
    const samples = transformed.samples || [];
    const obsByElement = {};
    let totalCreated = 0;

    // Mapa de sample → info
    const sampleMap = {};
    for (const s of samples) {
        if (s.sampleCode) sampleMap[s.sampleCode] = s;
    }

    for (const result of results) {
        const workerId = String(result.workerId || '').trim();
        const dept = String(result.department || '').trim();
        const sampleType = String(result.sampleTypeOHS || '')
            .toLowerCase()
            .trim();
        const sampleCode = result.sampleCode;
        const sample = sampleMap[sampleCode] || {};

        // Determina elemento alvo
        let targetElementId = null;
        if (
            decisions.sampleTypeStrategy === 'separate' &&
            (sampleType === 'area' || sampleType === 'area_sample' || sampleType === 'ambiental')
        ) {
            // Observacao de area → element area
            const areaInfo = createdAreas[dept];
            if (areaInfo) targetElementId = areaInfo.elementId;
        }
        if (!targetElementId && workerId && createdWorkers[workerId]) {
            // Observacao pessoal/biologica → element individual
            targetElementId = createdWorkers[workerId].elementId;
        }

        if (!targetElementId) {
            warnings.push(`Resultado OHS sem destino: worker='${workerId}', dept='${dept}'`);
            continue;
        }

        // Resolve parametro
        const agentName = String(result.exposureAgent || result.chemicalName || '').trim();
        const cas = String(result.casNumber || '').trim();
        const parameterId = resolveChemical(agentName, cas);

        // Resolve unidade
        const unitId = resolveUnit(String(result.resultUnit || ''));

        // Valor
        let value = null;
        if (result.resultValue != null && result.resultValue !== '') {
            value = Number(result.resultValue);
            if (isNaN(value)) value = null;
        }

        // Campanha
        let campaignId = campaignMap['_default'] || null;
        if (sampleCode) {
            const prefix = sampleCode.split('_')[0];
            if (/^\d{8}$/.test(prefix) && campaignMap[prefix]) {
                campaignId = campaignMap[prefix];
            }
        }

        // Data
        const date =
            sample.sampleDate || result.sampleDate
                ? new Date(sample.sampleDate || result.sampleDate).toISOString().slice(0, 10)
                : new Date().toISOString().slice(0, 10);

        // Constroi observacao OHS
        const obs = {
            x: 0,
            y: 0,
            z: 0,
            date,
            campaignId,
            parameterId: parameterId || agentName.toLowerCase().replace(/\s+/g, '_'),
            value,
            unitId: unitId || 'mg_m3',
            autoConvert: false,
            additionalReadings: [],
            variables: {
                // Variaveis OHS
                exposure_route: result.exposureRoute || null,
                sample_type_ohs: result.sampleTypeOHS || null,
                biological_matrix: result.specimen || null,
                ghe_id: result.gheId || null,
                worker_id: workerId || null,
                ppe_status: result.ppeStatus || null,
                duration_hours: result.durationHours != null ? Number(result.durationHours) : null,
                twa_8h: result.twa8h != null ? Number(result.twa8h) : null,
                oel_reference: result.oel != null ? Number(result.oel) : null,
                oel_source: decisions.oelSource || null,
            },
            // Campos compartilhados
            qualifier: result.qualifier || null,
            lab_name: result.labName || null,
            sample_code: sampleCode || null,
            analytical_method: result.method || null,
            // Carimbo de credencial — dados importados sem verificacao de autor
            credentialLevel: 'common',
            createdBy: null,
        };

        if (!obsByElement[targetElementId]) obsByElement[targetElementId] = [];
        obsByElement[targetElementId].push(obs);
        totalCreated++;
    }

    // Aplica observacoes em bulk
    const allCreated = { ...createdWorkers, ...createdAreas };
    for (const [elementId, observations] of Object.entries(obsByElement)) {
        const info = Object.values(allCreated).find((e) => e.elementId === elementId);
        if (!info?.element) continue;

        const existingObs = Array.isArray(info.element.data?.observations) ? info.element.data.observations : [];
        info.element.data.observations = [...existingObs, ...observations];
    }

    return totalCreated;
}

// ----------------------------------------------------------------
// PSEUDONYMIZATION HELPER
// ----------------------------------------------------------------

/**
 * Pseudonimiza identificador de trabalhador via hash simples.
 * Usa hash FNV-1a de 32 bits para gerar ID curto e consistente.
 *
 * @param {string} input - Nome ou ID original
 * @returns {string} Identificador pseudonimizado (ex: "Trab-A3F2")
 */
function pseudonymize(input) {
    if (!input) return 'Trab-0000';
    let hash = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0; // FNV prime, unsigned
    }
    return `Trab-${hash.toString(16).toUpperCase().slice(-4)}`;
}

// ----------------------------------------------------------------
// D17 HELPER — Convex hull 2D (Andrew's monotone chain)
// ----------------------------------------------------------------

/**
 * Calcula o convex hull de pontos 2D via Andrew's monotone chain.
 * @param {{x:number, z:number}[]} points
 * @returns {{x:number, z:number}[]} vertices do hull em ordem CCW
 */
function _convexHull2D(points) {
    if (points.length < 3) return [...points];
    const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
    const cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
    const lower = [];
    for (const p of sorted) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
    }
    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
        const p = sorted[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
}
