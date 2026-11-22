/* 학생·학부모 예약 화면 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var S = {
    settings: null,
    days: {},          // 'YYYY-MM-DD' -> [{start,end,status}]
    loadedRange: null,
    view: null,        // {y,m}
    date: null,
    slot: null,
    lastReservation: null,
    change: null       // 일정 변경 중이면 { r: 지금 예약, who: {studentId,name,code} }
  };

  // ---------- 초기화 ----------
  async function init() {
    bindTabs();
    bindForm();
    try {
      var cfg = await U.api('public.config');
      S.settings = cfg.settings;
      S.coreVersion = cfg.coreVersion || 0;
      if (!(cfg.coreVersion >= 5)) console.warn('서버(Apps Script) 코드가 예전 버전입니다. gas/Core.gs 를 새로 붙여 넣고 새 버전으로 배포하세요.');
      applySettings();
      var t = U.parse(S.settings.today);
      var start = S.settings.bookingStart > S.settings.today ? U.parse(S.settings.bookingStart) : t;
      S.view = { y: start.y, m: start.m };
      await loadAvailability();
      renderCalendar();
    } catch (e) {
      $('calendar').innerHTML = '<div class="empty-msg" style="grid-column:1/-1">😢 ' + U.esc(e.message) + '</div>';
    }
  }

  function applySettings() {
    var s = S.settings;
    // 기본 이름은 HTML에 이미 들어 있으므로, 선생님이 다른 이름을 정한 경우에만 바꿈 (제목 깜빡임 방지)
    if (s.title && s.title !== '상담 예약' && s.title !== document.title) {
      Array.prototype.forEach.call(document.querySelectorAll('.site-name'), function (el) { el.textContent = s.title; });
      document.title = s.title;
    }
    var contact = [];
    if (s.contactPhone) contact.push('☎ <a href="tel:' + U.esc(s.contactPhone.replace(/[^\d+]/g, '')) + '">' + U.esc(s.contactPhone) + '</a>');
    if (s.contactEmail) contact.push('✉ <a href="mailto:' + U.esc(s.contactEmail) + '">' + U.esc(s.contactEmail) + '</a>');
    Array.prototype.forEach.call(document.querySelectorAll('.contact'), function (el) {
      el.innerHTML = contact.length ? '상담 관련 문의 · ' + contact.join(' · ') : '';
      el.classList.toggle('hidden', !contact.length);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.res-link'), function (a) {
      if (s.resourceUrl) { a.href = s.resourceUrl; a.classList.remove('hidden'); }
      else a.classList.add('hidden');
    });
    Array.prototype.forEach.call(document.querySelectorAll('.res-label'), function (el) { el.textContent = s.resourceLabel || '진로진학자료실'; });
    var sub = [s.schoolName, '진로진학부'].filter(Boolean).join(' · ');
    $('subtitle').textContent = sub;
    $('subtitle').classList.toggle('hidden', !sub);
    if (s.notice) { $('notice').textContent = s.notice; $('notice').classList.remove('hidden'); }
    $('slotMin').textContent = s.slotMinutes;
    $('retention').textContent = s.retention || '상담 종료 후 1년';
    $('topics').innerHTML = (s.topics || []).map(function (t) {
      return '<label class="chip"><input type="checkbox" name="topic" value="' + U.esc(t) + '"><span>' + U.esc(t) + '</span></label>';
    }).join('');
  }

  async function loadAvailability() {
    var s = S.settings;
    var from = s.today > s.bookingStart ? s.today : s.bookingStart;
    var res = await U.api('public.availability', { from: from, to: s.bookingEnd });
    S.days = res.days || {};
  }

  // ---------- 달력 ----------
  function monthBounds() {
    var s = S.settings;
    var first = U.parse(s.today > s.bookingStart ? s.today : s.bookingStart);
    var last = U.parse(s.bookingEnd);
    return { min: first.y * 12 + first.m, max: last.y * 12 + last.m };
  }

  function renderCalendar() {
    var v = S.view, b = monthBounds(), cur = v.y * 12 + v.m;
    $('monthLabel').textContent = v.y + '년 ' + v.m + '월';
    $('prevMonth').disabled = cur <= b.min;
    $('nextMonth').disabled = cur >= b.max;

    var html = U.DAY.map(function (d, i) {
      return '<div class="dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') + '">' + d + '</div>';
    }).join('');
    var firstDow = new Date(v.y, v.m - 1, 1).getDay();
    for (var i = 0; i < firstDow; i++) html += '<div class="day empty"></div>';
    var n = U.daysIn(v.y, v.m), anyOpen = false;
    for (var d = 1; d <= n; d++) {
      var key = U.ymd(v.y, v.m, d);
      var list = S.days[key] || [];
      var open = list.filter(function (x) { return x.status === 'open'; }).length;
      var cls = 'day', label = U.pretty(key), extra = '';
      if (open) { cls += ' avail'; extra = '<span class="cnt">' + open + '자리</span>'; label += ', 예약 가능 ' + open + '자리'; anyOpen = true; }
      else if (list.length) { cls += ' full'; extra = '<span class="cnt">마감</span>'; label += ', 마감'; }
      if (key === S.settings.today) cls += ' today';
      if (key === S.date) cls += ' sel';
      html += '<button type="button" class="' + cls + '" data-date="' + key + '"' + (open ? '' : ' disabled') +
        ' aria-label="' + label + '">' + d + extra + '</button>';
    }
    $('calendar').innerHTML = html;
    if (!anyOpen && !Object.keys(S.days).length) {
      $('calendar').insertAdjacentHTML('beforeend', '<div class="empty-msg" style="grid-column:1/-1">아직 예약할 수 있는 시간이 없습니다. 조금 뒤에 다시 확인해 주세요.</div>');
    }
  }

  $('prevMonth').onclick = function () { var n = U.addMonths(S.view.y, S.view.m, -1); S.view = n; renderCalendar(); };
  $('nextMonth').onclick = function () { var n = U.addMonths(S.view.y, S.view.m, 1); S.view = n; renderCalendar(); };
  $('calendar').addEventListener('click', function (e) {
    var btn = e.target.closest('button.day');
    if (!btn || btn.disabled) return;
    S.date = btn.dataset.date;
    S.slot = null;
    renderCalendar();
    renderSlots();
    $('slotCard').classList.remove('is-empty');
    if (window.matchMedia('(max-width: 899px)').matches) $('slotCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  function renderSlots() {
    var list = S.days[S.date] || [];
    $('slotTitle').textContent = U.pretty(S.date) + ' · 시간을 골라 주세요';
    $('slots').innerHTML = list.length ? list.map(function (x) {
      var booked = x.status === 'booked';
      var on = S.slot && S.slot.start === x.start;
      return '<button type="button" class="slot' + (on ? ' on' : '') + '" data-start="' + x.start + '"' + (booked ? ' disabled' : '') + '>' +
        x.start + '<small>~' + x.end + ' · ' + (booked ? '마감' : on ? '선택됨' : '예약 가능') + '</small></button>';
    }).join('') : '<div class="empty-msg">이 날은 예약 가능한 시간이 없습니다.</div>';
    $('toForm').disabled = !S.slot;
    $('toForm').textContent = S.change ? '이 시간으로 변경하기' : '다음 단계로';
  }

  $('slots').addEventListener('click', function (e) {
    var btn = e.target.closest('button.slot');
    if (!btn || btn.disabled) return;
    S.slot = (S.days[S.date] || []).filter(function (x) { return x.start === btn.dataset.start; })[0];
    renderSlots();
  });

  // ---------- 단계 이동 ----------
  function goStep(n) {
    var t = document.getElementById('toast'); if (t) t.className = 'toast';
    $('step1').classList.toggle('hidden', n !== 1);
    $('step2').classList.toggle('hidden', n !== 2);
    $('step3').classList.toggle('hidden', n !== 3);
    Array.prototype.forEach.call(document.querySelectorAll('#steps li'), function (li) {
      var k = +li.dataset.step;
      li.className = k === n ? 'on' : k < n ? 'done' : '';
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  $('toForm').onclick = function () {
    if (!S.slot) return;
    if (S.change) return doChange();
    $('pickedLabel').innerHTML = U.esc(U.pretty(S.date)) + '<br><span class="nowrap">' + S.slot.start + ' ~ ' + S.slot.end + '</span>';
    goStep(2);
    setTimeout(function () { $('studentId').focus(); }, 300);
  };
  $('backToPick').onclick = function () { goStep(1); };
  $('againBtn').onclick = async function () {
    endChange();
    S.date = null; S.slot = null;
    $('step2').reset();
    $('slotCard').classList.add('is-empty');
    $('slots').innerHTML = '<div class="empty-msg">📅 먼저 달력에서 날짜를 골라 주세요.</div>';
    $('slotTitle').textContent = '시간을 골라 주세요';
    $('toForm').disabled = true;
    goStep(1);
    try { await loadAvailability(); } catch (e) { /* 무시 */ }
    renderCalendar();
  };

  // ---------- 신청서 ----------
  function bindForm() {
    $('phone').addEventListener('input', function (e) { e.target.value = U.formatPhone(e.target.value); });
    // 예약코드: 숫자 4자리 (예전 예약은 연락처를 넣을 수 있어 하이픈도 허용)
    $('lkCode').addEventListener('input', function (e) { e.target.value = e.target.value.replace(/[^\d-]/g, ''); });
    ['studentId', 'lkId'].forEach(function (id) {
      $(id).addEventListener('input', function (e) { e.target.value = e.target.value.replace(/\D/g, ''); });
    });

    $('step2').addEventListener('submit', async function (e) {
      e.preventDefault();
      var parentEl = document.querySelector('input[name=parent]:checked');
      var topics = Array.prototype.map.call(document.querySelectorAll('input[name=topic]:checked'), function (x) { return x.value; });
      var p = {
        date: S.date, start: S.slot && S.slot.start,
        studentId: $('studentId').value.trim(),
        name: $('name').value.trim(),
        phone: $('phone').value.trim(),
        parent: parentEl ? parentEl.value === 'yes' : null,
        topics: topics,
        topicEtc: $('topicEtc').value.trim(),
        gradeSchool: $('gradeSchool').value.trim(),
        gradeMock: $('gradeMock').value.trim(),
        consent: $('consent').checked
      };
      // 화면에서 먼저 확인
      var err = null, focus = null;
      if (!/^\d{4,6}$/.test(p.studentId)) { err = '학번을 숫자로 입력해 주세요. (예: 20315)'; focus = 'studentId'; }
      else if (!p.name) { err = '학생 성명을 입력해 주세요.'; focus = 'name'; }
      else if (p.phone.replace(/\D/g, '').length < 9) { err = '연락처를 입력해 주세요.'; focus = 'phone'; }
      else if (p.parent === null) { err = '학부모 참여 여부를 골라 주세요.'; }
      else if (!topics.length && !p.topicEtc) { err = '문의 내용을 하나 이상 고르거나 직접 적어 주세요.'; focus = 'topicEtc'; }
      else if (!p.consent) { err = '개인정보 제공 및 조회에 동의해 주세요.'; focus = 'consent'; }
      if (err) { U.toast(err, true); if (focus) $(focus).focus(); return; }

      var btns = Array.prototype.slice.call(document.querySelectorAll('.submit-btn'));
      btns.forEach(function (b) { b.disabled = true; b.innerHTML = '<span class="spinner" style="width:18px;height:18px;border-width:2px"></span> 예약하는 중…'; });
      try {
        var res = await U.api('public.reserve', p);
        S.lastReservation = res.reservation;
        $('doneTitle').textContent = '상담 예약이 완료되었습니다!';
        renderTicket(res.reservation, $('ticket'));
        goStep(3);
      } catch (ex) {
        U.toast(ex.message, true);
        if (/다른 분이 예약|예약할 수 없어요/.test(ex.message)) {
          try { await loadAvailability(); } catch (e2) { /* 무시 */ }
          S.slot = null; renderCalendar(); renderSlots(); goStep(1);
        }
      } finally {
        btns.forEach(function (b) { b.disabled = false; b.textContent = '상담 예약하기'; });
      }
    });

    $('icsBtn').onclick = function () { if (S.lastReservation) downloadIcs(S.lastReservation); };
  }

  function renderTicket(r, el) {
    var topics = (r.topics || []).slice();
    if (r.topicEtc) topics.push('직접 입력: ' + r.topicEtc);
    var place = r.place || (S.settings && S.settings.place);
    el.innerHTML =
      (/^\d{4}$/.test(r.code || '') ? '<div class="code-box"><span class="lbl">예약코드</span><strong>' + U.esc(r.code) + '</strong>' +
        '<small>일정 변경·취소할 때 학번·성명과 함께 입력합니다</small></div>' : '') +
      '<div class="when">' + U.esc(U.pretty(r.date)) + '<br>' + U.esc(r.start) + ' ~ ' + U.esc(r.end) + '</div>' +
      '<dl>' +
      '<dt>학번 · 성명</dt><dd>' + U.esc(r.studentId) + ' ' + U.esc(r.name) + '</dd>' +
      '<dt>학부모 참여</dt><dd>' + (r.parent ? '학부모 함께 참여' : '학생만 참여') + '</dd>' +
      '<dt>담당</dt><dd>진로진학부</dd>' +
      (place ? '<dt>장소</dt><dd>' + U.esc(place) + '</dd>' : '') +
      '<dt>문의 내용</dt><dd>' + U.esc(topics.join(', ')) + '</dd>' +
      '</dl>';
  }

  function downloadIcs(r) {
    var d = r.date.replace(/-/g, '');
    var t = function (hm) { return hm.replace(':', '') + '00'; };
    // iPhone·iPad: 서버 주소가 캘린더 파일을 바로 돌려주면 기본 캘린더의 '이벤트 추가' 창이 뜬다.
    // (data: 주소는 iOS가 막아서 반응이 없다.) 서버가 예전 버전이면 파일 내려받기로.
    var ua = navigator.userAgent || '';
    var ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (ios && S.coreVersion >= 5) {
      window.location.href = U.apiUrl() + (U.apiUrl().indexOf('?') >= 0 ? '&' : '?') +
        'ics=1&date=' + encodeURIComponent(r.date) + '&start=' + encodeURIComponent(r.start) + '&end=' + encodeURIComponent(r.end);
      return;
    }
    var title = '봉일천고 진로진학상담';
    var lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//counsel-reserve//KO', 'CALSCALE:GREGORIAN',
      'BEGIN:VTIMEZONE', 'TZID:Asia/Seoul', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:KST', 'END:STANDARD', 'END:VTIMEZONE',
      'BEGIN:VEVENT',
      'UID:' + d + t(r.start) + '-' + r.studentId + '@bongilcheon-counsel',
      'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''),
      'DTSTART;TZID=Asia/Seoul:' + d + 'T' + t(r.start),
      'DTEND;TZID=Asia/Seoul:' + d + 'T' + t(r.end),
      'SUMMARY:' + title.replace(/[,;]/g, ' '),
      r.place ? 'LOCATION:' + r.place.replace(/[,;]/g, ' ') : '',
      'DESCRIPTION:진로진학부 · 학번 ' + r.studentId + ' ' + r.name,
      'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'DESCRIPTION:상담 30분 전', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'
    ].filter(Boolean);
    var ics = lines.join('\r\n');
    // Mac·Windows·Android: .ics 파일을 내려받는다(Mac은 받은 파일을 누르면 캘린더 앱에 추가 창이 뜬다).
    U.download('상담예약_' + r.date + '.ics', ics, 'text/calendar;charset=utf-8');
  }

  // ---------- 탭 ----------
  function bindTabs() {
    var all = Array.prototype.slice.call(document.querySelectorAll('button[data-tab]'));
    all.forEach(function (b) {
      b.onclick = function () {
        var tab = b.dataset.tab;
        all.forEach(function (x) { x.classList.toggle('on', x.dataset.tab === tab); });
        $('tab-book').classList.toggle('hidden', tab !== 'book');
        $('tab-lookup').classList.toggle('hidden', tab !== 'lookup');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      };
    });
  }

  // ---------- 내 예약 확인 ----------
  var lastLookup = null;
  var lastList = [];
  $('lookupForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    lastLookup = { studentId: $('lkId').value.trim(), name: $('lkName').value.trim(), code: $('lkCode').value.trim() };
    if (!lastLookup.studentId || !lastLookup.name || !lastLookup.code) { U.toast('학번, 성명, 예약코드를 모두 입력해 주세요.', true); return; }
    await runLookup();
  });

  async function runLookup() {
    var box = $('lookupResult');
    box.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    try {
      var res = await U.api('public.lookup', lastLookup);
      lastList = res.reservations;
      if (!res.reservations.length) {
        box.innerHTML = '<div class="card empty-msg">예정된 예약을 찾지 못했습니다. 학번·성명·예약코드를 다시 확인해 주세요.</div>';
        return;
      }
      box.innerHTML = res.reservations.map(function (r, i) {
        r.teacherName = res.teacherName; r.place = res.place;
        return '<div class="card"><div class="ticket" id="lk' + i + '"></div><div class="lk-actions">' +
          '<button type="button" class="btn ghost small" data-change="' + i + '">일정 변경하기</button>' +
          '<button type="button" class="btn danger small" data-cancel="' + i + '">이 예약 취소하기</button></div></div>';
      }).join('');
      res.reservations.forEach(function (r, i) { renderTicket(r, $('lk' + i)); });
    } catch (ex) {
      box.innerHTML = '';
      U.toast(ex.message, true);
    }
  }

  $('lookupResult').addEventListener('click', async function (e) {
    var c = e.target.closest('[data-change]');
    if (c) return startChange(lastList[+c.dataset.change]);
    var b = e.target.closest('[data-cancel]');
    if (!b) return;
    if (b.dataset.confirm !== '1') {
      b.dataset.confirm = '1';
      b.textContent = '정말 취소하시겠습니까? 한 번 더 누르면 취소됩니다';
      return;
    }
    b.disabled = true;
    try {
      var r = lastList[+b.dataset.cancel];
      await U.api('public.cancel', { date: r.date, start: r.start, studentId: lastLookup.studentId, name: lastLookup.name, code: lastLookup.code });
      U.toast('예약을 취소했습니다.');
      await runLookup();
      try { await loadAvailability(); renderCalendar(); } catch (e2) { /* 무시 */ }
    } catch (ex) {
      b.disabled = false;
      U.toast(ex.message, true);
    }
  });

  // ---------- 일정 변경 ----------
  function showTab(tab) {
    Array.prototype.forEach.call(document.querySelectorAll('button[data-tab]'), function (x) { x.classList.toggle('on', x.dataset.tab === tab); });
    $('tab-book').classList.toggle('hidden', tab !== 'book');
    $('tab-lookup').classList.toggle('hidden', tab !== 'lookup');
  }

  async function startChange(r) {
    if (!r) return;
    S.change = { r: r, who: { studentId: lastLookup.studentId, name: lastLookup.name, code: lastLookup.code } };
    S.date = null; S.slot = null;
    $('changeFrom').textContent = U.pretty(r.date) + ' ' + r.start + '~' + r.end;
    $('changeBar').classList.remove('hidden');
    $('slotCard').classList.add('is-empty');
    $('slots').innerHTML = '<div class="empty-msg">📅 먼저 달력에서 날짜를 골라 주세요.</div>';
    $('slotTitle').textContent = '시간을 골라 주세요';
    $('toForm').disabled = true;
    $('toForm').textContent = '이 시간으로 변경하기';
    showTab('book');
    goStep(1);
    try { await loadAvailability(); } catch (e) { /* 무시 */ }
    renderCalendar();
  }

  function endChange() {
    S.change = null;
    $('changeBar').classList.add('hidden');
    $('toForm').textContent = '다음 단계로';
  }

  $('changeCancel').onclick = function () {
    endChange();
    S.date = null; S.slot = null;
    renderCalendar();
    $('slotCard').classList.add('is-empty');
    $('slots').innerHTML = '<div class="empty-msg">📅 먼저 달력에서 날짜를 골라 주세요.</div>';
    $('slotTitle').textContent = '시간을 골라 주세요';
    $('toForm').disabled = true;
    showTab('lookup');
  };

  async function doChange() {
    var btn = $('toForm');
    var c = S.change;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:18px;height:18px;border-width:2px"></span> 변경하는 중…';
    try {
      var res = await U.api('public.change', {
        studentId: c.who.studentId, name: c.who.name, code: c.who.code,
        date: c.r.date, start: c.r.start, newDate: S.date, newStart: S.slot.start
      });
      // 예전 예약은 변경하면서 새 예약코드를 받으므로, 이후 조회에는 새 코드를 쓴다
      if (res.reservation.code) lastLookup.code = res.reservation.code;
      endChange();
      S.lastReservation = res.reservation;
      $('doneTitle').textContent = '일정이 변경되었습니다!';
      renderTicket(res.reservation, $('ticket'));
      goStep(3);
      if (lastLookup) runLookup();
    } catch (ex) {
      U.toast(ex.message, true);
      if (/다른 분이 예약|예약할 수 없어요/.test(ex.message)) {
        try { await loadAvailability(); } catch (e2) { /* 무시 */ }
        S.slot = null; renderCalendar(); renderSlots();
      }
    } finally {
      btn.disabled = !S.slot;
      btn.textContent = S.change ? '이 시간으로 변경하기' : '다음 단계로';
    }
  }

  init();
})();
