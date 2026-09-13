/**
 * Portfolio persistence. Stored as JSON alongside the rest of Franklin's
 * per-user state under `~/.blockrun/portfolio.json` by default. Read/write
 * errors never throw — a missing or corrupt file just returns `null` so the
 * agent can fall back to a fresh portfolio rather than refusing to start.
 */

import { existsSync, readFileSync } from 'node:fs';

import { Portfolio } from './portfolio.js';
import { atomicWriteFileSync } from '../storage/atomic.js';

export function savePortfolio(pf: Portfolio, filePath: string): void {
  // Atomic write so a crash mid-save can't truncate portfolio.json and
  // silently reset cross-session P&L (see storage/atomic.ts).
  atomicWriteFileSync(filePath, JSON.stringify(pf.snapshot(), null, 2));
}

export function loadPortfolio(filePath: string): Portfolio | null {
  // Prefer the live file; fall back to the atomic-write backup if it's
  // missing or corrupt rather than zeroing the portfolio.
  return readPortfolioFile(filePath) ?? readPortfolioFile(`${filePath}.bak`);
}

function readPortfolioFile(filePath: string): Portfolio | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    if (
      typeof raw?.cashUsd !== 'number' ||
      typeof raw?.realizedPnlUsd !== 'number' ||
      !Array.isArray(raw?.positions)
    ) {
      return null;
    }
    const pf = new Portfolio({ startingCashUsd: 0 });
    pf.restore(raw);
    return pf;
  } catch {
    // Corrupt JSON — caller falls back to .bak, then to a fresh portfolio.
    return null;
  }
}
