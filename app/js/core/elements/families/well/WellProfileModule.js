// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Module: Well Family — Profile Module (SVG Renderer + Editor)
// Authorship: Calvin Stefan Iost
// Copyright (c) 2026 Calvin Stefan Iost

/* ================================================================
   WELL PROFILE MODULE — Modulo plugavel para familia 'well'.

   Renderiza perfil construtivo e litologico do poco em SVG.
   Layout 5-colunas: Descricao | Litologia | Escala | Construtivo | VOC

   Padroes litologicos baseados na norma ABGE.
   Elementos construtivos: revestimento, filtro, selo, pre-filtro.
   ================================================================ */

import { FamilyModule, SVG_NS } from '../_base/FamilyModule.js';

// ----------------------------------------------------------------
// CONSTANTS — Layout, cores, padroes
// ----------------------------------------------------------------

/** Pixels por metro de profundidade */
const PX_PER_M = 8;

/** Largura de cada coluna em pixels */
const COL = {
    desc: 90, // Descricao do solo
    litho: 50, // Padrao litologico
    scale: 30, // Escala de profundidade
    constr: 40, // Elementos construtivos
    voc: 60, // VOC readings
    gap: 4, // Espaco entre colunas
};

/** Margem superior/inferior do SVG */
const MARGIN = { top: 30, bottom: 20, left: 8, right: 8 };

/** Cores dos tipos de solo (ABGE simplificado) */
const SOIL_COLORS = {
    clay: '#C8946E',
    sand: '#F5E6B8',
    silt: '#D4C5A0',
    gravel: '#B0B0B0',
    rock: '#8C8C8C',
    sandy_clay: '#D4A87A',
    clayey_sand: '#E6D29E',
    silty_sand: '#E0D4B4',
    fill: '#A0907A',
    topsoil: '#6B4E37',
    peat: '#3D2B1F',
};

/** Labels para tipos de solo */
const SOIL_LABELS = {
    clay: 'Argila',
    sand: 'Areia',
    silt: 'Silte',
    gravel: 'Cascalho',
    rock: 'Rocha',
    sandy_clay: 'Argila arenosa',
    clayey_sand: 'Areia argilosa',
    silty_sand: 'Areia siltosa',
    fill: 'Aterro',
    topsoil: 'Solo orgânico',
    peat: 'Turfa',
};

/** Cores dos elementos construtivos */
const CONSTR_COLORS = {
    surface_completion: '#666',
    cement_seal: '#B0B0B0',
    bentonite_seal: '#7A6B5A',
    blank_casing: '#4A90D9',
    screen: '#4A90D9',
    gravel_pack: '#C8C0A8',
    sump: '#4A90D9',
};

/** Labels dos elementos construtivos */
const CONSTR_LABELS = {
    surface_completion: 'Base',
    cement_seal: 'Selo cimento',
    bentonite_seal: 'Bentonita',
    blank_casing: 'Rev. liso',
    screen: 'Filtro',
    gravel_pack: 'Pre-filtro',
    sump: 'Fundo',
};

// ----------------------------------------------------------------
// MODULE CLASS
// ----------------------------------------------------------------

/**
 * Modulo de perfil construtivo e litologico para pocos de monitoramento.
 * Renderiza SVG com 5 colunas: Desc | Litologia | Escala | Construtivo | VOC.
 */
export default class WellProfileModule extends FamilyModule {
    _getFamilyId() {
        return 'well';
    }

    /**
     * Monta o visualizador de perfil no container DOM.
     */
    async mount(container, element, options = {}) {
        await super.mount(container, element, options);

        // Migra dados legados se necessario
        if (element.data?.lithology && !element.data?.profile) {
            const migrated = this.migrateData(element.data);
            if (migrated) element.data.profile = migrated;
        }

        this._container.classList.add('ecbt-fm-well');
        this._render();
    }

    /**
     * Atualiza visualizacao com novos dados.
     */
    update(element) {
        super.update(element);
        if (this._mounted) this._render();
    }

    /**
     * Desmonta modulo.
     */
    unmount() {
        super.unmount();
    }

    /**
     * Dados padrao para um novo poco.
     */
    getDefaultData() {
        return {
            constructive: {
                totalDepth: 50,
                drillingDepth: 50,
                boreholeDiameter: 10,
                casingDiameter: 4,
                drillingMethod: 'hollow_stem_auger',
                elements: [],
            },
            lithologic: [],
            waterLevel: null,
            vocReadings: [],
        };
    }

    /**
     * Valida dados do perfil.
     */
    validate(profileData) {
        const errors = [];
        const c = profileData?.constructive;
        if (c && c.totalDepth > c.drillingDepth) {
            errors.push('Well depth cannot exceed drilling depth');
        }
        const layers = profileData?.lithologic || [];
        if (layers.length > 0) {
            const sorted = [...layers].sort((a, b) => a.from - b.from);
            for (let i = 0; i < sorted.length - 1; i++) {
                const gap = sorted[i + 1].from - sorted[i].to;
                if (Math.abs(gap) > 0.01) {
                    errors.push(`Gap/overlap between layers at ${sorted[i].to}m`);
                }
            }
        }
        return { valid: errors.length === 0, errors };
    }

