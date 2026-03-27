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
   GEOJSON FORMAT — Exportação e importação GIS
   ================================================================

   Gera FeatureCollection compatível com QGIS, geojson.io, Mapbox.
   Padrão RFC 7946 — coordenadas em WGS84 [longitude, latitude].

   MAPEAMENTO DE FAMÍLIAS:
   - Point: well, spring, marker, sample, tank, emission_source, effluent_point
   - Polygon: building, boundary, lake, plume, habitat, area
   - LineString: river

   Propriedades incluem metadados do elemento e resumo de observações.

   ================================================================ */

import { registerFormat } from './registry.js';
import { relativeToWGS84, wgs84ToRelative, getElementPosition, getOrigin, getEPSG } from '../geo/coordinates.js';
import { generateId } from '../../../utils/helpers/id.js';

// ----------------------------------------------------------------
// REGISTRO
// ----------------------------------------------------------------

registerFormat({
    id: 'geojson',
    name: 'GeoJSON',
    extensions: ['.geojson', '.json'],
    mimeType: 'application/geo+json',
    canExport: true,
    canImport: true,
    needsOrigin: true,
    exportScopes: ['elements'],
});

// ----------------------------------------------------------------
// MAPEAMENTO DE GEOMETRIA
// ----------------------------------------------------------------

const POINT_FAMILIES = new Set([
    'well',
    'spring',
    'marker',
    'sample',
    'tank',
    'emission_source',
    'effluent_point',
    'incident',
    'individual',
    'waste_stream',
    'stratum',
]);

const POLYGON_FAMILIES = new Set(['building', 'boundary', 'lake', 'plume', 'habitat', 'area', 'blueprint']);

const LINE_FAMILIES = new Set(['river']);

// ----------------------------------------------------------------
// EXPORTAÇÃO
// ----------------------------------------------------------------

/**
 * Exporta modelo como GeoJSON FeatureCollection.
 *
 * @param {Object} model - Modelo completo
 * @param {Object} [options]
 * @param {number} [options.precision=7] - Casas decimais nas coordenadas
 * @returns {Blob}
 */
export function exportGeoJSON(model, options = {}) {
    const { precision = 7 } = options;
    const origin = getOrigin();

    const features = [];

    for (const el of model.elements || []) {
        const feature = elementToFeature(el, precision);
        if (feature) {
            features.push(feature);
        }
    }

    const fc = {
        type: 'FeatureCollection',
        name: model.project?.name || 'ecbyts Export',
        crs: {
            type: 'name',
            properties: {
                name: `urn:ogc:def:crs:EPSG::4326`,
            },
        },
        metadata: {
            exported: new Date().toISOString(),
            source: 'ecbyts',
            version: model.ecbyts || '2.0.0',
            utmOrigin: {
                easting: origin.easting,
                northing: origin.northing,
                elevation: origin.elevation,
                zone: origin.zone,
                hemisphere: origin.hemisphere,
                epsg: getEPSG(origin.zone, origin.hemisphere),
            },
        },
        features,
    };

    const json = JSON.stringify(fc, null, 2);
    return new Blob([json], { type: 'application/geo+json' });
}

/**
 * Converte um elemento para um GeoJSON Feature.
 *
 * @param {Object} el - Elemento do modelo
 * @param {number} precision - Casas decimais
 * @returns {Object|null} - Feature ou null se não mapeável
 */
function elementToFeature(el, precision) {
    const family = el.family;
    const data = el.data || {};

    let geometry = null;

    if (LINE_FAMILIES.has(family)) {
        geometry = elementToLineString(el, precision);
    } else if (POLYGON_FAMILIES.has(family)) {
        geometry = elementToPolygon(el, precision);
    } else {
        // Default: Point
        geometry = elementToPoint(el, precision);
    }

    if (!geometry) return null;

    // Propriedades — metadados do elemento
    const properties = {
        id: el.id,
        family: el.family,
        name: el.name,
        visible: el.visible !== false,
    };

    // Adiciona propriedades específicas por família
    addFamilyProperties(properties, el);

    // Adiciona resumo de observações
    addObservationSummary(properties, data.observations);

    return {
        type: 'Feature',
        geometry,
        properties,
    };
}

// ----------------------------------------------------------------
// GEOMETRIAS
// ----------------------------------------------------------------

