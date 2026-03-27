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
   EXECUTOR DE COMANDOS - Mapeia ações do LLM para handlers
   ================================================================

   Este módulo executa as ações interpretadas pelo LLM,
   chamando os handlers existentes ou funções dos managers.

   FLUXO:
   1. Recebe ação e parâmetros validados
   2. Mapeia para o handler/função apropriada
   3. Executa a ação
   4. Retorna resultado

   ================================================================ */

import { showToast } from '../../utils/ui/toast.js';
import { t } from '../../utils/i18n/translations.js';
import {
    addNewElement,
    updateElement,
    getSelectedElement,
    setSelectedElement,
    getAllElements,
    getMeshByElementId,
} from '../elements/manager.js';
import { addCampaign, updateCampaign, getAllCampaigns } from '../campaigns/manager.js';
import { CONFIG } from '../../config.js';
import { getAllTrends, analyzeTimeSeries } from '../analytics/prediction.js';
import {
    suggestOptimalPoints,
    visualizeRecommendations,
    clearRecommendations,
    calculateCoverage,
} from '../analytics/spatial.js';
import { analyzeReport } from '../audit/greenwashing.js';
import { getScene } from '../../utils/scene/setup.js';
import { researchSite } from './siteResearch.js';
import { addCustomFamily, getFamily } from '../elements/families.js';
import { wgs84ToUTM, wgs84ToRelative, setOrigin } from '../io/geo/coordinates.js';

// ================================================================
// ESTADO — Ultimo relatorio de pesquisa para POPULATE_FROM_RESEARCH
// ================================================================

let _lastResearchReport = null;

/**
 * Armazena o ultimo relatorio de pesquisa.
 * Chamado pelo handler SITE_RESEARCH apos sucesso.
 *
 * @param {Object} report - Relatorio da pesquisa
 */
function setLastResearchReport(report) {
    _lastResearchReport = report;
}

/**
 * Retorna o ultimo relatorio de pesquisa.
 * @returns {Object|null}
 */
export function getLastResearchReport() {
    return _lastResearchReport;
}

// ================================================================
// EXECUTOR PRINCIPAL
// ================================================================

/**
 * Executa uma ação do LLM
 * @param {string} action - Nome da ação
 * @param {Object} params - Parâmetros resolvidos
 * @returns {Promise<Object>} - { success, message, data }
 */
export async function executeCommand(action, params) {
    const handler = actionHandlers[action];

    if (!handler) {
        return {
            success: false,
            message: `Ação desconhecida: ${action}`,
            data: null,
        };
    }

    try {
        const result = await handler(params);
        return {
            success: true,
            message: result.message || t('success'),
            data: result.data || null,
        };
    } catch (error) {
        console.error('Erro ao executar comando:', error);
        return {
            success: false,
            message: error.message || 'Erro ao executar comando',
            data: null,
        };
    }
}

// ================================================================
// HANDLERS DE AÇÕES
// ================================================================