    /**
     * Exporta SVG do perfil como string.
     */
    exportSVG() {
        const svg = this._container?.querySelector('.ecbt-fm-well__viewer svg');
        return svg ? svg.outerHTML : null;
    }

    /**
     * Migra dados legados para formato profile.
     */
    migrateData(oldData) {
        if (!oldData?.lithology && !oldData?.waterLevels) return null;
        return {
            constructive: {
                totalDepth: oldData.construction?.totalDepth || 50,
                drillingDepth: oldData.construction?.totalDepth || 50,
                boreholeDiameter: 10,
                casingDiameter: oldData.construction?.diameter || 4,
                drillingMethod: 'hollow_stem_auger',
                elements: [],
            },
            lithologic: (oldData.lithology || []).map((layer) => ({
                from: layer.from,
                to: layer.to,
                soilType: null,
                description: layer.description || '',
                classification: layer.classification || '',
                color: '',
                moisture: '',
                observations: '',
            })),
            waterLevel: oldData.waterLevels?.[0]
                ? { depth: oldData.waterLevels[0].depth, date: oldData.waterLevels[0].date }
                : null,
            vocReadings: [],
        };
    }

    /**
     * CSS do modulo.
     */
    getStyles() {
        return `
.ecbt-fm-well { padding: 8px 0; }
.ecbt-fm-well__header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 4px 0 8px; border-bottom: 1px solid var(--neutral-700, #444); margin-bottom: 8px;
}
.ecbt-fm-well__title { font-size: 12px; font-weight: 600; color: var(--neutral-200, #ccc); }
.ecbt-fm-well__actions { display: flex; gap: 4px; }
.ecbt-fm-well__viewer {
    overflow: auto; border: 1px solid var(--neutral-700, #444);
    border-radius: var(--radius-sm, 4px); background: #fff; padding: 4px;
    min-height: 120px;
}
.ecbt-fm-well__svg { display: block; }
.ecbt-fm-well__placeholder {
    color: var(--neutral-500, #888); font-size: 11px; text-align: center; padding: 24px 8px;
}
.ecbt-fm-well__legend {
    display: flex; flex-wrap: wrap; gap: 6px 12px; padding: 6px 0;
    border-top: 1px solid var(--neutral-700, #444); margin-top: 6px;
}
.ecbt-fm-well__legend-item {
    display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--neutral-300, #aaa);
}
.ecbt-fm-well__legend-swatch {
    width: 14px; height: 10px; border: 1px solid #666; border-radius: 1px;
}`;
    }

    // ----------------------------------------------------------------
    // PRIVATE — SVG Rendering
    // ----------------------------------------------------------------

    /**
     * Renderiza header + SVG ou placeholder.
     */
    _render() {
        if (!this._container) return;

        const profile = this._element?.data?.profile;
        const depth = this._element?.data?.construction?.totalDepth || profile?.constructive?.totalDepth || 50;

        this._container.innerHTML = `
            <div class="ecbt-fm-well__header">
                <span class="ecbt-fm-well__title">Well Profile &#8212; ${this._element?.name || ''}</span>
                <div class="ecbt-fm-well__actions">
                    <button class="btn btn-sm btn-secondary ecbt-fm-well__btn-edit" title="Edit profile">
                        Edit
                    </button>
                    <button class="btn btn-sm btn-secondary ecbt-fm-well__btn-export" title="Export SVG">
                        SVG
                    </button>
                </div>
            </div>
            <div class="ecbt-fm-well__viewer"></div>
            <div class="ecbt-fm-well__editor" style="display:none;"></div>
        `;

        const viewer = this._container.querySelector('.ecbt-fm-well__viewer');

        if (profile && (profile.lithologic?.length > 0 || profile.constructive?.elements?.length > 0)) {
            const svg = this._buildSVG(profile, depth);
            viewer.appendChild(svg);
            this._addLegend(profile);
        } else {
            viewer.innerHTML = `<p class="ecbt-fm-well__placeholder">
                No profile data.<br>Depth: ${depth}m
            </p>`;
        }

        // Wire export button
        const exportBtn = this._container.querySelector('.ecbt-fm-well__btn-export');
        if (exportBtn) {
            this._listen(exportBtn, 'click', () => this._handleExport());
        }

        // Wire edit button
        const editBtn = this._container.querySelector('.ecbt-fm-well__btn-edit');
        if (editBtn) {
            this._listen(editBtn, 'click', () => this._toggleEditor());
        }
    }

