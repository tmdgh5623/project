import { google } from 'googleapis';

// ───────── auth ─────────
function getAuth() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey  = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!clientEmail || !privateKey) throw new Error('Missing Google credentials');

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
}

// ───────── helpers: 2D values + merges ─────────
function valuesFromSheetData(data = []) {
  // data[0].rowData[].values[].formattedValue → 2D 배열로 만들기
  const rows = [];
  const rowData = (data[0]?.rowData) || [];
  for (let r = 0; r < rowData.length; r++) {
    const src = rowData[r]?.values || [];
    const row = [];
    for (let c = 0; c < src.length; c++) row.push(src[c]?.formattedValue || '');
    rows.push(row);
  }
  return rows;
}

function parseMonthFromTitle(t='') {
  const m = String(t).match(/(^|\D)(\d{1,2})\s*월(\D|$)/);
  return m ? +m[2] : null;
}

function splitLines(s){ return String(s).split(/\r?\n/).map(v=>v.trim()).filter(Boolean); }
function parseDateCell(txt){
  if(!txt) return null;
  const m = String(txt).match(/^\s*(\d{1,2})(?:\D|\s|$)([\s\S]*)$/);
  if(!m) return null;
  const d=+m[1]; if(d<1||d>31) return null;
  return { day:d, lines: splitLines(m[2]||'') };
}
function parseTimeFromLine(line){
  const rng = line.match(/(\d{1,2}:\d{2})\s*[-~–]\s*(\d{1,2}:\d{2})/);
  if(rng) return {text: line.replace(rng[0],'').trim(), start:rng[1], end:rng[2]};
  const s = line.match(/(\d{1,2}:\d{2})/);
  if(s) return {text: line.replace(s[0], '').trim(), start:s[1], end:''};
  return {text: line.trim(), start:'', end:''};
}

function detectYear(vals){
  const R=Math.min(vals.length,100), C=Math.min((vals[0]||[]).length,20);
  for(let r=0;r<R;r++) for(let c=0;c<C;c++){
    const v=(vals[r][c]||'')+'';
    const m=v.match(/(19|20)\d{2}\s*년/); if(m) return +m[0].replace(/[^\d]/g,'');
  }
  return new Date().getFullYear();
}
function detectMonthNearRow(vals, r){
  for(let i=Math.max(0,r-12); i<=Math.min(vals.length-1,r+12); i++){
    const row = vals[i]||[];
    for(let c=0;c<row.length;c++){
      const v=(row[c]||'')+'';
      const m=v.match(/(\d{1,2})\s*월/); if(m) return +m[1];
    }
  }
  return null;
}
function detectAllWeekHeaders(vals){
  const headers=[]; const tokens=[/(일|Sun)/i,/(월|Mon)/i,/(화|Tue)/i,/(수|Wed)/i,/(목|Thu)/i,/(금|Fri)/i,/(토|Sat)/i];
  for(let r=0;r<Math.min(vals.length,400);r++){
    const row=vals[r]||[]; let start=0;
    while(start<row.length){
      const cols=[]; let last=start-1; let ok=true;
      for(let k=0;k<7;k++){
        let found=-1;
        for(let c=last+1;c<row.length;c++){ if(tokens[k].test((row[c]||'')+'')){ found=c; break; } }
        if(found===-1){ ok=false; break; }
        cols.push(found); last=found;
      }
      if(ok){ headers.push({row:r, cols}); start=last+1; } else break;
    }
  }
  // 같은 행에서 거의 같은 위치는 1개만
  const uniq=[];
  const similar=(a,b)=>{ if(a.length!==b.length) return false; let d=0; for(let i=0;i<a.length;i++) d+=Math.abs(a[i]-b[i]); return d<=3; };
  headers.forEach(h=>{ if(!uniq.some(u=>u.row===h.row && similar(u.cols,h.cols))) uniq.push(h); });
  return uniq;
}
function nearestDayIndex(col, dayCols){ let best=null, diff=1e9; for(let i=0;i<dayCols.length;i++){ const d=Math.abs(col-dayCols[i]); if(d<diff){diff=d; best=i;} } return best; }

