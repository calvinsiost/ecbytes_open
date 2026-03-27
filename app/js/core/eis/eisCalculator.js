// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Version: 0.1-beta
// Architecture: Digital Twin Architecture (Blockchain + ML + LLM)
// Application: Environmental Data Governance
// Authorship: Calvin Stefan Iost
// Copyright (c) 2026 Calvin Stefan Iost

/* ================================================================
   EIS — EnviroTech Integrity Score
   Motor de Governança de Dados Ambientais (Framework TCCCA+T)
   ================================================================

   Avalia a qualidade de dados ambientais (telemetria, emissões)
   em 6 eixos: Transparência, Acurácia, Completude, Tempestividade,
   Consistência e Comparabilidade.

   REGRA DE OURO: Algoritmo estritamente não-compensatório.
   Média geométrica ponderada — um eixo crítico (nota 1) em alta
   relevância afunda o score global organicamente.
   Médias aritméticas (compensatórias) são expressamente proibidas.

   MODOS:
   - 'geometric': Média Geométrica Ponderada pura
   - 'veto':      Geométrica com Kill-Switch (T≤2 ou A≤2 → EIS=0.0)

   CREDENCIAIS (POR LEITURA):
   Cada observação é carimbada com o nível de credencial do autor
   no momento da inserção. O multiplicador do eixo T é computado
   como a média aritmética dos multiplicadores de todas as leituras
   do modelo, aplicado antes do cálculo com cap em 5.0.

   ================================================================ */

// ================================================================
// CONSTANTES DO FRAMEWORK TCCCA+T
// Eixos, pesos padrão e multiplicadores por credencial
// ================================================================

/** @type {string[]} Os 6 eixos do framework TCCCA+T */
export const EIS_AXES = ['T', 'A', 'Cp', 'Ty', 'Cs', 'Cm'];

/**
 * Pesos Gold Standard para o cálculo EIS.
 * Aceita customização por tenant — estes são os defaults.
 * Soma = 12 (facilita interpretação percentual por eixo).
 * @type {Object.<string, number>}
 */
export const EIS_DEFAULT_WEIGHTS = {
    T: 3, // Transparência / Evidência de origem
    A: 3, // Acurácia / Saúde do sensor
    Cp: 2, // Completude / Uptime de cobertura
    Ty: 2, // Tempestividade / Latência de entrega
    Cs: 1, // Consistência / Unidades SI
    Cm: 1, // Comparabilidade / Taxonomia
};

/**
 * Multiplicadores do eixo T por nível de credencial do autor.
 * Usuários credenciados provam origem mais forte, elevando T antes
 * do cálculo. O resultado é capeado em 5.0.
 * @type {Object.<string, number>}
 */
export const EIS_CREDENTIAL_MULTIPLIERS = {
    common: 1.0, // Usuário comum — sem alteração
    professional: 1.2, // Profissional (CREA/CRC) — leve elevação
    pos_graduado: 1.4, // Pós-graduado — elevação moderada
    mestre: 1.6, // Mestre — elevação significativa
    doutor: 2.0, // Doutor — máxima confiança de origem
};

/**
 * Rótulos legíveis dos níveis de credencial.
 * @type {Object.<string, string>}
 */
export const EIS_CREDENTIAL_LABELS = {
    common: '—',
    professional: '🏛️ Prof',
    pos_graduado: '🎓 Pós',
    mestre: '🎓🎓 MSc',
    doutor: '🏅 PhD',
};

/**
 * Limiares de classificação do veredito.
 * Escala 0.00–5.00 com 2 casas decimais.
 */
export const EIS_VERDICTS = {
    AUDIT_READY: { min: 4.5, max: 5.0, label: '🟢 Audit Ready', desc: 'Grau de Auditoria Externa' },
    MANAGEMENT_READY: { min: 3.5, max: 4.49, label: '🟡 Management Ready', desc: 'Decisões Internas' },
    CRITICAL_DATA: { min: 0.0, max: 3.49, label: '🔴 Critical Data', desc: 'Risco de Compliance' },
};

// ================================================================
// CLASSE PRINCIPAL
// EisCalculator — motor com os dois modos matemáticos
// ================================================================

/**
 * Motor de cálculo do EnviroTech Integrity Score (EIS).
 *
 * Implementa o framework TCCCA+T com dois modos matemáticos:
 * - 'geometric': Média Geométrica Ponderada (não-compensatório orgânico)
 * - 'veto':      Geométrica + Kill-Switch binário (para auditorias externas)
 *
 * Suporta pesos customizados por tenant e multiplicadores de credencial.
 *
 * @example
 * const calc = new EisCalculator();
 * const result = calc.calculate({ T:4, A:5, Cp:5, Ty:4, Cs:5, Cm:5 }, 'geometric', 'doutor');
 * console.log(result.eis, result.verdict);
 */
export class EisCalculator {
    /**
     * @param {Object.<string, number>|null} weights - Pesos customizados por tenant.
     *   Se null, usa EIS_DEFAULT_WEIGHTS (Gold Standard).
     *   Deve conter todos os 6 eixos com valores numéricos positivos.
     */
    constructor(weights = null) {
        this.weights = weights ? { ...weights } : { ...EIS_DEFAULT_WEIGHTS };
        this._validateWeights(this.weights);
        this._totalWeight = Object.values(this.weights).reduce((sum, w) => sum + w, 0);
    }

