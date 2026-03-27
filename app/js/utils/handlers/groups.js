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
   GROUP HANDLERS — UI handlers for element & family grouping
   Controla a criacao, edicao e remocao de grupos customizados

   Dois conjuntos de grupos independentes:
   - Element groups: organizam elementos na aba Elements
   - Family groups: organizam familias no painel esquerdo
   ================================================================ */

import {
    getGroupById,
    addElementGroup,
    updateElementGroupProps,
    removeElementGroup,
    toggleElementGroupCollapsed,
    toggleElementUngroupedCollapsed,
    addFamilyGroup,
    updateFamilyGroupProps,
    removeFamilyGroup,
    toggleFamilyGroupCollapsed,
    toggleFamilyUngroupedCollapsed,
    setElementGroup,
    clearElementGroup,
    setFamilyGroup,
    clearFamilyGroup,
} from '../groups/manager.js';
import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';
import { asyncPrompt, asyncConfirm } from '../ui/asyncDialogs.js';

let _updateAllUI = null;

export function setGroupsUpdateAllUI(fn) {
    _updateAllUI = fn;
}

// ================================================================
// ELEMENT GROUP CRUD
// ================================================================

export async function handleAddElementGroup() {
    const name = await asyncPrompt(t('groupName') || 'Group name:');
    if (!name || !name.trim()) return;
    addElementGroup({ name: name.trim() });
    showToast(t('groupCreated') || 'Group created', 'success');
}

export async function handleRenameElementGroup(groupId) {
    const group = getGroupById(groupId);
    if (!group) return;
    const name = await asyncPrompt(t('groupName') || 'Group name:', group.name);
    if (!name || !name.trim()) return;
    updateElementGroupProps(groupId, { name: name.trim() });
}

export async function handleRemoveElementGroup(groupId) {
    if (!(await asyncConfirm(t('confirmRemoveGroup') || 'Remove this group? Elements will become ungrouped.'))) return;
    removeElementGroup(groupId);
    showToast(t('groupRemoved') || 'Group removed', 'info');
}

export function handleToggleElementGroupCollapse(groupId) {
    toggleElementGroupCollapsed(groupId);
}

export function handleToggleElementUngroupedCollapse() {
    toggleElementUngroupedCollapsed();
}

export function handleElementGroupColorChange(groupId, color) {
    updateElementGroupProps(groupId, { color });
}

// ================================================================
// FAMILY GROUP CRUD
// ================================================================

export async function handleAddFamilyGroup() {
    const name = await asyncPrompt(t('groupName') || 'Group name:');
    if (!name || !name.trim()) return;
    addFamilyGroup({ name: name.trim() });
    showToast(t('groupCreated') || 'Group created', 'success');
}

export async function handleRenameFamilyGroup(groupId) {
    const group = getGroupById(groupId);
    if (!group) return;
    const name = await asyncPrompt(t('groupName') || 'Group name:', group.name);
    if (!name || !name.trim()) return;
    updateFamilyGroupProps(groupId, { name: name.trim() });
}

export async function handleRemoveFamilyGroup(groupId) {
    if (!(await asyncConfirm(t('confirmRemoveGroup') || 'Remove this group? Families will become ungrouped.'))) return;
    removeFamilyGroup(groupId);
    showToast(t('groupRemoved') || 'Group removed', 'info');
}

export function handleToggleFamilyGroupCollapse(groupId) {
    toggleFamilyGroupCollapsed(groupId);
}

export function handleToggleFamilyUngroupedCollapse() {
    toggleFamilyUngroupedCollapsed();
}

export function handleFamilyGroupColorChange(groupId, color) {
    updateFamilyGroupProps(groupId, { color });
}

// ================================================================
// ELEMENT / FAMILY ASSIGNMENT
// ================================================================

export function handleMoveElementToGroup(elementId, groupId) {
    if (groupId) {
        setElementGroup(elementId, groupId);
    } else {
        clearElementGroup(elementId);
    }
}

export function handleMoveFamilyToGroup(familyId, groupId) {
    if (groupId) {
        setFamilyGroup(familyId, groupId);
    } else {
        clearFamilyGroup(familyId);
    }
}

// ================================================================
// EXPORT HANDLER OBJECT
// ================================================================

export const groupHandlers = {
    handleAddElementGroup,
    handleRenameElementGroup,
    handleRemoveElementGroup,
    handleToggleElementGroupCollapse,
    handleToggleElementUngroupedCollapse,
    handleElementGroupColorChange,
    handleAddFamilyGroup,
    handleRenameFamilyGroup,
    handleRemoveFamilyGroup,
    handleToggleFamilyGroupCollapse,
    handleToggleFamilyUngroupedCollapse,
    handleFamilyGroupColorChange,
    handleMoveElementToGroup,
    handleMoveFamilyToGroup,
};
