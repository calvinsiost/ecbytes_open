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
   XLSX TEMPLATES — Definicoes de templates de exportacao
   ================================================================

   Cada template define um conjunto de planilhas (sheets) com
   colunas especificas mapeadas a campos do modelo ecbyts.

   A chave `nameKey` referencia uma string de traducao no i18n.
   A chave `enabled` controla se o template aparece ativo na UI.

   ================================================================ */

/**
 * Template column descriptor.
 * @typedef {Object} TemplateColumn
 * @property {string} header - Cabecalho da coluna no XLSX
 * @property {Function} value - Extrai o valor do objeto fonte (element ou observation)
 */

/**
 * Template sheet descriptor.
 * @typedef {Object} TemplateSheet
 * @property {string} name - Nome da aba no XLSX
 * @property {'elements'|'campaigns'|'observations'} source - Fonte dos dados
 * @property {TemplateColumn[]} columns - Definicoes das colunas
 */

/**
 * Template descriptor.
 * @typedef {Object} XLSXTemplate
 * @property {string} id
 * @property {string} nameKey - Chave i18n para o nome exibido
 * @property {string} descKey - Chave i18n para a descricao
 * @property {boolean} enabled - Se true, disponivel para exportacao
 * @property {TemplateSheet[]} sheets
 */

/**
 * All available XLSX export templates.
 * Templates com enabled:false aparecem na UI como "(coming soon)".
 * @type {Object.<string, XLSXTemplate>}
 */
export const XLSX_TEMPLATES = {
    'edd-br': {
        id: 'edd-br',
        nameKey: 'xlsxTemplateEddBrName',
        descKey: 'xlsxTemplateEddBrDesc',
        enabled: true,
        sheets: [
            {
                name: 'Locais',
                source: 'elements',
                columns: [
                    { header: 'cod_ponto', value: (el) => el.name || el.id },
                    { header: 'nome', value: (el) => el.name || '' },
                    { header: 'x', value: (el) => el.position?.x ?? '' },
                    { header: 'y', value: (el) => el.position?.y ?? '' },
                    { header: 'z', value: (el) => el.position?.z ?? '' },
                    { header: 'sistema_coordenadas', value: (el) => el.coordinateSystem || 'UTM' },
                    { header: 'zona_utm', value: (el) => el.utmZone || '' },
                    { header: 'hemisferio', value: (el) => el.hemisphere || 'S' },
                    { header: 'tipo', value: (el) => el.family || '' },
                ],
            },
            {
                name: 'Amostras',
                source: 'campaigns',
                columns: [
                    { header: 'cod_amostra', value: (c) => c.id },
                    { header: 'nome_campanha', value: (c) => c.name || c.id },
                    { header: 'data_inicio', value: (c) => c.startDate || c.date || '' },
                    { header: 'data_fim', value: (c) => c.endDate || c.date || '' },
                ],
            },
            {
                name: 'Resultados',
                source: 'observations',
                columns: [
                    { header: 'cod_ponto', value: (obs, el) => el.name || el.id },
                    { header: 'parametro', value: (obs) => obs.parameterId || '' },
                    { header: 'cas_number', value: (obs) => obs.casNumber || '' },
                    { header: 'resultado', value: (obs) => obs.value ?? '' },
                    { header: 'unidade', value: (obs) => obs.unit || '' },
                    { header: 'data_coleta', value: (obs) => obs.date || '' },
                    { header: 'campanha', value: (obs) => obs.campaignId || '' },
                ],
            },
        ],
    },

    ecbyts: {
        id: 'ecbyts',
        nameKey: 'xlsxTemplateEcbytsName',
        descKey: 'xlsxTemplateEcbytsDesc',
        enabled: true,
        sheets: [
            {
                name: 'Data',
                source: 'observations',
                columns: [
                    { header: 'elementId', value: (obs, el) => el.id },
                    { header: 'elementName', value: (obs, el) => el.name || '' },
                    { header: 'elementType', value: (obs, el) => el.family || '' },
                    { header: 'x', value: (obs, el) => el.position?.x ?? '' },
                    { header: 'y', value: (obs, el) => el.position?.y ?? '' },
                    { header: 'z', value: (obs, el) => el.position?.z ?? '' },
                    { header: 'campaignId', value: (obs) => obs.campaignId || '' },
                    { header: 'date', value: (obs) => obs.date || '' },
                    { header: 'parameterId', value: (obs) => obs.parameterId || '' },
                    { header: 'casNumber', value: (obs) => obs.casNumber || '' },
                    { header: 'value', value: (obs) => obs.value ?? '' },
                    { header: 'unit', value: (obs) => obs.unit || '' },
                    { header: 'depth', value: (obs) => obs.depth ?? '' },
                    { header: 'matrix', value: (obs) => obs.matrix || '' },
                    { header: 'method', value: (obs) => obs.method || '' },
                    { header: 'lab', value: (obs) => obs.lab || '' },
                    { header: 'detectionLimit', value: (obs) => obs.detectionLimit ?? '' },
                    { header: 'qualifier', value: (obs) => obs.qualifier || '' },
                ],
            },
        ],
    },

    'edd-r2': {
        id: 'edd-r2',
        nameKey: 'xlsxTemplateEddR2Name',
        descKey: 'xlsxTemplateEddR2Desc',
        enabled: false,
        sheets: [
            {
                name: 'Location_v1',
                source: 'elements',
                columns: [
                    { header: 'sys_loc_code', value: (el) => el.id },
                    { header: 'loc_name', value: (el) => el.name || '' },
                ],
            },
            {
                name: 'Sample_v4',
                source: 'campaigns',
                columns: [],
            },
            {
                name: 'TestResultsQC_v4',
                source: 'observations',
                columns: [],
            },
        ],
    },

    'ohs-aiha': {
        id: 'ohs-aiha',
        nameKey: 'xlsxTemplateOhsAihaName',
        descKey: 'xlsxTemplateOhsAihaDesc',
        enabled: false,
        sheets: [
            {
                name: 'Exposures',
                source: 'observations',
                columns: [],
            },
            {
                name: 'Workers',
                source: 'elements',
                columns: [],
            },
        ],
    },
};
