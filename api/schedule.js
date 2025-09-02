import { google } from 'googleapis';

// ====== 설정 ======
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
const MAX_ROWS_PER_DAY = 12; // 날짜칸 아래로 흡수할 최대 행 수(각주 과유입 방지)

// ====== 유틸 ======
const reYear = /(19|20)\d{2}\s*년/;
const reMonthInTitle = /(^|\D)(\d{1,2})\s*월(\D|$)/;
const weekdayTokens = [/(일|Sun)/i,/(월|Mon)/i,/(화|Tue)/i,/(수|Wed)/i,/(목|Thu)/i,/(금|Fri)/i,/(토|Sat)/i];

const pad2 = n => ('0'+n).slice(-2);
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

function parseDateCell(txt) {
  if (!txt) return null;
  const m = String(txt).match(/^\s*(\d{1,2})(?:\D|\s|$)([\s\S]*)$/);
  if (!m) return null;
  const day = +m[1]; if (day<1 || day>31) return null;
  const rest = (m[2]||'').trim();
  const lines = rest.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  return { day, lines };
}
function parseTimeFromLine(line) {
  const rng = line.match(/(\d{1,2}:\d{2})\s*[-~–]\s*(\d{1,2}:\d{2})/);
  if (rng) return { text: line.replace(rng[0],'').trim(), start: rng[1], end: rng[2] };
  const s = line.match(/(\d{1,2}:\d{2})/);
  if (s) return { text: line.replace(s[0],'').trim(), start: s[1], end: '' };
  return { text: line.trim(), start:'', end:'' };
}
function splitLines(s) { return String(s||'').split(/\r?\n/).map(v=>v.trim()).filter(Boolean); }

function detectYear(values) {
  const R = Math.min(values.length, 100), C = Math.min((values[0]||[]).length, 20);
  for (let r=0;r<R;r++){
    for (let c=0;c<C;c++){
      const v = (values[r][c]||'')+'';
      const m = v.match(reYear);
      if (m) return +m[0].replace(/[^0-9]/g,'');
    }
  }
  return null;
}
function parseMonthFromTitle(title) {
  const m = String(title||'').match(reMonthInTitle);
  return m ? +m[2] : null;
}
function detectMonthNearRow(values, row) {
  for (let i=Math.max(0,row-12); i<=Math.min(values.length-1,row+12); i++){
    const r = values[i] || [];
    for (let c=0;c<r.length;c++){
      const v = (r[c]||'')+'';
      const m = v.match(/(\d{1,2})\s*월/);
      if (m) return +m[1];
    }
  }
  return null;
}

// 한 행 안에서 "일~토" 7개가 연속으로 있는 덩어리(여러 개 가능) 찾기
function detectAllWeekHeaders(values) {
  const headers = [];
  for (let r=0; r<Math.min(values.length, 400); r++){
    const row = values[r] || [];
    let start = 0;
    while (start < row.length) {
      const cols = []; let last = start-1; let ok = true;
      for (let k=0;k<7;k++){
        let found = -1;
        for (let c=last+1; c<row.length; c++){
          const v = (row[c]||'')+'';
          if (weekdayTokens[k].test(v)){ found = c; break; }
        }
        if (found === -1){ ok=false; break; }
        cols.push(found); last = found;
      }
      if (ok) { headers.push({ row:r, cols }); start = last + 1; }
      else break;
    }
  }
  // 같은 행에서 거의 같은 위치면 중복 제거
  const uniq = [];
  const similar = (a,b)=> {
    if (a.length!==b.length) return false;
    let d=0; for (let i=0;i<a.length;i++) d += Math.abs(a[i]-b[i]);
    return d <= 3;
  };
  headers.forEach(h=>{
    const dup = uniq.some(u=>u.row===h.row && similar(u.cols,h.cols));
    if(!dup) uniq.push(h);
  });
  return uniq;
}

// "n팀" 라벨 좌표들
function detectTeamAnchors(values) {
  const anchors=[];
  for (let r=0;r<Math.min(values.length,300);r++){
    const row=values[r]||[];
    for (let c=0;c<row.length;c++){
      const v=(row[c]||'')+'';
      const m=v.match(/(\d)\s*팀/);
      if (m) { const t=+m[1]; if(t>=1&&t<=4) anchors.push({team:t,row:r,col:c}); }
    }
  }
  return anchors;
}
function nearestTeamBuilder(anchors){
  if (!anchors.length) return ()=>null;
  return (r,c)=>{
    let bestTeam=null, best=1e9;
    for (const a of anchors){
      const d = Math.abs(r-a.row)+Math.abs(c-a.col);
      if (d<best){ best=d; bestTeam=a.team; }
    }
    return bestTeam;
  };
}
function nearestDayIndex(col, dayCols) {
  let best=null, diff=1e9;
  for (let i=0;i<dayCols.length;i++){
    const d = Math.abs(col - dayCols[i]);
    if (d < diff){ diff=d; best=i; }
  }
  return best;
}

