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
   DECODIFICADOR DE CHAVES
   ================================================================

   Este modulo decodifica chaves de volta para modelos.

   VERSOES SUPORTADAS:
   - ECO1 simples: Formato simples (sem blockchain)
   - ECO1 blockchain: Com blockchain (hash-chain, assinatura, Merkle)

   PROCESSO DE DECODIFICACAO:
   1. Detecta versao (ECO1 simples ou blockchain)
   2. Valida formato da chave
   3. Extrai componentes
   4. Verifica checksum
   5. [ECO1 blockchain] Verifica assinatura e Merkle
   6. Descriptografa dados
   7. Converte JSON para objeto

   FORMATO ECO1 simples:
   ECO{versao}-{familias}-{salt}-{checksum}-{dados}

   FORMATO ECO1 blockchain:
   ECO1-{familias}-{keyId}-{prevHash}-{merkle}-{sig}-{salt}-{check}-{dados}

   ================================================================ */

import { xorCrypt, checksum, fromBase64URL } from './encoder.js';
import { crc32 } from './crc32.js';
import { decompress } from './compression.js';
import { loadSymbologyFromImport } from '../symbology/manager.js';
import { importIssues } from '../issues/manager.js';
import { importPlumeAnimations } from '../sequencer/plumeAnimation.js';

// ----------------------------------------------------------------
// EXPRESSOES REGULARES PARA VALIDACAO
// ----------------------------------------------------------------

/**
 * Regex para ECO1/ECO2 simples (5 segmentos, checksum 4 hex).
 * ECO{ver}-{familias}-{salt}-{checksum4}-{payload}
 */
const KEY_REGEX_V2 = /^ECO(\d+)-([A-Z]+)-([A-Za-z0-9_-]+)-([A-F0-9]{4})-([A-Za-z0-9_-]+)$/;

/**
 * Regex para ECO1 blockchain (9 segmentos).
 * ECO{ver}-{familias}-{keyId}-{prevHash}-{merkle}-{sig}-{salt}-{check}-{payload}
 */
const KEY_REGEX_V3 =
    /^ECO(\d+)-([A-Z]+)-([a-f0-9]{8})-([A-Za-z0-9_-]+|GENESIS)-([A-Za-z0-9_-]{16})-([A-Za-z0-9_-]{64,128})-([A-Za-z0-9_-]+)-([A-F0-9]{4})-([A-Za-z0-9_-]+)$/;

/**
 * Regex para ECO4 comprimida (5 segmentos, checksum CRC-32 = 8 hex).
 * ECO4-{familias}-{salt}-{crc32_8hex}-{payload}
 *
 * NOTA: Diferente de V2, usa CRC-32 (8 chars hex) em vez de mod-65536 (4 chars).
 * A discriminacao e feita pelo prefixo numerico (4), nao pelo tamanho do checksum.
 */
const KEY_REGEX_V4 = /^ECO4-([A-Z]*)-([A-Za-z0-9_-]+)-([A-F0-9]{8})-([A-Za-z0-9_-]+)$/;

/**
 * Regex generica para detectar versao numerica do prefixo.
 * Usada como primeiro passo antes de delegar ao regex especifico.
 *
 * DECISAO: Detectar versao pelo numero no prefixo (ECO4 vs ECO1/ECO2)
 * resolve o bug de backtracking onde regex V2 fazia match em chaves V4
 * quando o CRC-32 continha padrao XXXX-YYYY interpretavel como
 * checksum(4)+hifen+payload.
 */
const KEY_REGEX = /^ECO(\d+)-/;

// ----------------------------------------------------------------
// FUNCAO PRINCIPAL
// ----------------------------------------------------------------

/**
 * Decodifica uma chave para objeto modelo.
 * Detecta automaticamente o formato: simples (5 segmentos) ou blockchain (9 segmentos).
 * Ambos usam prefixo ECO1 — a diferenciacao e estrutural.
 *
 * @param {string} key - Chave a decodificar
 * @returns {Object} - Modelo decodificado
 * @throws {Error} - Se chave invalida ou corrompida
 *
 * EXEMPLO:
 *   try {
 *     const model = decodeKey('ECO1-PWM-AbCd...');
 *     console.log(model.project.name);
 *   } catch (error) {
 *     console.error('Chave invalida:', error.message);
 *   }
 */
