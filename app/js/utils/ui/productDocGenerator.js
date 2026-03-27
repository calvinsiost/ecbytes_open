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

/**
 * productDocGenerator.js — Scope & Terms Document Generator
 *
 * Generates .docx documents from service product configuration.
 * Uses docx@9 CDN library (same as docxExport.js).
 *
 * PLATFORM LIABILITY SHIELD:
 * - Documents are "Propostas de Escopo e Termos", NEVER "contratos"
 * - Immutable disclaimer in header/footer of every document
 * - Disclaimer cannot be overridden by any template or config
 *
 * @module utils/ui/productDocGenerator
 */

import { loadScriptCDN } from '../helpers/cdnLoader.js';
import { sanitizeDocxXmlData } from '../helpers/docxSanitizer.js';
import { t } from '../i18n/translations.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DOCX_CDN = 'https://cdn.jsdelivr.net/npm/docx@9.1.1/build/index.umd.min.js';

const PLATFORM_DISCLAIMER = {
    header: 'PROPOSTA DE ESCOPO E TERMOS \u2014 Documento gerado por ecbyts.com',
    footer: [
        'Este documento foi gerado automaticamente pela plataforma ecbyts',
        'e NAO constitui instrumento juridico valido.',
        'Requer revisao por advogado habilitado e assinatura formal das partes.',
        'ecbyts nao presta servicos juridicos, financeiros ou de intermediacao contratual.',
    ].join(' '),
};

const CLAUSE_ORDER = [
    'preamble',
    'object',
    'scope',
    'term',
    'remuneration',
    'warranty_acceptance',
    'ip',
    'confidentiality',
    'lgpd',
    'jurisdiction',
];

const REQUIRED_CLAUSES = new Set([
    'preamble',
    'object',
    'scope',
    'remuneration',
    'warranty_acceptance',
    'ip',
    'jurisdiction',
]);

export function preloadDocx() {
    return loadScriptCDN(DOCX_CDN, { name: 'docx', globalVar: 'docx' });
}

function _loadDocx() {
    return preloadDocx();
}

// ---------------------------------------------------------------------------
// docx-js helpers (matching docxExport.js patterns exactly)
// ---------------------------------------------------------------------------

function _bold(D, text) {
    return new D.TextRun({ text, bold: true, size: 22 });
}

function _normal(D, text) {
    return new D.TextRun({ text, size: 22 });
}

function _italic(D, text) {
    return new D.TextRun({ text, italics: true, color: '666666', size: 22 });
}

function _para(D, ...runs) {
    return new D.Paragraph({ children: runs, spacing: { after: 120 } });
}

function _heading(D, text, level) {
    const headingLevel = level === 2 ? D.HeadingLevel.HEADING_2 : D.HeadingLevel.HEADING_1;
    return new D.Paragraph({
        text,
        heading: headingLevel,
        spacing: { before: 240, after: 120 },
    });
}

function _placeholder(field) {
    return `[${field}]`;
}

