import { google } from 'googleapis';

// ====== 유틸 ======
const p2d = (n)=> ('0'+n).slice(-2);
const ymd = (d)=> `${d.getFullYear()}-${p2d(d.getMonth()+1)}-${p2d(d.getDate())}`;
const splitLines = (s)=> String(s||'').split(/\r?\n/).map(v=>v.trim()).filter(Boolean);

function parseDateCell(txt){
  if(!txt) return null;
  const m = String(txt).match(/^\s*(\d{1,2})(?:\D|\s|$)([\s\S]*)$/);
  if(!m) return null;
  const day = +m[1];
  if(day<1 || day>31) return null;
  return { day, lines: splitLines(m[2]||'') };
}

function parseTimeFromLine(line){
  const rng = line.match(/(\d{1,2}:\d{2})\s*[-~–]\s*(\d{1,2}:\d{2})/);
  if(rng) return { text: line.replace(rng[0],'').trim(), start:rng[1], end:rng[2] };
  const s = line.match(/(\d{1,2}:\d{2})/);
  if(s) return { text: line.replace(s[0],'').trim(), start:s[1], end:'' };
  return { text: line.trim(), start:'', end:'' };
}

// 요일 헤더 탐색
function detectAllWeekHeaders(vals){
  const headers=[];
  const tokens=[/(일|Sun)/i,/(월|Mon)/i,/(화|Tue)/i,/(수|Wed)/i,/(목|Thu)/i,/(금|Fri)/i,/(토|Sat)/i];
  for(let r=0;r<Math.min(vals.length,400);r++){
    const row = vals[r] || [];
    let start=0;
    while(start<row.length){
      const cols=[]; let last=start-1; let ok=true;
      for(let k=0;k<7;k++){
        let found=-1;
        for(let c=last+1;c<row.length;c++){
          const v=(row[c]||'')+'';
          if(tokens[k].test(v)){ found=c; break; }
        }
        if(found===-1){ ok=false; break; }
        cols.push(found); last=found;
      }
      if(ok){ headers.push({row:r, cols}); start = last+1; }
      else break;
    }
  }
  // 중복 제거
  const uniq=[];
  const similar = (a,b)=> {
    if(a.length!==b.length) return false;
    let d=0; for(let i=0;i<a.length;i++) d+=Math.abs(a[i]-b[i]);
    return d<=3;
  };
  headers.forEach(h=>{
    const dup = uniq.some(u=>u.row===h.row && similar(u.cols,h.cols));
    if(!dup) uniq.push(h);
  });
  // 정렬
  uniq.sort((a,b)=> (a.row-b.row)||(a.cols[0]-b.cols[0]));
  return uniq;
}

function parseMonthFromTitle(t){
  const s = String(t||'');
  const m = s.match(/(^|\D)(\d{1,2})\s*월(\D|$)/);
  return m ? +m[2] : null;
}

function detectYear(vals){
  const R=Math.min(vals.length,100), C=Math.min((vals[0]||[]).length,20);
  for(let r=0;r<R;r++){
    for(let c=0;c<C;c++){
      const v=(vals[r][c]||'')+'';
      const m=v.match(/(19|20)\d{2}\s*년/);
      if(m) return +m[0].replace(/[^0-9]/g,'');
    }
  }
  return null;
}

function detectMonthNearRow(vals, r){
  for(let i=Math.max(0,r-12); i<=Math.min(vals.length-1,r+12); i++){
    const row=vals[i]||[];
    for(let c=0;c<row.length;c++){
      const v=(row[c]||'')+'';
      const m=v.match(/(\d{1,2})\s*월/);
      if(m) return +m[1];
    }
  }
  return null;
}

function nearestDayIndex(col, dayCols){
  let best=null, diff=1e9;
  for(let i=0;i<dayCols.length;i++){
    const d = Math.abs(col - dayCols[i]);
    if(d < diff){ diff=d; best=i; }
  }
  return best;
}
// ====== /유틸 ======