const actionHandlers = {
    /**
     * Adiciona observação a um elemento
     */
    ADD_OBSERVATION: async (params) => {
        const { elementId, parameterId, value, unitId, campaignId, x = 0, y = 0, z = 0, date } = params;

        // Encontra o elemento
        const elements = getAllElements();
        const element = elements.find((e) => e.id === elementId);
        if (!element) {
            throw new Error(`Elemento não encontrado: ${elementId}`);
        }

        // Prepara a nova observação
        const newObservation = {
            x: Number(x) || 0,
            y: Number(y) || 0,
            z: Number(z) || 0,
            date: date || new Date().toISOString().slice(0, 10),
            campaignId: campaignId || null,
            parameterId: parameterId,
            value: Number(value),
            unitId: unitId || getDefaultUnit(parameterId),
            autoConvert: false,
            additionalReadings: [],
        };

        // Adiciona a observação
        const observations = Array.isArray(element.data?.observations) ? [...element.data.observations] : [];
        observations.push(newObservation);

        updateElement(elementId, {
            data: {
                ...element.data,
                observations,
            },
        });

        // Seleciona o elemento para mostrar na UI
        setSelectedElement(elementId);

        // Atualiza UI global
        if (typeof window.updateAllUI === 'function') {
            window.updateAllUI();
        }

        const paramName = getParameterName(parameterId);
        const unitSymbol = getUnitSymbol(unitId);

        return {
            message: `Observação de ${paramName} (${value} ${unitSymbol}) adicionada ao ${element.name}`,
            data: { elementId, observationIndex: observations.length - 1 },
        };
    },

    /**
     * Cria novo elemento
     */
    ADD_ELEMENT: async (params) => {
        const { familyId, name } = params;

        // Usa o handler global se disponível
        if (typeof window.handleAddElement === 'function') {
            window.handleAddElement(familyId);
            const element = getSelectedElement();

            if (element && name) {
                updateElement(element.id, { name });
                if (typeof window.updateAllUI === 'function') {
                    window.updateAllUI();
                }
            }

            return {
                message: `${element?.name || 'Elemento'} criado com sucesso`,
                data: { elementId: element?.id },
            };
        }

        // Fallback: usa diretamente o manager
        const element = addNewElement(familyId);
        if (!element) {
            throw new Error(`Falha ao criar elemento do tipo ${familyId}`);
        }

        if (name) {
            updateElement(element.id, { name });
        }

        setSelectedElement(element.id);

        if (typeof window.updateAllUI === 'function') {
            window.updateAllUI();
        }

        return {
            message: `${element.name} criado com sucesso`,
            data: { elementId: element.id },
        };
    },

    /**
     * Cria nova campanha
     */
    ADD_CAMPAIGN: async (params) => {
        const { name, startDate, endDate, color } = params;

        const campaignData = {};
        if (name) campaignData.name = name;
        if (startDate) campaignData.startDate = startDate;
        if (endDate) campaignData.endDate = endDate;
        if (color) campaignData.color = color;

        const campaign = addCampaign(campaignData);

        // Atualiza UI
        if (typeof window.updateCampaignsList === 'function') {
            window.updateCampaignsList();
        } else if (typeof window.updateAllUI === 'function') {
            window.updateAllUI();
        }

        return {
            message: `Campanha "${campaign.name}" criada com sucesso`,
            data: { campaignId: campaign.id },
        };
    },

    /**
     * Atualiza observação existente
     */
    UPDATE_OBSERVATION: async (params) => {
        const { elementId, observationIndex, field, value, isAdditional, readingIndex } = params;

        // Usa handler global se disponível
        if (isAdditional && typeof window.handleReadingChange === 'function') {
            window.handleReadingChange(elementId, observationIndex, readingIndex, field, value, true);
        } else if (typeof window.handleObservationChange === 'function') {
            window.handleObservationChange(elementId, observationIndex, field, value);
        } else {
            // Fallback: atualiza diretamente
            const elements = getAllElements();
            const element = elements.find((e) => e.id === elementId);
            if (!element) {
                throw new Error(`Elemento não encontrado: ${elementId}`);
            }

            const observations = Array.isArray(element.data?.observations) ? [...element.data.observations] : [];

            if (!observations[observationIndex]) {
                throw new Error(`Observação ${observationIndex} não encontrada`);
            }

            observations[observationIndex] = {
                ...observations[observationIndex],
                [field]: value,
            };

            updateElement(elementId, {
                data: {
                    ...element.data,
                    observations,
                },
            });
        }

        if (typeof window.updateElementDetails === 'function') {
            window.updateElementDetails();
        }

        return {
            message: `Observação atualizada: ${field} = ${value}`,
            data: { elementId, observationIndex, field, value },
        };
    },

    /**
     * Atualiza elemento
     */
    UPDATE_ELEMENT: async (params) => {
        const { elementId, field, value } = params;

        if (typeof window.handleElementFieldChange === 'function') {
            window.handleElementFieldChange(elementId, field, value);
        } else {
            updateElement(elementId, { [field]: value });
        }

        if (typeof window.updateAllUI === 'function') {
            window.updateAllUI();
        }

        return {
            message: `Elemento atualizado: ${field} = ${value}`,
            data: { elementId, field, value },
        };
    },

    /**
     * Atualiza campanha
     */
    UPDATE_CAMPAIGN: async (params) => {
        const { campaignId, field, value } = params;

        const campaign = updateCampaign(campaignId, { [field]: value });
        if (!campaign) {
            throw new Error(`Campanha não encontrada: ${campaignId}`);
        }

        if (typeof window.updateCampaignsList === 'function') {
            window.updateCampaignsList();
        }

        return {
            message: `Campanha "${campaign.name}" atualizada: ${field} = ${value}`,
            data: { campaignId, field, value },
        };
    },

    // ================================================================
    // ANALYTICS ACTIONS — Trend analysis, spatial, audit
    // Acoes analiticas executadas pelo bot conversacional
    // ================================================================

    /**
     * Analisa tendencias de series temporais
     */
    ANALYZE_TRENDS: async (params) => {
        // Single element analysis
        if (params.elementId && params.parameterId) {
            const result = analyzeTimeSeries(params.elementId, params.parameterId);
            if (!result) {
                return { message: 'Dados insuficientes para análise de tendência (mínimo 3 observações com datas).' };
            }
            return {
                message: formatTrendResult(result),
                data: result,
            };
        }

        // Batch analysis: all element-parameter combinations
        const trends = getAllTrends();
        if (trends.length === 0) {
            return {
                message:
                    'Nenhuma série temporal com dados suficientes encontrada. Adicione observações com datas para habilitar a análise.',
            };
        }

        let msg = `📊 Análise de tendência — ${trends.length} séries analisadas:\n\n`;
        for (const r of trends) {
            const icon = r.trend === 'increasing' ? '↑' : r.trend === 'decreasing' ? '↓' : '→';
            const sig = r.significant ? '' : ' (n.s.)';
            msg += `${icon} ${r.elementName} / ${r.parameterName}: `;
            msg += `${r.trend}${sig} (τ=${r.mannKendall.tau.toFixed(3)}, p=${r.mannKendall.pValue.toFixed(4)}, `;
            msg += `Sen=${r.sensSlope.slopePerMonth.toFixed(4)}/${r.unitSymbol}/mês, R²=${r.ols.r2.toFixed(3)})\n`;
        }

        return { message: msg, data: { trends } };
    },

    /**
     * Sugere pontos otimos de amostragem e visualiza na cena 3D
     */
    SUGGEST_SAMPLING: async (params) => {
        const count = params.count || 5;
        const coverage = calculateCoverage();
        const points = suggestOptimalPoints(count);

        if (points.length === 0) {
            return {
                message: `Cobertura: ${(coverage.coverage * 100).toFixed(1)}% (${coverage.pointCount} pontos). Nenhuma lacuna significativa encontrada.`,
            };
        }

        // Visualize in 3D scene
        const scene = getScene();
        const THREE = typeof window !== 'undefined' ? window.THREE : null;
        if (scene && THREE) {
            visualizeRecommendations(scene, points, THREE);
        }

        let msg = `📍 Cobertura atual: ${(coverage.coverage * 100).toFixed(1)}% (${coverage.pointCount} pontos de monitoramento)\n\n`;
        msg += `${points.length} pontos ótimos sugeridos:\n`;
        for (const p of points) {
            msg += `  #${p.priority}: X=${p.x.toFixed(1)}, Z=${p.z.toFixed(1)} — ${p.reason}\n`;
        }
        msg += '\nMarcadores verdes adicionados à cena 3D. Peça "limpar marcadores" para removê-los.';

        return { message: msg, data: { coverage, points } };
    },

    /**
     * Executa auditoria ESG anti-greenwashing
     */
    RUN_AUDIT: async (params) => {
        const reportText = params.reportText || '';

        const result = await analyzeReport(reportText);
        const ri = result.reliability;

        let msg = `🔍 Auditoria ESG — Índice de Confiabilidade: ${ri.score}/100 (${ri.grade})\n\n`;
        msg += `Achados: ${result.summary.totalFindings} total `;
        msg += `(${result.summary.critical} críticos, ${result.summary.high} altos, `;
        msg += `${result.summary.medium} médios, ${result.summary.low} baixos)\n\n`;

        // Red flags
        if (ri.redFlags.length > 0) {
            msg += '🚩 Red flags:\n';
            ri.redFlags.forEach((f) => {
                msg += `  • ${f}\n`;
            });
            msg += '\n';
        }

        // Statistical tests summary
        const b = result.statistical.benford;
        if (b.n >= 10) {
            msg += `Benford: ${b.conformity} (χ²=${b.chiSquared.toFixed(2)}, p=${b.pValue.toFixed(4)}, n=${b.n})\n`;
        }

        // Quality findings
        if (result.quality.findings.length > 0) {
            msg += `\nQualidade da investigação (${result.quality.findings.length} achados):\n`;
            result.quality.findings.slice(0, 5).forEach((f) => {
                msg += `  [${f.severity}] ${f.finding}\n`;
            });
            if (result.quality.findings.length > 5) {
                msg += `  ... e mais ${result.quality.findings.length - 5} achados\n`;
            }
        }

        // LLM claims
        if (result.claims.length > 0) {
            msg += `\nVerificação de alegações (${result.claims.length}):\n`;
            result.claims.slice(0, 5).forEach((c) => {
                msg += `  [${c.verdict}] "${c.claim}" — ${c.evidence}\n`;
            });
        }

        return { message: msg, data: result };
    },

    /**
     * Remove marcadores de recomendacao da cena 3D
     */
    CLEAR_MARKERS: async () => {
        const scene = getScene();
        clearRecommendations(scene);
        return { message: 'Marcadores de recomendação removidos da cena 3D.' };
    },

    // ================================================================
    // SITE RESEARCH — Consulta de dados publicos
    // ================================================================

    /**
     * Pesquisa dados publicos de uma area para modelo conceitual.
     * Usa Nominatim, IBGE e Overpass API.
     * Armazena o relatorio para uso posterior por POPULATE_FROM_RESEARCH.
     */
    SITE_RESEARCH: async (params) => {
        const report = await researchSite({
            address: params.address || params.query || '',
            lat: params.lat ? Number(params.lat) : undefined,
            lon: params.lon ? Number(params.lon) : undefined,
            radius: params.radius ? Number(params.radius) : 1000,
        });

        // Armazena para POPULATE_FROM_RESEARCH usar depois
        setLastResearchReport(report);

        if (!report.success) {
            return {
                message: report.summary || 'Não foi possível realizar a pesquisa.',
                data: report,
            };
        }

        // Conta features encontradas para sugerir inserção
        const feat = report.nearbyFeatures || {};
        const totalFeatures =
            (feat.waterBodies?.length || 0) + (feat.industries?.length || 0) + (feat.sensitiveSites?.length || 0);

        const hint =
            totalFeatures > 0
                ? `\n\n💡 ${totalFeatures} features encontradas. Diga "inserir dados no modelo" para criar elementos automaticamente.`
                : '';

        return {
            message: report.summary + hint,
            data: report,
        };
    },

    /**
     * Popula o modelo com dados da ultima pesquisa de area.
     * Cria elementos (markers/buildings) para features encontradas
     * e preenche coordenadas do projeto.
     *
     * AÇÃO CRÍTICA: Se o modelo ja tem dados, o LLM deve alertar
     * o usuario antes de confirmar. O parametro mode controla
     * se os dados sao adicionados (append) ou substituidos (replace).
     */
    POPULATE_FROM_RESEARCH: async (params) => {
        if (!_lastResearchReport || !_lastResearchReport.success) {
            throw new Error(
                'Nenhuma pesquisa de área disponível. Use "Pesquisa de Área" primeiro para buscar dados de uma localização.',
            );
        }

        const report = _lastResearchReport;
        const feat = report.nearbyFeatures || {};
        const loc = report.location;
        const mun = report.municipio;
        const created = [];
        const actions = []; // Log de acoes realizadas

        // Categorias a importar (default: todas)
        const categories = params.categories || ['waterBodies', 'industries', 'sensitiveSites'];
        const includeCoordinates = params.includeCoordinates !== false;
        const mode = params.mode || 'append'; // 'append' ou 'replace'

        // --- 0. Modo replace: limpa elementos existentes ---
        // PROTEÇÃO: modo replace so funciona se explicitamente solicitado
        if (mode === 'replace') {
            const existing = getAllElements();
            if (existing.length > 0) {
                // Conta elementos com observacoes para alertar sobre perda de dados
                const withObs = existing.filter((e) => e.data?.observations?.length > 0);
                if (withObs.length > 0) {
                    actions.push(`⚠️ ${withObs.length} elementos com observações serão removidos`);
                }
                for (const el of existing) {
                    if (typeof window.handleDeleteElement === 'function') {
                        window.handleDeleteElement(el.id);
                    }
                }
                actions.push(`🗑️ ${existing.length} elementos anteriores removidos`);
            }
        }

        // --- 1. Preenche coordenadas do projeto ---
        if (includeCoordinates && loc) {
            // Converte WGS84 lat/lon para UTM antes de salvar nos campos de origem
            const utm = wgs84ToUTM({ latitude: loc.lat, longitude: loc.lon });
            const eastingEl = document.getElementById('utm-origin-easting');
            const northingEl = document.getElementById('utm-origin-northing');
            if (eastingEl) eastingEl.value = utm.easting.toFixed(2);
            if (northingEl) northingEl.value = utm.northing.toFixed(2);

            // Atualiza origem do sistema de coordenadas
            setOrigin({
                easting: utm.easting,
                northing: utm.northing,
                elevation: 0,
                zone: utm.zone,
                hemisphere: utm.hemisphere,
            });
            actions.push(
                `📌 Coordenadas: ${loc.lat.toFixed(6)}, ${loc.lon.toFixed(6)} (UTM ${utm.zone}${utm.hemisphere}: ${utm.easting.toFixed(0)}E ${utm.northing.toFixed(0)}N)`,
            );

            // Preenche nome do projeto (sobrescreve em replace, preenche vazio em append)
            const nameEl = document.getElementById('project-name');
            if (nameEl && (mode === 'replace' || !nameEl.value)) {
                const addr = report.address || {};
                nameEl.value = addr.road
                    ? `${addr.road}${addr.house_number ? ' ' + addr.house_number : ''}, ${addr.city || addr.town || ''}`
                    : loc.displayName?.split(',').slice(0, 2).join(',') || 'Novo Projeto';
                actions.push(`📝 Nome do projeto: ${nameEl.value}`);
            }

            // Preenche descrição com resumo do município
            const descEl = document.getElementById('project-description');
            if (descEl && (mode === 'replace' || !descEl.value) && mun) {
                descEl.value = `${mun.nome} — ${mun.uf} | ${mun.mesorregiao} | IBGE: ${mun.id}`;
                actions.push(`🏛️ Município: ${mun.nome} — ${mun.uf}`);
            }
        }

        // --- 2. Garante que famílias necessárias existam ---
        // Usa nomes de icones Lucide (registrados em ui/icons.js)
        ensureFamilyExists('water_body', "Corpo d'Água", 'droplet');
        ensureFamilyExists('industry', 'Indústria/Posto', 'factory');
        ensureFamilyExists('sensitive_area', 'Área Sensível', 'alert-triangle');

        // --- Helper: calcula posicao relativa a partir de lat/lon ---
        function featurePosition(lat, lon) {
            if (lat == null || lon == null) return { x: 0, y: 0, z: 0 };
            return wgs84ToRelative({ latitude: lat, longitude: lon });
        }

        // --- Helper: posiciona mesh apos criacao do elemento ---
        function positionElement(el, pos) {
            const mesh = getMeshByElementId(el.id);
            if (mesh) mesh.position.set(pos.x, pos.y, pos.z);
        }

        // --- 3. Cria elementos para corpos d'água ---
        if (categories.includes('waterBodies') && feat.waterBodies?.length > 0) {
            for (const wb of feat.waterBodies.slice(0, 10)) {
                const el = addNewElement('water_body');
                if (el) {
                    const name = wb.name || `Corpo d'água (${wb.type})`;
                    const pos = featurePosition(wb.lat, wb.lon);
                    updateElement(el.id, {
                        name,
                        data: {
                            ...el.data,
                            position: { x: pos.x, y: 0, z: pos.z },
                            sourceType: wb.type,
                            sourceLat: wb.lat,
                            sourceLon: wb.lon,
                            sourceApi: 'overpass',
                            observations: [],
                        },
                    });
                    positionElement(el, pos);
                    created.push({ type: '💧', name, family: 'water_body' });
                }
            }
        }

        // --- 4. Cria elementos para indústrias/postos ---
        if (categories.includes('industries') && feat.industries?.length > 0) {
            for (const ind of feat.industries.slice(0, 10)) {
                const el = addNewElement('industry');
                if (el) {
                    const name = ind.name || `Indústria (${ind.type})`;
                    const pos = featurePosition(ind.lat, ind.lon);
                    updateElement(el.id, {
                        name,
                        data: {
                            ...el.data,
                            position: { x: pos.x, y: 0, z: pos.z },
                            sourceType: ind.type,
                            sourceLat: ind.lat,
                            sourceLon: ind.lon,
                            sourceApi: 'overpass',
                            observations: [],
                        },
                    });
                    positionElement(el, pos);
                    created.push({ type: '🏭', name, family: 'industry' });
                }
            }
        }

        // --- 5. Cria elementos para áreas sensíveis ---
        if (categories.includes('sensitiveSites') && feat.sensitiveSites?.length > 0) {
            for (const ss of feat.sensitiveSites.slice(0, 10)) {
                const el = addNewElement('sensitive_area');
                if (el) {
                    const name = ss.name || `Área sensível (${ss.type})`;
                    const pos = featurePosition(ss.lat, ss.lon);
                    updateElement(el.id, {
                        name,
                        data: {
                            ...el.data,
                            position: { x: pos.x, y: 0, z: pos.z },
                            sourceType: ss.type,
                            sourceLat: ss.lat,
                            sourceLon: ss.lon,
                            sourceApi: 'overpass',
                            observations: [],
                        },
                    });
                    positionElement(el, pos);
                    created.push({ type: '⚠️', name, family: 'sensitive_area' });
                }
            }
        }

        // --- 6. Atualiza UI e enquadra camera nos novos elementos ---
        if (typeof window.updateAllUI === 'function') {
            window.updateAllUI();
        }
        if (typeof window.fitAllElements === 'function') {
            window.fitAllElements();
        }

        // --- 7. Gera resumo ---
        let msg = `✅ MODELO POPULADO\n\n`;

        // Mostra acoes de projeto realizadas
        if (actions.length > 0) {
            msg += `📋 Dados do projeto:\n`;
            for (const a of actions) {
                msg += `  ${a}\n`;
            }
            msg += '\n';
        }

        // Mostra elementos criados
        if (created.length > 0) {
            msg += `🏗️ ${created.length} elementos criados:\n`;
            for (const c of created) {
                msg += `  ${c.type} ${c.name}\n`;
            }
        } else {
            const radius = report.query?.radius || 1000;
            msg += `ℹ️ Nenhuma feature encontrada no entorno (raio ${radius}m).\n`;
            msg += `   Tente "pesquisar [local] raio 2000" para ampliar a busca.\n`;
        }

        // Uso do solo como metadado
        if (feat.landUse?.length > 0) {
            const types = [...new Set(feat.landUse.map((l) => l.type))];
            msg += `\n🗺️ Uso do solo: ${types.join(', ')}`;
        }

        return {
            message: msg,
            data: { created, actions, coordinates: loc, municipio: mun, mode },
        };
    },

    // ================================================================
    // ADD_MESSAGE — Salva mensagem no historico do elemento
    // ================================================================

    /**
     * Adiciona mensagem ao historico de conversas de um elemento.
     * Usado para persistir contexto entre sessoes.
     */
    // ================================================================
    // AGENTIC LLM — State queries (read-only) + Workflow trigger
    // ================================================================

    /**
     * Consulta estado do modelo (read-only, sem confirmacao).
     * Resultado retornado ao LLM para continuar raciocinando.
     */
    QUERY_STATE: async (params) => {
        const { queryState } = await import('./stateQueries.js');
        const result = queryState(params.query || 'summary', params.filter || {});
        return {
            message: JSON.stringify(result, null, 2),
            data: result,
        };
    },

    /**
     * Consulta detalhes de um elemento (read-only).
     */
    QUERY_ELEMENT: async (params) => {
        const { queryElement } = await import('./stateQueries.js');
        const result = queryElement(params.elementId);
        if (!result) {
            throw new Error(`Elemento não encontrado: ${params.elementId}`);
        }
        return {
            message: JSON.stringify(result, null, 2),
            data: result,
        };
    },

    /**
     * Verifica conformidade regulatoria de um parametro (read-only).
     */
    QUERY_COMPLIANCE: async (params) => {
        const { queryCompliance } = await import('./stateQueries.js');
        const result = await queryCompliance(params.parameterId, params.regulation || 'CONAMA_420');
        return {
            message: JSON.stringify(result, null, 2),
            data: result,
        };
    },

    /**
     * Inicia um workflow guiado com decisoes pre-preenchidas.
     */
    START_WORKFLOW: async (params) => {
        const { workflowId, prefill } = params;

        // Dispara o handler global para abrir o wizard
        if (typeof window.handleStartWorkflow === 'function') {
            window.handleStartWorkflow(workflowId, prefill || {});
            return {
                message: `Workflow "${workflowId}" iniciado`,
                data: { workflowId, prefill },
            };
        }

        throw new Error('Workflow handler not available');
    },

    CREATE_ECO_TOOL: async (params) => {
        const { name, description, htmlContent } = params;
        const { createEcoTool } = await import('./toolBuilder.js');
        const tool = createEcoTool(name, description || '', htmlContent);

        // Atualiza UI se necessario
        if (typeof window.updateAllUI === 'function') {
            window.updateAllUI();
        }

        // Se houver modal de ferramentas, atualiza
        if (typeof window.renderEcoToolsList === 'function') {
            window.renderEcoToolsList();
        }

        return {
            message: `Ferramenta "${tool.name}" criada com sucesso. O HTML gerado foi salvo no modelo.`,
            data: { toolId: tool.id },
        };
    },

    ADD_MESSAGE: async (params) => {
        const { elementId, role, content, toolId, agentId } = params;

        const elements = getAllElements();
        const element = elements.find((e) => e.id === elementId);
        if (!element) {
            throw new Error(`Elemento não encontrado: ${elementId}`);
        }

        if (!Array.isArray(element.messages)) {
            element.messages = [];
        }

        element.messages.push({
            role: role || 'assistant',
            content: content || '',
            toolId: toolId || null,
            agentId: agentId || null,
            timestamp: new Date().toISOString(),
        });

        return {
            message: `Mensagem salva no elemento ${element.name}`,
            data: { elementId, messageCount: element.messages.length },
        };
    },
};

