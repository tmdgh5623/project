// project/api/schedule.js
export default async function handler(req, res) {
  try {
    const base = process.env.GAS_URL;
    if (!base) return res.status(500).json({ ok: false, error: 'Missing GAS_URL env' });

    const { mode = 'ping', sid = '' } = req.query;

    // base 에 이미 ? 가 있으므로 & 로만 이어붙입니다.
    const sep = base.includes('?') ? '&' : '?';
    const target =
      base +
      sep +
      `mode=${encodeURIComponent(mode)}` +
      (sid ? `&sid=${encodeURIComponent(sid)}` : '');

    const r = await fetch(target);
    const text = await r.text(); // 혹시 text/plain 으로 올 때 대비

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // JSON 파싱이 안되면 그대로 내려주기(디버깅용)
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(r.ok ? 200 : r.status).send(text);
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (err) {
    console.error('schedule api error:', err);
    return res.status(502).json({ ok: false, error: String(err) });
  }
}