    /**
     * Constroi o SVG completo do perfil.
     * Layout: [Desc | Litho | Scale | Constr | VOC]
     *
     * @param {Object} profile - element.data.profile
     * @param {number} totalDepth - Profundidade total em metros
     * @returns {SVGElement}
     */
    _buildSVG(profile, totalDepth) {
        const h = totalDepth * PX_PER_M;
        const totalW =
            MARGIN.left +
            COL.desc +
            COL.gap +
            COL.litho +
            COL.gap +
            COL.scale +
            COL.gap +
            COL.constr +
            COL.gap +
            COL.voc +
            MARGIN.right;
        const totalH = MARGIN.top + h + MARGIN.bottom;

        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('xmlns', SVG_NS);
        svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
        svg.setAttribute('width', totalW);
        svg.setAttribute('height', totalH);
        svg.classList.add('ecbt-fm-well__svg');

        // Background
        const bg = this._svgEl('rect', { x: 0, y: 0, width: totalW, height: totalH, fill: '#fff' });
        svg.appendChild(bg);

        // Defs (patterns)
        svg.appendChild(this._buildDefs());

        // Posicoes X de cada coluna
        const x = {
            desc: MARGIN.left,
            litho: MARGIN.left + COL.desc + COL.gap,
            scale: MARGIN.left + COL.desc + COL.gap + COL.litho + COL.gap,
            constr: MARGIN.left + COL.desc + COL.gap + COL.litho + COL.gap + COL.scale + COL.gap,
            voc: MARGIN.left + COL.desc + COL.gap + COL.litho + COL.gap + COL.scale + COL.gap + COL.constr + COL.gap,
        };

        // Column headers
        this._addColumnHeaders(svg, x);

        // Depth scale (center column)
        this._addDepthScale(svg, x.scale, totalDepth, h);

        // Lithologic layers
        if (profile.lithologic?.length > 0) {
            this._addLithology(svg, x.desc, x.litho, profile.lithologic, totalDepth, h);
        }

        // Constructive elements
        if (profile.constructive?.elements?.length > 0) {
            this._addConstructive(svg, x.constr, profile.constructive, totalDepth, h);
        }

        // Water level
        if (profile.waterLevel?.depth != null) {
            this._addWaterLevel(svg, x.litho, profile.waterLevel.depth, totalDepth, h);
        }

        // VOC readings
        if (profile.vocReadings?.length > 0) {
            this._addVOCReadings(svg, x.voc, profile.vocReadings, totalDepth, h);
        }

        // Borehole outline
        this._addBoreholeOutline(svg, x.litho, x.constr + COL.constr, totalDepth, h);

        return svg;
    }

    /**
     * Cria <defs> com padroes hatch para tipos de solo.
     */
    _buildDefs() {
        const defs = document.createElementNS(SVG_NS, 'defs');

        // Padrao para cada tipo de solo
        for (const [type, color] of Object.entries(SOIL_COLORS)) {
            const pat = this._svgEl('pattern', {
                id: `soil-${type}`,
                patternUnits: 'userSpaceOnUse',
                width: 8,
                height: 8,
            });
            // Fundo com cor solida
            pat.appendChild(this._svgEl('rect', { width: 8, height: 8, fill: color }));

            // Hatch por tipo
            if (type === 'clay' || type === 'sandy_clay') {
                // Linhas horizontais (argila)
                pat.appendChild(
                    this._svgEl('line', {
                        x1: 0,
                        y1: 2,
                        x2: 8,
                        y2: 2,
                        stroke: '#000',
                        'stroke-width': 0.5,
                        'stroke-opacity': 0.3,
                    }),
                );
                pat.appendChild(
                    this._svgEl('line', {
                        x1: 0,
                        y1: 6,
                        x2: 8,
                        y2: 6,
                        stroke: '#000',
                        'stroke-width': 0.5,
                        'stroke-opacity': 0.3,
                    }),
                );
            } else if (type === 'sand' || type === 'clayey_sand' || type === 'silty_sand') {
                // Pontos (areia)
                pat.appendChild(this._svgEl('circle', { cx: 2, cy: 2, r: 0.7, fill: '#000', 'fill-opacity': 0.3 }));
                pat.appendChild(this._svgEl('circle', { cx: 6, cy: 6, r: 0.7, fill: '#000', 'fill-opacity': 0.3 }));
            } else if (type === 'silt') {
                // Tracos curtos (silte)
                pat.appendChild(
                    this._svgEl('line', {
                        x1: 1,
                        y1: 4,
                        x2: 4,
                        y2: 4,
                        stroke: '#000',
                        'stroke-width': 0.5,
                        'stroke-opacity': 0.3,
                    }),
                );
            } else if (type === 'gravel') {
                // Circulos (cascalho)
                pat.appendChild(
                    this._svgEl('circle', {
                        cx: 4,
                        cy: 4,
                        r: 2,
                        fill: 'none',
                        stroke: '#000',
                        'stroke-width': 0.5,
                        'stroke-opacity': 0.4,
                    }),
                );
            } else if (type === 'rock') {
                // Cruz diagonal (rocha)
                pat.appendChild(
                    this._svgEl('line', {
                        x1: 0,
                        y1: 0,
                        x2: 8,
                        y2: 8,
                        stroke: '#000',
                        'stroke-width': 0.5,
                        'stroke-opacity': 0.4,
                    }),
                );
                pat.appendChild(
                    this._svgEl('line', {
                        x1: 8,
                        y1: 0,
                        x2: 0,
                        y2: 8,
                        stroke: '#000',
                        'stroke-width': 0.5,
                        'stroke-opacity': 0.4,
                    }),
                );
            }

            defs.appendChild(pat);
        }

        // Padrao gravel pack (pontilhado especifico)
        const gpPat = this._svgEl('pattern', {
            id: 'constr-gravel_pack',
            patternUnits: 'userSpaceOnUse',
            width: 6,
            height: 6,
        });
        gpPat.appendChild(this._svgEl('rect', { width: 6, height: 6, fill: CONSTR_COLORS.gravel_pack }));
        gpPat.appendChild(this._svgEl('circle', { cx: 2, cy: 2, r: 1, fill: '#8A8070' }));
        gpPat.appendChild(this._svgEl('circle', { cx: 5, cy: 5, r: 0.8, fill: '#8A8070' }));
        defs.appendChild(gpPat);

        // Padrao screen (linhas horizontais = ranhuras)
        const scPat = this._svgEl('pattern', {
            id: 'constr-screen',
            patternUnits: 'userSpaceOnUse',
            width: 10,
            height: 4,
        });
        scPat.appendChild(this._svgEl('rect', { width: 10, height: 4, fill: CONSTR_COLORS.screen }));
        scPat.appendChild(this._svgEl('line', { x1: 0, y1: 2, x2: 10, y2: 2, stroke: '#fff', 'stroke-width': 1.5 }));
        defs.appendChild(scPat);

        return defs;
    }

