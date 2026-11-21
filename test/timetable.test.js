const test = require('node:test');
const assert = require('node:assert');
const T = require('../docs/js/timetable.js');

test('격자형(교사 1명)', () => {
  const rows = [
    ['2026학년도 2학기 교사 시간표'],
    ['김선생'],
    ['교시', '월', '화', '수', '목', '금'],
    ['1교시', '2-3 국어', '', '', '1-1 국어', ''],
    ['', '', '', '', '', ''],
    ['2교시', '', '2-1 국어', '', '', ''],
    ['점심', '', '', '', '', ''],
    ['5', '', '', '', '', '2-3 국어'],
    ['6(14:30)', '', '', '창체', '', '']
  ];
  const r = T.parseRows(rows);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].name, '김선생');
  assert.deepStrictEqual(r[0].busy[1], [1]);
  assert.deepStrictEqual(r[0].busy[2], [2]);
  assert.deepStrictEqual(r[0].busy[3], [6]);
  assert.deepStrictEqual(r[0].busy[4], [1]);
  assert.deepStrictEqual(r[0].busy[5], [5]);
});

test('격자형: 과목/반 2줄 칸 — 아랫줄도 같은 교시', () => {
  const rows = [
    ['', '월', '화', '수', '목', '금'],
    ['1', '', '', '', '', ''],
    ['', '', '2-4', '', '', ''],
    ['2', '국어', '', '', '', ''],
  ];
  const r = T.parseRows(rows)[0];
  assert.deepStrictEqual(r.busy[2], [1]);
  assert.deepStrictEqual(r.busy[1], [2]);
});

test('목록형(전체 교사, 요일 병합 + 교시 행)', () => {
  const rows = [
    ['번호', '교사', '월', '월', '월', '화', '화', '화'],
    ['', '', '1', '2', '3', '1', '2', '3'],
    ['1', '김선생', '국어', '', '', '', '국어', ''],
    ['2', '이선생', '', '수학', '수학', '', '', '수학']
  ];
  const r = T.parseRows(rows);
  assert.deepStrictEqual(r.map((x) => x.name), ['김선생', '이선생']);
  assert.deepStrictEqual(r[0].busy[1], [1]);
  assert.deepStrictEqual(r[0].busy[2], [2]);
  assert.deepStrictEqual(r[1].busy[1], [2, 3]);
});

test('목록형(월1, 월2 한 줄 머리행)', () => {
  const rows = [
    ['교사명', '월1', '월2', '화1', '화2', '수1', '수2'],
    ['박선생', 'x', '-', '', '2-1', '', '']
  ];
  const r = T.parseRows(rows);
  assert.strictEqual(r[0].name, '박선생');
  assert.deepStrictEqual(r[0].busy[2], [2]);
  assert.deepStrictEqual(r[0].busy[1], [1], "아무 글자나(x) 수업으로 취급");
});

test('형식이 아니면 빈 결과', () => {
  assert.deepStrictEqual(T.parseRows([['이름', '점수'], ['a', 1]]), []);
});
