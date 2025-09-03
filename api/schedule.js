// api/schedule.js
export default async function handler(req, res) {
  const base = process.env.GAS_URL;
  if (!base) {
    res.status(500).json({ ok: false, error: 'GAS_URL env is missing' });
    return;
  }
  const qs = req.url.includes('?') ? req.url.split('?')[1] : '';
  const url = `${base}${base.includes('?') ? '&' : '?'}${qs}`;
  try {
    const r = await fetch(url, { method: 'GET' });
    const text = await r.text(); // 그대로 전달(이미 JSON 문자열)
    res.setHeader('Content-Type', 'application/json; charset=UTF-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(r.status).send(text);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
}