    // ================================================================
    // MÉTODO PÚBLICO PRINCIPAL
    // ================================================================

    /**
     * Calcula o EIS para um conjunto de notas.
     * Calcula o EIS para as 6 dimensões de qualidade de um dado ambiental.
     *
     * @param {Object.<string, number>} scores - Notas por eixo (1-5, inteiros).
     *   Deve conter: T, A, Cp, Ty, Cs, Cm
     * @param {'geometric'|'veto'} [mode='geometric'] - Modo de cálculo.
     *   'geometric': média geométrica ponderada pura.
     *   'veto': geométrica com kill-switch (T≤2 ou A≤2 → EIS=0.0).
     * @param {string} [credentialLevel='common'] - Nível de credencial do autor.
     *   Determina o multiplicador aplicado ao eixo T antes do cálculo.
     * @param {number|null} [credentialMultiplierOverride=null] - Multiplicador numérico
     *   computado a partir das leituras do modelo. Se fornecido, sobrepõe o lookup
     *   por credentialLevel. Usado pelo dashboard com dados reais.
     * @returns {EisResult} Objeto com score, veredito e detalhes do cálculo.
     * @throws {Error} Se alguma nota estiver fora do range 1-5 ou eixo ausente.
     */
    calculate(scores, mode = 'geometric', credentialLevel = 'common', credentialMultiplierOverride = null) {
        this._validateScores(scores);

        let multiplier;
        if (credentialMultiplierOverride != null && typeof credentialMultiplierOverride === 'number') {
            multiplier = credentialMultiplierOverride;
        } else {
            this._validateCredentialLevel(credentialLevel);
            multiplier = EIS_CREDENTIAL_MULTIPLIERS[credentialLevel];
        }

        const adjustedScores = this._applyCredentialMultiplier(scores, multiplier);

        if (mode === 'veto') {
            return this._calculateVeto(scores, adjustedScores, credentialLevel, multiplier);
        }
        return this._calculateGeometric(scores, adjustedScores, credentialLevel, multiplier, false);
    }

    // ================================================================
    // MÉTODO ESTÁTICO — CREDENCIAL AGREGADA POR LEITURA
    // ================================================================

    /**
     * Computa o multiplicador agregado de credencial a partir das observações do modelo.
     * Média aritmética dos multiplicadores individuais de cada leitura.
     * Observações sem credentialLevel são tratadas como 'common' (1.0×).
     *
     * @param {Array<Object>} observations - Todas as observações de todos os elementos.
     * @returns {{ multiplier: number, count: number, breakdown: Object.<string, number> }}
     */
    static computeAggregateCredential(observations) {
        if (!observations || observations.length === 0) {
            return { multiplier: 1.0, count: 0, breakdown: {} };
        }

        const breakdown = {};
        let sum = 0;

        for (const obs of observations) {
            const level = obs.credentialLevel || 'common';
            const mult = EIS_CREDENTIAL_MULTIPLIERS[level] ?? 1.0;
            sum += mult;
            breakdown[level] = (breakdown[level] || 0) + 1;
        }

        const multiplier = parseFloat((sum / observations.length).toFixed(4));
        return { multiplier, count: observations.length, breakdown };
    }

    // ================================================================
    // MÉTODO ESTÁTICO — COMPLETUDE (Cp) A PARTIR DAS CAMPANHAS
    // ================================================================

    /**
     * Computa o score Cp (Completude) a partir dos dados de campanha.
     * Mapeia a razao agregada executado/planejado para a escala 1-5 do EIS.
     *
     * Se nenhuma campanha tem plannedReadings, retorna null — fallback para slider manual.
     *
     * Escala:
     *   ratio >= 0.95 → 5 (cobertura total — Audit Ready)
     *   ratio >= 0.80 → 4 (boa cobertura)
     *   ratio >= 0.60 → 3 (cobertura moderada)
     *   ratio >= 0.30 → 2 (cobertura baixa)
     *   ratio <  0.30 → 1 (gap critico)
     *
     * @param {Array<{ planned: number, executed: number }>} campaignStats
     * @returns {{ score: number, totalPlanned: number, totalExecuted: number, ratio: number }|null}
     */
    static computeCpFromCampaigns(campaignStats) {
        const totalPlanned = campaignStats.reduce((s, c) => s + c.planned, 0);
        const totalExecuted = campaignStats.reduce((s, c) => s + c.executed, 0);

        if (totalPlanned === 0) return null;

        const ratio = totalExecuted / totalPlanned;
        let score;
        if (ratio >= 0.95) score = 5;
        else if (ratio >= 0.8) score = 4;
        else if (ratio >= 0.6) score = 3;
        else if (ratio >= 0.3) score = 2;
        else score = 1;

        return {
            score,
            totalPlanned,
            totalExecuted,
            ratio: parseFloat(ratio.toFixed(4)),
        };
    }

    // ================================================================
    // MÉTODO PÚBLICO — MODO CUSTOM
    // ================================================================

