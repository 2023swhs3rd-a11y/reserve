const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Core = require('../docs/js/core.js');

function memStore(initPw = 'first-pass') {
  let state = null; let res = [];
  return {
    loadState: () => (state ? JSON.parse(JSON.stringify(state)) : null),
    saveState: (s) => { state = JSON.parse(JSON.stringify(s)); },
    listReservations: () => res.map((r) => ({ ...r })),
    addReservation: (r) => res.push({ ...r }),
    updateReservation: (id, p) => { res = res.map((r) => (r.id === id ? { ...r, ...p } : r)); },
    deleteReservations: (ids) => { res = res.filter((r) => !ids.includes(r.id)); },
    withLock: (fn) => fn(),
    sha256: (t) => crypto.createHash('sha256').update(String(t)).digest('hex'),
    randomId: () => crypto.randomUUID(),
    initialPassword: () => initPw
  };
}

const { todayStr, addDays } = Core._internal;
function nextWeekday(from, wd) { let d = addDays(from, 2); while (new Date(d + 'T00:00:00Z').getUTCDay() !== wd) d = addDays(d, 1); return d; }

const base = (date, start, extra = {}) => ({
  date, start, studentId: '20315', name: '김하늘', phone: '01012345678', parent: true,
  topics: ['진로·진학'], topicEtc: '', consent: true, ...extra
});

test('slots: 08:00~17:00, 50분 → 10칸, 마지막 15:30~16:20', () => {
  const s = Core.slotList(Core.defaultSettings());
  assert.strictEqual(s.length, 10);
  assert.deepStrictEqual(s[0], { start: '08:00', end: '08:50' });
  assert.deepStrictEqual(s[9], { start: '15:30', end: '16:20' });
});

test('예약 → 마감 표시, 중복 예약 차단, 학번당 1건 제한', () => {
  const st = memStore();
  const date = nextWeekday(todayStr(), 2);
  const r = Core.handle('public.reserve', base(date, '08:50'), st).reservation;
  assert.match(r.code, /^[A-Z2-9]{6}$/);
  assert.strictEqual(r.end, '09:40');
  const av = Core.handle('public.availability', { from: date, to: date }, st).days[date];
  assert.strictEqual(av.find((x) => x.start === '08:50').status, 'booked');
  assert.throws(() => Core.handle('public.reserve', base(date, '08:50', { studentId: '10101' }), st), /다른 분이 예약/);
  assert.throws(() => Core.handle('public.reserve', base(date, '09:40'), st), /이미 예약된 상담/);
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
  Core.handle('public.cancel', { code: r.code, studentId: '20315', phone: '010-1234-5678' }, st);
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
  // 그 날만 16:20 은 칸이 아님(무시), 15:30 열고 08:00 닫기
  Core.handle('admin.saveOverrides', { password: pw, changes: { [date]: { '15:30': true, '08:00': false, '16:20': true } } }, st);
  av = Core.handle('public.availability', { from: date, to: date }, st).days[date];
  assert.deepStrictEqual(av.map((x) => x.start), ['15:30']);
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
  // 월 1교시(08:40~09:30) 수업 → 08:00~08:50, 08:50~09:40 칸 닫힘
  const t = Core.templateFromTimetable(s, { 1: [1] });
  assert.ok(!t[1].includes('08:00') && !t[1].includes('08:50'));
  assert.ok(t[1].includes('09:40'));
  assert.strictEqual(t[2].length, 10);
  assert.strictEqual(t[0].length, 0);
});

test('gas/Core.gs 가 docs/js/core.js 와 같음', () => {
  const root = path.join(__dirname, '..');
  const a = fs.readFileSync(path.join(root, 'docs/js/core.js'), 'utf8');
  const b = fs.readFileSync(path.join(root, 'gas/Core.gs'), 'utf8');
  assert.ok(b.endsWith(a), 'npm run build:gas 를 실행하세요');
});
