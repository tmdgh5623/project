// /api/schedule.js
export default async function handler(req, res) {
  try {
    const base = process.env.GAS_URL; // googleusercontent "echo" 전체 URL
    if (!base) return res.status(500).json({ ok: false, error: "Missing GAS_URL env" });

    // upstream = GAS echo URL (기존 user_content_key, lib 그대로 보존)
    const upstream = new URL(base);

    // (A) Vercel가 파싱한 쿼리 반영
    if (req.query) {
      for (const [k, v] of Object.entries(req.query)) {
        upstream.searchParams.set(k, Array.isArray(v) ? v[0] : v);
      }
    }

    // (B) 혹시 req.query가 비어오는 경우 대비: req.url에서 직접 추출
    if (req.url) {
      const incoming = new URL(req.url, "http://local");
      incoming.searchParams.forEach((v, k) => upstream.searchParams.set(k, v));
    }

    // 🔍 진단 모드: 실제로 호출될 GAS URL을 그대로 보여줌(네트워크 호출 안 함)
    if (upstream.searchParams.get("diag") === "1") {
      return res.status(200).json({
        ok: true,
        target: upstream.toString(),
        note: "This is the exact URL the proxy would request.",
      });
    }

    // 실제 호출
    const r = await fetch(upstream.toString(), { cache: "no-store" });
    const text = await r.text();

    // JSON 파싱 (HTML 에러일 수도 있으니 안전하게)
    let data;
    try { data = JSON.parse(text); }
    catch { data = { ok: false, status: r.status, bodySample: text.slice(0, 800) }; }

    res.status(r.ok ? 200 : r.status).json(data);
  } catch (err) {
    res.status(502).json({ ok: false, error: "upstream error", detail: String(err) });
  }
}