    /**
     * Adiciona headers de cada coluna.
     */
    _addColumnHeaders(svg, x) {
        const y = MARGIN.top - 8;
        const style = 'font-size:7px;font-weight:600;fill:#666;text-anchor:middle;font-family:sans-serif;';
        svg.appendChild(this._svgText(x.desc + COL.desc / 2, y, 'DESCR.', style));
        svg.appendChild(this._svgText(x.litho + COL.litho / 2, y, 'LITOL.', style));
        svg.appendChild(this._svgText(x.scale + COL.scale / 2, y, 'PROF.', style));
        svg.appendChild(this._svgText(x.constr + COL.constr / 2, y, 'CONSTR.', style));
        svg.appendChild(this._svgText(x.voc + COL.voc / 2, y, 'VOC (ppm)', style));
    }

    /**
     * Adiciona escala de profundidade (eixo central com marcas a cada metro).
     */
    _addDepthScale(svg, xStart, totalDepth, h) {
        const xCenter = xStart + COL.scale / 2;
        const yStart = MARGIN.top;

        // Eixo vertical
        svg.appendChild(
            this._svgEl('line', {
                x1: xCenter,
                y1: yStart,
                x2: xCenter,
                y2: yStart + h,
                stroke: '#333',
                'stroke-width': 1,
            }),
        );

        // Marcas a cada N metros (auto-escala)
        const step = totalDepth <= 20 ? 1 : totalDepth <= 50 ? 5 : 10;
        for (let d = 0; d <= totalDepth; d += step) {
            const y = yStart + d * PX_PER_M;
            // Tick mark
            svg.appendChild(
                this._svgEl('line', {
                    x1: xCenter - 4,
                    y1: y,
                    x2: xCenter + 4,
                    y2: y,
                    stroke: '#333',
                    'stroke-width': 0.5,
                }),
            );
            // Label
            svg.appendChild(
                this._svgText(
                    xCenter + 12,
                    y + 3,
                    `${d}`,
                    'font-size:7px;fill:#333;text-anchor:end;font-family:sans-serif;',
                ),
            );
        }
    }