    /**
     * Calcula EIS com eixos e pesos definidos pelo usuário.
     * Média geométrica ponderada pura (sem credential multiplier, sem veto).
     *
     * @param {Object.<string, number>} axisScores - Notas por eixo custom (1-5).
     * @param {Object.<string, number>} axisWeights - Pesos por eixo custom (>0).
     * @returns {{ eis: number, scores: Object, weights: Object, verdict: string, mode: string }}
     * @throws {Error} Se menos de 2 eixos, ou notas/pesos inválidos.
     */
    calculateCustom(axisScores, axisWeights) {
        const axes = Object.keys(axisScores);
        if (axes.length < 2) {
            throw new Error(`[EIS Custom] Mínimo 2 eixos. Recebido: ${axes.length}`);
        }
        if (axes.length > 12) {
            throw new Error(`[EIS Custom] Máximo 12 eixos. Recebido: ${axes.length}`);
        }

        let totalWeight = 0;
        for (const axis of axes) {
            const s = axisScores[axis];
            if (typeof s !== 'number' || !Number.isFinite(s) || s < 1 || s > 5) {
                throw new Error(`[EIS Custom] Nota inválida para '${axis}': ${s}. Deve ser 1-5.`);
            }
            const w = axisWeights[axis];
            if (w == null || typeof w !== 'number' || !Number.isFinite(w) || w <= 0) {
                throw new Error(`[EIS Custom] Peso inválido para '${axis}': ${w}. Deve ser > 0.`);
            }
            totalWeight += w;
        }

        let rawScore = 1;
        for (const axis of axes) {
            rawScore *= Math.pow(axisScores[axis], axisWeights[axis] / totalWeight);
        }

        const eis = parseFloat(rawScore.toFixed(2));
        return {
            eis,
            scores: { ...axisScores },
            weights: { ...axisWeights },
            verdict: this._getVerdict(eis),
            mode: 'custom',
        };
    }

    // ================================================================
    // MÉTODOS ESTÁTICOS — AUTO-CÁLCULO DOS EIXOS
    // ================================================================

    /**
     * Computa T (Transparência) a partir das observações do modelo.
     * Score baseado no multiplicador agregado de credencial + rastreabilidade.
     *
     * @param {Array<Object>} observations - Todas as observações.
     * @returns {{ score: number, aggregateMultiplier: number, tracedRatio: number, count: number }|null}
     */
    static computeTFromObservations(observations) {
        if (!observations || observations.length === 0) return null;

        const credInfo = EisCalculator.computeAggregateCredential(observations);
        const tracedCount = observations.filter((o) => o.createdBy != null && o.createdBy !== '').length;
        const tracedRatio = tracedCount / observations.length;

        // Score pelo multiplicador agregado
        let score;
        const m = credInfo.multiplier;
        if (m >= 1.8) score = 5;
        else if (m >= 1.4) score = 4;
        else if (m >= 1.2) score = 3;
        else if (m >= 1.0) score = 2;
        else score = 1;

        // Bônus de rastreabilidade: +0.5 se 90%+ das obs têm autor
        if (tracedRatio >= 0.9) score = Math.min(score + 0.5, 5);

        return {
            score: parseFloat(score.toFixed(1)),
            aggregateMultiplier: credInfo.multiplier,
            tracedRatio: parseFloat(tracedRatio.toFixed(4)),
            count: observations.length,
        };
    }

    /**
     * Computa A (Acurácia) a partir dos elementos do modelo.
     * Usa sensores (operationalStatus) se existirem, senão valida obs vs limites regulatórios.
     *
     * @param {Array<Object>} elements - Todos os elementos do modelo.
     * @param {Array<Object>} observations - Todas as observações.
     * @param {Object} [validationLimits=null] - Mapa parameterId → { max: number }.
     * @returns {{ score: number, sensorsTotal: number, sensorsOperational: number, validationRatio: number, method: string }|null}
     */
    static computeAFromModel(elements, observations, validationLimits = null) {
        // Tentar via sensores primeiro
        const sensors = (elements || []).filter((e) => e.familyId === 'sensor' && e.data);
        if (sensors.length > 0) {
            const operational = sensors.filter(
                (s) => s.data.weather && s.data.weather.operationalStatus === true,
            ).length;
            const ratio = operational / sensors.length;

            let score;
            if (ratio >= 0.95) score = 5;
            else if (ratio >= 0.8) score = 4;
            else if (ratio >= 0.6) score = 3;
            else if (ratio >= 0.4) score = 2;
            else score = 1;

            return {
                score,
                sensorsTotal: sensors.length,
                sensorsOperational: operational,
                validationRatio: ratio,
                method: 'sensor',
            };
        }

        // Fallback: validação regulatória (com penalização por alta incerteza)
        if (!observations || observations.length === 0) return null;
        if (!validationLimits || Object.keys(validationLimits).length === 0) return null;

        let validCount = 0;
        let checkedCount = 0;
        let lowPrecisionCount = 0;

        for (const obs of observations) {
            const limit = validationLimits[obs.parameterId];
            if (!limit || obs.value == null) continue;
            checkedCount++;
            if (limit.max != null && obs.value <= limit.max) validCount++;
            else if (limit.min != null && obs.value >= limit.min) validCount++;

            // Penalizar observações com alta incerteza relativa (> 50%)
            if (obs.uncertainty != null && obs.uncertainty > 0 && obs.value !== 0) {
                const relUnc =
                    obs.uncertaintyType === 'relative' ? obs.uncertainty : Math.abs(obs.uncertainty / obs.value) * 100;
                if (relUnc > 50) lowPrecisionCount++;
            }
        }

        if (checkedCount === 0) return null;

        // Observações de baixa precisão contam como meio ponto (penalização suave)
        const adjustedValid = validCount - lowPrecisionCount * 0.5;
        const ratio = Math.max(0, adjustedValid) / checkedCount;
        let score;
        if (ratio >= 0.95) score = 5;
        else if (ratio >= 0.8) score = 4;
        else if (ratio >= 0.6) score = 3;
        else if (ratio >= 0.4) score = 2;
        else score = 1;

        return { score, sensorsTotal: 0, sensorsOperational: 0, validationRatio: ratio, method: 'validation' };
    }

