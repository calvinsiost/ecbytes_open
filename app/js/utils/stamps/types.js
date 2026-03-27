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
   TIPOS DE ESTAMPAS (STAMP TYPES)
   ================================================================

   Define os tipos de estampas que podem ser aplicadas a ativos.
   Estampas sao metadados de governanca, contexto e reporte.

   CATEGORIAS:
   - governance: RT, responsavel legal, assinatura digital
   - context: campanha, coordenadas, area, periodo
   - reporting: GRI, ESG, H&S, ODS

   ================================================================ */

// ----------------------------------------------------------------
// CATEGORIAS DE ESTAMPAS
// ----------------------------------------------------------------

/**
 * Categorias principais de estampas.
 */
export const STAMP_CATEGORIES = {
    governance: {
        id: 'governance',
        name: 'Governanca',
        description: 'Responsabilidades e assinaturas',
        color: '#9C27B0', // Roxo
        icon: 'lock',
    },
    context: {
        id: 'context',
        name: 'Contexto',
        description: 'Localizacao, tempo e campanha',
        color: '#2196F3', // Azul
        icon: 'map-pin',
    },
    reporting: {
        id: 'reporting',
        name: 'Reporte',
        description: 'Indicadores e frameworks',
        color: '#4CAF50', // Verde
        icon: 'bar-chart',
    },
};

// ----------------------------------------------------------------
// TIPOS DE ESTAMPAS DE GOVERNANCA
// ----------------------------------------------------------------

export const GOVERNANCE_STAMP_TYPES = {
    responsible_technical: {
        id: 'responsible_technical',
        category: 'governance',
        name: 'Responsavel Tecnico',
        description: 'RT responsavel pelo ativo',
        icon: 'hardhat',
        schema: {
            name: { type: 'string', required: true, label: 'Nome' },
            role: { type: 'string', required: true, label: 'Cargo' },
            registration: { type: 'string', required: true, label: 'Registro (CREA/CRQ)' },
            validUntil: { type: 'date', required: false, label: 'Validade' },
        },
    },
    responsible_legal: {
        id: 'responsible_legal',
        category: 'governance',
        name: 'Responsavel Legal',
        description: 'Responsavel legal pela empresa',
        icon: 'user',
        schema: {
            name: { type: 'string', required: true, label: 'Nome' },
            cpf: { type: 'string', required: true, label: 'CPF' },
            role: { type: 'string', required: true, label: 'Cargo' },
        },
    },
    digital_signature: {
        id: 'digital_signature',
        category: 'governance',
        name: 'Assinatura Digital',
        description: 'Assinatura ECDSA do documento',
        icon: 'pen-sign',
        schema: {
            keyId: { type: 'string', required: true, label: 'ID da Chave' },
            signature: { type: 'string', required: true, label: 'Assinatura' },
            timestamp: { type: 'datetime', required: true, label: 'Data/Hora' },
            algorithm: { type: 'string', required: false, label: 'Algoritmo', default: 'ECDSA-P256' },
        },
    },
    approval: {
        id: 'approval',
        category: 'governance',
        name: 'Aprovacao',
        description: 'Status de aprovacao do ativo',
        icon: 'check-circle',
        schema: {
            status: {
                type: 'enum',
                required: true,
                label: 'Status',
                options: ['pending', 'approved', 'rejected', 'revision'],
            },
            approver: { type: 'string', required: true, label: 'Aprovador' },
            date: { type: 'date', required: true, label: 'Data' },
            comments: { type: 'text', required: false, label: 'Comentarios' },
        },
    },
    audit_status: {
        id: 'audit_status',
        category: 'governance',
        name: 'Status de Auditoria',
        description: 'Resultado de auditoria externa',
        icon: 'search',
        schema: {
            auditor: { type: 'string', required: true, label: 'Auditor' },
            result: {
                type: 'enum',
                required: true,
                label: 'Resultado',
                options: ['conforming', 'minor_nc', 'major_nc', 'observation'],
            },
            findings: { type: 'text', required: false, label: 'Constatacoes' },
            auditDate: { type: 'date', required: true, label: 'Data da Auditoria' },
        },
    },
};

// ----------------------------------------------------------------
// TIPOS DE ESTAMPAS DE CONTEXTO
// ----------------------------------------------------------------

