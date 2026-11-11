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
