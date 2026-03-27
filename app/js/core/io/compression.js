// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Module: Compression — Wrapper para Compression Streams API nativa
// Authorship: Calvin Stefan Iost
// Copyright (c) 2026 Calvin Stefan Iost

/* ================================================================
   COMPRESSAO NATIVA DO BROWSER
   ================================================================

   Wrapper sobre a Compression Streams API (Baseline 2023).
   Usa `deflate-raw` para compressao sem headers adicionais.

   SUPORTE:
   - Chrome 80+, Firefox 113+, Safari 16.4+, Edge 80+
   - Node.js 18+ (via globals)

   PIPELINE ECO4:
   JSON → TextEncoder → compress(deflate-raw) → XOR(salt) → Base64URL
   Base64URL → XOR(salt) → decompress(deflate-raw) → TextDecoder → JSON

   DECISAO DE DESIGN:
   Usamos `deflate-raw` em vez de `gzip` porque:
   - 18 bytes menor (sem header gzip)
   - O modelo ja tem checksum proprio (CRC-32)
   - Nao precisamos de deteccao de formato (sabemos que e deflate)

   FALLBACK:
   Se CompressionStream nao existir, as funcoes retornam os dados
   sem comprimir. O encoder deve checar `isCompressionSupported()`
   e decidir se gera ECO4 ou fallback para ECO2.

   ================================================================ */

// ----------------------------------------------------------------
// DETECCAO DE SUPORTE
// ----------------------------------------------------------------

/**
 * Verifica se a Compression Streams API esta disponivel.
 *
 * @returns {boolean} - true se CompressionStream e DecompressionStream existem
 */
export function isCompressionSupported() {
    return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

// ----------------------------------------------------------------
// COMPRESSAO
// ----------------------------------------------------------------

/**
 * Comprime bytes usando deflate-raw.
 *
 * @param {Uint8Array} data - Dados a comprimir
 * @returns {Promise<Uint8Array>} - Dados comprimidos
 *
 * Se a API nao estiver disponivel, retorna os dados sem comprimir.
 */
export async function compress(data) {
    if (!isCompressionSupported()) {
        return data;
    }

    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();

    // Escreve dados e fecha o stream
    writer.write(data);
    writer.close();

    // Le todos os chunks comprimidos
    const chunks = [];
    let totalLength = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalLength += value.length;
    }

    // Concatena chunks em um unico Uint8Array
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }

    return result;
}

// ----------------------------------------------------------------
// DESCOMPRESSAO
// ----------------------------------------------------------------

/**
 * Descomprime bytes usando deflate-raw.
 *
 * @param {Uint8Array} data - Dados comprimidos
 * @returns {Promise<Uint8Array>} - Dados descomprimidos
 * @throws {Error} - Se DecompressionStream nao disponivel ou dados corrompidos
 *
 * Diferente de compress(), esta funcao NAO tem fallback silencioso.
 * Se a API nao existir, lanca erro explicito — porque sem ela,
 * e impossivel ler uma chave ECO4 comprimida.
 */
export async function decompress(data) {
    if (!isCompressionSupported()) {
        throw new Error(
            'Chave ECO4 requer browser moderno com Compression Streams API. ' +
                'Atualize para Chrome 80+, Firefox 113+, Safari 16.4+ ou Edge 80+.',
        );
    }

    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();

    // Escreve dados comprimidos e fecha
    writer.write(data);
    writer.close();

    // Le todos os chunks descomprimidos
    const chunks = [];
    let totalLength = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalLength += value.length;
    }

    // Concatena
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }

    return result;
}
