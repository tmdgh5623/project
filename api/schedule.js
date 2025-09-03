// project/api/schedule.js
export default async function handler(req, res) {
  try {
    const base = process.env.GAS_URL;
    if (!base) {
      return res.status(500).json({ ok: false, error: 'Missing GAS_URL env' });
    }

    // 전달 파라미터(mode, sid) 받기
    const { mode = 'ping', sid = '' } = req.query;

    // base 이미 ?가 있으므로 &로만 붙여야 함
    const url = new URL(base);
    url.searchParams.set('mode', mode);
    if (sid) url.searchParams.set('sid', sid);

    const r = await fetch(url.toString());
    const text = await r.text(); // 가끔 text/plain으로 오기도 해서 먼저 text로 받음

    // JSON으로 파싱 시도
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // JSON이 아니면 그대로 반환(디버그용)
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
