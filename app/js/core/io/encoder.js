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
   CODIFICADOR DE CHAVES
   ================================================================

   Este modulo codifica o modelo em uma "chave" compacta.

   O QUE E UMA CHAVE?
   Uma string unica que contem todo o modelo compactado.
   Exemplo: ECO1-PWM-AbCdEf12-A1B2-xYz...

   FORMATOS:
   - ECO1 simples: 5 segmentos (sem blockchain)
   - ECO1 blockchain: 9 segmentos (hash-chain, assinatura, Merkle)

   ESTRUTURA ECO1 SIMPLES:
   ECO1 - PWM - AbCdEf12 - A1B2 - xYzBase64...
   |      |     |          |      |
   |      |     |          |      +-- Dados criptografados
   |      |     |          +--------- Checksum (verificacao)
   |      |     +-------------------- Salt (aleatorio)
   |      +-------------------------- Familias usadas
   +--------------------------------- Prefixo + versao

   ESTRUTURA ECO1 BLOCKCHAIN:
   ECO1 - PWM - keyId - prevHash - merkle - sig - salt - check - dados
   |      |     |       |          |        |     |       |       |
   |      |     |       |          |        |     |       |       +-- Payload
   |      |     |       |          |        |     |       +---------- Checksum
   |      |     |       |          |        |     +------------------ Salt
   |      |     |       |          |        +------------------------ Assinatura
   |      |     |       |          +--------------------------------- Merkle root
   |      |     |       +-------------------------------------------- Hash anterior
   |      |     +---------------------------------------------------- ID da chave
   |      +---------------------------------------------------------- Familias
   +----------------------------------------------------------------- Prefixo

   SEGURANCA:
   - XOR com salt aleatorio (ofuscacao)
   - Checksum para detectar corrupcao
   - Base64URL para URLs validas
   - [blockchain] Hash-chain para rastreabilidade
   - [blockchain] Assinatura ECDSA para autoria
   - [blockchain] Merkle Tree para integridade

   ================================================================ */

import { CONFIG } from '../../config.js';
import { generateFamilyCodes } from '../elements/families.js';
import { crc32 } from './crc32.js';
import { compress, isCompressionSupported } from './compression.js';
import { getSymbologyForExport } from '../symbology/manager.js';
import { exportIssues } from '../issues/manager.js';
import { exportPlumeAnimations } from '../sequencer/plumeAnimation.js';

// ----------------------------------------------------------------
// FUNCOES PRINCIPAIS
// ----------------------------------------------------------------

/**
 * Codifica um modelo completo em uma chave.
 *
 * @param {Object} model - Modelo a codificar
 * @returns {string} - Chave codificada
 *
 * PROCESSO:
 * 1. Converte modelo para JSON
 * 2. Converte JSON para bytes
 * 3. Gera salt aleatorio
 * 4. Criptografa bytes com XOR
 * 5. Calcula checksum
 * 6. Monta a chave final
 */
export function encodeKey(model) {
    // F10 — recordUsage removido: enforcement atomico agora em export.js via checkAndConsume

    // Inclui perfis de simbologia antes de serializar
    model.symbologyProfiles = getSymbologyForExport();

    // Inclui issues 3D no modelo para exportacao
    try {
        model.issues = exportIssues();
    } catch {
        /* issues module not loaded */
    }

    // Inclui animacoes de pluma (apenas metadados, sem grids brutos)
    try {
        model.plumeAnimations = exportPlumeAnimations();
    } catch {
        /* plumeAnimation module not loaded */
    }

    // 1. Converte modelo para string JSON
    const json = JSON.stringify(model);

    // 2. Converte string para bytes (Uint8Array)
    const bytes = new TextEncoder().encode(json);

    // 3. Gera salt aleatorio (8 bytes)
    const salt = new Uint8Array(8);
    crypto.getRandomValues(salt);

    // 4. Criptografa com XOR
    const encrypted = xorCrypt(bytes, salt);

    // 5. Calcula checksum dos dados criptografados
    const check = checksum(encrypted);

    // 6. Extrai versao e codigos de familia
    const version = model.ecbyts?.split('.')[0] || '2';
    const codes = generateFamilyCodes(model.elements || []);

    // 7. Monta a chave
    // Formato: ECO{versao}-{familias}-{salt}-{checksum}-{dados}
    return `${CONFIG.KEY_PREFIX}${version}-${codes}-${toBase64URL(salt)}-${check}-${toBase64URL(encrypted)}`;
}

// ----------------------------------------------------------------
// FUNCOES DE CRIPTOGRAFIA
// ----------------------------------------------------------------

/**
 * Criptografa/descriptografa bytes usando XOR com salt.
 *
 * COMO FUNCIONA O XOR:
 * - XOR e uma operacao binaria reversivel
 * - A XOR B = C, e C XOR B = A
 * - Ou seja, aplicar XOR duas vezes com a mesma chave volta ao original
 *
 * @param {Uint8Array} data - Dados a processar
 * @param {Uint8Array} salt - Chave de criptografia
 * @returns {Uint8Array} - Dados processados
 *
 * NOTA: XOR nao e criptografia segura!
 * E apenas ofuscacao para evitar edicao casual.
 * Nao use para dados sensiveis.
 */