function _formatBRL(v) {
    return `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// Clause renderers
// ---------------------------------------------------------------------------

function _renderPreamble(D, product) {
    return [
        _heading(D, 'PROPOSTA DE ESCOPO E TERMOS'),
        _para(D, _normal(D, `Servico: ${product.name || '—'}`)),
        _para(D, _normal(D, `Versao: ${product.version || '1.0.0'}`)),
        _para(D, _normal(D, `Data: ${new Date().toLocaleDateString('pt-BR')}`)),
        _para(D, _normal(D, '')),
        _para(D, _normal(D, 'CONTRATANTE: '), _italic(D, _placeholder('RAZAO SOCIAL DA CONTRATANTE'))),
        _para(D, _normal(D, 'CNPJ: '), _italic(D, _placeholder('CNPJ DA CONTRATANTE'))),
        _para(D, _normal(D, '')),
        _para(D, _normal(D, 'CONTRATADA: '), _italic(D, _placeholder('RAZAO SOCIAL DA CONTRATADA'))),
        _para(D, _normal(D, 'CNPJ: '), _italic(D, _placeholder('CNPJ DA CONTRATADA'))),
        _para(D, _normal(D, '')),
    ];
}

function _renderObject(D, product, num) {
    const paragraphs = [
        _heading(D, `${num}. OBJETO`),
        _para(
            D,
            _normal(
                D,
                `O presente documento descreve o escopo, termos e condicoes para a prestacao do servico "${product.name || '—'}", na categoria ${product.category || '—'}.`,
            ),
        ),
    ];
    if (product.description) {
        paragraphs.push(_para(D, _normal(D, product.description)));
    }
    return paragraphs;
}

function _renderScope(D, scopeItems, num) {
    const deliverables = scopeItems.filter((s) => s.node_type === 'deliverable');
    const milestones = scopeItems.filter((s) => s.node_type === 'milestone');
    const exclusions = scopeItems.filter((s) => s.node_type === 'exclusion');
    const totalEffort = scopeItems.reduce((s, i) => s + (Number(i.effort_hours) || 0), 0);

    const headerRow = new D.TableRow({
        children: ['Codigo', 'Tipo', 'Item', 'Horas', 'Criterio de Aceite'].map(
            (h) =>
                new D.TableCell({
                    children: [new D.Paragraph({ children: [_bold(D, h)], spacing: { after: 40 } })],
                    shading: { fill: 'E8E8E8' },
                }),
        ),
    });

    const dataRows = scopeItems
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
        .map(
            (item) =>
                new D.TableRow({
                    children: [
                        item.code || '\u2014',
                        item.node_type || '\u2014',
                        item.name || '\u2014',
                        item.effort_hours ? `${item.effort_hours}h` : '\u2014',
                        item.acceptance_criteria || '\u2014',
                    ].map(
                        (text) =>
                            new D.TableCell({
                                children: [new D.Paragraph({ children: [_normal(D, text)], spacing: { after: 40 } })],
                            }),
                    ),
                }),
        );

    const result = [
        _heading(D, `${num}. ESCOPO`),
        _para(
            D,
            _normal(
                D,
                `O escopo compreende ${deliverables.length} entrega(s), ${milestones.length} marco(s) e ${exclusions.length} exclusao(oes), totalizando ${totalEffort} horas estimadas.`,
            ),
        ),
        new D.Table({ rows: [headerRow, ...dataRows], width: { size: 100, type: D.WidthType.PERCENTAGE } }),
    ];

    if (exclusions.length > 0) {
        result.push(_para(D, _bold(D, 'Exclusoes de Escopo:')));
        for (const e of exclusions) {
            result.push(_para(D, _normal(D, `  \u2022 ${e.name}${e.description ? ': ' + e.description : ''}`)));
        }
    }

    return result;
}

function _renderTerm(D, pricing, num) {
    return [
        _heading(D, `${num}. PRAZO`),
        _para(D, _normal(D, 'Data de inicio: '), _italic(D, _placeholder('DATA DE INICIO'))),
        _para(D, _normal(D, 'Data de termino: '), _italic(D, _placeholder('DATA DE TERMINO'))),
        _para(D, _normal(D, `Garantia: ${pricing.warranty_days || 90} dias apos conclusao.`)),
    ];
}

function _renderRemuneration(D, pricing, num) {
    const paragraphs = [
        _heading(D, `${num}. REMUNERACAO`),
        _para(D, _normal(D, `Tipo: ${pricing.pricing_type === 'hourly' ? 'Por hora' : 'Preco fixo'}`)),
        _para(D, _normal(D, `Valor base: ${_formatBRL(pricing.base_value)}`)),
    ];

    if (pricing.pricing_type === 'hourly') {
        paragraphs.push(_para(D, _normal(D, `Valor/hora: ${_formatBRL(pricing.hourly_rate)}`)));
        paragraphs.push(_para(D, _normal(D, `Horas estimadas: ${pricing.estimated_hours || '\u2014'}`)));
    }

    const multA = Number(pricing.ip_scenario_a_multiplier || 1);
    const multB = Number(pricing.ip_scenario_b_multiplier || 1);
    const base = Number(pricing.base_value || 0);
    paragraphs.push(
        _para(D, _normal(D, `Cenario A (PI com Contratante): multiplicador ${multA}x = ${_formatBRL(base * multA)}`)),
    );
    paragraphs.push(
        _para(D, _normal(D, `Cenario B (PI com Contratada): multiplicador ${multB}x = ${_formatBRL(base * multB)}`)),
    );
    paragraphs.push(_para(D, _normal(D, '')));
    paragraphs.push(_para(D, _normal(D, `Multa moratoria: ${pricing.late_fee_pct ?? 2}% (CDC Art. 52 par. 1)`)));
    paragraphs.push(
        _para(D, _normal(D, `Juros de mora: ${pricing.late_interest_monthly_pct ?? 1}% ao mes (CC Art. 406)`)),
    );

    if (pricing.installments_count > 1) {
        paragraphs.push(
            _para(D, _normal(D, `Parcelas: ${pricing.installments_count}x (${pricing.installments_type})`)),
        );
    }

    return paragraphs;
}

function _renderWarrantyAcceptance(D, pricing, num) {
    return [
        _heading(D, `${num}. GARANTIA E ACEITE`),
        _para(
            D,
            _normal(
                D,
                `Periodo de garantia: ${pricing.warranty_days || 90} dias corridos apos a conclusao de cada entrega.`,
            ),
        ),
        _para(
            D,
            _normal(
                D,
                `Aceite tacito: ${pricing.tacit_acceptance_business_days || 10} dias uteis apos submissao da entrega, sem manifestacao formal.`,
            ),
        ),
        _para(
            D,
            _normal(D, 'Criterios de aceite estao detalhados na coluna "Criterio de Aceite" da tabela de escopo.'),
        ),
    ];
}

function _renderIP(D, pricing, num) {
    return [
        _heading(D, `${num}. PROPRIEDADE INTELECTUAL`),
        _para(
            D,
            _normal(
                D,
                'A atribuicao de propriedade intelectual derivada sera definida conforme o cenario selecionado:',
            ),
        ),
        _para(D, _normal(D, `  Cenario A: ${pricing.ip_scenario_a_label || 'PI Derivada com Contratante'}`)),
        _para(D, _normal(D, `  Cenario B: ${pricing.ip_scenario_b_label || 'PI Derivada com Contratada'}`)),
        _para(D, _normal(D, '')),
        _para(D, _italic(D, 'O cenario aplicavel sera indicado no momento da contratacao formal.')),
    ];
}

function _renderConfidentiality(D, num) {
    return [
        _heading(D, `${num}. CONFIDENCIALIDADE`),
        _para(
            D,
            _normal(
                D,
                'As partes se comprometem a manter sigilo sobre informacoes tecnicas, comerciais e estrategicas compartilhadas durante a execucao do servico.',
            ),
        ),
        _para(D, _normal(D, 'O prazo de confidencialidade sera definido no instrumento contratual formal.')),
    ];
}

function _renderLGPD(D, num) {
    return [
        _heading(D, `${num}. PROTECAO DE DADOS (LGPD)`),
        _para(
            D,
            _normal(
                D,
                'As partes se comprometem a tratar dados pessoais em conformidade com a Lei Geral de Protecao de Dados (Lei 13.709/2018).',
            ),
        ),
        _para(D, _normal(D, 'O papel de controlador e operador sera definido no instrumento contratual formal.')),
    ];
}

function _renderJurisdiction(D, num) {
    return [
        _heading(D, `${num}. FORO`),
        _para(
            D,
            _normal(D, 'Fica eleito o foro da comarca de '),
            _italic(D, _placeholder('CIDADE')),
            _normal(D, ', Estado de '),
            _italic(D, _placeholder('ESTADO')),
            _normal(D, ', para dirimir quaisquer questoes oriundas deste documento.'),
        ),
        _para(D, _normal(D, '')),
        _para(D, _normal(D, '')),
        _para(D, _normal(D, '_______________________________________')),
        _para(D, _italic(D, _placeholder('NOME DO REPRESENTANTE \u2014 CONTRATANTE'))),
        _para(D, _normal(D, '')),
        _para(D, _normal(D, '_______________________________________')),
        _para(D, _italic(D, _placeholder('NOME DO REPRESENTANTE \u2014 CONTRATADA'))),
        _para(D, _normal(D, '')),
        _para(D, _normal(D, 'Testemunhas:')),
        _para(D, _normal(D, '1. _________________________________ CPF: _______________')),
        _para(D, _normal(D, '2. _________________________________ CPF: _______________')),
    ];
}

// ---------------------------------------------------------------------------
// Governance Annex
// ---------------------------------------------------------------------------

function _buildGovernanceAnnex(D, governance) {
    if (!governance) return [];

    const score =
        (governance.dim_autonomy || 1) +
        (governance.dim_data_sensitivity || 1) +
        (governance.dim_integrations || 1) +
        (governance.dim_users || 1) +
        (governance.dim_decision_impact || 1) +
        (governance.dim_reversibility || 1);
    const tier = score <= 9 ? 1 : score <= 14 ? 2 : 3;
    const tierLabels = ['', 'PoC (Tier 1)', 'Padrao (Tier 2)', 'Critico (Tier 3)'];

    const dims = [
        { label: 'Autonomia', value: governance.dim_autonomy, options: ['Sugestiva', 'Semi-autonoma', 'Autonoma'] },
        {
            label: 'Sensibilidade de Dados',
            value: governance.dim_data_sensitivity,
            options: ['Sem dados pessoais', 'Dados pessoais', 'Dados sensiveis'],
        },
        {
            label: 'Integracoes',
            value: governance.dim_integrations,
            options: ['<=1 sistema', '2-3 sistemas', '>3 sistemas'],
        },
        { label: 'Usuarios', value: governance.dim_users, options: ['Interno', 'Departamento', 'Externo'] },
        {
            label: 'Impacto da Decisao',
            value: governance.dim_decision_impact,
            options: ['Informacional', 'Operacional', 'Estrategico'],
        },
        {
            label: 'Reversibilidade',
            value: governance.dim_reversibility,
            options: ['Totalmente', 'Parcialmente', 'Irreversivel'],
        },
    ];

    const headerRow = new D.TableRow({
        children: ['Dimensao', 'Nivel', 'Descricao'].map(
            (h) =>
                new D.TableCell({
                    children: [new D.Paragraph({ children: [_bold(D, h)], spacing: { after: 40 } })],
                    shading: { fill: 'E8E8E8' },
                }),
        ),
    });

    const dataRows = dims.map(
        (d) =>
            new D.TableRow({
                children: [d.label, String(d.value || 1), d.options[(d.value || 1) - 1] || '\u2014'].map(
                    (text) =>
                        new D.TableCell({
                            children: [new D.Paragraph({ children: [_normal(D, text)], spacing: { after: 40 } })],
                        }),
                ),
            }),
    );

    return [
        _heading(D, 'ANEXO I-A: PERFIL DE GOVERNANCA IA'),
        _para(D, _normal(D, `Tier de governanca: ${tierLabels[tier]} (Score: ${score}/18)`)),
        new D.Table({ rows: [headerRow, ...dataRows], width: { size: 100, type: D.WidthType.PERCENTAGE } }),
    ];
}

// ---------------------------------------------------------------------------
// ECO1 Annex
// ---------------------------------------------------------------------------

function _buildECO1Annex(D, eco1Meta) {
    if (!eco1Meta || !eco1Meta.hash) return [];

    const meta = eco1Meta;
    const lines = [
        { label: 'Model ID', value: meta.modelId || '—' },
        { label: 'Hash SHA-256', value: meta.hash || '—' },
        { label: 'Elementos', value: String(meta.elementCount || 0) },
        { label: 'Familias', value: meta.familySummary || '—' },
        { label: 'Campanhas', value: String(meta.campaignCount || 0) },
        { label: 'Cenas', value: String(meta.sceneCount || 0) },
        { label: 'Exportado em', value: meta.exportedAt || new Date().toISOString() },
    ];

    const rows = lines.map(
        ({ label, value }) =>
            new D.Paragraph({
                children: [
                    new D.TextRun({ text: `${label}:`, bold: true, size: 22 }),
                    new D.TextRun({ text: `  ${value}`, size: 22 }),
                ],
                spacing: { after: 60 },
            }),
    );

    return [
        _heading(D, 'ANEXO: MODELO AMBIENTAL DE REFERENCIA'),
        _para(
            D,
            _normal(
                D,
                'Os metadados abaixo identificam de forma unica o modelo ambiental de referencia vinculado a esta proposta. O hash SHA-256 garante integridade: qualquer alteracao no modelo gera um hash diferente.',
            ),
        ),
        _para(D, _normal(D, '')),
        ...rows,
        _para(D, _normal(D, '')),
        _para(
            D,
            _italic(
                D,
                'Para verificar integridade, importe a chave ECO1 em ecbyts.com e compare o hash SHA-256 acima com o gerado pela plataforma.',
            ),
        ),
    ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function _buildProductDocument(product, pricing, scopeItems, governance, clauses, eco1Meta) {
    await _loadDocx();
    const D = window.docx;

    const sanitizedPayload = sanitizeDocxXmlData({
        product: product || {},
        pricing: pricing || {},
        scopeItems: Array.isArray(scopeItems) ? scopeItems : [],
        governance: governance || null,
        clauses: Array.isArray(clauses) ? clauses : [],
        eco1Meta: eco1Meta || null,
    });
    const payload = sanitizedPayload.value || {};
    const safeProduct = payload.product || {};
    const safePricing = payload.pricing || {};
    const safeScopeItems = payload.scopeItems || [];
    const safeGovernance = payload.governance || null;
    const safeClauses = payload.clauses || [];
    const safeEco1Meta = payload.eco1Meta || null;

    const clauseMap = new Map();
    for (const c of safeClauses) {
        clauseMap.set(c.clause_key, c);
    }

    const p = safePricing;
    const scope = safeScopeItems;

    const renderers = {
        preamble: () => _renderPreamble(D, safeProduct),
        object: (num) => _renderObject(D, safeProduct, num),
        scope: (num) => _renderScope(D, scope, num),
        term: (num) => _renderTerm(D, p, num),
        remuneration: (num) => _renderRemuneration(D, p, num),
        warranty_acceptance: (num) => _renderWarrantyAcceptance(D, p, num),
        ip: (num) => _renderIP(D, p, num),
        confidentiality: (num) => _renderConfidentiality(D, num),
        lgpd: (num) => _renderLGPD(D, num),
        jurisdiction: (num) => _renderJurisdiction(D, num),
    };

    // Build document sections
    const docChildren = [];
    let clauseNum = 0;

    for (const key of CLAUSE_ORDER) {
        const config = clauseMap.get(key);
        if (config && !config.enabled && !REQUIRED_CLAUSES.has(key)) continue;
        if (!renderers[key]) continue;

        clauseNum++;

        if (config?.custom_text) {
            docChildren.push(_heading(D, `${clauseNum}. ${key.toUpperCase()}`));
            for (const line of config.custom_text.split('\n')) {
                docChildren.push(
                    new D.Paragraph({
                        children: [_normal(D, line)],
                        spacing: { after: 80 },
                    }),
                );
            }
        } else {
            const paragraphs = renderers[key](clauseNum);
            docChildren.push(...paragraphs);
        }
    }

    // AI Governance Annex
    if (safeProduct.ai_enabled && safeGovernance) {
        docChildren.push(..._buildGovernanceAnnex(D, safeGovernance));
    }

    // ECO1 Reference Model Annex (hash + metadata only)
    if (safeEco1Meta) {
        docChildren.push(..._buildECO1Annex(D, safeEco1Meta));
    }

    // Disclaimer header/footer (IMMUTABLE — spec v2.2 §5.3)
    const disclaimerHeader = new D.Header({
        children: [
            new D.Paragraph({
                alignment: D.AlignmentType.CENTER,
                children: [
                    new D.TextRun({
                        text: PLATFORM_DISCLAIMER.header,
                        size: 16,
                        color: '999999',
                        italics: true,
                    }),
                ],
            }),
        ],
    });

    const disclaimerFooter = new D.Footer({
        children: [
            new D.Paragraph({
                alignment: D.AlignmentType.CENTER,
                children: [
                    new D.TextRun({
                        text: PLATFORM_DISCLAIMER.footer,
                        size: 14,
                        color: '999999',
                        italics: true,
                    }),
                ],
            }),
        ],
    });

    // Create document
    const doc = new D.Document({
        sections: [
            {
                properties: {
                    page: {
                        margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
                        size: { width: 12240, height: 15840 },
                    },
                },
                headers: { default: disclaimerHeader },
                footers: { default: disclaimerFooter },
                children: docChildren,
            },
        ],
    });

    return {
        blob: await D.Packer.toBlob(doc),
        removedInvalidChars: sanitizedPayload.removedInvalidChars,
        hadInvalidChars: sanitizedPayload.hadInvalidChars,
        product: safeProduct,
    };
}

export async function generateProductDocument(product, pricing, scopeItems, governance, clauses, eco1Meta) {
    const result = await _buildProductDocument(product, pricing, scopeItems, governance, clauses, eco1Meta);
    return result.blob;
}

export async function downloadProductDocument(product, pricing, scopeItems, governance, clauses, eco1Meta) {
    const result = await _buildProductDocument(product, pricing, scopeItems, governance, clauses, eco1Meta);
    const blob = result.blob;
    const safeProduct = result.product || {};

    const filename = `${safeProduct.slug || 'servico'}-escopo-termos-${safeProduct.version || '1.0.0'}.docx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return {
        blob,
        filename,
        removedInvalidChars: result.removedInvalidChars,
        hadInvalidChars: result.hadInvalidChars,
    };
}
