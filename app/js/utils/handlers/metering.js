// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Version: 0.1-beta
// Authorship: Calvin Stefan Iost
// Copyright (c) 2026 Calvin Stefan Iost

/* ================================================================
   HANDLER: Metering — expoe openUsageDashboard no window.*
   ================================================================ */

import { openUsageDashboard, closeUsageDashboard } from '../ui/usageDashboard.js';

export const meteringHandlers = {
    handleOpenUsageDashboard: openUsageDashboard,
    closeUsageDashboard,
};