export function xorCrypt(data, salt) {
    return data.map((byte, index) => {
        // Usa bytes do salt ciclicamente
        // Se salt tem 8 bytes e data tem 100, repete o salt
        return byte ^ salt[index % salt.length];
    });
}

/**
 * Calcula checksum de verificacao.
 *
 * PARA QUE SERVE:
 * - Detecta se a chave foi corrompida ou alterada
 * - Na importacao, comparamos o checksum calculado com o da chave
 *
 * @param {Uint8Array} bytes - Dados para calcular
 * @returns {string} - Checksum em hexadecimal (4 caracteres)
 *
 * ALGORITMO:
 * - Soma todos os bytes
 * - Aplica modulo 65536 (2^16)
 * - Converte para hex maiusculo
 */
export function checksum(bytes) {
    let sum = 0;
    bytes.forEach((byte) => {
        sum = (sum + byte) % 65536;
    });
    return sum.toString(16).toUpperCase().padStart(4, '0');
}

// ----------------------------------------------------------------
// FUNCOES DE CONVERSAO BASE64
// ----------------------------------------------------------------

/**
 * Converte bytes para Base64URL.
 *
 * POR QUE BASE64URL?
 * - Base64 normal usa + / = que sao problematicos em URLs
 * - Base64URL substitui por - _ e remove padding
 * - Resultado e seguro para usar em URLs
 *
 * @param {Uint8Array} bytes - Bytes a converter
 * @returns {string} - String Base64URL
 */
export function toBase64URL(bytes) {
    // Converte bytes para string binaria
    let binary = '';
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });

    // Codifica em Base64
    const base64 = btoa(binary);

    // Converte para Base64URL
    return base64
        .replace(/\+/g, '-') // + vira -
        .replace(/\//g, '_') // / vira _
        .replace(/=+$/g, ''); // Remove padding (=)
}

/**
 * Converte Base64URL de volta para bytes.
 *
 * @param {string} str - String Base64URL
 * @returns {Uint8Array} - Bytes decodificados
 */