export const CONTEXT_STAMP_TYPES = {
    environmental_classification: {
        id: 'environmental_classification',
        category: 'context',
        name: 'Passivo / Ativo Ambiental',
        description: 'Classifica o elemento como passivo ambiental (obrigacao) ou ativo ambiental (recurso)',
        icon: 'alert-triangle',
        schema: {
            type: { type: 'enum', required: true, label: 'Tipo', options: ['Passivo Ambiental', 'Ativo Ambiental'] },
            description: { type: 'text', required: false, label: 'Descricao / Justificativa' },
        },
    },
    campaign: {
        id: 'campaign',
        category: 'context',
        name: 'Campanha',
        description: 'Campanha de monitoramento associada',
        icon: 'clipboard',
        schema: {
            campaignId: { type: 'string', required: true, label: 'ID da Campanha' },
            name: { type: 'string', required: true, label: 'Nome' },
            date: { type: 'date', required: true, label: 'Data' },
            type: {
                type: 'enum',
                required: false,
                label: 'Tipo',
                options: ['routine', 'incident', 'baseline', 'closure'],
            },
        },
    },
    coordinates: {
        id: 'coordinates',
        category: 'context',
        name: 'Coordenadas',
        description: 'Geolocalizacao do ativo',
        icon: 'globe',
        schema: {
            lat: { type: 'number', required: true, label: 'Latitude' },
            lon: { type: 'number', required: true, label: 'Longitude' },
            utm_e: { type: 'number', required: false, label: 'UTM Leste' },
            utm_n: { type: 'number', required: false, label: 'UTM Norte' },
            zone: { type: 'string', required: false, label: 'Zona UTM' },
            datum: { type: 'string', required: false, label: 'Datum', default: 'SIRGAS2000' },
        },
    },
    project_area: {
        id: 'project_area',
        category: 'context',
        name: 'Area do Projeto',
        description: 'Hierarquia de areas',
        icon: 'factory',
        schema: {
            areaId: { type: 'string', required: true, label: 'ID da Area' },
            name: { type: 'string', required: true, label: 'Nome' },
            hierarchy: { type: 'string', required: false, label: 'Hierarquia' },
        },
    },
    temporal: {
        id: 'temporal',
        category: 'context',
        name: 'Periodo Temporal',
        description: 'Periodo de validade ou referencia',
        icon: 'clock',
        schema: {
            start: { type: 'date', required: true, label: 'Inicio' },
            end: { type: 'date', required: false, label: 'Fim' },
            frequency: {
                type: 'enum',
                required: false,
                label: 'Frequencia',
                options: ['daily', 'weekly', 'monthly', 'quarterly', 'annual'],
            },
        },
    },
    regulatory: {
        id: 'regulatory',
        category: 'context',
        name: 'Norma Aplicavel',
        description: 'Norma ou regulamento de referencia',
        icon: 'docs',
        schema: {
            norm: { type: 'string', required: true, label: 'Norma' },
            version: { type: 'string', required: false, label: 'Versao' },
            article: { type: 'string', required: false, label: 'Artigo/Secao' },
            jurisdiction: { type: 'string', required: false, label: 'Jurisdicao' },
        },
    },
    employee_id: {
        id: 'employee_id',
        category: 'context',
        name: 'Matricula',
        description: 'Identificacao de colaborador',
        icon: 'tag',
        schema: {
            registration: { type: 'string', required: true, label: 'Matricula' },
            department: { type: 'string', required: false, label: 'Departamento' },
            costCenter: { type: 'string', required: false, label: 'Centro de Custo' },
        },
    },
    specimen_tag: {
        id: 'specimen_tag',
        category: 'context',
        name: 'Tag de Especime',
        description: 'Identificacao de arvore ou animal',
        icon: 'tag',
        schema: {
            tagId: { type: 'string', required: true, label: 'ID do Tag' },
            tagType: {
                type: 'enum',
                required: false,
                label: 'Tipo',
                options: ['collar', 'ring', 'microchip', 'plate'],
            },
            installDate: { type: 'date', required: false, label: 'Data Instalacao' },
        },
    },
};

// ----------------------------------------------------------------
// TIPOS DE ESTAMPAS DE REPORTE
// ----------------------------------------------------------------

