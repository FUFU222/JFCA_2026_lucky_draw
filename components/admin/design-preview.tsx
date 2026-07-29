'use client';

import { useState } from 'react';

import { NumberReceipt } from '../public/number-receipt';

const DEFAULT_NUMBER = '10000';

/**
 * The pop-in and confetti on `NumberReceipt` only ever fire once per real
 * visitor, on the one day their number is issued — there is no way to see
 * them again without walking the whole entry flow. This remounts the
 * component on demand (a changed `key` restarts a CSS animation the same way
 * a fresh page load would) so the moment can be checked and re-checked
 * without spending a real or even a test-mode entry on it.
 */
export function DesignPreview() {
  const [input, setInput] = useState(DEFAULT_NUMBER);
  const [replayKey, setReplayKey] = useState(0);

  const parsed = (() => {
    try {
      const value = BigInt(input.trim() || DEFAULT_NUMBER);
      return value > BigInt(0) ? value : BigInt(DEFAULT_NUMBER);
    } catch {
      return BigInt(DEFAULT_NUMBER);
    }
  })();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label htmlFor="preview-number" className="block text-sm font-medium text-neutral-800">
            表示する番号
          </label>
          <input
            id="preview-number"
            inputMode="numeric"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="min-h-12 w-40 rounded-lg border border-neutral-300 px-3 text-base"
          />
        </div>
        <button
          type="button"
          onClick={() => setReplayKey((key) => key + 1)}
          className="min-h-12 rounded-lg bg-[var(--brand-accent)] px-5 text-base font-semibold text-white transition-colors hover:bg-[var(--brand-accent-hover)]"
        >
          アニメーションを再生
        </button>
      </div>

      <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-6 sm:p-10">
        <div className="mx-auto max-w-xl rounded-2xl bg-white p-6 shadow-sm">
          <NumberReceipt key={replayKey} number={parsed} />
        </div>
      </div>
    </div>
  );
}