    /**
     * Computa Ty (Tempestividade) a partir das datas das observações.
     * Usa mediana da idade das obs (mais robusto que média).
     *
     * @param {Array<Object>} observations - Todas as observações.
     * @param {Date} [referenceDate=new Date()] - Data de referência.
     * @returns {{ score: number, medianAgeDays: number, freshCount: number, staleCount: number }|null}
     */
    static computeTyFromObservations(observations, referenceDate = new Date()) {
        if (!observations || observations.length === 0) return null;

        const refMs = referenceDate.getTime();
        const ages = [];

        for (const obs of observations) {
            if (!obs.date) continue;
            const obsDate = new Date(obs.date);
            if (isNaN(obsDate.getTime())) continue;
            const ageDays = (refMs - obsDate.getTime()) / (1000 * 60 * 60 * 24);
            ages.push(Math.max(0, ageDays));
        }

        if (ages.length === 0) return null;

        // Mediana
        ages.sort((a, b) => a - b);
        const mid = Math.floor(ages.length / 2);
        const medianAgeDays = ages.length % 2 === 0 ? (ages[mid - 1] + ages[mid]) / 2 : ages[mid];

        let score;
        if (medianAgeDays <= 30) score = 5;
        else if (medianAgeDays <= 90) score = 4;
        else if (medianAgeDays <= 180) score = 3;
        else if (medianAgeDays <= 365) score = 2;
        else score = 1;

        const freshCount = ages.filter((a) => a <= 90).length;
        const staleCount = ages.filter((a) => a > 365).length;

        return {
            score,
            medianAgeDays: parseFloat(medianAgeDays.toFixed(1)),
            freshCount,
            staleCount,
        };
    }

    /**
     * Computa Cs (Consistência) verificando unidades contra o catálogo.
     * Obs com unitId catalogado (dimension válida) = padronizada.
     *
     * @param {Array<Object>} observations - Todas as observações.
     * @param {Object} unitCatalog - Mapa unitId → { dimension, ... } (ex: UNITS do catalog.js).
     * @returns {{ score: number, standardCount: number, totalCount: number, ratio: number }|null}
     */
    static computeCsFromObservations(observations, unitCatalog) {
        if (!observations || observations.length === 0) return null;
        if (!unitCatalog || Object.keys(unitCatalog).length === 0) return null;

        let standardCount = 0;
        let totalCount = 0;

        for (const obs of observations) {
            if (!obs.unitId) continue;
            totalCount++;
            const unit = unitCatalog[obs.unitId];
            if (unit && unit.dimension) standardCount++;
        }

        if (totalCount === 0) return null;

        const ratio = standardCount / totalCount;
        let score;
        if (ratio >= 0.95) score = 5;
        else if (ratio >= 0.8) score = 4;
        else if (ratio >= 0.6) score = 3;
        else if (ratio >= 0.4) score = 2;
        else score = 1;

        return {
            score,
            standardCount,
            totalCount,
            ratio: parseFloat(ratio.toFixed(4)),
        };
    }

    /**
     * Computa Cm (Comparabilidade) verificando parâmetros contra o catálogo.
     * Combina: parameterId mapeado + unitId == defaultUnitId do parâmetro.
     *
     * @param {Array<Object>} observations - Todas as observações.
     * @param {Array<Object>} parameterCatalog - Array de { id, defaultUnitId, ... } (CONFIG.PARAMETERS).
     * @returns {{ score: number, mappedCount: number, defaultUnitCount: number, totalCount: number }|null}
     */
    static computeCmFromObservations(observations, parameterCatalog) {
        if (!observations || observations.length === 0) return null;
        if (!parameterCatalog || parameterCatalog.length === 0) return null;

        // Mapear para lookup rápido
        const paramMap = {};
        for (const p of parameterCatalog) {
            paramMap[p.id] = p;
        }

        let mappedCount = 0;
        let defaultUnitCount = 0;
        let totalCount = 0;

        for (const obs of observations) {
            if (!obs.parameterId) continue;
            totalCount++;
            const param = paramMap[obs.parameterId];
            if (param) {
                mappedCount++;
                if (obs.unitId && obs.unitId === param.defaultUnitId) defaultUnitCount++;
            }
        }

        if (totalCount === 0) return null;

        // Score composto: 50% taxonomia + 50% unidade padrão
        const ratio = (mappedCount + defaultUnitCount) / (2 * totalCount);
        let score;
        if (ratio >= 0.95) score = 5;
        else if (ratio >= 0.8) score = 4;
        else if (ratio >= 0.6) score = 3;
        else if (ratio >= 0.4) score = 2;
        else score = 1;

        return {
            score,
            mappedCount,
            defaultUnitCount,
            totalCount,
        };
    }

