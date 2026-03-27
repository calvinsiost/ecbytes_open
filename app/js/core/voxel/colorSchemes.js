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
   VOXEL COLOR SCHEMES — Zone definitions and color palettes
   Esquemas de cores para zonas de voxelizacao

   Cada esquema define zonas com ID numerico, tag textual,
   label para UI e cor para renderizacao 3D.
   O ID 0 e reservado para "vazio" (acima do terreno).
   ================================================================ */

// ----------------------------------------------------------------
// GEOLOGY SCHEME — Zona vadosa vs zona saturada
// ----------------------------------------------------------------

/**
 * Zone definitions for subsurface geology.
 * Zona vadosa (acima do lencol freatico) e saturada (abaixo).
 */
export const GEOLOGY_ZONES = [
    { id: 0, tag: 'empty', label: null, color: null },
    { id: 1, tag: 'vadose', label: 'Zona Vadosa', color: '#D2691E' },
    { id: 2, tag: 'saturated', label: 'Zona Saturada', color: '#1E90FF' },
];

/**
 * Hex color values for Three.js materials.
 * Cores em hexadecimal para uso com MeshStandardMaterial.
 */
export const ZONE_COLORS = {
    vadose: 0xd2691e, // Marrom — solo nao saturado
    saturated: 0x1e90ff, // Azul — abaixo do lencol freatico
};

/**
 * Default opacity per zone.
 * Opacidade padrao — saturada um pouco mais translucida.
 */
export const ZONE_OPACITY = {
    vadose: 0.55,
    saturated: 0.65,
};
