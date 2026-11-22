const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Core = require('../docs/js/core.js');

function memStore(initPw = 'first-pass') {
  let state = null; let res = []; const fails = {};
  const sent = [];
  return {
    sent,
    notify: (to, subject, body) => sent.push({ to, subject, body }),
    loadState: () => (state ? JSON.parse(JSON.stringify(state)) : null),
    saveState: (s) => { state = JSON.parse(JSON.stringify(s)); },
    listReservations: () => res.map((r) => ({ ...r })),
    addReservation: (r) => res.push({ ...r }),
    updateReservation: (id, p) => { res = res.map((r) => (r.id === id ? { ...r, ...p } : r)); },
    deleteReservations: (ids) => { res = res.filter((r) => !ids.includes(r.id)); },
    withLock: (fn) => fn(),
    getFails: (k) => fails[k] || 0,
    addFail: (k) => { fails[k] = (fails[k] || 0) + 1; },
    sha256: (t) => crypto.createHash('sha256').update(String(t)).digest('hex'),
    randomId: () => crypto.randomUUID(),
    initialPassword: () => initPw
  };
}

const { todayStr, addDays } = Core._internal;
function nextWeekday(from, wd) { let d = addDays(from, 2); while (new Date(d + 'T00:00:00Z').getUTCDay() !== wd) d = addDays(d, 1); return d; }

const base = (date, start, extra = {}) => ({
  date, start, studentId: '20315', name: '김하늘', phone: '01012345678', parent: true,
  topics: ['과목선택'], topicEtc: '', consent: true, ...extra
});

test('slots: 08~16시 매시 정각 시작, 50분 → 9칸', () => {
  const s = Core.slotList(Core.defaultSettings());
  assert.strictEqual(s.length, 9);
  assert.deepStrictEqual(s[0], { start: '08:00', end: '08:50' });
  assert.deepStrictEqual(s[1], { start: '09:00', end: '09:50' });
  assert.deepStrictEqual(s[8], { start: '16:00', end: '16:50' });
});

test('v1 데이터(50분 연속 칸) → v2 자동 전환', () => {
  const st = memStore();
  const old = Core.defaultSettings();
  delete old.lastStart; delete old.slotInterval; old.dayEnd = '17:00'; old.title = '상담 예약';
  st.saveState({ version: 1, settings: old, template: { 1: ['08:00', '08:50', '09:40'] }, overrides: { '2026-12-01': { '08:50': true } }, auth: null });
  const s = Core.handle('admin.state', { password: 'first-pass' }, st);
  assert.strictEqual(s.settings.title, '봉일천고 진로진학상담 예약시스템');
  assert.strictEqual(s.settings.dayEnd, undefined);
  assert.deepStrictEqual(s.settings.topics, ['과목선택', '대학 및 학과선택', '수시정시지원전략', '전공적합 활동 추천']);
  assert.strictEqual(s.settings.resourceUrl, 'https://2023swhs3rd-a11y.github.io/jinhak/');
  assert.strictEqual(s.slots.length, 9);
  assert.strictEqual(s.template[1].length, 9);
  assert.deepStrictEqual(s.overrides, {});
});

test('설정: 자료실 주소 검증', () => {
  const st = memStore();
  assert.throws(() => Core.handle('admin.saveSettings', { password: 'first-pass', settings: { resourceUrl: 'javascript:alert(1)' } }, st), /자료실/);
  const r = Core.handle('admin.saveSettings', { password: 'first-pass', settings: { resourceUrl: 'https://example.com/a' } }, st);
  assert.strictEqual(r.settings.resourceUrl, 'https://example.com/a');
  assert.strictEqual(Core.handle('public.config', {}, st).settings.resourceUrl, 'https://example.com/a');
});

