// ⚠ 자동 생성 파일입니다. docs/js/core.js 를 고친 뒤 `npm run build:gas` 로 다시 만드세요.
/*
 * 상담예약 핵심 로직 (Node 서버와 Google Apps Script가 함께 사용)
 *
 * 이 파일은 저장 방식과 무관한 순수 로직만 담고 있습니다.
 * - Node:  server.js 가 require('./core/core.js') 로 사용
 * - GAS:   gas/Core.gs 로 복사되어 사용 (npm run build:gas)
 *
 * 저장소(store) 인터페이스
 *   loadState()               -> 설정 객체 또는 null
 *   saveState(state)
 *   listReservations()        -> 예약 배열
 *   addReservation(r)
 *   updateReservation(id, patch)
 *   deleteReservations(ids)
 *   withLock(fn)              -> fn() 을 잠금 안에서 실행하고 결과 반환
 *   sha256(text)              -> hex 문자열
 *   randomId()                -> 무작위 문자열
 *   initialPassword()         -> 최초 관리자 비밀번호(환경변수/스크립트 속성) 또는 ''
 *   notify(to, subject, body) -> (선택) 담당자 알림 메일 발송. 실패해도 예약은 유지
 */
var Core = (function () {
  'use strict';

  var DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
  var STATE_VERSION = 3;
  var OLD_TOPICS = ['진로·진학', '학업·성적', '수시·정시 지원 전략', '학교생활기록부', '교우관계', '학교생활 적응', '건강·심리'];

  function UserError(message) {
    this.name = 'UserError';
    this.message = message;
    this.userFacing = true;
  }
  UserError.prototype = Object.create(Error.prototype);

  function fail(msg) { throw new UserError(msg); }

  // ---------- 시간 유틸 (항상 한국시간 기준) ----------
  function kstNow() {
    // 서버 시간대와 상관없이 한국시간 '벽시계' 값을 UTC 필드에 담은 Date
    return new Date(Date.now() + 9 * 3600 * 1000);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function todayStr() { return ymd(kstNow()); }
  function parseYmd(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return null;
    var p = s.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return ymd(d) === s ? d : null;
  }
  function addDays(s, n) {
    var d = parseYmd(s);
    d.setUTCDate(d.getUTCDate() + n);
    return ymd(d);
  }
  function weekday(s) { return parseYmd(s).getUTCDay(); }
  function toMin(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
    if (!m) return NaN;
    return (+m[1]) * 60 + (+m[2]);
  }
  function toHHMM(min) { return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }

  // ---------- 기본 설정 ----------
  function defaultSettings() {
    var t = todayStr();
    return {
      title: '봉일천고 진로진학상담 예약시스템',
      teacherName: '',
      schoolName: '',
      place: '',
      notice: '편한 날짜와 시간을 골라 주세요. 학생과 학부모님 모두 신청할 수 있어요.\n예약 후 일정 변경이 필요하면 [내 예약 확인]에서 취소하고 다시 신청해 주세요.',
      contactPhone: '031-950-0107',
      contactEmail: 'jungsooj@korea.kr',
      notifyEmail: 'jungsooj@korea.kr',  // 새 예약·취소 알림 받을 주소 (쉼표로 여러 개)
      dayStart: '08:00',      // 첫 상담 시작
      lastStart: '16:00',     // 마지막 상담 시작
      slotInterval: 60,       // 상담 시작 간격(분) → 매시 정각
      slotMinutes: 50,        // 상담 한 번 길이(분)
      resourceUrl: 'https://2023swhs3rd-a11y.github.io/jinhak/', // 진로진학자료실 주소
      resourceLabel: '진로진학자료실',
      bookingStart: t,
      bookingEnd: addDays(t, 30),
      weekdays: [1, 2, 3, 4, 5],
      minLeadHours: 3,
      maxActivePerStudent: 1,
      topics: ['과목선택', '대학 및 학과선택', '수시정시지원전략', '전공적합 활동 추천'],
      retention: '상담 종료 후 1년',
      periods: [
        { no: 1, start: '08:40', end: '09:30' },
        { no: 2, start: '09:40', end: '10:30' },
        { no: 3, start: '10:40', end: '11:30' },
        { no: 4, start: '11:40', end: '12:30' },
        { no: 5, start: '13:30', end: '14:20' },
        { no: 6, start: '14:30', end: '15:20' },
        { no: 7, start: '15:30', end: '16:20' }
      ]
    };
  }

  // 기본: 08:00부터 16:00까지 매시 정각 시작, 한 번에 50분 → 08:00~08:50 … 16:00~16:50 (9칸)
  function slotList(settings) {
    var s = toMin(settings.dayStart), e = toMin(settings.lastStart);
    var step = +settings.slotInterval, dur = +settings.slotMinutes;
    var out = [];
    if (!(step >= 10) || !(dur >= 10) || isNaN(s) || isNaN(e)) return out;
    for (var m = s; m <= e && out.length < 48; m += step) out.push({ start: toHHMM(m), end: toHHMM(m + dur) });
    return out;
  }

  function defaultTemplate(settings) {
    var all = slotList(settings).map(function (x) { return x.start; });
    var t = {};
    for (var d = 0; d <= 6; d++) t[d] = settings.weekdays.indexOf(d) >= 0 ? all.slice() : [];
    return t;
  }

  function getState(store) {
    var st = store.loadState();
    if (!st) {
      var settings = defaultSettings();
      st = { version: STATE_VERSION, settings: settings, template: defaultTemplate(settings), overrides: {}, auth: null };
      store.saveState(st);
    }
    // 새 설정 항목이 추가된 경우 기본값으로 채움
    var def = defaultSettings();
    Object.keys(def).forEach(function (k) { if (st.settings[k] === undefined) st.settings[k] = def[k]; });
    if ((st.version || 1) < 2) {
      // v2: 50분 연속 칸 → 매시 정각 시작(08~16시)으로 바뀜. 시간 칸 구성이 달라져 기본 시간을 새로 만듦
      delete st.settings.dayEnd;
      st.settings.dayStart = def.dayStart;
      st.settings.lastStart = def.lastStart;
      st.settings.slotInterval = def.slotInterval;
      st.settings.slotMinutes = def.slotMinutes;
      if (st.settings.title === '상담 예약') st.settings.title = def.title;
      st.template = defaultTemplate(st.settings);
      st.overrides = {};
      st.version = 2;
      store.saveState(st);
    }
    if (st.version < 3) {
      // v3: 문의 항목·자료실·문의처 기본값 변경 (선생님이 바꾸지 않은 값만 교체)
      if (JSON.stringify(st.settings.topics) === JSON.stringify(OLD_TOPICS)) st.settings.topics = def.topics;
      if (st.settings.title === '상담 예약') st.settings.title = def.title;
      if (!st.settings.resourceUrl) st.settings.resourceUrl = def.resourceUrl;
      st.version = 3;
      store.saveState(st);
    }
    st.overrides = st.overrides || {};
    st.template = st.template || defaultTemplate(st.settings);
    return st;
  }

  // ---------- 가용 시간 계산 ----------
  function isSlotOpenByRule(state, date, start) {
    var ov = state.overrides[date];
    if (ov && Object.prototype.hasOwnProperty.call(ov, start)) return !!ov[start];
    var wd = weekday(date);
    if (state.settings.weekdays.indexOf(wd) < 0) return false;
    var list = state.template[wd] || [];
    return list.indexOf(start) >= 0;
  }

  function activeReservations(store) {
    return store.listReservations().filter(function (r) { return r.status !== 'cancelled'; });
  }

  function bookedMap(reservations) {
    var m = {};
    reservations.forEach(function (r) { m[r.date + ' ' + r.start] = r; });
    return m;
  }

  function isTooLate(settings, date, start) {
    var now = kstNow();
    var nowMin = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 60000 + now.getUTCHours() * 60 + now.getUTCMinutes();
    var slotMin = parseYmd(date).getTime() / 60000 + toMin(start);
    return slotMin - nowMin < (+settings.minLeadHours || 0) * 60;
  }

  function availability(state, reservations, from, to) {
    var s = state.settings;
    var slots = slotList(s);
    var start = from < s.bookingStart ? s.bookingStart : from;
    var end = to > s.bookingEnd ? s.bookingEnd : to;
    var booked = bookedMap(reservations);
    var days = {};
    if (!parseYmd(start) || !parseYmd(end)) return days;
    var guard = 0;
    for (var d = start; d <= end && guard < 400; d = addDays(d, 1), guard++) {
      var list = [];
      slots.forEach(function (sl) {
        if (!isSlotOpenByRule(state, d, sl.start)) return;
        if (isTooLate(s, d, sl.start)) return;
        list.push({ start: sl.start, end: sl.end, status: booked[d + ' ' + sl.start] ? 'booked' : 'open' });
      });
      if (list.length) days[d] = list;
    }
    return days;
  }

  // ---------- 입력 검증 ----------
  function str(v, max) {
    v = (v === undefined || v === null) ? '' : String(v).trim();
    if (max && v.length > max) fail('입력이 너무 깁니다. (' + max + '자 이내)');
    return v;
  }
  function normPhone(v) {
    var digits = String(v || '').replace(/\D/g, '');
    if (!/^0\d{8,10}$/.test(digits)) return '';
    if (digits.length === 11) return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7);
    if (digits.length === 10 && digits.indexOf('02') === 0) return '02-' + digits.slice(2, 6) + '-' + digits.slice(6);
    if (digits.length === 10) return digits.slice(0, 3) + '-' + digits.slice(3, 6) + '-' + digits.slice(6);
    return digits;
  }

  function makeCode(store) {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var h = store.sha256(store.randomId() + Date.now());
    var out = '';
    for (var i = 0; i < 6; i++) out += chars[parseInt(h.substr(i * 2, 2), 16) % chars.length];
    return out;
  }

  function publicReservation(r) {
    return {
      date: r.date, start: r.start, end: r.end,
      dayName: DAY_NAMES[weekday(r.date)],
      studentId: r.studentId, name: r.name, parent: r.parent,
      topics: r.topics, topicEtc: r.topicEtc, status: r.status
    };
  }

  function publicSettings(s) {
    return {
      title: s.title, teacherName: s.teacherName, schoolName: s.schoolName, place: s.place,
      notice: s.notice, topics: s.topics, retention: s.retention,
      bookingStart: s.bookingStart, bookingEnd: s.bookingEnd,
      slotMinutes: s.slotMinutes, today: todayStr(),
      resourceUrl: s.resourceUrl, resourceLabel: s.resourceLabel,
      contactPhone: s.contactPhone, contactEmail: s.contactEmail
    };
  }

  // ---------- 담당자 알림 ----------
  function hourLabel(hhmm) {
    var p = String(hhmm).split(':');
    return (+p[1] ? p[0] + '시 ' + p[1] + '분' : p[0] + '시');
  }

  function notifyTeacher(store, settings, kind, r) {
    var to = String(settings.notifyEmail || '').trim();
    if (!to || typeof store.notify !== 'function') return;
    var subject = '[봉일천고 진로진학상담] ' + kind + ' - ' + r.date + '(' + DAY_NAMES[weekday(r.date)] + ') ' + hourLabel(r.start) + ' ' + r.name;
    var topics = (r.topics || []).slice();
    if (r.topicEtc) topics.push('직접 입력: ' + r.topicEtc);
    var body = [
      kind === '새 예약' ? '새 상담 예약이 들어왔어요.' : '상담 예약이 취소되었어요.',
      '',
      '일정: ' + r.date + '(' + DAY_NAMES[weekday(r.date)] + ') ' + r.start + '~' + r.end,
      '학번/성명: ' + r.studentId + ' ' + r.name,
      '연락처: ' + r.phone,
      '학부모 참여: ' + (r.parent ? '참여' : '불참'),
      '문의 내용: ' + topics.join(', '),
      '',
      '성적 등 자세한 내용은 관리자 화면에서 확인해 주세요.'
    ].join('\n');
    try { store.notify(to, subject, body); } catch (e) { /* 알림 실패는 예약에 영향 없음 */ }
  }

  // ---------- 관리자 인증 ----------
  function hashPw(store, salt, pw) { return store.sha256(salt + ':' + pw); }

  function checkAdmin(store, state, password) {
    password = String(password || '');
    if (!password) fail('관리자 비밀번호를 입력해 주세요.');
    if (state.auth && state.auth.hash) {
      if (hashPw(store, state.auth.salt, password) !== state.auth.hash) fail('비밀번호가 올바르지 않습니다.');
      return;
    }
    var init = store.initialPassword();
    if (!init) fail('관리자 비밀번호가 아직 설정되지 않았습니다. 설치 안내(README)의 "관리자 비밀번호 설정"을 확인해 주세요.');
    if (password !== init) fail('비밀번호가 올바르지 않습니다.');
  }

  // ---------- 설정 검증 ----------
  function cleanSettings(input, prev) {
    var s = JSON.parse(JSON.stringify(prev));
    var i = input || {};
    ['title', 'teacherName', 'schoolName', 'place', 'retention'].forEach(function (k) {
      if (i[k] !== undefined) s[k] = str(i[k], 100);
    });
    if (i.notice !== undefined) s.notice = str(i.notice, 2000);
    if (i.contactPhone !== undefined) s.contactPhone = str(i.contactPhone, 40);
    if (i.contactEmail !== undefined) s.contactEmail = str(i.contactEmail, 100);
    if (i.notifyEmail !== undefined) {
      s.notifyEmail = str(i.notifyEmail, 300);
      var bad = s.notifyEmail.split(',').map(function (x) { return x.trim(); }).filter(Boolean)
        .filter(function (x) { return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x); });
      if (bad.length) fail('알림 받을 이메일 주소를 확인해 주세요: ' + bad[0]);
    }
    if (i.dayStart !== undefined) s.dayStart = str(i.dayStart);
    if (i.lastStart !== undefined) s.lastStart = str(i.lastStart);
    if (i.slotMinutes !== undefined) s.slotMinutes = parseInt(i.slotMinutes, 10);
    if (i.slotInterval !== undefined) s.slotInterval = parseInt(i.slotInterval, 10);
    if (isNaN(toMin(s.dayStart)) || isNaN(toMin(s.lastStart)) || toMin(s.dayStart) > toMin(s.lastStart)) fail('첫 상담/마지막 상담 시작 시각을 확인해 주세요.');
    if (!(s.slotInterval >= 10 && s.slotInterval <= 240)) fail('상담 시작 간격(분)은 10~240 사이여야 합니다.');
    if (!(s.slotMinutes >= 10 && s.slotMinutes <= s.slotInterval)) fail('상담 시간(분)은 10분 이상, 시작 간격 이하여야 합니다.');
    if (toMin(s.lastStart) + s.slotMinutes > 24 * 60) fail('마지막 상담이 자정을 넘어요.');
    if (i.resourceUrl !== undefined) {
      s.resourceUrl = str(i.resourceUrl, 500);
      if (s.resourceUrl && !/^https?:\/\/\S+$/i.test(s.resourceUrl)) fail('자료실 주소는 http:// 또는 https:// 로 시작해야 해요.');
    }
    if (i.resourceLabel !== undefined) s.resourceLabel = str(i.resourceLabel, 40) || '진로진학자료실';
    if (i.bookingStart !== undefined) s.bookingStart = str(i.bookingStart);
    if (i.bookingEnd !== undefined) s.bookingEnd = str(i.bookingEnd);
    if (!parseYmd(s.bookingStart) || !parseYmd(s.bookingEnd) || s.bookingStart > s.bookingEnd) fail('예약 기간을 확인해 주세요.');
    if (i.weekdays !== undefined) {
      s.weekdays = (i.weekdays || []).map(Number).filter(function (d) { return d >= 0 && d <= 6; });
    }
    if (i.minLeadHours !== undefined) s.minLeadHours = Math.max(0, Math.min(240, parseInt(i.minLeadHours, 10) || 0));
    if (i.maxActivePerStudent !== undefined) s.maxActivePerStudent = Math.max(0, Math.min(20, parseInt(i.maxActivePerStudent, 10) || 0));
    if (i.topics !== undefined) {
      s.topics = (i.topics || []).map(function (t) { return str(t, 40); }).filter(Boolean).slice(0, 30);
    }
    if (i.periods !== undefined) {
      s.periods = (i.periods || []).map(function (p, idx) {
        var st = str(p.start), en = str(p.end);
        if (isNaN(toMin(st)) || isNaN(toMin(en)) || toMin(st) >= toMin(en)) fail((idx + 1) + '교시 시간을 확인해 주세요.');
        return { no: idx + 1, start: st, end: en };
      }).slice(0, 12);
    }
    return s;
  }

  function cleanTemplate(input, settings) {
    var valid = slotList(settings).map(function (x) { return x.start; });
    var t = {};
    for (var d = 0; d <= 6; d++) {
      var arr = (input && input[d]) || [];
      t[d] = valid.filter(function (v) { return arr.indexOf(v) >= 0; });
    }
    return t;
  }

  // ---------- 액션 처리 ----------
  var handlers = {
    // ===== 공개 =====
    'public.config': function (p, store) {
      var st = getState(store);
      return { settings: publicSettings(st.settings) };
    },

    'public.availability': function (p, store) {
      var st = getState(store);
      var from = parseYmd(p.from) ? p.from : todayStr();
      var to = parseYmd(p.to) ? p.to : addDays(from, 42);
      if (to > addDays(from, 92)) to = addDays(from, 92);
      return { days: availability(st, activeReservations(store), from, to) };
    },

    'public.reserve': function (p, store) {
      var date = str(p.date), start = str(p.start);
      var studentId = str(p.studentId, 10).replace(/\s/g, '');
      var name = str(p.name, 30);
      var phone = normPhone(p.phone);
      if (!parseYmd(date) || isNaN(toMin(start))) fail('상담 날짜와 시간을 선택해 주세요.');
      if (!/^\d{4,6}$/.test(studentId)) fail('학번은 숫자 4~6자리로 입력해 주세요. (예: 20315)');
      if (!name) fail('성명을 입력해 주세요.');
      if (!phone) fail('연락처를 올바르게 입력해 주세요. (예: 010-1234-5678)');
      if (p.parent !== true && p.parent !== false) fail('학부모 참여 여부를 선택해 주세요.');
      if (p.consent !== true) fail('개인정보 수집·이용 및 조회에 동의해야 신청할 수 있어요.');

      return store.withLock(function () {
        var st = getState(store);
        var allowedTopics = st.settings.topics;
        var topics = (Array.isArray(p.topics) ? p.topics : []).map(function (t) { return str(t, 40); })
          .filter(function (t) { return allowedTopics.indexOf(t) >= 0; });
        var topicEtc = str(p.topicEtc, 500);
        if (!topics.length && !topicEtc) fail('문의 내용을 하나 이상 선택하거나 직접 입력해 주세요.');

        var active = activeReservations(store);
        var days = availability(st, active, date, date);
        var slot = (days[date] || []).filter(function (x) { return x.start === start; })[0];
        if (!slot) fail('선택한 시간은 예약할 수 없어요. 다른 시간을 골라 주세요.');
        if (slot.status === 'booked') fail('앗, 방금 다른 분이 예약했어요. 다른 시간을 골라 주세요.');

        var today = todayStr();
        var mine = active.filter(function (r) { return r.studentId === studentId && r.date >= today; });
        var max = +st.settings.maxActivePerStudent;
        if (max > 0 && mine.length >= max) {
          fail('이미 예약된 상담이 있어요 (' + mine[0].date + ' ' + mine[0].start + '). [내 예약 확인]에서 확인하거나 취소 후 다시 신청해 주세요.');
        }

        var nowIso = new Date().toISOString();
        var r = {
          id: store.randomId(),
          code: makeCode(store),
          status: 'booked',
          date: date, start: slot.start, end: slot.end,
          studentId: studentId, name: name, phone: phone,
          parent: p.parent === true,
          topics: topics, topicEtc: topicEtc,
          gradeSchool: str(p.gradeSchool, 500),
          gradeMock: str(p.gradeMock, 500),
          consent: true, consentAt: nowIso,
          createdAt: nowIso, memo: ''
        };
        store.addReservation(r);
        notifyTeacher(store, st.settings, '새 예약', r);
        var out = publicReservation(r);
        out.teacherName = st.settings.teacherName;
        out.place = st.settings.place;
        out.title = st.settings.title;
        return { reservation: out };
      });
    },

    'public.lookup': function (p, store) {
      var studentId = str(p.studentId, 10).replace(/\s/g, '');
      var name = str(p.name, 30);
      var phone = normPhone(p.phone);
      if (!studentId || !name || !phone) fail('학번, 성명, 연락처를 모두 입력해 주세요.');
      var today = todayStr();
      var list = store.listReservations().filter(function (r) {
        return r.studentId === studentId && r.name === name && r.phone === phone && r.date >= today && r.status !== 'cancelled';
      }).sort(function (a, b) { return (a.date + a.start) < (b.date + b.start) ? -1 : 1; });
      var st = getState(store);
      return { reservations: list.map(publicReservation), teacherName: st.settings.teacherName, place: st.settings.place, title: st.settings.title };
    },

    // 예약번호 없이: 학번+성명+연락처 + 날짜·시각이 모두 맞아야 취소
    'public.cancel': function (p, store) {
      var studentId = str(p.studentId, 10).replace(/\s/g, '');
      var name = str(p.name, 30);
      var phone = normPhone(p.phone);
      var date = str(p.date), start = str(p.start);
      if (!studentId || !name || !phone || !date || !start) fail('예약 정보를 확인해 주세요.');
      return store.withLock(function () {
        var r = store.listReservations().filter(function (x) {
          return x.studentId === studentId && x.name === name && x.phone === phone &&
            x.date === date && x.start === start && x.status !== 'cancelled';
        })[0];
        if (!r) fail('예약을 찾을 수 없어요.');
        if (r.date < todayStr()) fail('지난 예약은 취소할 수 없어요.');
        store.updateReservation(r.id, { status: 'cancelled', memo: (r.memo ? r.memo + ' / ' : '') + '신청자 취소 ' + new Date().toISOString().slice(0, 10) });
        notifyTeacher(store, getState(store).settings, '예약 취소', r);
        return { ok: true };
      });
    },

    // ===== 관리자 =====
    'admin.login': function (p, store, st) {
      return { ok: true, usingInitialPassword: !(st.auth && st.auth.hash) };
    },

    'admin.state': function (p, store, st) {
      var res = store.listReservations().slice().sort(function (a, b) {
        return (a.date + a.start) < (b.date + b.start) ? -1 : 1;
      });
      return {
        settings: st.settings, template: st.template, overrides: st.overrides,
        slots: slotList(st.settings), reservations: res, today: todayStr(),
        usingInitialPassword: !(st.auth && st.auth.hash)
      };
    },

    'admin.saveSettings': function (p, store, st) {
      var before = slotList(st.settings).map(function (x) { return x.start; }).join(',');
      st.settings = cleanSettings(p.settings, st.settings);
      var after = slotList(st.settings).map(function (x) { return x.start; }).join(',');
      if (before !== after) {
        // 시간 칸 구성이 바뀌면 주간 기본 시간을 새 칸에 맞게 다시 만듦
        st.template = defaultTemplate(st.settings);
      }
      st.template = cleanTemplate(st.template, st.settings);
      store.saveState(st);
      return { settings: st.settings, template: st.template, slots: slotList(st.settings), slotsChanged: before !== after };
    },

    'admin.saveTemplate': function (p, store, st) {
      st.template = cleanTemplate(p.template, st.settings);
      store.saveState(st);
      return { template: st.template };
    },

    // p.changes = { 'YYYY-MM-DD': { '08:00': true|false|null, ... } }  (null = 기본값으로)
    'admin.saveOverrides': function (p, store, st) {
      var valid = slotList(st.settings).map(function (x) { return x.start; });
      var changes = p.changes || {};
      Object.keys(changes).forEach(function (date) {
        if (!parseYmd(date)) return;
        var cur = st.overrides[date] || {};
        var c = changes[date];
        if (c === null) { delete st.overrides[date]; return; }
        Object.keys(c).forEach(function (start) {
          if (valid.indexOf(start) < 0) return;
          if (c[start] === null) delete cur[start];
          else cur[start] = !!c[start];
        });
        if (Object.keys(cur).length) st.overrides[date] = cur; else delete st.overrides[date];
      });
      // 오래된 조정값 정리
      var cutoff = addDays(todayStr(), -60);
      Object.keys(st.overrides).forEach(function (d) { if (d < cutoff) delete st.overrides[d]; });
      store.saveState(st);
      return { overrides: st.overrides };
    },

    'admin.updateReservation': function (p, store) {
      var patch = {};
      if (p.status !== undefined) {
        if (['booked', 'done', 'cancelled'].indexOf(p.status) < 0) fail('잘못된 상태값입니다.');
        patch.status = p.status;
      }
      if (p.memo !== undefined) patch.memo = str(p.memo, 1000);
      return store.withLock(function () {
        var r = store.listReservations().filter(function (x) { return x.id === p.id; })[0];
        if (!r) fail('예약을 찾을 수 없어요.');
        if (patch.status === 'booked' && r.status === 'cancelled') {
          var clash = activeReservations(store).filter(function (x) { return x.date === r.date && x.start === r.start; })[0];
          if (clash) fail('같은 시간에 다른 예약이 있어 되살릴 수 없어요.');
        }
        store.updateReservation(r.id, patch);
        return { ok: true };
      });
    },

    'admin.deleteReservations': function (p, store) {
      var ids = Array.isArray(p.ids) ? p.ids.map(String) : [];
      return store.withLock(function () {
        store.deleteReservations(ids);
        return { deleted: ids.length };
      });
    },

    // 기준일 이전의 예약(개인정보)을 일괄 파기
    'admin.purgeBefore': function (p, store) {
      var before = str(p.before);
      if (!parseYmd(before)) fail('날짜를 확인해 주세요.');
      return store.withLock(function () {
        var ids = store.listReservations().filter(function (r) { return r.date < before; }).map(function (r) { return r.id; });
        store.deleteReservations(ids);
        return { deleted: ids.length };
      });
    },

    'admin.changePassword': function (p, store, st) {
      var pw = String(p.newPassword || '');
      if (pw.length < 8) fail('새 비밀번호는 8자 이상으로 정해 주세요.');
      var salt = store.randomId();
      st.auth = { salt: salt, hash: hashPw(store, salt, pw), changedAt: new Date().toISOString() };
      store.saveState(st);
      return { ok: true };
    }
  };

  function handle(action, payload, store) {
    var fn = handlers[action];
    if (!fn) fail('알 수 없는 요청입니다.');
    payload = payload || {};
    if (action.indexOf('admin.') === 0) {
      var st = getState(store);
      checkAdmin(store, st, payload.password);
      return fn(payload, store, st);
    }
    return fn(payload, store);
  }

  // 시간표(교시) → 상담 칸 겹침 계산: busy = { 1: [1,3,5], 2: [...] } (요일: 교시 목록)
  function templateFromTimetable(settings, busy) {
    var slots = slotList(settings);
    var periods = settings.periods || [];
    var t = {};
    for (var d = 0; d <= 6; d++) {
      if (settings.weekdays.indexOf(d) < 0) { t[d] = []; continue; }
      var busyPeriods = (busy && busy[d]) || [];
      t[d] = slots.filter(function (sl) {
        var s = toMin(sl.start), e = toMin(sl.end);
        return !busyPeriods.some(function (no) {
          var pr = periods.filter(function (x) { return x.no === no; })[0];
          return pr && toMin(pr.start) < e && toMin(pr.end) > s;
        });
      }).map(function (sl) { return sl.start; });
    }
    return t;
  }

  return {
    handle: handle,
    UserError: UserError,
    slotList: slotList,
    defaultSettings: defaultSettings,
    templateFromTimetable: templateFromTimetable,
    normPhone: normPhone,
    _internal: { todayStr: todayStr, addDays: addDays, availability: availability }
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Core;