    /**
     * Adiciona camadas litologicas (coluna descricao + coluna pattern).
     */
    _addLithology(svg, xDesc, xLitho, layers, totalDepth, h) {
        const yStart = MARGIN.top;

        for (const layer of layers) {
            const y1 = yStart + layer.from * PX_PER_M;
            const y2 = yStart + layer.to * PX_PER_M;
            const layerH = y2 - y1;
            if (layerH <= 0) continue;

            const soilType = layer.soilType || 'clay';
            const patternId = SOIL_COLORS[soilType] ? `soil-${soilType}` : 'soil-clay';

            // Retangulo com padrao litologico
            svg.appendChild(
                this._svgEl('rect', {
                    x: xLitho,
                    y: y1,
                    width: COL.litho,
                    height: layerH,
                    fill: `url(#${patternId})`,
                    stroke: '#999',
                    'stroke-width': 0.5,
                }),
            );

            // Descricao do solo (coluna esquerda)
            const label = SOIL_LABELS[soilType] || soilType;
            const midY = y1 + layerH / 2;
            if (layerH > 10) {
                svg.appendChild(
                    this._svgText(
                        xDesc + COL.desc - 4,
                        midY + 3,
                        label,
                        'font-size:7px;fill:#333;text-anchor:end;font-family:sans-serif;',
                    ),
                );
            }

            // Profundidade no limite inferior
            svg.appendChild(
                this._svgText(
                    xDesc + COL.desc - 4,
                    y2 + 3,
                    `${layer.to}m`,
                    'font-size:6px;fill:#999;text-anchor:end;font-family:sans-serif;',
                ),
            );

            // Linha de separacao horizontal
            svg.appendChild(
                this._svgEl('line', {
                    x1: xDesc,
                    y1: y2,
                    x2: xLitho + COL.litho,
                    y2: y2,
                    stroke: '#aaa',
                    'stroke-width': 0.3,
                    'stroke-dasharray': '2,1',
                }),
            );
        }
    }

    /**
     * Adiciona elementos construtivos (coluna direita do eixo de profundidade).
     */
    _addConstructive(svg, xConstr, constructive, totalDepth, h) {
        const yStart = MARGIN.top;
        const elements = constructive.elements || [];

        for (const el of elements) {
            const y1 = yStart + el.topDepth * PX_PER_M;
            const y2 = yStart + el.bottomDepth * PX_PER_M;
            const elH = y2 - y1;
            if (elH <= 0) continue;

            let fill = CONSTR_COLORS[el.type] || '#999';
            const extraAttrs = {};

            // Usa padroes especiais para screen e gravel_pack
            if (el.type === 'screen') {
                fill = 'url(#constr-screen)';
            } else if (el.type === 'gravel_pack') {
                fill = 'url(#constr-gravel_pack)';
            }

            // Largura variavel por tipo
            let w = COL.constr;
            let xOff = 0;
            if (el.type === 'gravel_pack') {
                // Pre-filtro: coluna inteira
                w = COL.constr;
            } else if (el.type === 'blank_casing' || el.type === 'screen' || el.type === 'sump') {
                // Revestimento: mais estreito, centralizado
                w = COL.constr * 0.5;
                xOff = (COL.constr - w) / 2;
            } else if (el.type === 'cement_seal' || el.type === 'bentonite_seal') {
                // Selos: largura media
                w = COL.constr * 0.75;
                xOff = (COL.constr - w) / 2;
            } else if (el.type === 'surface_completion') {
                w = COL.constr;
            }

            svg.appendChild(
                this._svgEl('rect', {
                    x: xConstr + xOff,
                    y: y1,
                    width: w,
                    height: elH,
                    fill,
                    stroke: '#666',
                    'stroke-width': 0.5,
                    ...extraAttrs,
                }),
            );
        }
    }

    /**
     * Adiciona indicador de nivel d'agua (linha azul tracejada).
     */
    _addWaterLevel(svg, xStart, wlDepth, totalDepth, h) {
        const y = MARGIN.top + wlDepth * PX_PER_M;
        const xEnd = xStart + COL.litho + COL.gap + COL.scale + COL.gap + COL.constr;

        // Linha tracejada azul
        svg.appendChild(
            this._svgEl('line', {
                x1: xStart,
                y1: y,
                x2: xEnd,
                y2: y,
                stroke: '#1E90FF',
                'stroke-width': 1.5,
                'stroke-dasharray': '6,3',
            }),
        );

        // Triangulo (simbolo NA)
        const triSize = 5;
        svg.appendChild(
            this._svgEl('polygon', {
                points: `${xStart - 2},${y} ${xStart - 2 - triSize},${y - triSize} ${xStart - 2 - triSize},${y + triSize}`,
                fill: '#1E90FF',
            }),
        );

        // Label
        svg.appendChild(
            this._svgText(
                xStart - triSize - 6,
                y + 3,
                `NA ${wlDepth.toFixed(1)}m`,
                'font-size:6px;fill:#1E90FF;text-anchor:end;font-family:sans-serif;font-weight:600;',
            ),
        );
    }

