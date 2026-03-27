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
   BENFORD'S LAW ANALYSIS — First-digit distribution test
   ================================================================

   Testa a distribuicao dos primeiros digitos dos valores reportados
   contra a distribuicao logaritmica esperada (Lei de Benford).
   Dados fabricados frequentemente nao seguem esta distribuicao.

   CHI-SQUARED TEST:
   Compara frequencias observadas vs esperadas.
   p-value baixo = desvio significativo = suspeito.

   ================================================================ */

// ================================================================
// BENFORD EXPECTED DISTRIBUTION
// Distribuicao esperada dos primeiros digitos (1-9)
// ================================================================

const BENFORD_EXPECTED = [
    0.301, // 1
    0.176, // 2
    0.125, // 3
    0.097, // 4
    0.079, // 5
    0.067, // 6
    0.058, // 7
    0.051, // 8
    0.046, // 9
];

// ================================================================
// FIRST-DIGIT EXTRACTION
// Extrai o primeiro digito significativo de cada valor
// ================================================================

/**
 * Extract the leading significant digit from a number.
 * Extrai o primeiro digito significativo (1-9) de um numero.
 *
 * @param {number} value
 * @returns {number|null} Digit 1-9, or null if invalid
 */
function getFirstDigit(value) {
    const absVal = Math.abs(value);
    if (absVal === 0 || !isFinite(absVal)) return null;

    // Convert to string, strip leading zeros and decimal point
    const str = absVal.toExponential();
    const digit = parseInt(str.charAt(0), 10);

    return digit >= 1 && digit <= 9 ? digit : null;
}

// ================================================================
// DIGIT DISTRIBUTION
// Calcula a distribuicao dos primeiros digitos
// ================================================================

/**
 * Calculate first-digit frequency distribution.
 * Calcula a frequencia dos primeiros digitos em um array de valores.
 *
 * @param {number[]} values - Array of numeric values
 * @returns {number[]} Array of 9 frequencies (index 0 = digit 1, etc.)
 */
export function benfordDigitDistribution(values) {
    const counts = new Array(9).fill(0);
    let validCount = 0;

    for (const val of values) {
        const digit = getFirstDigit(val);
        if (digit !== null) {
            counts[digit - 1]++;
            validCount++;
        }
    }

    // Convert to proportions
    if (validCount === 0) return counts;
    return counts.map((c) => c / validCount);
}

// ================================================================
// CHI-SQUARED TEST
// Teste chi-quadrado para comparar distribuicoes
// ================================================================

/**
 * Chi-squared test comparing observed vs expected distributions.
 * Teste chi-quadrado comparando distribuicoes observada vs esperada.
 *
 * @param {number[]} observed - Observed proportions (length 9)
 * @param {number[]} expected - Expected proportions (length 9)
 * @param {number} n - Sample size
 * @returns {{ chiSquared: number, pValue: number }}
 */
export function chiSquaredTest(observed, expected, n) {
    let chiSq = 0;

    for (let i = 0; i < observed.length; i++) {
        const oCount = observed[i] * n;
        const eCount = expected[i] * n;
        if (eCount > 0) {
            chiSq += Math.pow(oCount - eCount, 2) / eCount;
        }
    }

    // Degrees of freedom = k - 1 = 8
    const df = 8;
    const pValue = chiSquaredPValue(chiSq, df);

    return { chiSquared: chiSq, pValue };
}

/**
 * Approximate chi-squared p-value using Wilson-Hilferty transform.
 * Aproximacao do p-value chi-quadrado via transformacao de Wilson-Hilferty.
 *
 * @param {number} x - Chi-squared statistic
 * @param {number} df - Degrees of freedom
 * @returns {number} Approximate p-value
 */
function chiSquaredPValue(x, df) {
    if (x <= 0) return 1;
    if (df <= 0) return 0;

    // Wilson-Hilferty approximation: transform chi-sq to approx normal
    const z = Math.pow(x / df, 1 / 3) - (1 - 2 / (9 * df));
    const denom = Math.sqrt(2 / (9 * df));
    const zScore = z / denom;

    // P(X > x) using normal CDF complement
    return 1 - normalCDF(zScore);
}

/**
 * Standard normal CDF approximation (Abramowitz & Stegun).
 * @param {number} x
 * @returns {number}
 */
function normalCDF(x) {
    if (x < -8) return 0;
    if (x > 8) return 1;

    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    const absX = Math.abs(x);
    const t = 1.0 / (1.0 + p * absX);
    const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp((-absX * absX) / 2);

    return 0.5 * (1.0 + sign * y);
}

// ================================================================
// MAIN BENFORD TEST
// Teste principal da Lei de Benford
// ================================================================

/**
 * Run Benford's Law test on a dataset.
 * Executa o teste da Lei de Benford em um conjunto de dados.
 *
 * @param {number[]} values - Array of numeric values
 * @returns {Object} { observed, expected, chiSquared, pValue, conformity, n, digits }
 */
export function benfordTest(values) {
    // Filter valid numeric values
    const numericValues = values.filter((v) => typeof v === 'number' && isFinite(v) && v !== 0);

    if (numericValues.length < 10) {
        return {
            observed: new Array(9).fill(0),
            expected: BENFORD_EXPECTED,
            chiSquared: 0,
            pValue: 1,
            conformity: 'insufficient_data',
            n: numericValues.length,
            digits: [1, 2, 3, 4, 5, 6, 7, 8, 9],
        };
    }

    const observed = benfordDigitDistribution(numericValues);
    const { chiSquared, pValue } = chiSquaredTest(observed, BENFORD_EXPECTED, numericValues.length);

    // Determine conformity verdict
    let conformity;
    if (pValue >= 0.05) {
        conformity = 'conforming';
    } else if (pValue >= 0.01) {
        conformity = 'suspicious';
    } else {
        conformity = 'non-conforming';
    }

    return {
        observed,
        expected: BENFORD_EXPECTED,
        chiSquared,
        pValue,
        conformity,
        n: numericValues.length,
        digits: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    };
}
