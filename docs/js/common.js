/* 공통 유틸: API 호출, 날짜, 알림 */
(function () {
  'use strict';
  var DAY = ['일', '월', '화', '수', '목', '금', '토'];

  function apiUrl() {
    var u = (window.APP_CONFIG && window.APP_CONFIG.API_URL) || '';
    return u || 'api';
  }

  async function api(action, payload) {
    var res;
    try {
      // text/plain 으로 보내야 Apps Script에서도 CORS 사전요청 없이 동작함
      res = await fetch(apiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, payload: payload || {} }),
        redirect: 'follow'
      });
    } catch (e) {
      throw new Error('서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.');
    }
    var j;
    try { j = await res.json(); } catch (e) { throw new Error('서버 응답을 읽을 수 없어요. (API 주소 설정을 확인해 주세요)'); }
    if (!j.ok) throw new Error(j.error || '오류가 발생했어요.');
    return j.data;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function parse(s) { var p = s.split('-'); return { y: +p[0], m: +p[1], d: +p[2] }; }
  function dow(s) { var p = parse(s); return new Date(p.y, p.m - 1, p.d).getDay(); }
  function pretty(s) {
    var p = parse(s);
    return p.y + '년 ' + p.m + '월 ' + p.d + '일 (' + DAY[dow(s)] + ')';
  }
  // '09:00' → '09시', '09:30' → '09시 30분'
  function hour(hm) { var p = String(hm).split(':'); return +p[1] ? p[0] + '시 ' + p[1] + '분' : p[0] + '시'; }
  function short(s) { var p = parse(s); return p.m + '/' + p.d + '(' + DAY[dow(s)] + ')'; }
  function addMonths(y, m, n) { var t = (y * 12 + (m - 1)) + n; return { y: Math.floor(t / 12), m: (t % 12) + 1 }; }
  function daysIn(y, m) { return new Date(y, m, 0).getDate(); }

  var toastTimer;
  function toast(msg, isErr) {
    var el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    el.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast' + (isErr ? ' err' : ''); }, isErr ? 4200 : 2600);
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatPhone(v) {
    var d = String(v).replace(/\D/g, '').slice(0, 11);
    if (d.indexOf('02') === 0) {
      if (d.length > 9) return d.slice(0, 2) + '-' + d.slice(2, 6) + '-' + d.slice(6, 10);
      if (d.length > 5) return d.slice(0, 2) + '-' + d.slice(2, 5) + '-' + d.slice(5);
      if (d.length > 2) return d.slice(0, 2) + '-' + d.slice(2);
      return d;
    }
    if (d.length > 10) return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
    if (d.length > 6) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
    if (d.length > 3) return d.slice(0, 3) + '-' + d.slice(3);
    return d;
  }

  function download(filename, content, type) {
    var blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  window.U = {
    api: api, DAY: DAY, pad: pad, ymd: ymd, parse: parse, dow: dow, pretty: pretty, short: short, hour: hour,
    addMonths: addMonths, daysIn: daysIn, toast: toast, esc: esc, formatPhone: formatPhone, download: download
  };
})();
