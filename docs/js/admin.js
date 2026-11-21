/* 관리자 화면 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var qsa = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var KEY = 'counsel-admin-pw';
  var A = { pw: '', st: null, tpl: null, view: null, selDate: null, tt: { book: null, cands: [], busy: null }, periods: [] };
  var WD_ORDER = [1, 2, 3, 4, 5, 6, 0];

  function getPw() { try { return sessionStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function setPw(v) { try { if (v) sessionStorage.setItem(KEY, v); else sessionStorage.removeItem(KEY); } catch (e) { /* 무시 */ } }

  function call(action, payload) {
    payload = Object.assign({}, payload || {}, { password: A.pw });
    return U.api(action, payload).catch(function (e) {
      if (/비밀번호/.test(e.message) && action !== 'admin.changePassword') { logout(); }
      throw e;
    });
  }

  // ---------- 로그인 ----------
  $('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    A.pw = $('pw').value;
    try {
      await call('admin.login');
      setPw(A.pw);
      $('pw').value = '';
      await enter();
    } catch (ex) { U.toast(ex.message, true); }
  });

  function logout() {
    A.pw = ''; setPw('');
    $('adminView').classList.add('hidden');
    $('loginView').classList.remove('hidden');
  }
  $('logoutBtn').onclick = logout;

  async function enter() {
    $('loginView').classList.add('hidden');
    $('adminView').classList.remove('hidden');
    await reload();
  }

  async function reload() {
    A.st = await call('admin.state');
    A.tpl = JSON.parse(JSON.stringify(A.st.template));
    A.periods = JSON.parse(JSON.stringify(A.st.settings.periods || []));
    if (!A.view) { var t = U.parse(A.st.today); A.view = { y: t.y, m: t.m }; }
    $('pwWarn').classList.toggle('hidden', !A.st.usingInitialPassword);
    renderAll();
  }

  function renderAll() {
    renderStats(); renderRes(); renderTpl(); renderAdminCal(); renderDayEditor();
    renderPeriods(); renderTT(); fillSettings();
  }

  // ---------- 탭 ----------
  qsa('#adminTabs button').forEach(function (b) {
    b.onclick = function () {
      qsa('#adminTabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
      ['res', 'avail', 'tt', 'set'].forEach(function (k) { $('tab-' + k).classList.toggle('hidden', k !== b.dataset.tab); });
    };
  });

  // ---------- 예약 현황 ----------
  var STATUS = { booked: '예약', done: '완료', cancelled: '취소' };

  function renderStats() {
    var today = A.st.today, rs = A.st.reservations;
    var up = rs.filter(function (r) { return r.status === 'booked' && r.date >= today; });
    var todayN = up.filter(function (r) { return r.date === today; }).length;
    var parentN = up.filter(function (r) { return r.parent; }).length;
    var doneN = rs.filter(function (r) { return r.status === 'done'; }).length;
    $('stats').innerHTML =
      '<div class="stat"><b>' + todayN + '</b><span>오늘 상담</span></div>' +
      '<div class="stat"><b>' + up.length + '</b><span>다가오는 예약</span></div>' +
      '<div class="stat"><b>' + parentN + '</b><span>학부모 참여 예정</span></div>' +
      '<div class="stat"><b>' + doneN + '</b><span>상담 완료</span></div>';
  }

  function filteredRes() {
    var f = $('resFilter').value, q = $('resSearch').value.trim(), today = A.st.today;
    var list = A.st.reservations.filter(function (r) {
      if (f === 'upcoming' && !(r.status !== 'cancelled' && r.date >= today)) return false;
      if (f === 'past' && !(r.status !== 'cancelled' && r.date < today)) return false;
      if (f === 'cancelled' && r.status !== 'cancelled') return false;
      if (q && (r.studentId + ' ' + r.name).indexOf(q) < 0) return false;
      return true;
    });
    if (f === 'past') list = list.slice().reverse();
    return list;
  }

  function topicText(r) {
    var t = (r.topics || []).slice();
    if (r.topicEtc) t.push(r.topicEtc);
    return t.join(', ');
  }

  function renderRes() {
    var list = filteredRes();
    if (!list.length) { $('resTable').innerHTML = '<tr><td class="empty-msg">해당하는 예약이 없어요.</td></tr>'; return; }
    $('resTable').innerHTML = '<thead><tr><th>날짜</th><th>시간</th><th>학번</th><th>성명</th><th>연락처</th><th>학부모</th><th>문의 내용</th><th>상태</th></tr></thead><tbody>' +
      list.map(function (r) {
        return '<tr class="clickable" data-id="' + U.esc(r.id) + '">' +
          '<td>' + U.esc(U.short(r.date)) + '</td><td>' + U.esc(r.start) + '~' + U.esc(r.end) + '</td>' +
          '<td>' + U.esc(r.studentId) + '</td><td>' + U.esc(r.name) + '</td><td>' + U.esc(r.phone) + '</td>' +
          '<td>' + (r.parent ? '참여' : '-') + '</td><td class="wrap-cell">' + U.esc(topicText(r)) + '</td>' +
          '<td><span class="badge ' + r.status + '">' + STATUS[r.status] + '</span></td></tr>';
      }).join('') + '</tbody>';
  }
  $('resFilter').onchange = renderRes;
  $('resSearch').oninput = renderRes;
  $('reloadBtn').onclick = function () { reload().then(function () { U.toast('새로고침했어요.'); }).catch(function (e) { U.toast(e.message, true); }); };

  $('resTable').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-id]');
    if (tr) openRes(tr.dataset.id);
  });

  function openRes(id) {
    var r = A.st.reservations.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    var row = function (k, v) { return '<dt>' + k + '</dt><dd>' + U.esc(v || '-') + '</dd>'; };
    $('modalBody').innerHTML =
      '<h2 style="margin-top:0">' + U.esc(r.studentId + ' ' + r.name) + ' <span class="badge ' + r.status + '">' + STATUS[r.status] + '</span></h2>' +
      '<dl>' +
      row('일정', U.pretty(r.date) + ' ' + r.start + '~' + r.end) +
      row('연락처', r.phone) + row('학부모 참여', r.parent ? '참여' : '불참') +
      row('문의 내용', (r.topics || []).join(', ')) + row('직접 입력', r.topicEtc) +
      row('교과 성적', r.gradeSchool) + row('모의고사 성적', r.gradeMock) +
      row('동의 일시', r.consentAt ? new Date(r.consentAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '') +
      row('신청 일시', r.createdAt ? new Date(r.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '') +
      '</dl>' +
      '<div class="field"><label for="mMemo">상담 메모 (선생님만 보여요)</label><textarea id="mMemo" maxlength="1000">' + U.esc(r.memo) + '</textarea></div>' +
      '<div class="btn-row">' +
      '<button class="btn small" data-act="memo">메모 저장</button>' +
      (r.status !== 'done' ? '<button class="btn ghost small" data-act="done">상담 완료로 표시</button>' : '') +
      (r.status !== 'booked' ? '<button class="btn ghost small" data-act="booked">예약 상태로 되돌리기</button>' : '') +
      (r.status !== 'cancelled' ? '<button class="btn danger small" data-act="cancelled">예약 취소</button>' : '') +
      '</div><div class="btn-row" style="margin-top:10px">' +
      '<button class="btn danger small" data-act="delete">기록 완전 삭제</button>' +
      '<button class="btn ghost small" data-act="close">닫기</button></div>';
    $('modal').classList.remove('hidden');
    $('modalBody').onclick = async function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.dataset.act;
      if (act === 'close') return closeModal();
      if ((act === 'delete' || act === 'cancelled') && b.dataset.confirm !== '1') {
        b.dataset.confirm = '1'; b.textContent = '한 번 더 누르면 ' + (act === 'delete' ? '삭제' : '취소') + '돼요'; return;
      }
      b.disabled = true;
      try {
        if (act === 'delete') await call('admin.deleteReservations', { ids: [r.id] });
        else if (act === 'memo') await call('admin.updateReservation', { id: r.id, memo: $('mMemo').value });
        else await call('admin.updateReservation', { id: r.id, status: act, memo: $('mMemo').value });
        U.toast('저장했어요.');
        closeModal();
        await reload();
      } catch (ex) { b.disabled = false; U.toast(ex.message, true); }
    };
  }
  function closeModal() { $('modal').classList.add('hidden'); }
  $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  $('csvBtn').onclick = function () {
    var list = filteredRes();
    var head = ['날짜', '시작', '종료', '학번', '성명', '연락처', '학부모참여', '문의내용', '직접입력', '교과성적', '모의고사성적', '상태', '메모', '동의일시', '신청일시'];
    var q = function (v) { v = String(v === undefined || v === null ? '' : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
    var rows = list.map(function (r) {
      return [r.date, r.start, r.end, r.studentId, r.name, r.phone, r.parent ? '참여' : '불참', (r.topics || []).join(', '), r.topicEtc,
        r.gradeSchool, r.gradeMock, STATUS[r.status], r.memo, r.consentAt, r.createdAt].map(q).join(',');
    });
    U.download('상담예약_' + A.st.today + '.csv', '﻿' + [head.map(q).join(',')].concat(rows).join('\r\n'), 'text/csv;charset=utf-8');
  };

  $('purgeBtn').onclick = async function () {
    var d = $('purgeDate').value, b = $('purgeBtn');
    if (!d) return U.toast('날짜를 골라 주세요.', true);
    var n = A.st.reservations.filter(function (r) { return r.date < d; }).length;
    if (!n) return U.toast('삭제할 예약이 없어요.');
    if (b.dataset.confirm !== d) { b.dataset.confirm = d; b.textContent = n + '건 삭제 — 한 번 더 누르면 삭제돼요'; return; }
    try {
      var res = await call('admin.purgeBefore', { before: d });
      b.dataset.confirm = ''; b.textContent = '이전 예약 삭제';
      U.toast(res.deleted + '건을 삭제했어요.');
      await reload();
    } catch (ex) { U.toast(ex.message, true); }
  };

  // ---------- 주간 기본 시간 ----------
  function activeWeekdays() { return WD_ORDER.filter(function (d) { return A.st.settings.weekdays.indexOf(d) >= 0; }); }

  function gridHtml(slots, days, cellFn) {
    return '<thead><tr><th></th>' + days.map(function (d) { return '<th>' + U.DAY[d] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      slots.map(function (sl) {
        return '<tr><th class="rowh">' + sl.start + '~' + sl.end + '</th>' + days.map(function (d) { return cellFn(sl, d); }).join('') + '</tr>';
      }).join('') + '</tbody>';
  }

  function renderTpl() {
    var days = activeWeekdays();
    if (!days.length) { $('tplGrid').innerHTML = '<tr><td class="empty-msg">[설정]에서 상담 요일을 먼저 골라 주세요.</td></tr>'; return; }
    $('tplGrid').innerHTML = gridHtml(A.st.slots, days, function (sl, d) {
      var on = (A.tpl[d] || []).indexOf(sl.start) >= 0;
      return '<td class="cell' + (on ? ' on' : '') + '" data-d="' + d + '" data-s="' + sl.start + '">' + (on ? '가능' : '—') + '</td>';
    });
  }

  function setTplCell(td, val) {
    var d = td.dataset.d, s = td.dataset.s;
    var arr = A.tpl[d] = A.tpl[d] || [];
    var i = arr.indexOf(s);
    if (val && i < 0) arr.push(s);
    if (!val && i >= 0) arr.splice(i, 1);
    td.classList.toggle('on', val);
    td.textContent = val ? '가능' : '—';
  }
  var paint = null;
  $('tplGrid').addEventListener('pointerdown', function (e) {
    var td = e.target.closest('td.cell'); if (!td) return;
    e.preventDefault();
    paint = !td.classList.contains('on');
    setTplCell(td, paint);
  });
  $('tplGrid').addEventListener('pointerover', function (e) {
    if (paint === null) return;
    var td = e.target.closest('td.cell'); if (td) setTplCell(td, paint);
  });
  document.addEventListener('pointerup', function () { paint = null; });

  $('tplAllOn').onclick = function () { activeWeekdays().forEach(function (d) { A.tpl[d] = A.st.slots.map(function (s) { return s.start; }); }); renderTpl(); };
  $('tplAllOff').onclick = function () { activeWeekdays().forEach(function (d) { A.tpl[d] = []; }); renderTpl(); };
  $('tplSave').onclick = async function () {
    try {
      var res = await call('admin.saveTemplate', { template: A.tpl });
      A.st.template = res.template; A.tpl = JSON.parse(JSON.stringify(res.template));
      renderTpl(); renderAdminCal(); renderDayEditor();
      U.toast('주간 기본 시간을 저장했어요.');
    } catch (ex) { U.toast(ex.message, true); }
  };

  // ---------- 날짜별 조정 ----------
  function effectiveOpen(date, start) {
    var ov = A.st.overrides[date];
    if (ov && Object.prototype.hasOwnProperty.call(ov, start)) return ov[start];
    var wd = U.dow(date);
    if (A.st.settings.weekdays.indexOf(wd) < 0) return false;
    return (A.st.template[wd] || []).indexOf(start) >= 0;
  }
  function bookingsOn(date) {
    var m = {};
    A.st.reservations.forEach(function (r) { if (r.date === date && r.status !== 'cancelled') m[r.start] = r; });
    return m;
  }

  function renderAdminCal() {
    var v = A.view, s = A.st.settings;
    $('aMonth').textContent = v.y + '년 ' + v.m + '월';
    var html = U.DAY.map(function (d, i) { return '<div class="dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') + '">' + d + '</div>'; }).join('');
    var firstDow = new Date(v.y, v.m - 1, 1).getDay();
    for (var i = 0; i < firstDow; i++) html += '<div class="day empty"></div>';
    for (var d = 1; d <= U.daysIn(v.y, v.m); d++) {
      var key = U.ymd(v.y, v.m, d);
      var inRange = key >= s.bookingStart && key <= s.bookingEnd;
      var open = A.st.slots.filter(function (sl) { return effectiveOpen(key, sl.start); }).length;
      var booked = Object.keys(bookingsOn(key)).length;
      var cls = 'day' + (!inRange || !open ? ' off' : '') + (A.st.overrides[key] ? ' has-ov' : '') + (key === A.selDate ? ' sel' : '') + (key === A.st.today ? ' today' : '');
      var info = open ? '<span class="cnt">' + open + '칸' + (booked ? ' · 예약 ' + booked : '') + '</span>' : (booked ? '<span class="cnt">예약 ' + booked + '</span>' : '');
      html += '<button type="button" class="' + cls + '" data-date="' + key + '">' + d + info + '</button>';
    }
    $('aCal').innerHTML = html;
  }
  $('aPrev').onclick = function () { A.view = U.addMonths(A.view.y, A.view.m, -1); renderAdminCal(); };
  $('aNext').onclick = function () { A.view = U.addMonths(A.view.y, A.view.m, 1); renderAdminCal(); };
  $('aCal').addEventListener('click', function (e) {
    var b = e.target.closest('button.day'); if (!b) return;
    A.selDate = b.dataset.date; renderAdminCal(); renderDayEditor();
  });

  function renderDayEditor() {
    var date = A.selDate, box = $('dayEditor');
    if (!date) return;
    var s = A.st.settings;
    var bk = bookingsOn(date);
    var outRange = date < s.bookingStart || date > s.bookingEnd;
    box.innerHTML = '<h3 style="margin-top:0">' + U.pretty(date) + '</h3>' +
      (outRange ? '<p class="notice" style="margin:0 0 10px">이 날은 예약 받는 기간(' + s.bookingStart + ' ~ ' + s.bookingEnd + ') 밖이라 학생 화면에 보이지 않아요.</p>' : '') +
      '<div class="slot-edit">' + A.st.slots.map(function (sl) {
        var on = effectiveOpen(date, sl.start), r = bk[sl.start];
        var ov = A.st.overrides[date] && Object.prototype.hasOwnProperty.call(A.st.overrides[date], sl.start);
        return '<button type="button" data-s="' + sl.start + '" class="' + (r ? 'booked' : on ? 'on' : '') + '">' + sl.start + '~' + sl.end +
          '<span class="tag">' + (r ? U.esc(r.name) + ' 예약' : on ? '가능' : '닫힘') + (ov ? ' ✎' : '') + '</span></button>';
      }).join('') + '</div>' +
      '<p class="hint">칸을 누르면 열림/닫힘이 바로 저장돼요. ✎ = 이 날만 바꾼 칸</p>' +
      '<div class="toolbar"><button class="btn ghost small" data-all="1">이 날 모두 열기</button>' +
      '<button class="btn ghost small" data-all="0">이 날 모두 닫기</button>' +
      '<button class="btn ghost small" data-all="reset">주간 기본값으로</button></div>';
  }

  $('dayEditor').addEventListener('click', async function (e) {
    var date = A.selDate; if (!date) return;
    var changes = {};
    var b = e.target.closest('button[data-s]');
    var all = e.target.closest('button[data-all]');
    var wd = U.dow(date);
    var base = function (start) { return A.st.settings.weekdays.indexOf(wd) >= 0 && (A.st.template[wd] || []).indexOf(start) >= 0; };
    if (b) {
      var start = b.dataset.s, next = !effectiveOpen(date, start);
      if (!next && bookingsOn(date)[start]) U.toast('이미 예약이 있는 칸이에요. 예약은 그대로 남고 새 예약만 막혀요.');
      changes[date] = {}; changes[date][start] = next === base(start) ? null : next;
    } else if (all) {
      if (all.dataset.all === 'reset') changes[date] = null;
      else {
        var val = all.dataset.all === '1';
        changes[date] = {};
        A.st.slots.forEach(function (sl) { changes[date][sl.start] = val === base(sl.start) ? null : val; });
      }
    } else return;
    try {
      var res = await call('admin.saveOverrides', { changes: changes });
      A.st.overrides = res.overrides;
      renderAdminCal(); renderDayEditor();
    } catch (ex) { U.toast(ex.message, true); }
  });

  // ---------- 교시 시각 ----------
  function renderPeriods() {
    $('periods').innerHTML = A.periods.map(function (p, i) {
      return '<div class="p"><b>' + (i + 1) + '교시</b><input type="time" data-i="' + i + '" data-k="start" value="' + p.start + '">' +
        '~<input type="time" data-i="' + i + '" data-k="end" value="' + p.end + '"></div>';
    }).join('');
  }
  $('periods').addEventListener('change', function (e) {
    var t = e.target; if (!t.dataset.k) return;
    A.periods[+t.dataset.i][t.dataset.k] = t.value;
    renderTTPreview();
  });
  $('addPeriod').onclick = function () {
    var last = A.periods[A.periods.length - 1];
    var toMin = function (h) { var p = h.split(':'); return +p[0] * 60 + +p[1]; };
    var hm = function (m) { return U.pad(Math.floor(m / 60)) + ':' + U.pad(m % 60); };
    var s = last ? toMin(last.end) + 10 : 540;
    A.periods.push({ no: A.periods.length + 1, start: hm(s), end: hm(s + 50) });
    renderPeriods(); renderTT();
  };
  $('delPeriod').onclick = function () { A.periods.pop(); renderPeriods(); renderTT(); };
  $('savePeriods').onclick = async function () {
    try {
      var res = await call('admin.saveSettings', { settings: { periods: A.periods } });
      A.st.settings = res.settings; A.periods = JSON.parse(JSON.stringify(res.settings.periods));
      U.toast('교시 시각을 저장했어요.');
    } catch (ex) { U.toast(ex.message, true); }
  };

  // ---------- 시간표 가져오기 ----------
  function sheetRows(ws) {
    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: true });
    (ws['!merges'] || []).forEach(function (m) {
      var v = (rows[m.s.r] || [])[m.s.c];
      for (var r = m.s.r; r <= m.e.r; r++) {
        rows[r] = rows[r] || [];
        for (var c = m.s.c; c <= m.e.c; c++) rows[r][c] = v;
      }
    });
    return rows;
  }

  async function readFile(file) {
    if (typeof XLSX === 'undefined') { U.toast('엑셀 도구를 불러오는 중이에요. 잠시 뒤 다시 시도해 주세요.', true); return; }
    try {
      var buf = await file.arrayBuffer();
      var wb = XLSX.read(buf, { type: 'array', codepage: 949 });
      A.tt.book = wb;
      var sheets = wb.SheetNames.map(function (n) { return { name: n, cands: Timetable.parseRows(sheetRows(wb.Sheets[n])) }; })
        .filter(function (s) { return s.cands.length; });
      if (!sheets.length) {
        U.toast('시간표 모양을 찾지 못했어요. 머리행에 월·화·수·목·금, 왼쪽에 1교시·2교시…가 있는지 확인해 주세요.', true);
        return;
      }
      A.tt.sheets = sheets;
      $('ttSheet').innerHTML = sheets.map(function (s, i) { return '<option value="' + i + '">' + U.esc(s.name) + ' (' + s.cands.length + '개)</option>'; }).join('');
      $('ttSheetWrap').classList.toggle('hidden', sheets.length < 2);
      pickSheet(0);
      $('ttResult').classList.remove('hidden');
      U.toast('시간표를 읽었어요. 내용을 확인해 주세요.');
    } catch (ex) {
      console.error(ex);
      U.toast('파일을 읽지 못했어요: ' + ex.message, true);
    }
  }

  function pickSheet(i) {
    var cands = A.tt.sheets[i].cands;
    A.tt.cands = cands;
    var teacher = (A.st.settings.teacherName || '').replace(/\s/g, '');
    var guess = 0;
    if (teacher) cands.forEach(function (c, ci) { if (c.name.replace(/\s/g, '').indexOf(teacher) >= 0) guess = ci; });
    $('ttWho').innerHTML = cands.map(function (c, ci) {
      return '<option value="' + ci + '"' + (ci === guess ? ' selected' : '') + '>' + U.esc(c.name) + ' · 수업 ' + c.count + '시간</option>';
    }).join('');
    $('ttWhoWrap').classList.toggle('hidden', cands.length < 2);
    pickWho(guess);
  }
  function pickWho(i) {
    A.tt.busy = JSON.parse(JSON.stringify(A.tt.cands[i].busy));
    var maxP = 0;
    Object.keys(A.tt.busy).forEach(function (d) { A.tt.busy[d].forEach(function (p) { if (p > maxP) maxP = p; }); });
    while (A.periods.length < maxP) $('addPeriod').onclick();
    renderTT();
  }
  $('ttSheet').onchange = function () { pickSheet(+this.value); };
  $('ttWho').onchange = function () { pickWho(+this.value); };

  function renderTT() {
    renderTTGrid();
    renderTTPreview();
  }

  function renderTTGrid() {
    if (!A.tt.busy) return;
    var days = [1, 2, 3, 4, 5].concat(A.tt.busy[6] && A.tt.busy[6].length ? [6] : []);
    var rows = A.periods.map(function (p, i) { return { start: (i + 1) + '교시', end: '', no: i + 1 }; });
    $('ttGrid').innerHTML = '<thead><tr><th></th>' + days.map(function (d) { return '<th>' + U.DAY[d] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><th class="rowh">' + r.start + '</th>' + days.map(function (d) {
          var b = (A.tt.busy[d] || []).indexOf(r.no) >= 0;
          return '<td class="cell' + (b ? ' busy' : ' on') + '" data-d="' + d + '" data-p="' + r.no + '">' + (b ? '수업' : '') + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody>';
  }
  $('ttGrid').addEventListener('click', function (e) {
    var td = e.target.closest('td.cell'); if (!td) return;
    var d = td.dataset.d, p = +td.dataset.p, arr = A.tt.busy[d] = A.tt.busy[d] || [];
    var i = arr.indexOf(p);
    if (i >= 0) arr.splice(i, 1); else arr.push(p);
    renderTT();
  });

  function previewTemplate() {
    var s = Object.assign({}, A.st.settings, { periods: A.periods.map(function (p, i) { return { no: i + 1, start: p.start, end: p.end }; }) });
    return Core.templateFromTimetable(s, A.tt.busy || {});
  }

  function renderTTPreview() {
    var days = activeWeekdays();
    if (!A.tt.busy || !days.length) {
      $('ttPreview').innerHTML = '<tr><td class="empty-msg">시간표 파일을 올리면 여기에 미리보기가 나타나요.</td></tr>';
      $('ttApply').disabled = true;
      return;
    }
    var t = previewTemplate();
    $('ttPreview').innerHTML = gridHtml(A.st.slots, days, function (sl, d) {
      var on = (t[d] || []).indexOf(sl.start) >= 0;
      return '<td class="cell ro' + (on ? ' on' : ' busy') + '">' + (on ? '가능' : '수업') + '</td>';
    });
    $('ttApply').disabled = false;
  }

  $('ttApply').onclick = async function () {
    var b = $('ttApply');
    b.disabled = true;
    try {
      var r1 = await call('admin.saveSettings', { settings: { periods: A.periods } });
      A.st.settings = r1.settings;
      var t = previewTemplate();
      var r2 = await call('admin.saveTemplate', { template: t });
      A.st.template = r2.template; A.tpl = JSON.parse(JSON.stringify(r2.template));
      renderTpl(); renderAdminCal(); renderDayEditor();
      U.toast('주간 기본 시간에 적용했어요! [상담 가능 시간] 탭에서 더 고칠 수 있어요.');
    } catch (ex) { U.toast(ex.message, true); }
    b.disabled = false;
  };

  var drop = $('drop');
  $('ttFile').onchange = function () { if (this.files[0]) readFile(this.files[0]); this.value = ''; };
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('drag'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('drag'); }); });
  drop.addEventListener('drop', function (e) { var f = e.dataTransfer.files[0]; if (f) readFile(f); });

  $('ttTemplate').onclick = function (e) {
    e.preventDefault();
    var lines = ['교시,월,화,수,목,금'];
    for (var i = 1; i <= Math.max(7, A.periods.length); i++) lines.push(i + '교시,,,,,');
    U.download('시간표_양식.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  };

  // ---------- 설정 ----------
  function fillSettings() {
    var s = A.st.settings;
    $('sTitle').value = s.title; $('sTeacher').value = s.teacherName; $('sSchool').value = s.schoolName;
    $('sPlace').value = s.place; $('sNotice').value = s.notice;
    $('sBStart').value = s.bookingStart; $('sBEnd').value = s.bookingEnd;
    $('sStart').value = s.dayStart; $('sLast').value = s.lastStart; $('sInt').value = s.slotInterval; $('sMin').value = s.slotMinutes;
    $('sResUrl').value = s.resourceUrl || ''; $('sResLabel').value = s.resourceLabel || '';
    $('sCPhone').value = s.contactPhone || ''; $('sCEmail').value = s.contactEmail || ''; $('sNotify').value = s.notifyEmail || '';
    $('sLead').value = s.minLeadHours; $('sMax').value = s.maxActivePerStudent; $('sRet').value = s.retention;
    $('sTopics').value = (s.topics || []).join('\n');
    $('sWeekdays').innerHTML = WD_ORDER.map(function (d) {
      return '<label class="chip"><input type="checkbox" value="' + d + '"' + (s.weekdays.indexOf(d) >= 0 ? ' checked' : '') + '><span>' + U.DAY[d] + '</span></label>';
    }).join('');
    updateSlotPreview();
  }
  function formSettings() {
    return {
      title: $('sTitle').value, teacherName: $('sTeacher').value, schoolName: $('sSchool').value, place: $('sPlace').value,
      notice: $('sNotice').value, bookingStart: $('sBStart').value, bookingEnd: $('sBEnd').value,
      dayStart: $('sStart').value, lastStart: $('sLast').value, slotInterval: +$('sInt').value, slotMinutes: +$('sMin').value,
      resourceUrl: $('sResUrl').value.trim(), resourceLabel: $('sResLabel').value.trim(),
      contactPhone: $('sCPhone').value.trim(), contactEmail: $('sCEmail').value.trim(), notifyEmail: $('sNotify').value.trim(),
      minLeadHours: +$('sLead').value, maxActivePerStudent: +$('sMax').value, retention: $('sRet').value,
      topics: $('sTopics').value.split('\n').map(function (t) { return t.trim(); }).filter(Boolean),
      weekdays: qsa('#sWeekdays input:checked').map(function (x) { return +x.value; })
    };
  }
  function updateSlotPreview() {
    var f = formSettings();
    var list = Core.slotList({ dayStart: f.dayStart, lastStart: f.lastStart, slotInterval: f.slotInterval, slotMinutes: f.slotMinutes });
    $('slotPreview').textContent = list.length
      ? '하루 ' + list.length + '칸: ' + list.map(function (x) { return x.start + '~' + x.end; }).join(', ')
      : '시각과 단위를 확인해 주세요.';
  }
  ['sStart', 'sLast', 'sInt', 'sMin'].forEach(function (id) { $(id).addEventListener('input', updateSlotPreview); });

  $('setForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    try {
      var res = await call('admin.saveSettings', { settings: formSettings() });
      await reload();
      U.toast(res.slotsChanged ? '저장했어요. 시간 칸이 바뀌어 주간 기본 시간을 새로 만들었어요.' : '설정을 저장했어요.');
    } catch (ex) { U.toast(ex.message, true); }
  });

  $('pwForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var a = $('pw1').value, b = $('pw2').value;
    if (a.length < 8) return U.toast('새 비밀번호는 8자 이상이어야 해요.', true);
    if (a !== b) return U.toast('두 비밀번호가 서로 달라요.', true);
    try {
      await call('admin.changePassword', { newPassword: a });
      A.pw = a; setPw(a);
      $('pw1').value = ''; $('pw2').value = '';
      $('pwWarn').classList.add('hidden');
      U.toast('비밀번호를 바꿨어요.');
    } catch (ex) { U.toast(ex.message, true); }
  });

  // ---------- 시작 ----------
  A.pw = getPw();
  if (A.pw) enter().catch(function () { logout(); });
})();