export function decodeKey(key) {
    const cleanKey = key.trim();

    // Detecta versao pelo prefixo numerico ANTES de testar regexes especificos.
    // Isso resolve o bug de backtracking onde KEY_REGEX_V2 fazia match em chaves V4.
    const versionMatch = cleanKey.match(KEY_REGEX);
    if (versionMatch) {
        const ver = parseInt(versionMatch[1], 10);
        if (ver === 4) {
            throw new Error(
                'Chave ECO4 (comprimida) requer decodificacao assincrona. ' +
                    'Use decodeKeyUniversal() ou importFromString() em vez de decodeKey().',
            );
        }
    }

    // Tenta blockchain primeiro (regex mais especifica, campos de tamanho fixo)
    if (KEY_REGEX_V3.test(cleanKey)) {
        const model = decodeKeyV3Sync(cleanKey);
        _restoreSymbology(model);
        _restoreIssues(model);
        _restorePlumeAnimations(model);
        return model;
    }

    // Formato simples (v1/v2)
    const model = decodeKeyV2(cleanKey);
    _restoreSymbology(model);
    _restorePlumeAnimations(model);
    return model;
}

/**
 * Decodifica chave ECO1 simples (formato original).
 */
function decodeKeyV2(key) {
    const match = key.match(KEY_REGEX_V2);

    if (!match) {
        throw new Error('Formato de chave invalido. Esperado: ECO{versao}-{familias}-{salt}-{checksum}-{dados}');
    }

    const [, version, families, saltB64, check, payload] = match;

    // Decodifica salt e dados
    const salt = fromBase64URL(saltB64);
    const encrypted = fromBase64URL(payload);

    // Verifica checksum
    const calculatedCheck = checksum(encrypted);
    if (check !== calculatedCheck) {
        throw new Error(
            `Checksum invalido. Esperado: ${check}, Calculado: ${calculatedCheck}. A chave pode estar corrompida.`,
        );
    }

    // Descriptografa dados
    const decrypted = xorCrypt(encrypted, salt);
    const json = new TextDecoder().decode(decrypted);

    try {
        return JSON.parse(json);
    } catch (parseError) {
        throw new Error('Erro ao interpretar dados. O conteudo da chave esta corrompido.');
    }
}

/**
 * Decodifica chave ECO1 blockchain de forma sincrona (sem verificar assinatura).
 * Use decodeKeyV3 para verificacao completa.
 */
function decodeKeyV3Sync(key) {
    const match = key.match(KEY_REGEX_V3);

    if (!match) {
        throw new Error('Formato de chave ECO1 blockchain invalido.');
    }

    const [
        ,
        // Match completo
        version, // Versao (1)
        families, // Familias (PWM)
        keyId, // ID da chave (a1b2c3d4)
        prevHash, // Hash anterior (GENESIS ou hash)
        merkleRoot, // Raiz Merkle
        signature, // Assinatura
        saltB64, // Salt
        check, // Checksum
        payload, // Dados
    ] = match;

    // Decodifica salt e dados
    const salt = fromBase64URL(saltB64);
    const encrypted = fromBase64URL(payload);

    // Verifica checksum
    const calculatedCheck = checksum(encrypted);
    if (check !== calculatedCheck) {
        throw new Error(`Checksum invalido. Esperado: ${check}, Calculado: ${calculatedCheck}.`);
    }

    // Descriptografa dados
    const decrypted = xorCrypt(encrypted, salt);
    const json = new TextDecoder().decode(decrypted);

    try {
        const model = JSON.parse(json);

        // Adiciona metadados de verificacao (pendente)
        model._verification = {
            version: parseInt(version, 10),
            keyId,
            prevHash,
            merkleRoot,
            signature,
            verified: false, // Precisa chamar decodeKeyV3 para verificar
            status: 'pending',
        };

        return model;
    } catch (parseError) {
        throw new Error('Erro ao interpretar dados. O conteudo da chave esta corrompido.');
    }
}

/**
 * Decodifica chave ECO1 blockchain com verificacao completa.
 * Verifica assinatura digital e integridade Merkle.
 *
 * @param {string} key - Chave ECO1 blockchain
 * @param {Object} options - Opcoes
 * @param {boolean} [options.verifySignature=true] - Verificar assinatura
 * @param {boolean} [options.verifyMerkle=true] - Verificar Merkle root
 * @returns {Promise<Object>} - Modelo com status de verificacao
 */