export function fromBase64URL(str) {
    // Converte Base64URL para Base64 normal
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');

    // Adiciona padding se necessario
    const padding = (4 - (base64.length % 4)) % 4;
    base64 += '='.repeat(padding);

    // Decodifica Base64 para string binaria
    const binary = atob(base64);

    // Converte string binaria para bytes
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

// ----------------------------------------------------------------
// CODIFICACAO ECO1 BLOCKCHAIN
// ----------------------------------------------------------------

/**
 * Codifica um modelo com recursos de blockchain (ECO1 blockchain).
 * Inclui hash-chain, assinatura digital e Merkle Tree.
 *
 * @param {Object} model - Modelo a codificar
 * @param {Object} options - Opcoes de codificacao
 * @param {string} options.keyId - ID da chave para assinar
 * @param {string} [options.previousKey] - Chave anterior (para cadeia)
 * @param {number} [options.previousVersion] - Versao anterior
 * @returns {Promise<string>} - Chave ECO1 blockchain codificada
 *
 * PROCESSO:
 * 1. Importa modulos de crypto dinamicamente
 * 2. Cria metadados da cadeia (prevHash, version)
 * 3. Constroi Merkle Tree
 * 4. Adiciona metadados ao modelo
 * 5. Codifica modelo (JSON -> bytes -> XOR -> Base64URL)
 * 6. Assina a chave
 * 7. Monta chave final
 */
export async function encodeKeyV3(model, options = {}) {
    // F10 — recordUsage removido: enforcement atomico agora em export.js via checkAndConsume

    const { keyId, previousKey = null, previousVersion = 0 } = options;

    if (!keyId) {
        throw new Error('keyId e obrigatorio para blockchain');
    }

    // Importa modulos de crypto dinamicamente
    const { createChainMeta, GENESIS } = await import('../crypto/hashChain.js');
    const { buildMerkleTree } = await import('../crypto/merkle.js');
    const { signData } = await import('../crypto/signer.js');

    // 1. Cria metadados da cadeia
    const chainMeta = await createChainMeta(previousKey, previousVersion);

    // 2. Constroi Merkle Tree
    const merkle = await buildMerkleTree(model);

    // 3. Adiciona metadados ao modelo
    const modelWithMeta = {
        ...model,
        ecbyts: CONFIG.VERSION_BLOCKCHAIN,
        chain: chainMeta,
        merkle: { root: merkle.root, algorithm: 'sha256' },
        author: { keyId },
    };

    // 4. Codifica modelo (mesmo processo do formato simples)
    const json = JSON.stringify(modelWithMeta);
    const bytes = new TextEncoder().encode(json);
    const salt = new Uint8Array(8);
    crypto.getRandomValues(salt);
    const encrypted = xorCrypt(bytes, salt);
    const check = checksum(encrypted);

    // 5. Extrai codigos de familia
    const codes = generateFamilyCodes(model.elements || []);

    // 6. Monta dados para assinar (tudo exceto assinatura)
    const { FIELD_LENGTHS } = CONFIG.BLOCKCHAIN;
    const prevHashTrunc =
        chainMeta.prevHash === GENESIS ? GENESIS : chainMeta.prevHash.slice(0, FIELD_LENGTHS.PREV_HASH);
    const merkleRootTrunc = merkle.root.slice(0, FIELD_LENGTHS.MERKLE_ROOT);
    const saltB64 = toBase64URL(salt);
    const payloadB64 = toBase64URL(encrypted);

    const versionPrefix = `${CONFIG.KEY_PREFIX}${CONFIG.VERSION_BLOCKCHAIN.split('.')[0]}`;
    const dataToSign = `${versionPrefix}-${codes}-${keyId}-${prevHashTrunc}-${merkleRootTrunc}-${saltB64}-${check}-${payloadB64}`;

    // 7. Assina
    // Use full ECDSA signature to keep strict verification cryptographically sound.
    // Legacy truncated signatures remain parseable on decode for backward compatibility.
    const signature = await signData(keyId, dataToSign);

    // 8. Monta chave final (com assinatura inserida)
    return `${versionPrefix}-${codes}-${keyId}-${prevHashTrunc}-${merkleRootTrunc}-${signature}-${saltB64}-${check}-${payloadB64}`;
}

// ----------------------------------------------------------------
// CODIFICACAO ECO4 COMPRIMIDA
// ----------------------------------------------------------------

/**
 * Codifica um modelo em chave ECO4 comprimida.
 *
 * PIPELINE:
 *   JSON.stringify → TextEncoder → compress(deflate-raw) → XOR(salt) → CRC-32 → Base64URL
 *
 * FORMATO:
 *   ECO4-{familias}-{salt}-{crc32_8hex}-{payload}
 *
 * REDUCAO TIPICA: ~95% menor que ECO1/ECO2 (validado com modelos reais).
 *
 * DECISOES DE DESIGN:
 * - compress→XOR (nao XOR→compress): XOR destroi padroes, DEFLATE precisa deles.
 *   Testado: XOR→compress e 2.7x maior.
 * - CRC-32 (8 hex) em vez de mod-65536 (4 hex): deteccao de corrupcao superior.
 * - Sem compactor/dictionary: DEFLATE sozinho da 95.7% de reducao. Null-strip
 *   adicionaria apenas 1.74% extra — complexidade nao justificada.
 *
 * COMPATIBILIDADE:
 * - Se CompressionStream nao disponivel, faz fallback para encodeKey() (ECO2).
 * - Chaves ECO4 sao detectadas pelo prefixo numerico "ECO4-" no decoder.
 *
 * @param {Object} model - Modelo a codificar
 * @returns {Promise<string>} - Chave ECO4 comprimida
 */
export async function encodeKeyV4(model) {
    // Fallback: se browser nao suporta compressao, gera chave v2
    if (!isCompressionSupported()) {
        console.warn('[ECO4] CompressionStream indisponivel. Gerando chave ECO2 (sem compressao).');
        return encodeKey(model);
    }

    // 1. Serializa modelo para JSON e converte para bytes
    const json = JSON.stringify(model);
    const bytes = new TextEncoder().encode(json);

    // 2. Comprime com deflate-raw
    const compressed = await compress(bytes);

    // 3. Gera salt aleatorio (8 bytes)
    const salt = new Uint8Array(8);
    crypto.getRandomValues(salt);

    // 4. XOR apos compressao (preserva padroes para DEFLATE)
    const encrypted = xorCrypt(compressed, salt);

    // 5. CRC-32 dos dados criptografados (8 hex chars)
    const check = crc32(encrypted);

    // 6. Extrai codigos de familia
    const codes = generateFamilyCodes(model.elements || []);

    // 7. Monta chave ECO4
    return `${CONFIG.KEY_PREFIX}4-${codes}-${toBase64URL(salt)}-${check}-${toBase64URL(encrypted)}`;
}

/**
 * Codifica modelo com opcao de blockchain ou compressao.
 * Decide automaticamente entre formatos.
 *
 * @param {Object} model - Modelo a codificar
 * @param {Object} [options] - Opcoes
 * @param {boolean} [options.useBlockchain] - Se true, usa formato blockchain (v3)
 * @param {boolean} [options.useCompression] - Se true, usa formato comprimido (v4)
 * @param {string} [options.keyId] - ID da chave (obrigatorio se useBlockchain)
 * @param {string} [options.previousKey] - Chave anterior
 * @param {number} [options.previousVersion] - Versao anterior
 * @returns {Promise<string>} - Chave codificada
 *
 * PRIORIDADE: blockchain > compressao > simples
 */
export async function encodeKeyAuto(model, options = {}) {
    const { useBlockchain = false, useCompression = false, keyId, previousKey, previousVersion } = options;

    if (useBlockchain) {
        return encodeKeyV3(model, { keyId, previousKey, previousVersion });
    }

    if (useCompression) {
        return encodeKeyV4(model);
    }

    // Formato simples (sincrono)
    return encodeKey(model);
}