    /**
     * Computa Global Compliance (GC) score from observations.
     * Delegates to globalCompliance.js, returns 1-5 score or null.
     *
     * @param {Array<Object>} observations - All observations from model
     * @param {string} [matrix='groundwater']
     * @returns {{ score: number, detail: Object }|null}
     */
    static computeGcFromObservations(observations, matrix = 'groundwater') {
        try {
            // Dynamic import to avoid circular dependency
            const mod = import('../../core/validation/globalCompliance.js');
            // Sync fallback — if module already cached, use it
            return mod.then(({ computeGlobalCompliance }) => {
                const result = computeGlobalCompliance(observations, matrix);
                if (!result) return null;
                return { score: result.score, detail: result };
            });
        } catch {
            return null;
        }
    }

    // ================================================================
    // MÉTODO ESTÁTICO — WHAT-IF: IMPACTO DE MELHORIA POR EIXO
    // ================================================================

    /**
     * Simula o impacto no EIS se um eixo melhorar em 1 ponto.
     * Calcula o delta entre EIS atual e EIS com o eixo incrementado.
     *
     * @param {Object.<string, number>} scores - Scores atuais por eixo
     * @param {Object.<string, number>} weights - Pesos por eixo
     * @param {string} targetAxis - Eixo a simular melhoria
     * @param {number} credMultiplier - Multiplicador de credencial agregado
     * @param {'geometric'|'veto'} [mode='geometric'] - Modo de cálculo
     * @returns {{ axis: string, currentScore: number, targetScore: number, currentEIS: number, projectedEIS: number, delta: number }}
     */
    // ================================================================
    // MÉTODO ESTÁTICO — DIAGNÓSTICO: ITENS PROBLEMÁTICOS POR EIXO
    // ================================================================

    /**
     * Coleta itens problemáticos que arrastam o score de um eixo para baixo.
     * Filtro read-only — não computa score, só identifica problemas.
     *
     * @param {string} axis - 'T'|'A'|'Cp'|'Ty'|'Cs'|'Cm'
     * @param {Array<Object>} observations - Obs enriquecidas (_elementId, _elementName)
     * @param {Array<Object>} elements - Todos os elementos
     * @param {Array<Object>} campaignDetails - Stats com details[] (para Cp)
     * @param {Object} unitsCatalog - UNITS catalog
     * @param {Array<Object>} paramsCatalog - CONFIG.PARAMETERS
     * @returns {{ problems: Array<Object>, fixCount: number }}
     */
    static collectAxisProblems(axis, observations, elements, campaignDetails, unitsCatalog, paramsCatalog) {
        const problems = [];
        const now = Date.now();

        switch (axis) {
            case 'T':
                for (const obs of observations) {
                    if (!obs.credentialLevel || obs.credentialLevel === 'common') {
                        problems.push({
                            elementId: obs._elementId,
                            elementName: obs._elementName,
                            parameterId: obs.parameterId,
                            field: 'credentialLevel',
                            current: obs.credentialLevel || 'none',
                            fixKey: 'eis.fix_add_credential',
                        });
                    }
                    if (!obs.createdBy) {
                        problems.push({
                            elementId: obs._elementId,
                            elementName: obs._elementName,
                            parameterId: obs.parameterId,
                            field: 'createdBy',
                            current: 'missing',
                            fixKey: 'eis.fix_add_author',
                        });
                    }
                }
                break;

            case 'A': {
                // Sensores offline
                const sensors = (elements || []).filter((e) => e.familyId === 'sensor' || e.family === 'sensor');
                for (const s of sensors) {
                    if (!s.data?.weather?.operationalStatus) {
                        problems.push({
                            elementId: s.id,
                            elementName: s.data?.name || s.id,
                            parameterId: null,
                            field: 'operationalStatus',
                            current: 'offline',
                            fixKey: 'eis.fix_sensor_offline',
                        });
                    }
                }
                // Obs com alta incerteza
                for (const obs of observations) {
                    if (obs.uncertainty != null && obs.uncertainty > 0 && obs.value !== 0) {
                        const relUnc =
                            obs.uncertaintyType === 'relative'
                                ? obs.uncertainty
                                : Math.abs(obs.uncertainty / obs.value) * 100;
                        if (relUnc > 50) {
                            problems.push({
                                elementId: obs._elementId,
                                elementName: obs._elementName,
                                parameterId: obs.parameterId,
                                field: 'uncertainty',
                                current: `${relUnc.toFixed(0)}%`,
                                fixKey: 'eis.fix_high_uncertainty',
                            });
                        }
                    }
                }
                break;
            }

            case 'Cp':
                // Readings planejados nao executados
                if (Array.isArray(campaignDetails)) {
                    for (const cs of campaignDetails) {
                        if (!cs || !Array.isArray(cs.details)) continue;
                        for (const d of cs.details) {
                            if (!d.executed) {
                                // Encontra nome do elemento
                                const el = (elements || []).find((e) => e.id === d.elementId);
                                problems.push({
                                    elementId: d.elementId,
                                    elementName: el?.data?.name || d.elementId,
                                    parameterId: d.parameterId,
                                    field: 'reading',
                                    current: 'not executed',
                                    fixKey: 'eis.fix_missing_reading',
                                    campaignId: cs.campaignId,
                                });
                            }
                        }
                    }
                }
                break;

            case 'Ty': {
                const ageThreshold = 180; // dias
                for (const obs of observations) {
                    if (!obs.date) continue;
                    const ageDays = (now - new Date(obs.date).getTime()) / (1000 * 60 * 60 * 24);
                    if (ageDays > ageThreshold) {
                        problems.push({
                            elementId: obs._elementId,
                            elementName: obs._elementName,
                            parameterId: obs.parameterId,
                            field: 'date',
                            current: `${Math.round(ageDays)}d`,
                            fixKey: 'eis.fix_stale_obs',
                        });
                    }
                }
                // Ordenar por idade decrescente (mais antigos primeiro)
                problems.sort((a, b) => parseInt(b.current) - parseInt(a.current));
                break;
            }

            case 'Cs':
                for (const obs of observations) {
                    if (!obs.unitId) continue;
                    const unit = unitsCatalog?.[obs.unitId];
                    if (!unit || !unit.dimension) {
                        problems.push({
                            elementId: obs._elementId,
                            elementName: obs._elementName,
                            parameterId: obs.parameterId,
                            field: 'unitId',
                            current: obs.unitId || 'none',
                            fixKey: 'eis.fix_nonstandard_unit',
                        });
                    }
                }
                break;

            case 'Cm':
                for (const obs of observations) {
                    if (!obs.parameterId) continue;
                    const param = Array.isArray(paramsCatalog)
                        ? paramsCatalog.find((p) => p.id === obs.parameterId)
                        : null;
                    if (!param) {
                        problems.push({
                            elementId: obs._elementId,
                            elementName: obs._elementName,
                            parameterId: obs.parameterId,
                            field: 'parameterId',
                            current: obs.parameterId,
                            fixKey: 'eis.fix_unmapped_param',
                        });
                    }
                }
                break;
        }

        return { problems, fixCount: problems.length };
    }