export async function decodeKeyV3(key, options = {}) {
    const { verifySignature = true, verifyMerkle = true } = options;

    const cleanKey = key.trim();
    const match = cleanKey.match(KEY_REGEX_V3);

    if (!match) {
        throw new Error('Formato de chave ECO1 blockchain invalido.');
    }

    const [, version, families, keyId, prevHash, merkleRoot, signature, saltB64, check, payload] = match;

    // Decodifica e descriptografa
    const salt = fromBase64URL(saltB64);
    const encrypted = fromBase64URL(payload);

    const calculatedCheck = checksum(encrypted);
    if (check !== calculatedCheck) {
        throw new Error(`Checksum invalido.`);
    }

    const decrypted = xorCrypt(encrypted, salt);
    const json = new TextDecoder().decode(decrypted);
    const model = JSON.parse(json);

    // Prepara resultado de verificacao
    const verification = {
        version: parseInt(version, 10),
        keyId,
        prevHash,
        merkleRoot,
        signatureValid: null,
        merkleValid: null,
        verified: false,
        status: 'pending',
    };

    // Verifica assinatura
    if (verifySignature) {
        try {
            const { verifySignature: verifySig } = await import('../crypto/signer.js');

            // Reconstroi dados que foram assinados
            const dataToVerify = `ECO${version}-${families}-${keyId}-${prevHash}-${merkleRoot}-${saltB64}-${check}-${payload}`;

            verification.signatureValid = await verifySig(keyId, dataToVerify, signature);
        } catch (err) {
            console.warn('Erro ao verificar assinatura:', err.message);
            verification.signatureValid = false;
            verification.signatureError = err.message;
        }
    }

    // Verifica Merkle root
    if (verifyMerkle) {
        try {
            const { verifyModelIntegrity } = await import('../crypto/merkle.js');
            const result = await verifyModelIntegrity(model, merkleRoot);
            verification.merkleValid = result.valid;
        } catch (err) {
            console.warn('Erro ao verificar Merkle:', err.message);
            verification.merkleValid = false;
            verification.merkleError = err.message;
        }
    }

    // Status final
    if (verification.signatureValid === true && verification.merkleValid === true) {
        verification.verified = true;
        verification.status = 'verified';
    } else if (verification.signatureValid === false || verification.merkleValid === false) {
        verification.status = 'invalid';
    } else {
        verification.status = 'partial';
    }

    model._verification = verification;
    return model;
}

// ----------------------------------------------------------------
// DECODIFICACAO ECO4 COMPRIMIDA
// ----------------------------------------------------------------

/**
 * Decodifica chave ECO4 comprimida.
 *
 * PIPELINE INVERSO:
 *   Base64URL → XOR(salt) → decompress(deflate-raw) → TextDecoder → JSON.parse
 *
 * @param {string} key - Chave ECO4
 * @returns {Promise<Object>} - Modelo decodificado
 * @throws {Error} - Se formato invalido, CRC falha, ou descompressao falha
 */
export async function decodeKeyV4(key) {
    const cleanKey = key.trim();
    const match = cleanKey.match(KEY_REGEX_V4);

    if (!match) {
        throw new Error('Formato de chave ECO4 invalido. Esperado: ECO4-{familias}-{salt}-{crc32}-{dados}');
    }

    const [, families, saltB64, check, payload] = match;

    // 1. Decodifica Base64URL
    const salt = fromBase64URL(saltB64);
    const encrypted = fromBase64URL(payload);

    // 2. Verifica CRC-32
    const calculatedCheck = crc32(encrypted);
    if (check !== calculatedCheck) {
        throw new Error(
            `CRC-32 invalido. Esperado: ${check}, Calculado: ${calculatedCheck}. ` +
                'A chave pode estar corrompida ou truncada.',
        );
    }

    // 3. XOR para reverter ofuscacao (mesma operacao — XOR e reversivel)
    const compressed = xorCrypt(encrypted, salt);

    // 4. Descomprime (deflate-raw) — async
    let decompressed;
    try {
        decompressed = await decompress(compressed);
    } catch (err) {
        throw new Error(
            'Erro ao descomprimir chave ECO4. ' +
                (err.message.includes('Compression Streams') ? err.message : 'Os dados podem estar corrompidos.'),
        );
    }

    // 5. Converte bytes para string e parse JSON
    const json = new TextDecoder().decode(decompressed);

    try {
        return JSON.parse(json);
    } catch (parseError) {
        throw new Error('Erro ao interpretar dados da chave ECO4. O conteudo esta corrompido.');
    }
}

