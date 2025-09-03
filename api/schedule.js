// /api/schedule.js
export default async function handler(req, res) {
  try {
    const base = process.env.GAS_URL; // ← googleusercontent "echo" URL 전체
    if (!base) {
      return res.status(500).json({ ok: false, error: 'Missing GAS_URL env' });
    }

    // base에 원래 붙어있던 파라미터 유지 + 클라이언트 쿼리(mode, sid 등) 그대로 추가
    const upstream = new URL(base);
    for (const [k, v] of Object.entries(req.query || {})) {
      if (Array.isArray(v)) upstream.searchParams.set(k, v[0]);
      else if (v !== undefined) upstream.searchParams.set(k, v);
    }

    const r = await fetch(upstream.toString(), { cache: 'no-store' });
    const text = await r.text();

    // JSON 파싱 시도 (오류 페이지일 수도 있으니 텍스트도 보관)
    let data;
    try { data = JSON.parse(text); }
    catch { data = { ok: false, status: r.status, bodySample: text.slice(0, 500) }; }

    res.status(r.ok ? 200 : r.status).json(data);
  } catch (err) {
    res.status(502).json({ ok: false, error: 'upstream error', detail: String(err) });
  }
}
