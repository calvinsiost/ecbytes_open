
export async function initSubscription() {}
export function getSubscriptionStatus() { return { active: true, tier: 'open' }; }
export function getSubscriptionInfo() { return { tier: 'open', active: true }; }
export function isProfessional() { return false; }
export function isSubscriptionActive() { return false; }
export async function startCheckout() {}
export async function cancelSubscription() {}
export async function startConnectOnboarding() {}
export async function checkConnectStatus() { return { connected: false }; }
export async function checkPaymentReturn() {}
