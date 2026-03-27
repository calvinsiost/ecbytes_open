/**
 * Security Event Logger — ecbyts
 *
 * Logging padronizado para eventos de seguranca.
 * Strip automatico de campos sensiveis (passwords, tokens, keys).
 *
 * @module utils/helpers/securityLogger
 */

// Campos que NUNCA devem aparecer em logs
const SENSITIVE_KEYS = new Set([
    'password',
    'apiKey',
    'api_key',
    'token',
    'secret',
    'privateKey',
    'enc_key',
    'accessToken',
    'refreshToken',
    'authorization',
    'cookie',
    'sessionToken',
]);

/**
 * Loga evento de seguranca com sanitizacao automatica de dados sensiveis.
 *
 * @param {'auth'|'crypto'|'storage'|'metering'|'sandbox'} category
 * @param {'warn'|'error'} severity
 * @param {string} message - Descricao do evento (sem dados sensiveis)
 * @param {Record<string, unknown>} [context={}] - Contexto adicional (campos sensiveis mascarados)
 */
export function logSecurityEvent(category, severity, message, context = {}) {
    const safeContext = {};
    for (const [k, v] of Object.entries(context)) {
        safeContext[k] = SENSITIVE_KEYS.has(k) ? '***' : v;
    }

    const prefix = `[ecbyts:security:${category}]`;
    const fn = severity === 'error' ? console.error : console.warn;

    if (Object.keys(safeContext).length > 0) {
        fn(prefix, message, safeContext);
    } else {
        fn(prefix, message);
    }
}
