import { persistentAtom } from '@nanostores/persistent';

// AI に質問の利用コード（有料プラン）。ログインは無く、このブラウザに保存したコードで見分ける。
export const $aiCode = persistentAtom<string>('takken_ai_code', '');

export const AI_ENDPOINT: string | undefined = import.meta.env.PUBLIC_AI_ENDPOINT;

export const normalizeCode = (s: string) => {
  const t = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return t.length === 16 ? t.match(/.{4}/g)!.join('-') : s.trim().toUpperCase();
};

export async function postJson<T>(path: string, body: unknown): Promise<{ ok: boolean; data: T & { error?: string } }> {
  const r = await fetch(`${AI_ENDPOINT}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { ok: r.ok, data: await r.json().catch(() => ({ error: '通信に失敗しました。' })) };
}

// 有料プランかどうか。利用コードを中継サーバーに聞き、このタブの間は覚えておく（ページを移るたびに聞かない）。
// 模擬試験・○× の回数の線に使う。端末側の判定なので外せるが、価値の中心の AI は中継サーバー側で止まる。
export type PaidState = 'checking' | 'paid' | 'free';
export async function checkPaid(code: string): Promise<PaidState> {
  if (!code || !AI_ENDPOINT) return 'free';
  const key = 'takken_paid_' + code;
  try {
    const c = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (c && Date.now() - c.at < 10 * 60 * 1000) return c.paid ? 'paid' : 'free';
  } catch { /* 読めなければ聞き直す */ }
  try {
    const { ok, data } = await postJson<{ active: boolean }>('/status', { code });
    const paid = ok && !!data.active;
    try { sessionStorage.setItem(key, JSON.stringify({ paid, at: Date.now() })); } catch { /* 保存できなくても動く */ }
    return paid ? 'paid' : 'free';
  } catch {
    return 'free';
  }
}

// AI の弱点分析の材料と結果（この端末にだけ残す。サーバーには送るだけで残さない）
const jsonCodec = { encode: JSON.stringify, decode: (s: string) => { try { return JSON.parse(s); } catch { return undefined; } } };
export type AiLogRec = { qid: string; q: string; at: number };
// AI に聞いた問題と質問文（直近50件・1件200字まで）
export const $aiLog = persistentAtom<AiLogRec[]>('takken_ai_log_v1', [], jsonCodec);
export function logAsk(qid: string, q: string) {
  const t = q.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (t) $aiLog.set([...$aiLog.get(), { qid, q: t, at: Date.now() }].slice(-50));
}
// 前の分析の結果（解いた数も一緒に。新しく10問解くまで押せない）
export const $analysis = persistentAtom<{ at: number; answered: number; res: unknown } | null>('takken_ai_bunseki_v1', null, jsonCodec);
// 「AI に送る物」を一度見せたか
export const $bunsekiOk = persistentAtom<boolean>('takken_ai_bunseki_ok', false, jsonCodec);
