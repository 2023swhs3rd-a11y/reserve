/*
 * 상담예약 - Google Apps Script 백엔드
 *
 * 구글 스프레드시트 > 확장 프로그램 > Apps Script 에 이 파일(Code.gs)과
 * Core.gs 를 붙여 넣고 "웹 앱"으로 배포하세요. 자세한 방법은 README 참고.
 *
 * 데이터 위치
 *   - '예약' 시트: 예약 1건당 1행 (선생님이 바로 보고 정렬/필터 가능)
 *   - '_설정' 시트: 설정 JSON (직접 수정하지 마세요)
 */

var RES_SHEET = '예약';
var CFG_SHEET = '_설정';
var HEADERS = ['예약코드', '상태', '날짜', '시작', '종료', '학번', '성명', '연락처', '학부모참여',
  '문의내용', '직접입력', '교과성적', '모의고사성적', '동의일시', '신청일시', '메모', 'id'];
var STATUS_KO = { booked: '예약', done: '완료', cancelled: '취소' };
var STATUS_EN = { '예약': 'booked', '완료': 'done', '취소': 'cancelled' };

// 최초 1회(그리고 코드 업데이트 후 1회): 편집기에서 이 함수를 선택해 ▶실행 하세요.
// 시트를 만들고, 메일 발송 권한을 승인받습니다.
// 관리자 비밀번호는 [프로젝트 설정 > 스크립트 속성]에 ADMIN_PASSWORD 로 넣어 주세요.
function setup() {
  resSheet_();
  cfgSheet_();
  Core.handle('public.config', {}, makeStore_());
  MailApp.getRemainingDailyQuota(); // 메일 발송 권한 승인용
  Logger.log('준비 완료! 이제 [배포 > 새 배포 > 웹 앱]으로 배포하세요.');
}

function doGet(e) {
  // 캘린더 추가(iPhone·iPad): ?ics=1&date=YYYY-MM-DD&start=HH:MM&end=HH:MM
  if (e && e.parameter && e.parameter.ics) {
    var ics = Core.calendarIcs(e.parameter, makeStore_());
    if (ics) return ContentService.createTextOutput(ics).setMimeType(ContentService.MimeType.ICAL);
  }
  return ContentService.createTextOutput('상담예약 API가 동작 중입니다. (서버 코드 버전 ' + Core.VERSION + ')');
}