    static computeImpactIfImproved(scores, weights, targetAxis, credMultiplier = 1.0, mode = 'geometric') {
        const calc = new EisCalculator(weights);
        const currentScore = scores[targetAxis] || 3;
        const targetScore = Math.min(
            5,
            Math.ceil(currentScore) === currentScore ? currentScore + 1 : Math.ceil(currentScore),
        );

        // Calcula EIS atual
        let currentEIS;
        try {
            currentEIS = calc.calculate(scores, mode, 'common', credMultiplier).eis;
        } catch {
            currentEIS = 0;
        }

        // Calcula EIS com eixo melhorado
        const improved = { ...scores, [targetAxis]: targetScore };
        let projectedEIS;
        try {
            projectedEIS = calc.calculate(improved, mode, 'common', credMultiplier).eis;
        } catch {
            projectedEIS = currentEIS;
        }

        return {
            axis: targetAxis,
            currentScore,
            targetScore,
            currentEIS,
            projectedEIS,
            delta: parseFloat((projectedEIS - currentEIS).toFixed(2)),
        };
    }

    /**
     * Computa scores de custo-efetividade a partir do rollup de custos e benchmarks.
     * Cada eixo compara valor real vs referência setorial.
     *
     * Score: ratio actual/benchmark → 1-5
     *   ≤0.80x → 5 (muito abaixo do benchmark = excelente)
     *   ≤1.00x → 4 (dentro do benchmark)
     *   ≤1.20x → 3 (levemente acima)
     *   ≤1.50x → 2 (acima)
     *   >1.50x → 1 (muito acima = crítico)
     *
     * @param {Object} costRollup - Resultado de buildCostRollup() (kpis, byFamily, etc.)
     * @param {Array<Object>} benchmarks - Array de { id, reference, computeActual: fn(rollup) → number }
     * @returns {Object.<string, { score: number, actual: number, reference: number, ratio: number }>}
     */
    static computeCostEffectiveness(costRollup, benchmarks) {
        const results = {};
        if (!costRollup || !benchmarks) return results;

        for (const bm of benchmarks) {
            const actual = typeof bm.computeActual === 'function' ? bm.computeActual(costRollup) : null;
            if (actual == null || !Number.isFinite(actual) || bm.reference <= 0) {
                results[bm.id] = null;
                continue;
            }

            const ratio = actual / bm.reference;
            let score;
            if (ratio <= 0.8) score = 5;
            else if (ratio <= 1.0) score = 4;
            else if (ratio <= 1.2) score = 3;
            else if (ratio <= 1.5) score = 2;
            else score = 1;

            results[bm.id] = {
                score,
                actual: parseFloat(actual.toFixed(2)),
                reference: bm.reference,
                ratio: parseFloat(ratio.toFixed(4)),
            };
        }
        return results;
    }

    // ================================================================
    // MÉTODOS PRIVADOS — LÓGICA MATEMÁTICA
    // ================================================================

    /**
     * Aplica o multiplicador de credencial ao eixo T, com cap em 5.0.
     * Os demais eixos não são alterados.
     * Aplica o bônus de evidência para autores credenciados.
     *
     * @param {Object.<string, number>} scores - Notas originais.
     * @param {number} multiplier - Multiplicador de credencial.
     * @returns {Object.<string, number>} Notas com T ajustado.
     */
    _applyCredentialMultiplier(scores, multiplier) {
        const adjusted = { ...scores };
        adjusted.T = Math.min(scores.T * multiplier, 5.0);
        return adjusted;
    }