export const REPORTING_STAMP_TYPES = {
    gri: {
        id: 'gri',
        category: 'reporting',
        name: 'GRI',
        description: 'Indicador Global Reporting Initiative',
        icon: 'bar-chart',
        schema: {
            standard: { type: 'string', required: true, label: 'Padrao (ex: GRI 303)' },
            disclosure: { type: 'string', required: true, label: 'Divulgacao (ex: 303-1)' },
            topic: { type: 'string', required: false, label: 'Topico' },
        },
    },
    esg_category: {
        id: 'esg_category',
        category: 'reporting',
        name: 'Categoria ESG',
        description: 'Classificacao ESG',
        icon: 'tree',
        schema: {
            pillar: { type: 'enum', required: true, label: 'Pilar', options: ['E', 'S', 'G'] },
            category: { type: 'string', required: true, label: 'Categoria' },
            subcategory: { type: 'string', required: false, label: 'Subcategoria' },
        },
    },
    hs_metric: {
        id: 'hs_metric',
        category: 'reporting',
        name: 'Metrica H&S',
        description: 'Metrica de Saude e Seguranca',
        icon: 'shield',
        schema: {
            metricType: {
                type: 'enum',
                required: true,
                label: 'Tipo',
                options: ['frequency', 'severity', 'ltir', 'trir', 'near_miss'],
            },
            calculation: { type: 'string', required: false, label: 'Metodo de Calculo' },
            baseline: { type: 'number', required: false, label: 'Baseline' },
            target: { type: 'number', required: false, label: 'Meta' },
        },
    },
    sdg: {
        id: 'sdg',
        category: 'reporting',
        name: 'ODS',
        description: 'Objetivo de Desenvolvimento Sustentavel',
        icon: 'target',
        schema: {
            goal: { type: 'number', required: true, label: 'ODS (1-17)', min: 1, max: 17 },
            target: { type: 'string', required: false, label: 'Meta' },
            indicator: { type: 'string', required: false, label: 'Indicador' },
        },
    },
    benchmark: {
        id: 'benchmark',
        category: 'reporting',
        name: 'Benchmark',
        description: 'Comparativo com referencia externa',
        icon: 'bar-chart',
        schema: {
            source: { type: 'string', required: true, label: 'Fonte' },
            value: { type: 'number', required: true, label: 'Valor' },
            percentile: { type: 'number', required: false, label: 'Percentil', min: 0, max: 100 },
            year: { type: 'number', required: false, label: 'Ano' },
        },
    },
    biodiversity: {
        id: 'biodiversity',
        category: 'reporting',
        name: 'Biodiversidade',
        description: 'Indicador de biodiversidade',
        icon: 'tree',
        schema: {
            iucnStatus: {
                type: 'enum',
                required: false,
                label: 'Status IUCN',
                options: ['LC', 'NT', 'VU', 'EN', 'CR', 'EW', 'EX', 'DD', 'NE'],
            },
            endemism: { type: 'boolean', required: false, label: 'Endemica' },
            protectedStatus: { type: 'boolean', required: false, label: 'Protegida' },
            cites: { type: 'enum', required: false, label: 'CITES', options: ['I', 'II', 'III', 'none'] },
        },
    },
};

// ----------------------------------------------------------------
// AGREGACAO DE TODOS OS TIPOS
// ----------------------------------------------------------------

/**
 * Todos os tipos de estampas indexados por ID.
 */
export const STAMP_TYPES = {
    ...GOVERNANCE_STAMP_TYPES,
    ...CONTEXT_STAMP_TYPES,
    ...REPORTING_STAMP_TYPES,
};

/**
 * Obtem tipo de estampa por ID.
 * @param {string} typeId - ID do tipo
 * @returns {Object|null}
 */
export function getStampType(typeId) {
    return STAMP_TYPES[typeId] || null;
}

/**
 * Obtem tipos de estampa por categoria.
 * @param {string} category - governance|context|reporting
 * @returns {Object[]}
 */
export function getStampTypesByCategory(category) {
    return Object.values(STAMP_TYPES).filter((t) => t.category === category);
}

/**
 * Valida valor de estampa contra schema.
 * @param {string} typeId - ID do tipo
 * @param {Object} value - Valor a validar
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateStampValue(typeId, value) {
    const stampType = getStampType(typeId);
    if (!stampType) {
        return { valid: false, errors: [`Tipo de estampa desconhecido: ${typeId}`] };
    }

    const errors = [];
    const schema = stampType.schema;

    for (const [field, rules] of Object.entries(schema)) {
        const fieldValue = value[field];

        // Verificar campo obrigatorio
        if (rules.required && (fieldValue === undefined || fieldValue === null || fieldValue === '')) {
            errors.push(`Campo obrigatorio: ${rules.label || field}`);
            continue;
        }

        // Pular validacao se campo vazio e nao obrigatorio
        if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
            continue;
        }

        // Validar tipo
        switch (rules.type) {
            case 'string':
            case 'text':
                if (typeof fieldValue !== 'string') {
                    errors.push(`${rules.label || field} deve ser texto`);
                }
                break;
            case 'number':
                if (typeof fieldValue !== 'number' || isNaN(fieldValue)) {
                    errors.push(`${rules.label || field} deve ser numero`);
                } else {
                    if (rules.min !== undefined && fieldValue < rules.min) {
                        errors.push(`${rules.label || field} deve ser >= ${rules.min}`);
                    }
                    if (rules.max !== undefined && fieldValue > rules.max) {
                        errors.push(`${rules.label || field} deve ser <= ${rules.max}`);
                    }
                }
                break;
            case 'boolean':
                if (typeof fieldValue !== 'boolean') {
                    errors.push(`${rules.label || field} deve ser booleano`);
                }
                break;
            case 'enum':
                if (!rules.options.includes(fieldValue)) {
                    errors.push(`${rules.label || field} deve ser um de: ${rules.options.join(', ')}`);
                }
                break;
            case 'date':
            case 'datetime':
                if (isNaN(Date.parse(fieldValue))) {
                    errors.push(`${rules.label || field} deve ser data valida`);
                }
                break;
        }
    }

    return { valid: errors.length === 0, errors };
}
