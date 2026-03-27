
export function getApiKey(provider) { return sessionStorage.getItem('ecbyts-apikey-' + provider) || ''; }
export function setApiKey(provider, key) { sessionStorage.setItem('ecbyts-apikey-' + provider, key); }
export function removeApiKey(provider) { sessionStorage.removeItem('ecbyts-apikey-' + provider); }
export function hasApiKey(provider) { return !!getApiKey(provider); }
export async function loadApiKeys() {}
export async function saveApiKeys() {}
export async function generateApiKey() { return null; }
export async function revokeApiKey() {}
export async function listApiKeys() { return []; }
