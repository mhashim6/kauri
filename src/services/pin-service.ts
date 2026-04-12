/**
 * Pin / unpin service — toggle the `pinned` flag with soft-cap warnings.
 */
import type { KauriRecord, Warning } from '../core/types.ts';

import { bundleForId, type ServiceContext } from './context.ts';

export interface PinResult {
  readonly record: KauriRecord;
  readonly pinnedCount: number;
  readonly warnings: readonly Warning[];
}

export function pinRecord(ctx: ServiceContext, id: string, _source: string): PinResult {
  return togglePin(ctx, id, true);
}

export function unpinRecord(ctx: ServiceContext, id: string, _source: string): PinResult {
  return togglePin(ctx, id, false);
}

function togglePin(ctx: ServiceContext, id: string, pinned: boolean): PinResult {
  const now = ctx.clock.nowIso();
  const bundle = bundleForId(ctx, id);
  const warnings: Warning[] = [];

  bundle.store.tx(() => {
    bundle.records.setPinned(id, pinned, now);
  });

  const pinnedCount = bundle.records.pinnedCount();
  if (pinned && pinnedCount > bundle.meta.getPinSoftCap()) {
    warnings.push({
      code: 'pin_soft_cap_exceeded',
      message: `pinned count (${pinnedCount}) exceeds the soft cap of ${bundle.meta.getPinSoftCap()}`,
    });
  }

  const record = bundle.records.findById(id);
  // record must exist because setPinned would have thrown not_found.
  return { record: record!, pinnedCount, warnings };
}