    /**
     * Modo 'geometric': Média Geométrica Ponderada.
     * Calcula EIS = ∏ (Nota_i)^(Peso_i / SomaPesos)
     *
     * Propriedade fundamental: uma nota 1 em eixo de peso alto
     * afunda o score de forma não-linear, impedindo compensação.
     *
     * @param {Object.<string, number>} scores - Notas originais (para output).
     * @param {Object.<string, number>} adjustedScores - Notas após multiplicador.
     * @param {string} credentialLevel - Nível de credencial do autor.
     * @param {number} multiplier - Multiplicador aplicado.
     * @param {boolean} vetoed - Se o kill-switch disparou.
     * @returns {EisResult}
     */
    _calculateGeometric(scores, adjustedScores, credentialLevel, multiplier, vetoed) {
        let rawScore = 1;
        for (const axis of EIS_AXES) {
            const note = adjustedScores[axis];
            const weight = this.weights[axis];
            rawScore *= Math.pow(note, weight / this._totalWeight);
        }

        // Kill-switch pode ter zerado o score antes de chegar aqui
        const eis = vetoed ? 0.0 : parseFloat(rawScore.toFixed(2));
        return this._buildResult(eis, scores, adjustedScores, credentialLevel, multiplier, vetoed);
    }

    /**
     * Modo 'veto': Geométrica com Kill-Switch binário.
     * Avalia T e A sobre as notas ORIGINAIS (sem multiplicador).
     * Se T≤2 ou A≤2, EIS = 0.0 independente de tudo.
     *
     * Regra: um PhD com T=1 não passa no veto — o kill-switch
     * julga a evidência bruta, não o crédito dado ao autor.
     *
     * @param {Object.<string, number>} scores - Notas originais (para avaliação do veto).
     * @param {Object.<string, number>} adjustedScores - Notas com multiplicador.
     * @param {string} credentialLevel - Nível de credencial.
     * @param {number} multiplier - Multiplicador aplicado.
     * @returns {EisResult}
     */
    _calculateVeto(scores, adjustedScores, credentialLevel, multiplier) {
        const vetoed = scores.T <= 2 || scores.A <= 2;
        return this._calculateGeometric(scores, adjustedScores, credentialLevel, multiplier, vetoed);
    }

    // ================================================================
    // MÉTODOS PRIVADOS — RESULTADO E CLASSIFICAÇÃO
    // ================================================================

    /**
     * Monta o objeto de retorno padronizado.
     * Constrói o resultado EIS com todas as informações para o frontend.
     *
     * @param {number} eis - Score final (0.00–5.00).
     * @param {Object} scores - Notas originais.
     * @param {Object} adjustedScores - Notas com multiplicador de credencial.
     * @param {string} credentialLevel - Nível de credencial.
     * @param {number} multiplier - Multiplicador aplicado.
     * @param {boolean} vetoed - Se o kill-switch disparou.
     * @returns {EisResult}
     */
    _buildResult(eis, scores, adjustedScores, credentialLevel, multiplier, vetoed) {
        return {
            eis,
            scores: { ...scores },
            adjustedScores: { ...adjustedScores },
            weights: { ...this.weights },
            credentialLevel,
            credentialMultiplier: multiplier,
            credentialLabel: EIS_CREDENTIAL_LABELS[credentialLevel] || '—',
            verdict: this._getVerdict(eis),
            vetoed,
        };
    }

    /**
     * Classifica o score EIS em categoria de veredito.
     * Mapeia o score numérico para a classificação de auditabilidade.
     *
     * @param {number} score - Score EIS (0.00–5.00).
     * @returns {string} String do veredito (ex: '🟢 Audit Ready').
     */
    _getVerdict(score) {
        if (score >= 4.5) return EIS_VERDICTS.AUDIT_READY.label;
        if (score >= 3.5) return EIS_VERDICTS.MANAGEMENT_READY.label;
        return EIS_VERDICTS.CRITICAL_DATA.label;
    }

    // ================================================================
    // MÉTODOS PRIVADOS — VALIDAÇÃO
    // ================================================================

    /**
     * Valida que as notas fornecidas são inteiros no range 1-5
     * e que todos os 6 eixos obrigatórios estão presentes.
     *
     * @param {Object} scores - Notas a validar.
     * @throws {Error} Se alguma nota for inválida.
     */
    _validateScores(scores) {
        for (const axis of EIS_AXES) {
            if (!(axis in scores)) {
                throw new Error(
                    `[EIS] Eixo ausente nas notas: '${axis}'. Forneça todos os 6 eixos: ${EIS_AXES.join(', ')}`,
                );
            }
            const v = scores[axis];
            if (typeof v !== 'number' || !Number.isFinite(v) || v < 1 || v > 5) {
                throw new Error(`[EIS] Nota inválida para '${axis}': ${v}. Deve ser número entre 1 e 5 (inclusive).`);
            }
        }
    }