    /**
     * Adiciona leituras VOC (barras horizontais).
     */
    _addVOCReadings(svg, xVoc, readings, totalDepth, h) {
        if (readings.length === 0) return;

        const maxVOC = Math.max(...readings.map((r) => r.value), 1);
        const barMaxW = COL.voc - 10;
        const yStart = MARGIN.top;

        // Eixo VOC
        svg.appendChild(
            this._svgEl('line', {
                x1: xVoc,
                y1: yStart,
                x2: xVoc,
                y2: yStart + h,
                stroke: '#ddd',
                'stroke-width': 0.5,
            }),
        );

        for (const reading of readings) {
            const y = yStart + reading.depth * PX_PER_M;
            const barW = (reading.value / maxVOC) * barMaxW;

            // Barra
            svg.appendChild(
                this._svgEl('rect', {
                    x: xVoc + 2,
                    y: y - 2,
                    width: barW,
                    height: 4,
                    fill: reading.value > 100 ? '#e74c3c' : '#f39c12',
                    rx: 1,
                }),
            );

            // Valor
            svg.appendChild(
                this._svgText(
                    xVoc + barW + 6,
                    y + 2,
                    `${reading.value}`,
                    'font-size:6px;fill:#666;font-family:sans-serif;',
                ),
            );
        }

        // Max label
        svg.appendChild(
            this._svgText(
                xVoc + COL.voc,
                yStart - 2,
                `max: ${maxVOC.toFixed(0)}`,
                'font-size:5px;fill:#999;text-anchor:end;font-family:sans-serif;',
            ),
        );
    }

    /**
     * Adiciona outline externo do furo (borda do perfil).
     */
    _addBoreholeOutline(svg, x1, x2, totalDepth, h) {
        const yStart = MARGIN.top;
        const yEnd = yStart + h;

        // Retangulo pontilhado ao redor da area litho+scale+constr
        svg.appendChild(
            this._svgEl('rect', {
                x: x1,
                y: yStart,
                width: x2 - x1,
                height: h,
                fill: 'none',
                stroke: '#333',
                'stroke-width': 0.75,
            }),
        );

        // Superficie (linha dupla no topo)
        svg.appendChild(
            this._svgEl('line', {
                x1: x1 - 10,
                y1: yStart,
                x2: x2 + 10,
                y2: yStart,
                stroke: '#333',
                'stroke-width': 2,
            }),
        );

        // Hachurado de superficie (terra)
        for (let i = 0; i < 6; i++) {
            const xh = x1 - 10 + i * 8;
            svg.appendChild(
                this._svgEl('line', {
                    x1: xh,
                    y1: yStart,
                    x2: xh - 4,
                    y2: yStart - 5,
                    stroke: '#666',
                    'stroke-width': 0.5,
                }),
            );
        }
    }

    /**
     * Adiciona legenda abaixo do SVG.
     */
    _addLegend(profile) {
        const legend = document.createElement('div');
        legend.className = 'ecbt-fm-well__legend';

        // Tipos de solo usados
        const usedSoils = new Set((profile.lithologic || []).map((l) => l.soilType).filter(Boolean));

        for (const type of usedSoils) {
            const item = document.createElement('div');
            item.className = 'ecbt-fm-well__legend-item';
            item.innerHTML = `
                <span class="ecbt-fm-well__legend-swatch" style="background:${SOIL_COLORS[type] || '#ccc'}"></span>
                ${SOIL_LABELS[type] || type}
            `;
            legend.appendChild(item);
        }

        // Water level
        if (profile.waterLevel?.depth != null) {
            const wlItem = document.createElement('div');
            wlItem.className = 'ecbt-fm-well__legend-item';
            wlItem.innerHTML = `
                <span class="ecbt-fm-well__legend-swatch" style="background:#1E90FF"></span>
                NA (${profile.waterLevel.depth.toFixed(1)}m)
            `;
            legend.appendChild(wlItem);
        }

        this._container.appendChild(legend);
    }

    // ----------------------------------------------------------------
    // PRIVATE — SVG Helpers
    // ----------------------------------------------------------------

    /**
     * Cria elemento SVG com atributos.
     */
    _svgEl(tag, attrs = {}) {
        const el = document.createElementNS(SVG_NS, tag);
        for (const [k, v] of Object.entries(attrs)) {
            el.setAttribute(k, String(v));
        }
        return el;
    }

    /**
     * Cria elemento <text> SVG.
     */
    _svgText(x, y, text, style = '') {
        const el = document.createElementNS(SVG_NS, 'text');
        el.setAttribute('x', x);
        el.setAttribute('y', y);
        if (style) el.setAttribute('style', style);
        el.textContent = text;
        return el;
    }

    // ----------------------------------------------------------------
    // EDITOR — Inline editing of lithologic and constructive layers
    // ----------------------------------------------------------------

    _toggleEditor() {
        const editorEl = this._container?.querySelector('.ecbt-fm-well__editor');
        if (!editorEl) return;
        const isVisible = editorEl.style.display !== 'none';
        if (isVisible) {
            editorEl.style.display = 'none';
        } else {
            this._renderEditor(editorEl);
            editorEl.style.display = '';
        }
    }