// ================================================================
// HELPERS
// ================================================================

/**
 * Formata resultado de tendencia para exibicao no chat
 * @param {Object} r - Resultado de analyzeTimeSeries
 * @returns {string}
 */
function formatTrendResult(r) {
    const icon = r.trend === 'increasing' ? '↑' : r.trend === 'decreasing' ? '↓' : '→';
    const sig = r.significant ? '(significativo)' : '(não significativo)';

    return `📊 Tendência: ${r.elementName} / ${r.parameterName} (${r.unitSymbol})
Período: ${r.dateRange.start} a ${r.dateRange.end} (${r.n} observações)
Último valor: ${r.latestValue} ${r.unitSymbol}

${icon} Tendência: ${r.trend} ${sig}
• Regressão Linear: slope=${r.ols.slopePerMonth.toFixed(4)}/mês, R²=${r.ols.r2.toFixed(3)}
• Mann-Kendall: τ=${r.mannKendall.tau.toFixed(3)}, Z=${r.mannKendall.Z.toFixed(2)}, p=${r.mannKendall.pValue.toFixed(4)}
• Sen's Slope: ${r.sensSlope.slopePerMonth.toFixed(4)}/mês (IC: ${r.sensSlope.lowerCI.toFixed(4)} a ${r.sensSlope.upperCI.toFixed(4)})
• Estatísticas: média=${r.stats.mean.toFixed(2)}, mediana=${r.stats.median.toFixed(2)}, σ=${r.stats.std.toFixed(2)}`;
}

