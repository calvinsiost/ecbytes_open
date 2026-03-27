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
   HASH CHAIN - CADEIA DE HASHES
   ================================================================

   Este modulo implementa funcoes de hash e gerenciamento de cadeia
   para rastreabilidade de versoes das chaves ECO.

   CONCEITO DE BLOCKCHAIN:
   - Cada chave contem o hash da versao anterior
   - Isso cria uma "cadeia" verificavel de versoes
   - Se alguem modificar uma versao antiga, a cadeia quebra

   FLUXO:
   1. Primeira versao: prevHash = "GENESIS"
   2. Versoes seguintes: prevHash = SHA256(chaveAnterior)
   3. Para verificar: recalcular hashes e comparar

   ================================================================ */

// ----------------------------------------------------------------
// FUNCOES DE HASH
// ----------------------------------------------------------------

/**
 * Calcula hash SHA-256 de qualquer dado.
 * Usa Web Crypto API nativa do navegador.
 *
 * @param {string|Object} data - Dados para calcular hash
 * @returns {Promise<string>} - Hash em hexadecimal (64 caracteres)
 *
 * EXEMPLO:
 * await sha256("hello") -> "2cf24dba..."
 * await sha256({foo: "bar"}) -> "7a38bf81..."
 */
export async function sha256(data) {
    const encoder = new TextEncoder();
    const dataString = typeof data === 'string' ? data : JSON.stringify(data);
    const dataBuffer = encoder.encode(dataString);

    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);

    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Converte hash hexadecimal para Base64URL truncado.
 * Usado para incluir hash na chave sem ficar muito longo.
 *
 * @param {string} hexHash - Hash em hexadecimal
 * @param {number} length - Tamanho desejado em caracteres (padrao: 12)
 * @returns {string} - Hash truncado em Base64URL
 *
 * EXEMPLO:
 * hashToBase64URL("2cf24dba5fb0a30e...", 12) -> "LPJNul-owo"
 */
export function hashToBase64URL(hexHash, length = 12) {
    // Converte hex para bytes
    const bytes = new Uint8Array(hexHash.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));

    // Converte bytes para Base64
    let binary = '';
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    const base64 = btoa(binary);

    // Converte para Base64URL e trunca
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '').slice(0, length);
}

/**
 * Converte Base64URL de volta para hash hexadecimal.
 *
 * @param {string} base64url - Hash em Base64URL
 * @returns {string} - Hash em hexadecimal
 */
export function base64URLToHex(base64url) {
    // Converte Base64URL para Base64 normal
    let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');

    // Adiciona padding se necessario
    const padding = (4 - (base64.length % 4)) % 4;
    base64 += '='.repeat(padding);

    // Decodifica Base64 para bytes
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

    // Converte bytes para hex
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

// ----------------------------------------------------------------
// GERENCIAMENTO DA CADEIA
// ----------------------------------------------------------------

/**
 * Identificador para a primeira versao (sem antecessor).
 */
export const GENESIS = 'GENESIS';

/**
 * Cria metadados da cadeia para uma nova versao.
 *
 * @param {string|null} previousKey - Chave ECO da versao anterior (null para primeira)
 * @param {number} previousVersion - Numero da versao anterior (0 para primeira)
 * @returns {Promise<Object>} - Metadados da cadeia
 *
 * RETORNO:
 * {
 *   prevHash: "GENESIS" ou "abc123...",
 *   version: 1, 2, 3...
 *   timestamp: "2024-01-15T10:30:00.000Z"
 * }
 */
export async function createChainMeta(previousKey = null, previousVersion = 0) {
    let prevHash = GENESIS;

    if (previousKey && previousKey.trim() !== '') {
        // Calcula hash da chave anterior
        const fullHash = await sha256(previousKey);
        prevHash = hashToBase64URL(fullHash, 12);
    }

    return {
        prevHash,
        version: previousVersion + 1,
        timestamp: new Date().toISOString(),
    };
}

/**
 * Verifica integridade de uma cadeia de chaves.
 *
 * @param {string[]} keys - Array de chaves em ordem cronologica
 * @returns {Promise<Object>} - Resultado da verificacao
 *
 * RETORNO (sucesso):
 * { valid: true, length: 5 }
 *
 * RETORNO (falha):
 * {
 *   valid: false,
 *   breakAt: 3,
 *   expected: "abc123...",
 *   found: "xyz789..."
 * }
 */
export async function verifyChain(keys) {
    if (!Array.isArray(keys) || keys.length === 0) {
        return { valid: true, length: 0 };
    }

    // Primeira chave deve ter GENESIS como prevHash
    // (nao podemos verificar sem decodificar, isso sera feito no decoder)

    for (let i = 1; i < keys.length; i++) {
        const previousKey = keys[i - 1];
        const currentKey = keys[i];

        // Calcula hash esperado
        const expectedFullHash = await sha256(previousKey);
        const expectedPrevHash = hashToBase64URL(expectedFullHash, 12);

        // Extrai prevHash da chave atual (posicao 3 no formato ECO1 blockchain)
        // ECO1-FAMILIAS-KEYID-PREVHASH-MERKLE-SIG-SALT-CHECK-DATA
        const parts = currentKey.split('-');

        // Para ECO1 blockchain (>=4 segmentos), prevHash esta na posicao 3
        // Para ECO1 simples (<4 segmentos), nao tem prevHash
        if (parts.length >= 4 && parts[0].startsWith('ECO')) {
            const foundPrevHash = parts[3];

            if (foundPrevHash !== expectedPrevHash) {
                return {
                    valid: false,
                    breakAt: i,
                    expected: expectedPrevHash,
                    found: foundPrevHash,
                };
            }
        }
    }

    return { valid: true, length: keys.length };
}

/**
 * Extrai o prevHash de uma chave ECO1 blockchain.
 *
 * @param {string} key - Chave ECO1 blockchain (>=4 segmentos)
 * @returns {string|null} - prevHash ou null se nao for blockchain
 */
export function extractPrevHash(key) {
    if (!key || !key.startsWith('ECO')) {
        return null;
    }

    const parts = key.split('-');
    if (parts.length >= 4) {
        return parts[3];
    }

    return null;
}

/**
 * Verifica se uma chave e a primeira da cadeia (GENESIS).
 *
 * @param {string} key - Chave ECO1 blockchain
 * @returns {boolean}
 */
export function isGenesisKey(key) {
    const prevHash = extractPrevHash(key);
    return prevHash === GENESIS;
}