// ====== 핵심 파서 ======
function extractFromSheet(sheet) {
  const { title } = sheet.properties || {};
  const grid = sheet.data?.[0]?.rowData || [];
  const values = grid.map(r => (r?.values || []).map(v => v?.formattedValue || ''));
  const merges = (sheet.merges || []).map(m => ({
    rs: m.startRowIndex|0, re: m.endRowIndex|0,
    cs: m.startColumnIndex|0, ce: m.endColumnIndex|0
  }));

  const out = [];
  const seen = new Set();
  const year = detectYear(values) || new Date().getFullYear();
  const mFromTitle = parseMonthFromTitle(title);

  const headers = detectAllWeekHeaders(values)
    .sort((a,b)=>(a.row-b.row) || (a.cols[0]-b.cols[0]));
  if (!headers.length) return out;

  const anchors = detectTeamAnchors(values);
  const nearestTeam = nearestTeamBuilder(anchors);

  // 다음 "더 아래 행"의 헤더 row
  const nextLowerHeaderRow = idx => {
    const curr = headers[idx].row;
    for (let j=idx+1;j<headers.length;j++){
      if (headers[j].row > curr) return headers[j].row;
    }
    return values.length;
  };

  for (let i=0;i<headers.length;i++){
    const hdr = headers[i];
    const rStart = hdr.row + 1;
    const rEnd   = Math.min(nextLowerHeaderRow(i)-1, values.length-1);
    const dayCols = hdr.cols.slice();
    const month = mFromTitle ?? detectMonthNearRow(values, hdr.row) ?? (new Date().getMonth()+1);

    // 요일별 실제 "날짜 숫자" 찾기
    const dayNums = Array(7).fill(null);
    for (let j=0;j<7;j++){
      const c = dayCols[j];
      for (let r=rStart; r<=rEnd; r++){
        const head = parseDateCell((values[r]?.[c]||'').trim());
        if (head){ dayNums[j] = head.day; break; }
      }
    }

    // 1) 병합(가로 스팬) 먼저
    const minC = Math.min(...dayCols), maxC = Math.max(...dayCols);
    merges.forEach(m=>{
      // 이 블록 범위 안의 병합만
      if (m.re < rStart || m.rs > rEnd) return;
      if (m.ce < minC  || m.cs > maxC) return;

      const text = (values[m.rs]?.[m.cs] || '').trim(); // 좌상단 표시값
      if (!text) return;

      const midR = m.rs + Math.floor((m.re-m.rs)/2);
      const midC = m.cs + Math.floor((m.ce-m.cs)/2);
      const team = nearestTeam(midR, midC);
      if (!team) return;

      const sIdx = nearestDayIndex(m.cs, dayCols);
      const eIdx = nearestDayIndex(m.ce-1, dayCols); // end는 exclusive라 -1
      if (sIdx==null || eIdx==null) return;

      const lines = splitLines(text);
      for (let j=sIdx; j<=eIdx; j++){
        const dnum = dayNums[j];
        if (!dnum) continue;
        const date = ymd(new Date(year, month-1, dnum));
        for (const line of lines){
          const p = parseTimeFromLine(line);
          if (!p.text) continue;
          const key = `${date}|${team}|${p.start}|${p.end}|${p.text}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ date, team, text:p.text, start:p.start, end:p.end, color:'' });
        }
      }
    });

    // 2) 비병합: 날짜칸 아래 줄 긁기
    for (let j=0;j<7;j++){
      const c = dayCols[j];
      let hr=-1, head=null;
      for (let r=rStart; r<=rEnd; r++){
        const h = parseDateCell((values[r]?.[c]||'').trim());
        if (h){ hr=r; head=h; break; }
      }
      if (hr===-1 || !head) continue;

      const team = nearestTeam(hr, c);
      if (!team) continue;
      const dnum = dayNums[j];
      if (!dnum) continue;
      const date = ymd(new Date(year, month-1, dnum));

      const lines = [...head.lines];
      let rr = hr + 1, taken = 0;
      while (rr<=rEnd && taken<MAX_ROWS_PER_DAY){
        const t = (values[rr]?.[c] || '').trim();
        if (!t){ rr++; taken++; continue; }
        if (parseDateCell(t)) break;     // 다음 날짜 시작이면 stop
        lines.push(...splitLines(t));
        rr++; taken++;
      }
      for (const line of lines){
        const p = parseTimeFromLine(line);
        if (!p.text) continue;
        const key = `${date}|${team}|${p.start}|${p.end}|${p.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ date, team, text:p.text, start:p.start, end:p.end, color:'' });
      }
    }
  }

  return out;
}

// ====== Vercel handler ======
export default async function handler(req, res) {
  try {
    const sid = (req.query.sid || process.env.DEFAULT_SHEET_ID || '').trim();
    if (!sid) return res.status(400).json({ error: 'Missing sid (spreadsheet ID)' });

    const auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      SCOPES
    );

    const sheets = google.sheets({ version: 'v4', auth });
    // includeGridData=true → 셀 표시값/병합정보까지 함께
    const { data } = await sheets.spreadsheets.get({
      spreadsheetId: sid,
      includeGridData: true,
      fields: 'sheets(properties(title),data(rowData.values.formattedValue),merges)'
    });

    const events = [];
    for (const sh of (data.sheets || [])) {
      events.push(...extractFromSheet(sh));
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300'); // (선택) CDN 캐시
    res.status(200).json({ ok: true, count: events.length, events });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
