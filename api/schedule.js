// /api/schedule.js
export default async function handler(req, res) {
  try {
    const base = process.env.GAS_URL; // googleusercontent "echo" URL 전체
    if (!base) {
      return res.status(500).json({ ok: false, error: 'Missing GAS_URL env' });
    }

    // upstream = GAS echo URL (기존 쿼리 유지: user_content_key, lib 등)
    const upstream = new URL(base);

    // 1) Vercel/Node가 채워주는 req.query 반영
    if (req.query) {
      for (const [k, v] of Object.entries(req.query)) {
        upstream.searchParams.set(k, Array.isArray(v) ? v[0] : v);
      }
    }

    // 2) 혹시 req.query가 비어오는 환경 대비: req.url에서 직접 파싱
    //    (예: /api/schedule?mode=raw&sid=XXXX)
    if (req.url) {
      const incoming = new URL(req.url, 'http://local');
      incoming.searchParams.forEach((v, k) => {
        // 위 1)에서 이미 넣었더라도 최종 덮어쓰기
        upstream.searchParams.set(k, v);
      });
    }

    // ---- (선택) 디버그: upstream으로 실제로 어디로 나가는지 확인하고 싶으면
    // if (upstream.searchParams.get('diag') === '1') {
    //   return res.status(200).json({ ok: true, target: upstream.toString() });
    // }

    const r = await fetch(upstream.toString(), { cache: 'no-store' });
    const text = await r.text();

    // JSON 파싱 (오류 페이지일 수도 있으므로 안전하게)
    let data;
    try { data = JSON.parse(text); }
    catch {
      data = { ok: false, status: r.status, bodySample: text.slice(0, 600) };
    }

    res.status(r.ok ? 200 : r.status).json(data);
  } catch (err) {
    res.status(502).json({ ok: false, error: 'upstream error', detail: String(err) });
  }
}
