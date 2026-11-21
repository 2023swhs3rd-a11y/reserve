/*
 * 컴시간 시간표 엑셀 해석기
 * 입력: 2차원 배열(행 × 열, 문자열). 병합된 칸은 미리 같은 값으로 채워져 있어야 함.
 * 출력: [{ name, busy: { 1: [교시...], 2: [...], ... } }]  (요일 1=월 … 5=금, 6=토)
 *
 * 지원 형식
 *  (가) 교사 한 명 격자형: 머리행에 월·화·수·목·금, 왼쪽 열에 1교시·2교시… (한 시트에 여러 명이 위아래로 있어도 됨)
 *  (나) 전체 교사 목록형: 머리행에 월이 여러 번(병합) + 아랫줄에 1·2·3…, 또는 '월1','월2' 처럼 한 줄 머리행
 *       각 행이 교사 한 명 (왼쪽에 교사 이름)
 */
var Timetable = (function () {
  'use strict';
  var DAYS = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };

  function norm(v) { return String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function dayOf(v) {
    var m = /^\(?([월화수목금토])\)?(요일)?$/.exec(norm(v));
    return m ? DAYS[m[1]] : 0;
  }
  function dayPeriodOf(v) {
    var m = /^([월화수목금토])(요일)?\s*[-_.]?\s*(\d{1,2})(교시)?$/.exec(norm(v));
    return m ? { day: DAYS[m[1]], period: +m[3] } : null;
  }
  function periodOf(v) {
    var s = norm(v);
    var m = /^(\d{1,2})\s*(교시)?(\s*\(.*\))?$/.exec(s) || /^제?\s*(\d{1,2})\s*교시/.exec(s);
    if (!m) return 0;
    var n = +m[1];
    return n >= 1 && n <= 12 ? n : 0;
  }
  function isClass(v) {
    var s = norm(v);
    return !!s && !/^[-–—·.]$/.test(s) && s !== '0';
  }
  function emptyBusy() { return { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }; }
  function addBusy(b, d, p) { if (b[d].indexOf(p) < 0) b[d].push(p); }
  function sortBusy(b) { Object.keys(b).forEach(function (k) { b[k].sort(function (x, y) { return x - y; }); }); return b; }
  function countBusy(b) { return Object.keys(b).reduce(function (a, k) { return a + b[k].length; }, 0); }

  function parseRows(rows) {
    rows = (rows || []).map(function (r) { return (r || []).map(norm); });
    var wide = parseWide(rows);
    if (wide.length) return wide;
    return parseGrid(rows);
  }

  // ----- (나) 목록형 -----
  function parseWide(rows) {
    for (var r = 0; r < Math.min(rows.length, 30); r++) {
      var row = rows[r];
      var colMap = {};   // col -> {day, period}
      // 한 줄 머리행: 월1, 월2 …
      row.forEach(function (c, ci) { var dp = dayPeriodOf(c); if (dp) colMap[ci] = dp; });
      var headerRows = 1;
      if (Object.keys(colMap).length < 5) {
        // 두 줄 머리행: 요일(병합) + 교시
        colMap = {};
        var next = rows[r + 1] || [];
        var counts = {};
        row.forEach(function (c, ci) {
          var d = dayOf(c), p = periodOf(next[ci]);
          if (d && p) { colMap[ci] = { day: d, period: p }; counts[d] = (counts[d] || 0) + 1; }
        });
        var repeated = Object.keys(counts).some(function (k) { return counts[k] >= 2; });
        if (!repeated || Object.keys(colMap).length < 5) continue;
        headerRows = 2;
      }
      var cols = Object.keys(colMap).map(Number);
      var firstCol = Math.min.apply(null, cols);
      var out = [];
      for (var i = r + headerRows; i < rows.length; i++) {
        var data = rows[i];
        var name = '';
        for (var c = 0; c < firstCol; c++) {
          var t = data[c] || '';
          if (t && !/^\d+$/.test(t) && t.length > name.length) name = t;
        }
        if (!name) continue;
        var busy = emptyBusy();
        cols.forEach(function (ci) { if (isClass(data[ci])) addBusy(busy, colMap[ci].day, colMap[ci].period); });
        out.push({ name: name, busy: sortBusy(busy), count: countBusy(busy) });
      }
      if (out.length) return out;
    }
    return [];
  }

  // ----- (가) 격자형 -----
  function parseGrid(rows) {
    var out = [];
    var r = 0;
    while (r < rows.length) {
      var row = rows[r];
      var dayCols = {};
      row.forEach(function (c, ci) { var d = dayOf(c); if (d && !Object.prototype.hasOwnProperty.call(dayCols, d)) dayCols[d] = ci; });
      if (Object.keys(dayCols).length < 3) { r++; continue; }
      var firstDayCol = Math.min.apply(null, Object.keys(dayCols).map(function (k) { return dayCols[k]; }));
      // 이름: 머리행 위쪽 3줄 안의 글자
      var name = '';
      for (var u = r - 1; u >= Math.max(0, r - 3) && !name; u--) {
        name = (rows[u] || []).filter(Boolean).join(' ');
      }
      if (!name) name = row.slice(0, firstDayCol).filter(Boolean).join(' ');
      var busy = emptyBusy();
      var lastPeriod = 0, i = r + 1;
      for (; i < rows.length; i++) {
        var data = rows[i];
        // 다음 격자의 머리행이면 멈춤
        var dc = data.filter(function (c) { return dayOf(c); }).length;
        if (dc >= 3) break;
        var label = data.slice(0, firstDayCol).filter(Boolean);
        var p = 0;
        for (var k = 0; k < label.length && !p; k++) p = periodOf(label[k]);
        if (p) lastPeriod = p;
        else if (label.length) lastPeriod = 0; // '점심' 같은 다른 행
        if (!lastPeriod) continue;
        Object.keys(dayCols).forEach(function (d) {
          if (isClass(data[dayCols[d]])) addBusy(busy, +d, lastPeriod);
        });
      }
      out.push({ name: name || ('시간표 ' + (out.length + 1)), busy: sortBusy(busy), count: countBusy(busy) });
      r = i;
    }
    return out;
  }

  return { parseRows: parseRows, _dayOf: dayOf, _periodOf: periodOf };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Timetable;