test('예약 → 마감 표시, 중복 예약 차단, 학번당 1건 제한', () => {
  const st = memStore();
  const date = nextWeekday(todayStr(), 2);
  const r = Core.handle('public.reserve', base(date, '09:00'), st).reservation;
  assert.ok(!('code' in r), '예약번호는 화면에 내보내지 않음');
  assert.strictEqual(r.end, '09:50');
  const av = Core.handle('public.availability', { from: date, to: date }, st).days[date];
  assert.strictEqual(av.find((x) => x.start === '09:00').status, 'booked');
  assert.throws(() => Core.handle('public.reserve', base(date, '09:00', { studentId: '10101' }), st), /다른 분이 예약/);
  assert.throws(() => Core.handle('public.reserve', base(date, '10:00'), st), /이미 예약된 상담/);
  // 공개 응답에 연락처·성적 미포함
  assert.ok(!('phone' in r) && !('gradeSchool' in r));
});

test('필수값 검증', () => {
  const st = memStore();
  const date = nextWeekday(todayStr(), 3);
  assert.throws(() => Core.handle('public.reserve', base(date, '08:00', { consent: false }), st), /동의/);
  assert.throws(() => Core.handle('public.reserve', base(date, '08:00', { topics: [], topicEtc: '' }), st), /문의 내용/);
  assert.throws(() => Core.handle('public.reserve', base(date, '08:00', { phone: '123' }), st), /연락처/);
  assert.throws(() => Core.handle('public.reserve', base(date, '08:00', { parent: null }), st), /학부모/);
  // 직접 입력만 있어도 OK
  const ok = Core.handle('public.reserve', base(date, '08:00', { topics: [], topicEtc: '동아리 고민' }), st);
  assert.strictEqual(ok.reservation.topicEtc, '동아리 고민');
});

test('조회와 취소', () => {
  const st = memStore();
  const date = nextWeekday(todayStr(), 4);
  const r = Core.handle('public.reserve', base(date, '13:00'), st).reservation;
  const lk = Core.handle('public.lookup', { studentId: '20315', name: '김하늘', phone: '010-1234-5678' }, st);
  assert.strictEqual(lk.reservations.length, 1);
  assert.strictEqual(Core.handle('public.lookup', { studentId: '20315', name: '김하늘', phone: '010-0000-0000' }, st).reservations.length, 0);
  assert.throws(() => Core.handle('public.cancel', { studentId: '20315', name: '김하늘', phone: '010-1234-5678', date, start: '14:00' }, st), /찾을 수 없어요/);
  Core.handle('public.cancel', { studentId: '20315', name: '김하늘', phone: '010-1234-5678', date, start: '13:00' }, st);
  assert.deepStrictEqual(st.sent.map((m) => m.subject.split(' - ')[0]), ['[봉일천고 진로진학상담] 새 예약', '[봉일천고 진로진학상담] 예약 취소']);
  assert.strictEqual(st.sent[0].to, 'jungsooj@korea.kr');
  assert.match(st.sent[0].subject, /13:00 김하늘$/);
  assert.ok(!/2\.4등급/.test(st.sent[0].body));
  const av = Core.handle('public.availability', { from: date, to: date }, st).days[date];
  assert.strictEqual(av.find((x) => x.start === '13:00').status, 'open');
});