    /**
     * Valida que os pesos fornecidos cobrem todos os eixos
     * e contêm valores numéricos positivos.
     *
     * @param {Object} weights - Pesos a validar.
     * @throws {Error} Se algum peso for inválido.
     */
    _validateWeights(weights) {
        for (const axis of EIS_AXES) {
            if (!(axis in weights)) {
                throw new Error(`[EIS] Peso ausente para eixo: '${axis}'. Forneça todos os 6 eixos.`);
            }
            const w = weights[axis];
            if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0) {
                throw new Error(`[EIS] Peso inválido para '${axis}': ${w}. Deve ser número positivo.`);
            }
        }
    }

    /**
     * Valida que o nível de credencial é reconhecido.
     *
     * @param {string} level - Nível a validar.
     * @throws {Error} Se o nível não existir em EIS_CREDENTIAL_MULTIPLIERS.
     */
    _validateCredentialLevel(level) {
        if (!(level in EIS_CREDENTIAL_MULTIPLIERS)) {
            const valid = Object.keys(EIS_CREDENTIAL_MULTIPLIERS).join(', ');
            throw new Error(`[EIS] Nível de credencial desconhecido: '${level}'. Valores válidos: ${valid}`);
        }
    }
}

// ================================================================
// TEMPLATES DE PERFIS CUSTOM
// ================================================================

/**
 * Templates pré-configurados para o modo Custom.
 * Não editáveis diretamente — o usuário pode duplicar e customizar.
 */
export const EIS_CUSTOM_TEMPLATES = [
    {
        id: 'template_global_compliance',
        name: 'Global Regulatory Compliance',
        isTemplate: true,
        axes: [
            {
                id: 'gc_jurisdiction',
                name: 'Jurisdiction Pass Rate',
                weight: 3,
                description: 'Fraction of global jurisdictions where all measured substances pass regulatory limits',
            },
            {
                id: 'gc_margin',
                name: 'Safety Margin',
                weight: 2,
                description: 'Average ratio of measured value to most stringent threshold worldwide (lower = safer)',
            },
            {
                id: 'gc_coverage',
                name: 'Assessment Coverage',
                weight: 1,
                description: 'Fraction of measured substances that have international threshold data available',
            },
        ],
    },
    {
        id: 'template_cost_effectiveness',
        name: 'Custo-Efetividade Ambiental',
        isTemplate: true,
        axes: [
            {
                id: 'ce_cost_meter',
                name: 'Custo/metro',
                weight: 3,
                description: 'Custo de perfuração por metro vs benchmark setorial',
                benchmark: { reference: 350, unit: 'BRL/m', source: 'ABAS 2024' },
            },
            {
                id: 'ce_cost_obs',
                name: 'Custo/observação',
                weight: 2,
                description: 'Custo médio por observação analítica',
                benchmark: { reference: 150, unit: 'BRL/obs', source: 'Catálogo interno' },
            },
            {
                id: 'ce_capex_opex',
                name: 'Ratio CAPEX:OPEX',
                weight: 2,
                description: 'Proporção investimento vs operação (ideal 60:40 a 70:30)',
                benchmark: { reference: 1.5, unit: 'ratio', source: 'FRTR 2023' },
            },
            {
                id: 'ce_coverage',
                name: 'Cobertura/custo',
                weight: 1,
                description: 'Nº de parâmetros monitorados por R$1000 investido',
                benchmark: { reference: 5, unit: 'params/kBRL', source: 'Estimativa' },
            },
        ],
    },
];

/**
 * Definições de benchmark para o template custo-efetividade.
 * Cada entry mapeia um eixo custom a uma função que extrai o valor real do rollup.
 */
export const EIS_COST_BENCHMARKS = [
    {
        id: 'ce_cost_meter',
        reference: 350,
        computeActual: (rollup) => {
            const wellData = rollup.byFamily?.well;
            if (!wellData || !wellData.capex) return null;
            const drillingCost = rollup.byCategory?.capex?.drilling || 0;
            const totalDepth = rollup.kpis?.totalWellDepthMeters || 0;
            return totalDepth > 0 ? drillingCost / totalDepth : null;
        },
    },
    {
        id: 'ce_cost_obs',
        reference: 150,
        computeActual: (rollup) => {
            const obsCost = rollup.totalObservationCost || 0;
            const obsCount = rollup.kpis?.observationCount || 0;
            return obsCount > 0 ? obsCost / obsCount : null;
        },
    },
    {
        id: 'ce_capex_opex',
        reference: 1.5,
        computeActual: (rollup) => {
            const capex = rollup.totalCapex || 0;
            const opex = rollup.totalOpex || 0;
            return opex > 0 ? capex / opex : null;
        },
    },
    {
        id: 'ce_coverage',
        reference: 5,
        computeActual: (rollup) => {
            const grandTotal = rollup.grandTotal || 0;
            const uniqueParams = rollup.kpis?.uniqueParameterCount || 0;
            return grandTotal > 0 ? uniqueParams / (grandTotal / 1000) : null;
        },
    },
];

// ================================================================
// TYPEDEFS
// ================================================================

/**
 * @typedef {Object} EisResult
 * @property {number} eis - Score final EIS (0.00–5.00, 2 casas decimais).
 * @property {Object.<string, number>} scores - Notas originais por eixo.
 * @property {Object.<string, number>} adjustedScores - Notas após multiplicador de credencial.
 * @property {Object.<string, number>} weights - Pesos utilizados no cálculo.
 * @property {string} credentialLevel - Nível de credencial do autor.
 * @property {number} credentialMultiplier - Multiplicador aplicado ao eixo T.
 * @property {string} credentialLabel - Rótulo legível da credencial.
 * @property {string} verdict - Classificação ('🟢 Audit Ready' | '🟡 Management Ready' | '🔴 Critical Data').
 * @property {boolean} vetoed - true se o kill-switch (modo 'veto') disparou.
 */
