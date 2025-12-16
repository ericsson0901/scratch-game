// app.js - 第一段
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// 模擬資料庫
let gameList = [
  { code: 'GAME001', locked: false, data: [] },
  { code: 'GAME002', locked: false, data: [] },
  { code: 'GAME003', locked: false, data: [] }
];

const passwords = {
  player: '1234',
  admin: 'admin123',
  manager: 'manager123'
};

// 簡單權限檢查
function checkRole(password) {
  if (password === passwords.admin) return 'admin';
  if (password === passwords.manager) return 'manager';
  if (password === passwords.player) return 'player';
  return null;
}

// 登入 API
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  const role = checkRole(password);
  if (!role) {
    return res.status(401).json({ error: '密碼錯誤' });
  }
  res.json({ role });
});

// 遊戲清單 API
app.get('/api/game-list', (req, res) => {
  const codes = gameList.map(g => g.code);
  res.json({ codes });
});

// 遊戲狀態 API
app.get('/api/game/state', (req, res) => {
  const { code, playerId } = req.query;
  const game = gameList.find(g => g.code === code);
  if (!game) return res.status(404).json({ error: '找不到遊戲代碼' });
  if (game.locked) return res.status(423).json({ error: 'locked' });

  // 鎖定遊戲
  game.locked = true;
  game.currentPlayer = playerId;

  res.json({
    code: game.code,
    data: game.data || [],
    locked: true
  });
});

// 釋放鎖定 API
app.post('/api/game/unlock', (req, res) => {
  const { code, playerId } = req.body;
  const game = gameList.find(g => g.code === code);
  if (!game) return res.status(404).json({ error: '找不到遊戲代碼' });

  if (game.currentPlayer === playerId) {
    game.locked = false;
    game.currentPlayer = null;
    return res.json({ success: true });
  }
  res.status(403).json({ error: '無權解除鎖定' });
});

// Google 雲端備份(舊版保留)
app.post('/api/backup', (req, res) => {
  // 模擬備份到雲端
  const backupData = JSON.stringify(gameList, null, 2);
  fs.writeFileSync(path.join(__dirname, 'backup.json'), backupData);
  res.json({ success: true, message: '已備份到本地 backup.json (模擬雲端)' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
// app.js - 第二段 (接續第一段)

// Admin / Manager 新增遊戲代碼
app.post('/api/game/add', (req, res) => {
  const { code, password } = req.body;
  const role = checkRole(password);
  if (role !== 'admin' && role !== 'manager') {
    return res.status(403).json({ error: '無權限' });
  }

  if (gameList.find(g => g.code === code)) {
    return res.status(400).json({ error: '遊戲代碼已存在' });
  }

  gameList.push({ code, locked: false, data: [] });
  res.json({ success: true, code });
});

// Admin / Manager 刪除遊戲代碼
app.post('/api/game/delete', (req, res) => {
  const { code, password } = req.body;
  const role = checkRole(password);
  if (role !== 'admin' && role !== 'manager') {
    return res.status(403).json({ error: '無權限' });
  }

  const index = gameList.findIndex(g => g.code === code);
  if (index === -1) return res.status(404).json({ error: '找不到遊戲代碼' });

  gameList.splice(index, 1);
  res.json({ success: true });
});

// 遊戲完成後更新資料並解鎖
app.post('/api/game/update', (req, res) => {
  const { code, playerId, data } = req.body;
  const game = gameList.find(g => g.code === code);
  if (!game) return res.status(404).json({ error: '找不到遊戲代碼' });

  if (game.currentPlayer !== playerId) {
    return res.status(403).json({ error: '無權限更新遊戲' });
  }

  game.data = data;
  game.locked = false;
  game.currentPlayer = null;
  res.json({ success: true });
});

// 真正 Google 雲端備份 & 刪除舊檔（需要 googleapis 套件 & OAuth 設定）
const { google } = require('googleapis');
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
const drive = google.drive({ version: 'v3', auth: oauth2Client });

// 上傳備份到 Google Drive
app.post('/api/backup/drive', async (req, res) => {
  try {
    const fileMetadata = {
      name: `backup_${Date.now()}.json`,
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID] // 可設定雲端資料夾
    };
    const media = {
      mimeType: 'application/json',
      body: JSON.stringify(gameList, null, 2)
    };
    const response = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: 'id, name'
    });
    res.json({ success: true, fileId: response.data.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '備份雲端失敗' });
  }
});

// 刪除 Google Drive 舊備份檔
app.post('/api/backup/drive/delete', async (req, res) => {
  const { fileId } = req.body;
  if (!fileId) return res.status(400).json({ error: '缺少 fileId' });

  try {
    await drive.files.delete({ fileId });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '刪除檔案失敗' });
  }
});