/**
 * Decodifica qualquer versao de chave ECO (v1/v2, v3, v4).
 * Detecta a versao automaticamente pelo prefixo numerico.
 *
 * Esta e a funcao recomendada para decodificacao universal.
 * E async porque ECO4 requer descompressao via Streams API.
 *
 * @param {string} key - Chave ECO de qualquer versao
 * @returns {Promise<Object>} - Modelo decodificado
 * @throws {Error} - Se formato invalido ou dados corrompidos
 *
 * ORDEM DE DETECCAO (por prefixo numerico, sem ambiguidade):
 * 1. ECO4 → decodeKeyV4 (async, comprimida)
 * 2. ECO{qualquer} com 9 segmentos → decodeKeyV3Sync (blockchain)
 * 3. ECO{qualquer} com 5 segmentos → decodeKeyV2 (simples)
 */
export async function decodeKeyUniversal(key) {
    const cleanKey = key.trim();

    // Extrai versao numerica do prefixo
    const versionMatch = cleanKey.match(KEY_REGEX);
    if (!versionMatch) {
        throw new Error('Formato de chave invalido. Esperado prefixo ECO{versao}-');
    }

    const ver = parseInt(versionMatch[1], 10);

    // ECO4: comprimida (async)
    if (ver === 4) {
        return decodeKeyV4(cleanKey);
    }

    // V3 blockchain (sync, mas retornamos como Promise para interface uniforme)
    if (KEY_REGEX_V3.test(cleanKey)) {
        return decodeKeyV3Sync(cleanKey);
    }

    // V1/V2 simples (sync)
    return decodeKeyV2(cleanKey);
}

/**
 * Versao async de parseInput.
 * Suporta chaves ECO4 (comprimidas) alem de JSON e chaves v1/v2/v3.
 *
 * @param {string} input - Chave ECO ou JSON
 * @returns {Promise<Object>} - Modelo decodificado
 * @throws {Error} - Se nenhum formato funcionar
 */
export async function parseInputAsync(input) {
    if (!input || typeof input !== 'string') {
        throw new Error('Input vazio ou invalido');
    }

    const trimmed = input.trim();

    // JSON direto
    if (trimmed.startsWith('{')) {
        try {
            return JSON.parse(trimmed);
        } catch (e) {
            throw new Error('JSON invalido: ' + e.message);
        }
    }

    // Chave ECO (qualquer versao)
    if (trimmed.startsWith('ECO')) {
        return decodeKeyUniversal(trimmed);
    }

    throw new Error('Formato nao reconhecido. Use uma chave ECO ou JSON.');
}

// ----------------------------------------------------------------
// FUNCOES DE VALIDACAO
// ----------------------------------------------------------------

/**
 * Verifica se uma string parece ser uma chave valida.
 * Suporta ECO1/ECO2 simples, ECO1 blockchain e ECO4 comprimida.
 *
 * @param {string} str - String a verificar
 * @returns {boolean} - true se parece ser chave valida
 */
export function isValidKeyFormat(str) {
    if (!str || typeof str !== 'string') {
        return false;
    }
    const trimmed = str.trim();
    return KEY_REGEX_V4.test(trimmed) || KEY_REGEX_V3.test(trimmed) || KEY_REGEX_V2.test(trimmed);
}

/**
 * Detecta a versao de uma chave.
 * Usa prefixo numerico para ECO4, regex estrutural para v2/v3.
 *
 * @param {string} key - Chave ECO
 * @returns {number|null} - Versao (1, 2, 3, 4) ou null se invalida
 */
export function detectKeyVersion(key) {
    if (!key || typeof key !== 'string') {
        return null;
    }

    const trimmed = key.trim();

    // ECO4 — detecta pelo prefixo numerico (mais seguro que regex estrutural)
    if (KEY_REGEX_V4.test(trimmed)) {
        return 4;
    }

    if (KEY_REGEX_V3.test(trimmed)) {
        return 3;
    }

    if (KEY_REGEX_V2.test(trimmed)) {
        const match = trimmed.match(/^ECO(\d+)-/);
        return match ? parseInt(match[1], 10) : 2;
    }

    return null;
}

/**
 * Verifica se uma string e JSON valido.
 *
 * @param {string} str - String a verificar
 * @returns {boolean} - true se e JSON valido
 */
export function isValidJSON(str) {
    if (!str || typeof str !== 'string') {
        return false;
    }

    try {
        JSON.parse(str.trim());
        return true;
    } catch {
        return false;
    }
}

