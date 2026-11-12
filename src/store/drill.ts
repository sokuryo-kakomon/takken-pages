import { persistentAtom } from '@nanostores/persistent';

// 一問一答（肢ごとの○×）と模擬試験の記録。成績表と同じく端末の localStorage だけに置く。

export interface OxRec { ok: boolean; n: number; ng: number; at: number }
export type OxProgress = Record<string, OxRec>;

const codec = {
  encode: JSON.stringify,
  decode: (s: string) => { try { return JSON.parse(s); } catch { return undefined; } },
};

export const $ox = persistentAtom<OxProgress>('takken_ox_v1', {}, codec);
// 無料の○×も回数の制限なし（数える仕組みは残す）。{ d: '2026-11-04', n: 3 }
export const $oxDay = persistentAtom<{ d: string; n: number }>('takken_ox_day', { d: '', n: 0 }, codec);
// 無料の模擬試験のお試し（1回だけ）。{ shi: true }
export const $mogiTrial = persistentAtom<Record<string, boolean>>('takken_mogi_trial', {}, codec);

export const FREE_OX_PER_DAY = Infinity; // 11-12 本人: 一問一答は無料でも回数の制限なし
export const today = () => new Date().toLocaleDateString('sv-SE'); // 端末の日付で YYYY-MM-DD

export function oxUsedToday() {
  const d = $oxDay.get();
  return d.d === today() ? d.n : 0;
}
export function countOx() {
  $oxDay.set({ d: today(), n: oxUsedToday() + 1 });
}

export function recordOx(id: string, ok: boolean) {
  const p = $ox.get()[id];
  $ox.set({ ...$ox.get(), [id]: { ok, n: (p?.n || 0) + 1, ng: (p?.ng || 0) + (ok ? 0 : 1), at: Date.now() } });
}
