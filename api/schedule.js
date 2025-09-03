// /api/schedule.js
export default async function handler(req, res) {
  const { mode = 'ping', sid = '', diag } = req.query || {};
  const BASE = process.env.GAS_URL;           // ✅ 반드시 /exec 로 끝나는 웹앱 URL
  if (!BASE) return res.status(500).json({ ok:false, error:'Missing GAS_URL' });

  // 목적지 URL 구성
  const u = new URL(BASE);
  if (mode) u.searchParams.set('mode', mode);
  if (sid)  u.searchParams.set('sid',  sid);

  // 진단: 실제로 어디로 던지는지 보여주기
  if (diag === '1') {
    return res.status(200).json({ ok:true, target: u.toString() });
  }

  try {
    const resp = await fetch(u.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });

    const ct = resp.headers.get('content-type') || '';
    const text = await resp.text();

    // Apps Script가 에러일 때 HTML 페이지(Drive/“열 수 없습니다”)를 돌려주기도 하므로,
    // 컨텐츠 타입을 보고 분기한다.
    if (ct.includes('application/json')) {
      let data;
      try {
        // 혹시 보호문자( )]}') 가 앞에 붙었으면 제거
        const cleaned = text.replace(/^[)\]\}'\s]+/, '');
        data = JSON.parse(cleaned);
      } catch (e) {
        return res.status(502).json({
          ok: false,
          error: 'Upstream JSON parse error',
          upstreamStatus: resp.status,
          bodySample: text.slice(0, 500),
        });
      }
      // upstream이 200이 아니라도 메시지와 함께 내려보내 주자
      if (!resp.ok) {
        return res.status(502).json({
          ok: false,
          error: `Upstream ${resp.status}`,
          data,
        });
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(200).json(data);
    }

    // JSON이 아니면 그대로 샘플 띄워서 원인 보이게
    return res.status(502).json({
      ok: false,
      error: 'Upstream not JSON',
      upstreamStatus: resp.status,
      contentType: ct,
      bodySample: text.slice(0, 800),
    });
  } catch (err) {
    return res.status(500).json({ ok:false, error:String(err) });
  }
}
