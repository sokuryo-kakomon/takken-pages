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