function doPost(e) {
  var out;
  try {
    var msg = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = { ok: true, data: Core.handle(msg.action, msg.payload, makeStore_()) };
  } catch (err) {
    if (!err.userFacing) console.error(err && err.stack || err);
    out = { ok: false, error: err.userFacing ? err.message : '서버 오류가 발생했어요. 잠시 후 다시 시도해 주세요.' };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- 시트 ----------
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function resSheet_() {
  var sh = ss_().getSheetByName(RES_SHEET);
  if (!sh) {
    sh = ss_().insertSheet(RES_SHEET);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#FDEBD3');
    sh.setFrozenRows(1);
    // 연락처 앞자리 0, 날짜가 자동 변환되지 않도록 모든 칸을 '일반 텍스트'로
    sh.getRange(1, 1, sh.getMaxRows(), HEADERS.length).setNumberFormat('@');
    sh.hideColumns(HEADERS.length);
  }
  return sh;
}

function cfgSheet_() {
  var sh = ss_().getSheetByName(CFG_SHEET);
  if (!sh) {
    sh = ss_().insertSheet(CFG_SHEET);
    sh.getRange('A1').setNumberFormat('@');
    sh.getRange('B1').setValue('← 앱 설정 저장 공간입니다. 직접 수정하지 마세요.');
    sh.hideSheet();
  }
  return sh;
}

// 시트에 쓸 때 =·+·-·@·탭·줄바꿈으로 시작하는 글은 수식으로 읽히지 않게 앞에 ' 를 붙인다(수식 인젝션 방지).
// 읽을 때는 그 ' 를 떼어 원래 글로 돌린다.
function safeCell_(v) {
  var s = String(v === undefined || v === null ? '' : v);
  return /^[=+\-@\t\r\n]/.test(s) ? "'" + s : s;
}
function unsafeCell_(v) {
  var s = String(v === undefined || v === null ? '' : v);
  return /^'[=+\-@\t\r\n]/.test(s) ? s.slice(1) : s;
}

function rowToRes_(row) {
  row = row.map(unsafeCell_);
  return {
    code: row[0], status: STATUS_EN[row[1]] || row[1], date: row[2], start: row[3], end: row[4],
    studentId: row[5], name: row[6], phone: row[7], parent: row[8] === '참여',
    topics: row[9] ? String(row[9]).split(', ').filter(String) : [], topicEtc: row[10],
    gradeSchool: row[11], gradeMock: row[12], consent: true, consentAt: row[13],
    createdAt: row[14], memo: row[15], id: row[16]
  };
}

function resToRow_(r) {
  return resToRowRaw_(r).map(safeCell_);
}
function resToRowRaw_(r) {
  return [r.code, STATUS_KO[r.status] || r.status, r.date, r.start, r.end, r.studentId, r.name, r.phone,
    r.parent ? '참여' : '불참', (r.topics || []).join(', '), r.topicEtc || '', r.gradeSchool || '',
    r.gradeMock || '', r.consentAt || '', r.createdAt || '', r.memo || '', r.id];
}

function allRows_() {
  var sh = resSheet_();
  var n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  return sh.getRange(2, 1, n, HEADERS.length).getDisplayValues();
}

function makeStore_() {
  return {
    loadState: function () {
      var v = cfgSheet_().getRange('A1').getValue();
      return v ? JSON.parse(v) : null;
    },
    saveState: function (s) {
      cfgSheet_().getRange('A1').setValue(JSON.stringify(s));
    },
    listReservations: function () {
      return allRows_().filter(function (r) { return r[16]; }).map(rowToRes_);
    },
    addReservation: function (r) {
      var sh = resSheet_();
      var row = sh.getLastRow() + 1;
      var range = sh.getRange(row, 1, 1, HEADERS.length);
      range.setNumberFormat('@');
      range.setValues([resToRow_(r)]);
    },
    updateReservation: function (id, patch) {
      var rows = allRows_();
      for (var i = 0; i < rows.length; i++) {
        if (rows[i][16] === id) {
          var r = rowToRes_(rows[i]);
          Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
          resSheet_().getRange(i + 2, 1, 1, HEADERS.length).setValues([resToRow_(r)]);
          return;
        }
      }
    },
    deleteReservations: function (ids) {
      var rows = allRows_();
      var sh = resSheet_();
      for (var i = rows.length - 1; i >= 0; i--) {
        if (ids.indexOf(rows[i][16]) >= 0) sh.deleteRow(i + 2);
      }
    },
    withLock: function (fn) {
      var lock = LockService.getScriptLock();
      lock.waitLock(15000);
      try { return fn(); } finally { SpreadsheetApp.flush(); lock.releaseLock(); }
    },
    sha256: function (text) {
      var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
      return bytes.map(function (b) { return ((b + 256) % 256).toString(16).replace(/^(.)$/, '0$1'); }).join('');
    },
    randomId: function () { return Utilities.getUuid(); },
    // 조회·취소 실패 횟수(15분 동안 기억). Core가 학번당 5번, 전체 60번을 넘으면 잠시 막는다.
    getFails: function (key) {
      return Number(CacheService.getScriptCache().get('fail:' + key) || 0);
    },
    addFail: function (key, seconds) {
      var cache = CacheService.getScriptCache();
      cache.put('fail:' + key, String(Number(cache.get('fail:' + key) || 0) + 1), seconds);
    },
    notify: function (to, subject, body) {
      // 하루 발송 한도(일반 계정 약 100통)를 넘으면 조용히 건너뜀
      if (MailApp.getRemainingDailyQuota() < 1) return;
      MailApp.sendEmail({ to: to, subject: subject, body: body, name: '봉일천고 진로진학상담 예약' });
    },
    initialPassword: function () {
      return PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD') || '';
    }
  };
}
