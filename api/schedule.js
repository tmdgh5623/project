// /api/schedule.js  (Vercel/Node 서버리스)
export default async function handler(req, res) {
  const GAS_URL   = process.env.GAS_SCHEDULE_URL
                 || 'https://script.google.com/macros/s/https://script.google.com/macros/s/AKfycbzT8n74FDLLtxNKys_h9JI80Bl2otg095MwbGL1gUACHzsfkPaunINTColdUeYDtwJkDw/exec';
  const SHEET_ID  = process.env.SCHEDULE_SHEET_ID
                 || '17RCw2gBxseB36Ac9kF7zYXZ4qFTaXP7KsAiKY9uPbN4';

  const url = `${GAS_URL}?mode=raw&sid=${encodeURIComponent(SHEET_ID)}&t=${Date.now()}`;

  try {
    const r = await fetch(url, { headers: { 'cache-control': 'no-cache' }});
    const data = await r.json();
    if (!data.ok) return res.status(500).json(data);
    // data.sheets = { '1월 1팀': {gid, values:[...]}, ... }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(data.sheets);
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e) });
  }
}