// ───────── /api/schedule ─────────
export default async function handler(req, res) {
  try {
    const sid = (req.query.sid || process.env.SHEET_ID_DEFAULT || '').trim();
    if (!sid) return res.status(400).json({error:'sid is required'});

    const auth = getAuth();
    const sheets = google.sheets({ version:'v4', auth });

    // includeGridData=true → 셀 값과 merges 같이 가져오기
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: sid,
      includeGridData: true,
      fields: 'sheets(properties(title),merges,data(rowData(values(formattedValue))))'
    });

    const out = [];
    const MAX_ROWS_PER_DAY = 12;
    const seen = new Set();

    for (const S of (meta.data.sheets || [])) {
      const title = S.properties?.title || '';
      const monthFromTitle = parseMonthFromTitle(title);
      const vals = valuesFromSheetData(S.data);
      const year = detectYear(vals);
      const headers = detectAllWeekHeaders(vals).sort((a,b)=>(a.row-b.row)|| (a.cols[0]-b.cols[0]));
      if(!headers.length) continue;

      // merges: [{sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex}]
      const merges = S.merges || [];

      // 팀 라벨(가까운 팀 판정) — 간단: 라벨 좌표 수집
      const anchors = [];
      for(let r=0;r<Math.min(vals.length,300);r++){
        const row = vals[r] || [];
        for(let c=0;c<row.length;c++){
          const m = String(row[c]||'').match(/(\d)\s*팀/);
          if(m){ const t=+m[1]; if(t>=1 && t<=4) anchors.push({team:t,row:r,col:c}); }
        }
      }
      const nearestTeam=(r,c)=>{
        if(!anchors.length) return null;
        let best=null, d0=1e9;
        for(const a of anchors){ const d=Math.abs(r-a.row)+Math.abs(c-a.col); if(d<d0){d0=d; best=a.team;} }
        return best;
      };

      const nextLowerHeaderRow=(idx)=>{
        const curr=headers[idx].row;
        for(let j=idx+1;j<headers.length;j++){ if(headers[j].row > curr) return headers[j].row; }
        return vals.length;
      };

      for(let i=0;i<headers.length;i++){
        const hdr=headers[i];
        const rStart=hdr.row+1;
        const rEnd=Math.min(nextLowerHeaderRow(i)-1, vals.length-1);
        const dayCols=hdr.cols.slice();
        const month = monthFromTitle ?? detectMonthNearRow(vals, hdr.row) ?? (new Date().getMonth()+1);

        // 요일별 날짜 숫자 찾기
        const dayNums=Array(7).fill(null);
        for(let j=0;j<7;j++){
          const c=dayCols[j];
          for(let r=rStart;r<=rEnd;r++){ const h=parseDateCell((vals[r]?.[c]||'').trim()); if(h){ dayNums[j]=h.day; break; } }
        }

        // 1) 병합 처리(가로 스팬)
        for(const m of merges){
          // 병합이 이 블록 안에 걸친 경우만
          const cs=m.startColumnIndex, ce=m.endColumnIndex-1;
          const rs=m.startRowIndex,   re=m.endRowIndex-1;
          if(re < rStart || rs > rEnd) continue;          // 세로 범위 밖
          const minC=Math.min(...dayCols), maxC=Math.max(...dayCols);
          if(ce < minC || cs > maxC) continue;            // 가로 범위 밖

          const text = String(vals[rs]?.[cs] || '').trim();
          if(!text) continue;

          const midR = rs + Math.floor((re-rs+1)/2);
          const midC = cs + Math.floor((ce-cs+1)/2);
          const team = nearestTeam(midR, midC);
          if(!team) continue;

          const sIdx = nearestDayIndex(cs, dayCols);
          const eIdx = nearestDayIndex(ce, dayCols);
          if(sIdx==null || eIdx==null) continue;

          const lines = splitLines(text);
          for(let j=sIdx;j<=eIdx;j++){
            const dnum = dayNums[j]; if(!dnum) continue;
            const date = new Date(year, month-1, dnum);
            for(const line of lines){
              const p = parseTimeFromLine(line);
              if(!p.text) continue;
              const key = `${date.toISOString().slice(0,10)}|${team}|${p.start}|${p.end}|${p.text}`;
              if(seen.has(key)) continue; seen.add(key);
              out.push({date: date.toISOString().slice(0,10), team, text:p.text, start:p.start, end:p.end, color:''});
            }
          }
        }

        // 2) 일반(비병합) 셀: 날짜칸 아래 줄 흡수
        for(let j=0;j<7;j++){
          const c=dayCols[j];
          let hr=-1, head=null;
          for(let r=rStart;r<=rEnd;r++){ const h=parseDateCell((vals[r]?.[c]||'').trim()); if(h){ hr=r; head=h; break; } }
          if(hr===-1 || !head) continue;

          const tTeam = nearestTeam(hr, c);
          if(!tTeam) continue;

          const dnum = dayNums[j]; if(!dnum) continue;
          const date = new Date(year, month-1, dnum);

          const lines = [...head.lines];
          let rr=hr+1, taken=0;
          while(rr<=rEnd && taken<MAX_ROWS_PER_DAY){
            const t=(vals[rr]?.[c]||'').trim();
            if(parseDateCell(t)) break;
            if(t) lines.push(...splitLines(t));
            rr++; taken++;
          }
          for(const line of lines){
            const p=parseTimeFromLine(line);
            if(!p.text) continue;
            const key=`${date.toISOString().slice(0,10)}|${tTeam}|${p.start}|${p.end}|${p.text}`;
            if(seen.has(key)) continue; seen.add(key);
            out.push({date: date.toISOString().slice(0,10), team:tTeam, text:p.text, start:p.start, end:p.end, color:''});
          }
        }
      }
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ events: out });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err.message || err) });
  }
}