/**
 * Tenta decodificar string como chave ou JSON.
 * Util quando nao sabemos o formato do input.
 *
 * @param {string} input - Chave ECO ou JSON
 * @returns {Object} - Modelo decodificado
 * @throws {Error} - Se nenhum formato funcionar
 *
 * LOGICA:
 * 1. Se comeca com '{', tenta como JSON
 * 2. Se comeca com 'ECO', tenta como chave
 * 3. Se nenhum funcionar, lanca erro
 */
export function parseInput(input) {
    if (!input || typeof input !== 'string') {
        throw new Error('Input vazio ou invalido');
    }

    const trimmed = input.trim();

    // Tenta como JSON direto
    if (trimmed.startsWith('{')) {
        try {
            return JSON.parse(trimmed);
        } catch (e) {
            throw new Error('JSON invalido: ' + e.message);
        }
    }

    // Tenta como chave ECO
    if (trimmed.startsWith('ECO')) {
        return decodeKey(trimmed);
    }

    throw new Error('Formato nao reconhecido. Use uma chave ECO ou JSON.');
}

// ----------------------------------------------------------------
// FUNCOES DE EXTRACAO DE METADADOS
// ----------------------------------------------------------------

/**
 * Extrai metadados de uma chave sem decodificar completamente.
 * Util para preview rapido. Suporta ECO1 simples e ECO1 blockchain.
 *
 * @param {string} key - Chave ECO
 * @returns {Object|null} - Metadados ou null se invalida
 *
 * RETORNA simples:
 * { version, families, isValid, hasBlockchain: false }
 *
 * RETORNA blockchain:
 * { version, families, keyId, prevHash, merkleRoot, isValid, hasBlockchain: true }
 */
export function extractKeyMetadata(key) {
    if (!key || typeof key !== 'string') {
        return null;
    }

    const trimmed = key.trim();

    // ECO4 comprimida
    const matchV4 = trimmed.match(KEY_REGEX_V4);
    if (matchV4) {
        return {
            version: '4',
            families: matchV4[1],
            isValid: true,
            hasBlockchain: false,
            isCompressed: true,
        };
    }

    // Tenta blockchain (regex mais especifica)
    const matchV3 = trimmed.match(KEY_REGEX_V3);
    if (matchV3) {
        return {
            version: matchV3[1],
            families: matchV3[2],
            keyId: matchV3[3],
            prevHash: matchV3[4],
            merkleRoot: matchV3[5],
            isValid: true,
            hasBlockchain: true,
            isCompressed: false,
        };
    }

    // Tenta simples
    const matchV2 = trimmed.match(KEY_REGEX_V2);
    if (matchV2) {
        return {
            version: matchV2[1],
            families: matchV2[2],
            isValid: true,
            hasBlockchain: false,
            isCompressed: false,
        };
    }

    return null;
}

/**
 * Restaura perfis de simbologia após decodificação de chave ECO1.
 * @param {Object} model
 */
function _restoreSymbology(model) {
    if (model?.symbologyProfiles && typeof loadSymbologyFromImport === 'function') {
        try {
            loadSymbologyFromImport(model.symbologyProfiles);
        } catch (e) {
            console.warn('[decoder] Erro ao restaurar simbologia:', e);
        }
    }
}

/**
 * Restaura issues 3D do modelo importado via three-way merge.
 * Gap #1: nunca sobrescreve issues locais mais recentes.
 * @param {Object} model
 */
function _restoreIssues(model) {
    if (Array.isArray(model?.issues) && model.issues.length > 0) {
        try {
            const result = importIssues(model.issues, { mode: 'merge' });
            if (result.inserted || result.updated) {
                console.log(
                    `[decoder] Issues restored: ${result.inserted} inserted, ${result.updated} updated, ${result.kept} kept local`,
                );
            }
        } catch (e) {
            console.warn('[decoder] Erro ao restaurar issues:', e);
        }
    }
}

/**
 * Restaura animacoes de pluma do modelo importado (apenas metadados).
 * @param {Object} model
 */
function _restorePlumeAnimations(model) {
    if (Array.isArray(model?.plumeAnimations) && model.plumeAnimations.length > 0) {
        try {
            importPlumeAnimations(model.plumeAnimations);
        } catch (e) {
            console.warn('[decoder] Erro ao restaurar animacoes de pluma:', e);
        }
    }
}
