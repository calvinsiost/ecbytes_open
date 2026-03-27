
// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt

export async function initAuth() {}
export async function loginWithEmail() { return null; }
export async function registerWithEmail() { return null; }
export async function loginGoogle() {}
export async function loginGitHub() {}
export async function loginMicrosoft() {}
export async function sendPasswordReset() {}
export async function logout() {}
export function getCurrentUser() { return null; }
export const getCurrentSession = getCurrentUser;
export function isLoggedIn() { return false; }
export function getUserEmail() { return 'demo@ecbytes-open.local'; }
export function getSupabaseClient() { return null; }
export async function refreshProfile() {}
export async function validateInviteCode() { return { valid: false }; }
export async function claimInviteCode() { return false; }
export async function generateUserInvites() { return []; }
export async function getUserInvites() { return []; }
export async function submitWaitlist() { return false; }