/**
 * Obtém a unidade padrão de um parâmetro
 * @param {string} parameterId
 * @returns {string}
 */
function getDefaultUnit(parameterId) {
    const param = CONFIG.PARAMETERS.find((p) => p.id === parameterId);
    return param?.defaultUnitId || 'mg_L';
}

/**
 * Obtém o nome de um parâmetro
 * @param {string} parameterId
 * @returns {string}
 */
function getParameterName(parameterId) {
    const param = CONFIG.PARAMETERS.find((p) => p.id === parameterId);
    return param?.name || parameterId;
}

/**
 * Obtém o símbolo de uma unidade
 * @param {string} unitId
 * @returns {string}
 */
function getUnitSymbol(unitId) {
    const unit = CONFIG.UNITS.find((u) => u.id === unitId);
    return unit?.symbol || unitId;
}

/**
 * Garante que uma familia de elementos exista.
 * Se nao existir, cria como familia customizada.
 *
 * @param {string} familyId - ID da familia
 * @param {string} name - Nome de exibicao
 * @param {string} icon - Emoji do icone
 */
function ensureFamilyExists(familyId, name, icon) {
    if (!getFamily(familyId)) {
        addCustomFamily(familyId, name, icon);
    }
}

/**
 * Lista de ações suportadas
 * @returns {string[]}
 */
export function getSupportedActions() {
    return Object.keys(actionHandlers);
}