test('관리자: 비밀번호, 주간 시간, 날짜 조정', () => {
  const st = memStore();
  assert.throws(() => Core.handle('admin.state', { password: 'wrong' }, st), /비밀번호/);
  const s = Core.handle('admin.state', { password: 'first-pass' }, st);
  assert.strictEqual(s.usingInitialPassword, true);
  Core.handle('admin.changePassword', { password: 'first-pass', newPassword: 'new-pass-123' }, st);
  assert.throws(() => Core.handle('admin.state', { password: 'first-pass' }, st), /비밀번호/);
  const pw = 'new-pass-123';
  const date = nextWeekday(todayStr(), 1);
  // 월요일은 08:00만 열기
  const tpl = s.template; tpl[1] = ['08:00'];
  Core.handle('admin.saveTemplate', { password: pw, template: tpl }, st);
  let av = Core.handle('public.availability', { from: date, to: date }, st).days[date];
  assert.deepStrictEqual(av.map((x) => x.start), ['08:00']);
  // 그 날만 16:20 은 칸이 아님(무시), 15:00 열고 08:00 닫기
  Core.handle('admin.saveOverrides', { password: pw, changes: { [date]: { '15:00': true, '08:00': false, '16:20': true } } }, st);
  av = Core.handle('public.availability', { from: date, to: date }, st).days[date];
  assert.deepStrictEqual(av.map((x) => x.start), ['15:00']);
  Core.handle('admin.saveOverrides', { password: pw, changes: { [date]: null } }, st);
  av = Core.handle('public.availability', { from: date, to: date }, st).days[date];
  assert.deepStrictEqual(av.map((x) => x.start), ['08:00']);
  // 토요일은 기본적으로 닫힘
  const sat = nextWeekday(todayStr(), 6);
  assert.strictEqual(Core.handle('public.availability', { from: sat, to: sat }, st).days[sat], undefined);
});

test('관리자 비밀번호가 설정되지 않으면 로그인 불가', () => {
  const st = memStore('');
  assert.throws(() => Core.handle('admin.login', { password: 'x' }, st), /설정되지 않았습니다/);
});

test('시간표 → 주간 기본 시간: 수업과 겹치는 칸 제외', () => {
  const s = Core.defaultSettings();
  // 월 1교시(08:40~09:30) 수업 → 08:00~08:50, 09:00~09:50 칸 닫힘
  const t = Core.templateFromTimetable(s, { 1: [1] });
  assert.ok(!t[1].includes('08:00') && !t[1].includes('09:00'));
  assert.ok(t[1].includes('10:00'));
  assert.strictEqual(t[2].length, 9);
  assert.strictEqual(t[0].length, 0);
});

test('gas/Core.gs 가 docs/js/core.js 와 같음', () => {
  const root = path.join(__dirname, '..');
  const a = fs.readFileSync(path.join(root, 'docs/js/core.js'), 'utf8');
  const b = fs.readFileSync(path.join(root, 'gas/Core.gs'), 'utf8');
  assert.ok(b.endsWith(a), 'npm run build:gas 를 실행하세요');
});

test('알림 이메일: 비우면 미발송, 잘못된 주소 거부', () => {
  const st = memStore();
  assert.throws(() => Core.handle('admin.saveSettings', { password: 'first-pass', settings: { notifyEmail: 'abc' } }, st), /이메일/);
  Core.handle('admin.saveSettings', { password: 'first-pass', settings: { notifyEmail: '' } }, st);
  const date = nextWeekday(todayStr(), 5);
  Core.handle('public.reserve', base(date, '10:00'), st);
  assert.strictEqual(st.sent.length, 0);
});

test('알림 실패해도 예약은 성공', () => {
  const st = memStore();
  st.notify = () => { throw new Error('quota'); };
  const date = nextWeekday(todayStr(), 2);
  assert.ok(Core.handle('public.reserve', base(date, '11:00'), st).reservation);
});

test('조회·취소: 여러 번 틀리면 잠시 막힘', () => {
  const st = memStore();
  const date = nextWeekday(todayStr(), 4);
  Core.handle('public.reserve', base(date, '13:00'), st);
  const who = { studentId: '20315', name: '김하늘', phone: '010-1234-5678' };
  for (let i = 0; i < 5; i++) Core.handle('public.lookup', { ...who, phone: '010-0000-0000' }, st);
  assert.throws(() => Core.handle('public.lookup', who, st), /15분/);
  assert.throws(() => Core.handle('public.cancel', { ...who, date, start: '13:00' }, st), /15분/);
  // 다른 학번은 막히지 않는다
  assert.strictEqual(Core.handle('public.lookup', { ...who, studentId: '20316' }, st).reservations.length, 0);
});
