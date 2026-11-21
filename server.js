/*
 * 상담예약 Node 서버 (외부 패키지 없이 실행)
 *   node server.js
 * 환경변수
 *   PORT            기본 3000
 *   ADMIN_PASSWORD  최초 관리자 비밀번호 (관리자 화면에서 바꾸면 그 뒤로는 무시됨)
 *   DATA_FILE       데이터 저장 파일, 기본 ./data/db.json
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Core = require('./docs/js/core.js');

const PORT = +process.env.PORT || 3000;
const ROOT = path.join(__dirname, 'docs');
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');

function readDb() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { return { state: null, reservations: [] }; }
}
function writeDb(db) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DATA_FILE);
}

// Node는 요청을 한 번에 하나씩 동기 처리하므로 별도 잠금이 필요 없음
const store = {
  loadState: () => readDb().state,
  saveState: (s) => { const db = readDb(); db.state = s; writeDb(db); },
  listReservations: () => readDb().reservations,
  addReservation: (r) => { const db = readDb(); db.reservations.push(r); writeDb(db); },
  updateReservation: (id, patch) => {
    const db = readDb();
    db.reservations = db.reservations.map((r) => (r.id === id ? Object.assign({}, r, patch) : r));
    writeDb(db);
  },
  deleteReservations: (ids) => {
    const db = readDb();
    db.reservations = db.reservations.filter((r) => ids.indexOf(r.id) < 0);
    writeDb(db);
  },
  withLock: (fn) => fn(),
  sha256: (t) => crypto.createHash('sha256').update(String(t), 'utf8').digest('hex'),
  randomId: () => crypto.randomUUID(),
  initialPassword: () => process.env.ADMIN_PASSWORD || '',
  // Node 서버는 메일 서버가 없어 알림을 콘솔에만 남김 (필요하면 여기에 SMTP 등을 연결)
  notify: (to, subject) => console.log('[알림] ' + to + ' ← ' + subject)
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json', '.csv': 'text/csv; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY'
};

function send(res, code, body, type) {
  res.writeHead(code, Object.assign({ 'Content-Type': type || 'application/json; charset=utf-8' }, SEC_HEADERS));
  res.end(body);
}

// 관리자 비밀번호 대입 공격을 늦추기 위한 간단한 제한
const failures = new Map();
function tooManyFailures(ip) {
  const f = failures.get(ip);
  return f && f.count >= 10 && Date.now() - f.since < 10 * 60 * 1000;
}
function recordFailure(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.since > 10 * 60 * 1000) failures.set(ip, { count: 1, since: Date.now() });
  else f.count++;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api') {
    if (req.method !== 'POST') return send(res, 405, JSON.stringify({ ok: false, error: 'POST only' }));
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 100000) req.destroy(); });
    req.on('end', () => {
      const ip = req.socket.remoteAddress;
      let out;
      try {
        const msg = JSON.parse(body || '{}');
        const isAdmin = String(msg.action || '').indexOf('admin.') === 0;
        if (isAdmin && tooManyFailures(ip)) throw new Core.UserError('비밀번호를 여러 번 틀렸어요. 10분 뒤 다시 시도해 주세요.');
        try {
          out = { ok: true, data: Core.handle(msg.action, msg.payload, store) };
        } catch (e) {
          if (isAdmin && /비밀번호/.test(e.message)) recordFailure(ip);
          throw e;
        }
      } catch (e) {
        if (!e.userFacing) console.error(e);
        out = { ok: false, error: e.userFacing ? e.message : '서버 오류가 발생했어요. 잠시 후 다시 시도해 주세요.' };
      }
      send(res, 200, JSON.stringify(out));
    });
    return;
  }

  // 정적 파일
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('상담예약 서버 실행 중: http://localhost:' + PORT);
    console.log('관리자 화면:        http://localhost:' + PORT + '/admin.html');
    if (!process.env.ADMIN_PASSWORD && !(readDb().state || {}).auth) {
      console.log('⚠ ADMIN_PASSWORD 환경변수가 없어 관리자 로그인이 불가능합니다. 예) ADMIN_PASSWORD=원하는비번 node server.js');
    }
  });
}

module.exports = { server, store };
