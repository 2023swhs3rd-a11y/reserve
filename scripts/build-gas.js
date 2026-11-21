// docs/js/core.js 를 Apps Script용 gas/Core.gs 로 복사합니다.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'docs/js/core.js'), 'utf8');
const header = '// ⚠ 자동 생성 파일입니다. docs/js/core.js 를 고친 뒤 `npm run build:gas` 로 다시 만드세요.\n';
fs.writeFileSync(path.join(root, 'gas/Core.gs'), header + src);
console.log('gas/Core.gs 생성 완료');