    _renderEditor(editorEl) {
        const profile = this._element?.data?.profile || this.getDefaultData();
        const depth = this._element?.data?.construction?.totalDepth || profile?.constructive?.totalDepth || 50;
        const lithoLayers = profile.lithologic || [];
        const constrElements = profile.constructive?.elements || [];

        const soilOptions = Object.entries(SOIL_LABELS)
            .map(([k, v]) => `<option value="${k}">${v}</option>`)
            .join('');
        const constrOptions = Object.entries(CONSTR_LABELS)
            .map(([k, v]) => `<option value="${k}">${v}</option>`)
            .join('');

        editorEl.innerHTML = `
            <div style="padding:8px;font-size:11px;border-top:1px solid var(--neutral-200,#e5e7eb);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <strong>Lithologic Layers (${lithoLayers.length})</strong>
                    <button class="btn btn-sm btn-secondary ecbt-fm-well__add-litho">+ Layer</button>
                </div>
                <table style="width:100%;font-size:10px;border-collapse:collapse;">
                    <thead><tr style="background:var(--neutral-100,#f5f5f5);">
                        <th style="padding:2px 4px;text-align:left;">From (m)</th>
                        <th style="padding:2px 4px;text-align:left;">To (m)</th>
                        <th style="padding:2px 4px;text-align:left;">Soil Type</th>
                        <th style="padding:2px 4px;text-align:left;">Description</th>
                        <th></th>
                    </tr></thead>
                    <tbody class="ecbt-fm-well__litho-rows">
                        ${lithoLayers
                            .map(
                                (l, i) => `
                        <tr data-idx="${i}">
                            <td><input type="number" value="${l.from}" step="0.5" style="width:50px;font-size:10px;" data-field="from"></td>
                            <td><input type="number" value="${l.to}" step="0.5" style="width:50px;font-size:10px;" data-field="to"></td>
                            <td><select style="font-size:10px;" data-field="type">${Object.entries(SOIL_LABELS)
                                .map(([k, v]) => `<option value="${k}" ${l.type === k ? 'selected' : ''}>${v}</option>`)
                                .join('')}</select></td>
                            <td><input type="text" value="${l.description || ''}" style="width:80px;font-size:10px;" data-field="description"></td>
                            <td><button class="ecbt-fm-well__del-litho" data-idx="${i}" style="cursor:pointer;color:var(--error,red);border:none;background:none;">&#10005;</button></td>
                        </tr>`,
                            )
                            .join('')}
                    </tbody>
                </table>

                <div style="display:flex;justify-content:space-between;align-items:center;margin:12px 0 8px;">
                    <strong>Constructive Elements (${constrElements.length})</strong>
                    <button class="btn btn-sm btn-secondary ecbt-fm-well__add-constr">+ Element</button>
                </div>
                <table style="width:100%;font-size:10px;border-collapse:collapse;">
                    <thead><tr style="background:var(--neutral-100,#f5f5f5);">
                        <th style="padding:2px 4px;text-align:left;">From (m)</th>
                        <th style="padding:2px 4px;text-align:left;">To (m)</th>
                        <th style="padding:2px 4px;text-align:left;">Type</th>
                        <th></th>
                    </tr></thead>
                    <tbody class="ecbt-fm-well__constr-rows">
                        ${constrElements
                            .map(
                                (c, i) => `
                        <tr data-idx="${i}">
                            <td><input type="number" value="${c.from}" step="0.5" style="width:50px;font-size:10px;" data-field="from"></td>
                            <td><input type="number" value="${c.to}" step="0.5" style="width:50px;font-size:10px;" data-field="to"></td>
                            <td><select style="font-size:10px;" data-field="type">${Object.entries(CONSTR_LABELS)
                                .map(([k, v]) => `<option value="${k}" ${c.type === k ? 'selected' : ''}>${v}</option>`)
                                .join('')}</select></td>
                            <td><button class="ecbt-fm-well__del-constr" data-idx="${i}" style="cursor:pointer;color:var(--error,red);border:none;background:none;">&#10005;</button></td>
                        </tr>`,
                            )
                            .join('')}
                    </tbody>
                </table>

                <div style="margin-top:8px;text-align:right;">
                    <button class="btn btn-sm btn-primary ecbt-fm-well__save-profile">Save Profile</button>
                </div>
            </div>
        `;

        // Wire events
        editorEl.querySelector('.ecbt-fm-well__add-litho')?.addEventListener('click', () => {
            const lastTo = lithoLayers.length > 0 ? lithoLayers[lithoLayers.length - 1].to : 0;
            this._addLithoLayer({ from: lastTo, to: lastTo + 5, type: 'clay', description: '' });
        });

        editorEl.querySelector('.ecbt-fm-well__add-constr')?.addEventListener('click', () => {
            const lastTo = constrElements.length > 0 ? constrElements[constrElements.length - 1].to : 0;
            this._addConstrElement({ from: lastTo, to: lastTo + 5, type: 'blank_casing' });
        });

        editorEl.querySelectorAll('.ecbt-fm-well__del-litho').forEach((btn) => {
            btn.addEventListener('click', () => this._removeLithoLayer(parseInt(btn.dataset.idx)));
        });

        editorEl.querySelectorAll('.ecbt-fm-well__del-constr').forEach((btn) => {
            btn.addEventListener('click', () => this._removeConstrElement(parseInt(btn.dataset.idx)));
        });

        editorEl.querySelector('.ecbt-fm-well__save-profile')?.addEventListener('click', () => {
            this._saveEditorState(editorEl);
        });
    }

