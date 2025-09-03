// /api/schedule.js
export default async function handler(req, res) {
  try {
    // 1) 환경변수 필수 체크
    const GAS = (process.env.GAS_URL || "").replace(/\/$/, ""); // 끝의 / 제거
    const SID = process.env.SHEET_ID || "";
    if (!GAS || !SID) {
      res.status(500).json({ ok: false, error: "Missing env GAS_URL or SHEET_ID" });
      return;
    }

    // 2) 쿼리 구성 (기본 raw, sid 없으면 기본 SID)
    const mode = req.query.mode === "sheets" ? "sheets" : "raw";
    const sid  = encodeURIComponent(req.query.sid || SID);
    const url  = `${GAS}?mode=${mode}&sid=${sid}`;

    // 3) 요청 (캐시 금지)
    const r = await fetch(url, { method: "GET", cache: "no-store" });
    const text = await r.text(); // 먼저 text로 받음 (HTML/JSONP 보호)

    // 4) JSON 안전 파싱 (JSON → 실패시 JSONP 콜백 형태도 시도)
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      const m = text.match(/^[^(]+\((.*)\)\s*$/s); // callback(JSON) 캡쳐
      if (m) {
        data = JSON.parse(m[1]);
      }
    }

    if (!r.ok || !data) {
      res.status(502).json({
        ok: false,
        error: "Upstream error",
        status: r.status,
        bodySample: text.slice(0, 400)
      });
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
}