function elementToPoint(el, prec) {
    const pos = getElementPosition(el);
    const wgs = relativeToWGS84(pos);
    return {
        type: 'Point',
        coordinates: [round(wgs.longitude, prec), round(wgs.latitude, prec)],
    };
}

function elementToPolygon(el, prec) {
    const data = el.data || {};

    // Boundary: vértices explícitos
    if (data.vertices && data.vertices.length >= 3) {
        const coords = data.vertices.map((v) => {
            const wgs = relativeToWGS84(v);
            return [round(wgs.longitude, prec), round(wgs.latitude, prec)];
        });
        // Fechar o anel
        coords.push(coords[0]);
        return { type: 'Polygon', coordinates: [coords] };
    }

    // Building: retângulo a partir de posição + footprint
    if (data.footprint && data.position) {
        const p = data.position;
        const hw = (data.footprint.width || 10) / 2;
        const hl = (data.footprint.length || 10) / 2;
        const corners = [
            { x: p.x - hw, y: p.y, z: p.z - hl },
            { x: p.x + hw, y: p.y, z: p.z - hl },
            { x: p.x + hw, y: p.y, z: p.z + hl },
            { x: p.x - hw, y: p.y, z: p.z + hl },
        ];
        const coords = corners.map((c) => {
            const wgs = relativeToWGS84(c);
            return [round(wgs.longitude, prec), round(wgs.latitude, prec)];
        });
        coords.push(coords[0]);
        return { type: 'Polygon', coordinates: [coords] };
    }

    // Plume/Lake/Habitat: elipse aproximada
    const pos = getElementPosition(el);
    let rx = 10,
        rz = 10;

    if (data.shape) {
        rx = data.shape.radiusX || 10;
        rz = data.shape.radiusY || data.shape.radiusZ || 10;
    }
    if (data.area) {
        rx = rz = Math.sqrt((data.area || 100) / Math.PI);
    }

    return ellipseToPolygon(pos, rx, rz, prec);
}

function elementToLineString(el, prec) {
    const data = el.data || {};
    if (!data.path || data.path.length < 2) {
        // Fallback: ponto
        return elementToPoint(el, prec);
    }

    const coords = data.path.map((p) => {
        const wgs = relativeToWGS84(p);
        return [round(wgs.longitude, prec), round(wgs.latitude, prec)];
    });

    return { type: 'LineString', coordinates: coords };
}

/**
 * Gera polígono aproximando uma elipse.
 *
 * @param {{ x: number, y: number, z: number }} center
 * @param {number} rx - Raio X (metros)
 * @param {number} rz - Raio Z (metros)
 * @param {number} prec - Precisão decimal
 * @param {number} [numPoints=32] - Número de vértices
 * @returns {Object} - GeoJSON Polygon geometry
 */
function ellipseToPolygon(center, rx, rz, prec, numPoints = 32) {
    const coords = [];
    for (let i = 0; i <= numPoints; i++) {
        const angle = (2 * Math.PI * i) / numPoints;
        const point = {
            x: center.x + rx * Math.cos(angle),
            y: center.y,
            z: center.z + rz * Math.sin(angle),
        };
        const wgs = relativeToWGS84(point);
        coords.push([round(wgs.longitude, prec), round(wgs.latitude, prec)]);
    }
    return { type: 'Polygon', coordinates: [coords] };
}

// ----------------------------------------------------------------
// PROPRIEDADES
// ----------------------------------------------------------------

function addFamilyProperties(props, el) {
    const d = el.data || {};

    switch (el.family) {
        case 'well':
            props.totalDepth = d.construction?.totalDepth;
            props.diameter = d.construction?.diameter;
            break;
        case 'plume':
            props.depthLevel = d.depth?.level;
            props.depthTop = d.depth?.top;
            props.depthBottom = d.depth?.bottom;
            break;
        case 'building':
            props.width = d.footprint?.width;
            props.length = d.footprint?.length;
            props.height = d.height;
            break;
        case 'tank':
            props.tankType = d.type;
            props.contents = d.contents;
            break;
        case 'lake':
            props.depth = d.shape?.depth;
            break;
        case 'river':
            props.width = d.width;
            break;
        case 'habitat':
            props.habitatType = d.habitatType;
            props.protectionStatus = d.protectionStatus;
            props.area = d.area;
            break;
        case 'emission_source':
            props.sourceType = d.type;
            props.sourceCategory = d.sourceCategory;
            break;
        case 'effluent_point':
            props.effluentType = d.effluentType;
            props.receivingBody = d.receivingBody;
            break;
        case 'blueprint':
            props.category = d.category;
            props.area_m2 = d.area_m2;
            props.crs_source = d.crs_source;
            props.layer_count = d.layers?.length || 0;
            break;
    }
}