export default async function handler(req, res){
  try{
    const spreadsheetId = req.query.s || req.query.spreadsheetId;
    if(!spreadsheetId) return res.status(400).json({error:'Missing ?s=SPREADSHEET_ID'});

    // 인증
    const auth = new google.auth.JWT(
      process.env.GOOGLE_SERVICE_EMAIL,
      null,
      (process.env.GOOGLE_PRIVATE_KEY||'').replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );
    const sheets = google.sheets({version:'v4', auth});

    // 스프레드시트 전체(텍스트 + 병합 정보) 가져오기
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      includeGridData: true,
      fields: 'sheets(properties(title,sheetId),data.rowData.values.formattedValue,merges)'
    });

    const results = [];
    const seen = new Set();

    for(const sh of meta.data.sheets || []){
      const title = sh.properties?.title || '';
      const monthFromTitle = parseMonthFromTitle(title);

      // values 2차원 배열로 변환
      const grid = [];
      const rowData = sh.data?.[0]?.rowData || [];
      const maxCols = Math.max(0, ...rowData.map(r => (r.values||[]).length));
      for(let r=0;r<rowData.length;r++){
        const row = rowData[r]?.values || [];
        const arr = new Array(maxCols).fill('');
        for(let c=0;c<maxCols;c++){
          const v = row[c]?.formattedValue ?? '';
          arr[c] = String(v);
        }
        grid.push(arr);
      }

      const headers = detectAllWeekHeaders(grid);
      if(!headers.length) continue;

      const year = detectYear(grid) || new Date().getFullYear();

      const nextLowerRow = (idx)=>{
        const curr = headers[idx].row;
        for(let j=idx+1;j<headers.length;j++){
          if(headers[j].row > curr) return headers[j].row;
        }
        return grid.length;
      };

      for(let i=0;i<headers.length;i++){
        const hdr = headers[i];
        const rStart = hdr.row + 1;
        const rEnd   = Math.min(nextLowerRow(i)-1, grid.length-1);
        const dayCols = hdr.cols.slice();
        const month = monthFromTitle ?? detectMonthNearRow(grid, hdr.row) ?? (new Date().getMonth()+1);

        // 요일별 날짜 숫자 찾기
        const dayNums = Array(7).fill(null);
        for(let j=0;j<7;j++){
          const c = dayCols[j];
          for(let r=rStart; r<=rEnd; r++){
            const head = parseDateCell((grid[r]?.[c]||'').trim());
            if(head){ dayNums[j]=head.day; break; }
          }
        }

        // 병합(merges) 먼저 처리: startRow/Col ~ endRow/Col
        const merges = sh.merges || [];
        const minC = Math.min(...dayCols), maxC = Math.max(...dayCols);
        merges.forEach(m=>{
          const sr = m.startRowIndex ?? 0, er = (m.endRowIndex ?? 0)-1;
          const sc = m.startColumnIndex ?? 0, ec = (m.endColumnIndex ?? 0)-1;
          // 이 병합이 현재 블록 범위에 걸쳐있는가?
          if(er < rStart || sr > rEnd) return;
          if(ec < minC || sc > maxC) return;

          const txt = String(grid[sr]?.[sc]||'').trim();
          if(!txt) return;

          const midC = Math.floor((sc+ec)/2);
          const startIdx = nearestDayIndex(sc, dayCols);
          const endIdx   = nearestDayIndex(ec, dayCols);
          if(startIdx==null || endIdx==null) return;

          for(let j=startIdx;j<=endIdx;j++){
            const dnum = dayNums[j];
            if(!dnum) continue;
            const date = ymd(new Date(year, month-1, dnum));
            for(const line of splitLines(txt)){
              const p = parseTimeFromLine(line);
              if(!p.text) continue;
              const key = `${date}|${p.start}|${p.end}|${p.text}`;
              if(seen.has(key)) continue;
              seen.add(key);
              // 팀은 우선 1~4 추정이 어려우므로 임시 1로(필요시 추정 로직 추가)
              results.push({ date, team:1, text:p.text, start:p.start, end:p.end, color:'' });
            }
          }
        });

        // 개별 날짜칸 처리: 헤더칸 + 아래 줄
        for(let j=0;j<7;j++){
          const c = dayCols[j];
          let hr=-1, head=null;
          for(let r=rStart; r<=rEnd; r++){
            const h=parseDateCell((grid[r]?.[c]||'').trim());
            if(h){ hr=r; head=h; break; }
          }
          if(hr===-1 || !head) continue;

          const dnum = dayNums[j];
          if(!dnum) continue;
          const date = ymd(new Date(year, month-1, dnum));

          const lines = [...head.lines];
          let rr = hr + 1, taken = 0, MAX_ROWS_PER_DAY = 12;
          while(rr<=rEnd && taken < MAX_ROWS_PER_DAY){
            const t = (grid[rr]?.[c]||'').trim();
            if(parseDateCell(t)) break;
            if(t) lines.push(...splitLines(t));
            rr++; taken++;
          }

          for(const line of lines){
            const p = parseTimeFromLine(line);
            if(!p.text) continue;
            const key = `${date}|${p.start}|${p.end}|${p.text}`;
            if(seen.has(key)) continue;
            seen.add(key);
            results.push({ date, team:1, text:p.text, start:p.start, end:p.end, color:'' });
          }
        }
      }
    }

    res.status(200).json({ events: results });
  }catch(err){
    // 에러를 화면에서 바로 볼 수 있게 자세히 내려줌
    res.status(500).json({
      error: String(err && err.message ? err.message : err),
      hint: [
        '1) 시트를 서비스계정 메일로 공유했는지 확인',
        '2) Vercel 환경변수 3개가 모두 저장되어 있는지 확인',
        '3) GOOGLE_PRIVATE_KEY는 줄바꿈을 \\n 으로 넣었는지 확인',
        '4) /api/ping 으로 함수/환경변수 정상 확인'
      ]
    });
  }
}