    _ensureProfile() {
        if (!this._element?.data) return;
        if (!this._element.data.profile) {
            this._element.data.profile = this.getDefaultData();
        }
    }

    _addLithoLayer(layer) {
        this._ensureProfile();
        if (!this._element.data.profile.lithologic) this._element.data.profile.lithologic = [];
        this._element.data.profile.lithologic.push(layer);
        this._render();
        this._toggleEditor(); // Re-open editor
    }

    _removeLithoLayer(idx) {
        this._ensureProfile();
        this._element.data.profile.lithologic?.splice(idx, 1);
        this._render();
        this._toggleEditor();
    }

    _addConstrElement(elem) {
        this._ensureProfile();
        if (!this._element.data.profile.constructive) {
            this._element.data.profile.constructive = { totalDepth: 50, elements: [] };
        }
        if (!this._element.data.profile.constructive.elements) {
            this._element.data.profile.constructive.elements = [];
        }
        this._element.data.profile.constructive.elements.push(elem);
        this._render();
        this._toggleEditor();
    }

    _removeConstrElement(idx) {
        this._ensureProfile();
        this._element.data.profile.constructive?.elements?.splice(idx, 1);
        this._render();
        this._toggleEditor();
    }

    _saveEditorState(editorEl) {
        this._ensureProfile();
        const profile = this._element.data.profile;

        // Read litho rows
        const lithoRows = editorEl.querySelectorAll('.ecbt-fm-well__litho-rows tr');
        profile.lithologic = Array.from(lithoRows).map((row) => ({
            from: parseFloat(row.querySelector('[data-field="from"]')?.value) || 0,
            to: parseFloat(row.querySelector('[data-field="to"]')?.value) || 0,
            type: row.querySelector('[data-field="type"]')?.value || 'clay',
            description: row.querySelector('[data-field="description"]')?.value || '',
        }));

        // Read constr rows
        const constrRows = editorEl.querySelectorAll('.ecbt-fm-well__constr-rows tr');
        if (!profile.constructive) profile.constructive = { totalDepth: 50, elements: [] };
        profile.constructive.elements = Array.from(constrRows).map((row) => ({
            from: parseFloat(row.querySelector('[data-field="from"]')?.value) || 0,
            to: parseFloat(row.querySelector('[data-field="to"]')?.value) || 0,
            type: row.querySelector('[data-field="type"]')?.value || 'blank_casing',
        }));

        // Re-render SVG
        this._render();

        // Notify ecbyts that element changed
        try {
            const { updateElement } = window;
            if (typeof updateElement === 'function') {
                updateElement(this._element.id, { data: this._element.data });
            }
        } catch {
            /* silent */
        }

        // Update 3D mesh with new profile
        this._update3DMesh();
    }

    /**
     * Atualiza a mesh 3D do poço com os novos dados do profile.
     * Recria a representação 3D com textura litológica e elementos construtivos.
     */
    async _update3DMesh() {
        if (!this._element?.id) return;

        try {
            // Importa funções do wellProfile3D
            const { createWellProfile3D } = await import('./wellProfile3D.js');

            // Encontra a mesh 3D existente na cena
            const findMesh = () => {
                const elementsGroup = window._scene?.getObjectByName('elements');
                if (!elementsGroup) return null;
                return elementsGroup.children.find((child) => child.userData?.elementId === this._element.id);
            };

            const existingGroup = findMesh();
            if (!existingGroup) return;

            // Cria novo grupo de profile
            const newProfileGroup = createWellProfile3D(this._element);
            if (!newProfileGroup) return;

            // Preserva transformação de posição do grupo existente
            newProfileGroup.position.copy(existingGroup.position);

            // Remove filhos antigos do grupo existente (mantém o grupo pai)
            while (existingGroup.children.length > 0) {
                const child = existingGroup.children[0];
                existingGroup.remove(child);
                // Dispose recursos
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            }

            // Adiciona novos filhos
            while (newProfileGroup.children.length > 0) {
                existingGroup.add(newProfileGroup.children[0]);
            }

            // Atualiza metadata
            existingGroup.userData.profileVersion = Date.now();
            existingGroup.userData.hasProfile = true;

            // Solicita re-render da cena
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }

            console.log(`[WellProfileModule] 3D mesh updated for ${this._element.id}`);
        } catch (err) {
            console.warn('[WellProfileModule] Failed to update 3D mesh:', err);
        }
    }

    /**
     * Handler de exportacao SVG.
     */
    _handleExport() {
        const svg = this.exportSVG();
        if (!svg) return;

        // Download como arquivo
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this._element?.name || 'well-profile'}.svg`;
        a.click();
        URL.revokeObjectURL(url);
    }
}
