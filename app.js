// app.js - 完整整合版 (第一段)

// 基本套件
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

// ---- 使用者 / 管理員設定 ----
const USERS = {
  player: '1234',     // 玩家密碼
  admin: 'adminpass', // 管理員密碼
  manager: 'managerpass' // Manager 密碼
};

// ---- 遊戲資料存放 ----
const GAMES_FILE = path.join(__dirname, 'games.json');
let games = {};
if (fs.existsSync(GAMES_FILE)) {
  games = JSON.parse(fs.readFileSync(GAMES_FILE));
}

// ---- 遊戲鎖定管理 ----
let locks = {};

// ---- Google Drive 設定 ----
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const KEYFILE = 'service-account.json'; // 放你的 Google Service Account Key
const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILE,
  scopes: SCOPES
});
const drive = google.drive({ version: 'v3', auth });

// ---- API: 登入 ----
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === USERS.player || password === USERS.admin || password === USERS.manager) {
    return res.json({ ok: true, role: password === USERS.admin ? 'admin' : (password === USERS.manager ? 'manager' : 'player') });
  }
  return res.status(401).json({ error: '密碼錯誤' });
});

// ---- API: 遊戲代碼清單 ----
app.get('/api/game-list', (req, res) => {
  const codes = Object.keys(games);
  res.json({ codes });
});

// ---- API: 遊戲狀態 ----
app.get('/api/game/state', (req, res) => {
  const { code, playerId } = req.query;
  if (!code || !games[code]) return res.status(404).json({ error: '遊戲不存在' });

  // 檢查鎖定
  if (locks[code] && locks[code] !== playerId) {
    return res.status(403).json({ error: 'locked' });
  }

  // 設定鎖定
  locks[code] = playerId;
  res.json(games[code]);
});

// ---- API: 管理員建立或修改遊戲 ----
app.post('/api/admin/game', async (req, res) => {
  const { password, code, data } = req.body;
  if (password !== USERS.admin && password !== USERS.manager) {
    return res.status(401).json({ error: '密碼錯誤' });
  }

  games[code] = data;
  fs.writeFileSync(GAMES_FILE, JSON.stringify(games, null, 2));

  // 呼叫 Google Drive 備份
  await backupToDrive(code);

  res.json({ ok: true });
});

// ---- Google Drive 備份功能 ----
async function backupToDrive(code) {
  const filePath = path.join(__dirname, `${code}.json`);
  fs.writeFileSync(filePath, JSON.stringify(games[code], null, 2));

  try {
    // 上傳檔案
    const fileMetadata = { name: `${code}.json` };
    const media = { mimeType: 'application/json', body: fs.createReadStream(filePath) };
    await drive.files.create({ resource: fileMetadata, media, fields: 'id' });

    // 刪除本地舊檔
    fs.unlinkSync(filePath);
  } catch (err) {
    console.error('Google Drive 備份失敗:', err.message);
  }
}

// ---- 伺服器啟動 ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
// ---- API: 結束遊戲、解除鎖定 ----
app.post('/api/game/release', (req, res) => {
  const { code, playerId } = req.body;
  if (!code || !locks[code]) return res.status(400).json({ error: '遊戲未鎖定' });

  // 只有持有鎖定的玩家可以釋放
  if (locks[code] !== playerId) return res.status(403).json({ error: '無法釋放他人鎖定' });

  delete locks[code];
  res.json({ ok: true });
});

// ---- API: 刪除舊備份檔案 ----
app.post('/api/admin/cleanup-backups', async (req, res) => {
  const { password } = req.body;
  if (password !== USERS.admin && password !== USERS.manager) {
    return res.status(401).json({ error: '密碼錯誤' });
  }

  try {
    const driveRes = await drive.files.list({
      pageSize: 100,
      fields: 'files(id, name)',
    });

    const files = driveRes.data.files;
    if (!files || files.length === 0) return res.json({ ok: true, message: '無檔案可刪除' });

    for (let file of files) {
      // 只刪除 .json 備份檔
      if (file.name.endsWith('.json')) {
        await drive.files.delete({ fileId: file.id });
      }
    }

    res.json({ ok: true, message: '備份檔案已清理完成' });
  } catch (err) {
    console.error('清理 Google Drive 備份失敗:', err.message);
    res.status(500).json({ error: '清理失敗' });
  }
});

// ---- 其他工具 ----
// 可根據需求加入定時自動清理備份、鎖定逾時釋放等
function releaseExpiredLocks(timeoutMs = 600000) { // 預設 10 分鐘
  const now = Date.now();
  for (let code in locks) {
    if (locks[code] && now - locks[code].timestamp > timeoutMs) {
      delete locks[code];
      console.log(`已釋放過期鎖定: ${code}`);
    }
  }
}
setInterval(releaseExpiredLocks, 60000); // 每分鐘檢查一次

// ---- 完整日誌輸出 ----
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});
