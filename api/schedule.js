// CommonJS (Vercel Node.js 함수)
const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

function txt(v) { return (v ?? '').toString(); }
function ymd(d) {
  const p = n => ('0' + n).slice(-2);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function splitLines(s) {
  return txt(s).split(/\r?\n/).map(v => v.trim()).filter(Boolean);
}
function parseTimeFromLine(line) {
  const rng = line.match(/(\d{1,2}:\d{2})\s*[-~–]\s*(\d{1,2}:\d{2})/);
  if (rng) return { text: line.replace(rng[0], '').trim(), start: rng[1], end: rng[2] };
  const s = line.match(/(\d{1,2}:\d{2})/);
  if (s) return { text: line.replace(s[0], '').trim(), start: s[1], end: '' };
  return { text: line.trim(), start: '', end: '' };
}
function parseMonthFromTitle(t) {
  const m = txt(t).match(/(^|\D)(\d{1,2})\s*월(\D|$)/);
  return m ? +m[2] : null;
}
function parseDateCell(s) {
  const m = txt(s).match(/^\s*(\d{1,2})(?:\D|\s|$)([\s\S]*)$/);
  if (!m) return null;
  const day = +m[1];
  if (day < 1 || day > 31) return null;
  return { day, lines: splitLines(m[2] || '') };
}

function detectAllWeekHeaders(vals) {
  const headers = [];
  const tokens = [/(일|Sun)/i,/(월|Mon)/i,/(화|Tue)/i,/(수|Wed)/i,/(목|Thu)/i,/(금|Fri)/i,/(토|Sat)/i];
  for (let r = 0; r < Math.min(vals.length, 400); r++) {
    const row = vals[r] || [];
    let start = 0;
    while (start < row.length) {
      const cols = []; let last = start - 1; let ok = true;
      for (let k = 0; k < 7; k++) {
        let found = -1;
        for (let c = last + 1; c < row.length; c++) {
          const v = txt(row[c]);
          if (tokens[k].test(v)) { found = c; break; }
        }
        if (found === -1) { ok = false; break; }
        cols.push(found); last = found;
      }
      if (ok) { headers.push({ row: r, cols }); start = last + 1; }
      else break;
    }
  }
  // 같은 행에서 거의 같은 위치는 1개만
  const uniq = [];
  const similar = (a, b) => {
    if (a.length !== b.length) return false;
    let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    return d <= 3;
  };
  headers.forEach(h => {
    const dup = uniq.some(u => u.row === h.row && similar(u.cols, h.cols));
    if (!dup) uniq.push(h);
  });
  return uniq;
}

function detectTeamAnchors(vals) {
  const anchors = [];
  for (let r = 0; r < Math.min(vals.length, 300); r++) {
    const row = vals[r] || [];
    for (let c = 0; c < row.length; c++) {
      const m = txt(row[c]).match(/(\d)\s*팀/);
      if (m) { const t = +m[1]; if (t >= 1 && t <= 4) anchors.push({ team: t, row: r, col: c }); }
    }
  }
  return anchors;
}
function nearestTeam(anchors, r, c) {
  if (!anchors.length) return null;
  let bestTeam = null, best = 1e9;
  for (const a of anchors) {
    const d = Math.abs(r - a.row) + Math.abs(c - a.col);
    if (d < best) { best = d; bestTeam = a.team; }
  }
  return bestTeam;
}
function guessTeamByTextAround(vals, r, c) {
  for (let i = Math.max(0, r - 20); i <= Math.min(vals.length - 1, r + 20); i++) {
    for (let j = Math.max(0, c - 10); j <= Math.min((vals[i] || []).length - 1, c + 10); j++) {
      const m = txt((vals[i] || [])[j]).match(/(\d)\s*팀/);
      if (m) { const t = +m[1]; if (t >= 1 && t <= 4) return t; }
    }
  }
  return null;
}
function nearestDayIndex(col, dayCols) {
  let best = null, diff = 1e9;
  for (let i = 0; i < dayCols.length; i++) {
    const d = Math.abs(col - dayCols[i]);
    if (d < diff) { diff = d; best = i; }
  }
  return best;
}

module.exports = async (req, res) => {
  try {
    const sid = (req.query.sid || '').trim();
    if (!sid) return res.status(400).json({ error: 'missing sid' });

    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const jwt = new google.auth.JWT(
      process.env.GOOGLE_SERVICE_EMAIL,
      null,
      privateKey,
      SCOPES
    );

    const sheets = google.sheets({ version: 'v4', auth: jwt });

    // 시트 전체 + 그리드데이터까지
    const { data } = await sheets.spreadsheets.get({
      spreadsheetId: sid,
      includeGridData: true
    });

    const events = [];
    const dedupe = new Set();

    for (const sh of data.sheets || []) {
      const title = sh.properties?.title || '';
      const grids = sh.data || [];
      if (!grids.length) continue;

      // 2D values
      const rowCount = sh.properties?.gridProperties?.rowCount || 0;
      const colCount = sh.properties?.gridProperties?.columnCount || 0;
      const vals = Array.from({ length: rowCount }, (_, r) =>
        Array.from({ length: colCount }, (_, c) => {
          const cell = grids[0]?.rowData?.[r]?.values?.[c];
          return cell?.formattedValue ?? '';
        })
      );

      const year = (() => {
        for (let r = 0; r < Math.min(vals.length, 100); r++) {
          for (let c = 0; c < Math.min((vals[0] || []).length, 20); c++) {
            const m = txt(vals[r][c]).match(/(19|20)\d{2}\s*년/);
            if (m) return +m[0].replace(/[^0-9]/g, '');
          }
        }
        return new Date().getFullYear();
      })();

      const month = parseMonthFromTitle(title) ?? (() => {
        // 헤더 주변에서 "n월" 찾기
        const headers = detectAllWeekHeaders(vals);
        if (!headers.length) return (new Date().getMonth() + 1);
        const hr = headers[0].row;
        for (let i = Math.max(0, hr - 12); i <= Math.min(vals.length - 1, hr + 12); i++) {
          for (let c = 0; c < (vals[i] || []).length; c++) {
            const m = txt(vals[i][c]).match(/(\d{1,2})\s*월/);
            if (m) return +m[1];
          }
        }
        return (new Date().getMonth() + 1);
      })();

      const headers = detectAllWeekHeaders(vals).sort((a, b) =>
        (a.row - b.row) || (a.cols[0] - b.cols[0])
      );
      if (!headers.length) continue;

      const anchors = detectTeamAnchors(vals);
      const merges = (sh.merges || []).map(m => ({
        r1: m.startRowIndex ?? 0,
        r2: (m.endRowIndex ?? 0) - 1,
        c1: m.startColumnIndex ?? 0,
        c2: (m.endColumnIndex ?? 0) - 1
      }));

      const nextLowerHeaderRow = (idx) => {
        const curr = headers[idx].row;
        for (let j = idx + 1; j < headers.length; j++) {
          if (headers[j].row > curr) return headers[j].row;
        }
        return vals.length;
      };

      for (let i = 0; i < headers.length; i++) {
        const hdr = headers[i];
        const rStart = hdr.row + 1;
        const rEnd = Math.min(nextLowerHeaderRow(i) - 1, vals.length - 1);
        const dayCols = hdr.cols.slice();

        // 각 요일의 날짜숫자
        const dayNums = Array(7).fill(null);
        for (let j = 0; j < 7; j++) {
          const c = dayCols[j];
          for (let r = rStart; r <= rEnd; r++) {
            const head = parseDateCell(vals[r]?.[c]);
            if (head) { dayNums[j] = head.day; break; }
          }
        }

        // 1) 병합(가로 스팬) 먼저
        const minC = Math.min.apply(null, dayCols);
        const maxC = Math.max.apply(null, dayCols);
        for (const m of merges) {
          if (m.r2 < rStart || m.r1 > rEnd) continue; // 블록 밖
          if (m.c2 < minC || m.c1 > maxC) continue; // 요일칸 바깥

          const tl = txt(vals[m.r1]?.[m.c1]);
          if (!tl.trim()) continue;

          const midR = m.r1 + Math.floor((m.r2 - m.r1 + 1) / 2);
          const midC = m.c1 + Math.floor((m.c2 - m.c1 + 1) / 2);
          let team = nearestTeam(anchors, midR, midC) ?? guessTeamByTextAround(vals, midR, midC);
          if (!team) continue;

          const sIdx = nearestDayIndex(m.c1, dayCols);
          const eIdx = nearestDayIndex(m.c2, dayCols);
          if (sIdx == null || eIdx == null) continue;

          const lines = splitLines(tl);
          for (let j = sIdx; j <= eIdx; j++) {
            const dnum = dayNums[j];
            if (!dnum) continue;
            const date = ymd(new Date(year, month - 1, dnum));
            for (const line of lines) {
              const p = parseTimeFromLine(line);
              if (!p.text) continue;
              const key = `${date}|${team}|${p.start}|${p.end}|${p.text}`;
              if (dedupe.has(key)) continue;
              dedupe.add(key);
              events.push({ date, team, text: p.text, start: p.start, end: p.end, color: '' });
            }
          }
        }

        // 2) 일반(비병합) – 날짜칸 아래 줄들 수집
        for (let j = 0; j < 7; j++) {
          const c = dayCols[j];
          let hr = -1, head = null;
          for (let r = rStart; r <= rEnd; r++) {
            const h = parseDateCell(vals[r]?.[c]);
            if (h) { hr = r; head = h; break; }
          }
          if (hr === -1 || !head) continue;

          const dnum = dayNums[j];
          if (!dnum) continue;
          const date = ymd(new Date(year, month - 1, dnum));

          let team = nearestTeam(anchors, hr, c) ?? guessTeamByTextAround(vals, hr, c);
          if (!team) continue;

          const lines = [...head.lines];
          let rr = hr + 1;
          let taken = 0;
          while (rr <= rEnd && taken < 14) { // 안전상한
            const t = txt(vals[rr]?.[c]).trim();
            // 다음 날짜칸 만나면 stop
            if (parseDateCell(t)) break;
            // 병합칸 내부의 꼬리줄 중복 방지(해당 칸이 병합 내부인지 대략 체크)
            const insideMerge = merges.some(m => rr >= m.r1 && rr <= m.r2 && c >= m.c1 && c <= m.c2);
            if (!insideMerge && t) lines.push(...splitLines(t));
            rr++; taken++;
          }

          for (const line of lines) {
            const p = parseTimeFromLine(line);
            if (!p.text) continue;
            const key = `${date}|${team}|${p.start}|${p.end}|${p.text}`;
            if (dedupe.has(key)) continue;
            dedupe.add(key);
            events.push({ date, team, text: p.text, start: p.start, end: p.end, color: '' });
          }
        }
      }
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600');
    return res.status(200).json({ events });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
};