function addObservationSummary(props, observations) {
    if (!observations || observations.length === 0) return;

    props.observations_count = observations.length;

    // Último valor de cada parâmetro
    const latest = {};
    for (const o of observations) {
        const paramId = o.parameterId || o.parameter || 'unknown';
        const date = o.date || '';
        if (!latest[paramId] || date >= latest[paramId].date) {
            latest[paramId] = { value: o.value ?? o.reading, date };
        }
    }

    for (const [paramId, data] of Object.entries(latest)) {
        props[`latest_${paramId}`] = data.value;
    }
}

// ----------------------------------------------------------------
// IMPORTAÇÃO
// ----------------------------------------------------------------

/**
 * Importa GeoJSON FeatureCollection como elementos.
 *
 * @param {string} jsonText - Conteúdo do arquivo GeoJSON
 * @returns {{ elements: Object[], warnings: string[] }}
 */
export function importGeoJSON(jsonText) {
    const fc = JSON.parse(jsonText);
    const warnings = [];

    if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
        throw new Error('GeoJSON deve ser FeatureCollection');
    }

    const elements = [];

    for (const feature of fc.features) {
        try {
            const el = featureToElement(feature);
            if (el) elements.push(el);
        } catch (e) {
            warnings.push(`Feature ignorada: ${e.message}`);
        }
    }

    return { elements, warnings };
}

/**
 * Converte GeoJSON Feature para elemento do modelo.
 */
function featureToElement(feature) {
    const props = feature.properties || {};
    const geom = feature.geometry;
    if (!geom) return null;

    const family = props.family || inferFamily(geom.type, props);
    const id = props.id || generateId('import');
    const name = props.name || id;

    let data = {};

    switch (geom.type) {
        case 'Point': {
            const [lon, lat] = geom.coordinates;
            const rel = wgs84ToRelative({ latitude: lat, longitude: lon });
            if (family === 'well') {
                data = {
                    coordinates: { easting: rel.x, northing: rel.z, elevation: rel.y },
                    construction: { totalDepth: props.totalDepth || 50, diameter: props.diameter || 4 },
                };
            } else {
                data = { position: rel };
            }
            break;
        }
        case 'Polygon': {
            const ring = geom.coordinates[0] || [];
            if (family === 'boundary') {
                data = {
                    vertices: ring.slice(0, -1).map(([lon, lat]) => wgs84ToRelative({ latitude: lat, longitude: lon })),
                };
            } else if (family === 'building') {
                const center = polygonCentroid(ring);
                const rel = wgs84ToRelative(center);
                data = {
                    position: rel,
                    footprint: { width: props.width || 10, length: props.length || 10 },
                    height: props.height || 5,
                };
            } else {
                const center = polygonCentroid(ring);
                data = { position: wgs84ToRelative(center) };
            }
            break;
        }
        case 'LineString': {
            data = {
                path: geom.coordinates.map(([lon, lat]) => wgs84ToRelative({ latitude: lat, longitude: lon })),
                width: props.width || 5,
            };
            break;
        }
        default:
            return null;
    }

    return {
        family,
        id,
        name,
        visible: true,
        data,
    };
}

function inferFamily(geomType, props) {
    if (props.family) return props.family;
    switch (geomType) {
        case 'Point':
            return 'marker';
        case 'Polygon':
            return 'boundary';
        case 'LineString':
            return 'river';
        default:
            return 'marker';
    }
}

function polygonCentroid(ring) {
    let latSum = 0,
        lonSum = 0;
    const n = ring.length - 1; // Exclui ponto de fechamento
    for (let i = 0; i < n; i++) {
        lonSum += ring[i][0];
        latSum += ring[i][1];
    }
    return { latitude: latSum / n, longitude: lonSum / n };
}

function round(n, prec) {
    const factor = Math.pow(10, prec);
    return Math.round(n * factor) / factor;
}
