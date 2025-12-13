const express = require('express');
const path = require('path');
require('dotenv').config();
const { google } = require('googleapis');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// Google Drive 設定
const FILE_ID = process.env.DRIVE_FILE_ID; // 在環境變數設定檔案 ID
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS); // 從環境變數讀取 Service Account JSON
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/drive']
});
const drive = google.drive({ version: 'v3', auth });

// 預設設定
let defaultConfig = {
  gridSize: 9,
  winNumbers: [7],
  progressThreshold: 3
};

// 全域玩家密碼
let globalPlayerPassword = process.env.PLAYER_PASSWORD || 'player123';

// 管理員密碼
let adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

// 多場遊戲狀態
let games = {};
// 從 Google Drive 載入資料檔案
async function loadGames() {
  try {
    const res = await drive.files.get({
      fileId: FILE_ID,
      alt: 'media'
    });
    games = JSON.parse(res.data);

    // 相容舊格式
    for (const code in games) {
      const config = games[code].config;
      if (typeof config?.winNumber === 'number') {
        config.winNumbers = [config.winNumber];
        delete config.winNumber;
      }
    }

    if (games.__adminPassword) adminPassword = games.__adminPassword;
    if (games.__globalPlayerPassword) globalPlayerPassword = games.__globalPlayerPassword;

    console.log('遊戲資料已從 Google Drive 載入');
  } catch (err) {
    console.error('載入遊戲資料失敗:', err);
    games = {};
  }
}

// 儲存資料到 Google Drive
async function saveGames() {
  try {
    await drive.files.update({
      fileId: FILE_ID,
      media: {
        mimeType: 'application/json',
        body: JSON.stringify(games, null, 2)
      }
    });
    console.log('遊戲資料已更新到 Google Drive');
  } catch (err) {
    console.error('儲存遊戲資料失敗:', err);
  }
}

// 初始化遊戲
function initGame(code, config = defaultConfig) {
  let arr = Array.from({ length: config.gridSize }, (_, i) => i + 1);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  games[code] = {
    numbers: arr,
    scratched: Array(config.gridSize).fill(null),
    config: { ...config }
  };
  saveGames();
}

// 啟動時先載入遊戲資料
loadGames();
// === Manager 重製遊戲 ===
app.post('/api/manager/reset', (req, res) => {
  const authHeader = req.headers.authorization;
  const { code } = req.body;
  if (!authHeader || authHeader !== `Bearer manager-token-${code}`) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  initGame(code, games[code].config);
  res.json({ message: `遊戲 ${code} 已由場次管理員重製` });
});

// === Manager 修改格子數 ===
app.post('/api/manager/config/grid', (req, res) => {
  const authHeader = req.headers.authorization;
  const { code, gridSize } = req.body;
  if (!authHeader || authHeader !== `Bearer manager-token-${code}`) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  games[code].config.gridSize = gridSize;
  saveGames();
  res.json({ message: `遊戲 ${code} 格子數已更新為 ${gridSize}` });
});

// === Manager 修改中獎號碼 ===
app.post('/api/manager/config/win', (req, res) => {
  const authHeader = req.headers.authorization;
  const { code, winNumbers } = req.body;
  if (!authHeader || authHeader !== `Bearer manager-token-${code}`) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  games[code].config.winNumbers = Array.isArray(winNumbers) ? winNumbers : games[code].config.winNumbers;
  saveGames();
  res.json({ message: `遊戲 ${code} 中獎號碼已更新為 ${games[code].config.winNumbers.join(', ')}` });
});

// === Admin 建立遊戲 ===
app.post('/api/admin/create-game', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { code, managerPassword } = req.body;
  if (!code) return res.status(400).json({ error: 'Game code required' });
  if (games[code]) return res.status(400).json({ error: 'Game already exists' });

  initGame(code, { ...defaultConfig, managerPassword });
  res.json({ message: `遊戲 ${code} 已建立` });
});

// === Admin 重設遊戲 ===
app.post('/api/admin/reset', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { code } = req.body;
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  initGame(code, games[code].config);
  res.json({ message: `遊戲 ${code} 已重設` });
});

// === Admin 刪除遊戲 ===
app.post('/api/admin/delete-game', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { code } = req.body;
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  delete games[code];
  saveGames();
  res.json({ message: `遊戲 ${code} 已刪除` });
});

// === Admin 修改遊戲設定 ===
app.post('/api/admin/config', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { code, gridSize, winNumbers, progressThreshold, managerPassword } = req.body;
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  games[code].config.gridSize = gridSize || games[code].config.gridSize;
  games[code].config.winNumbers = Array.isArray(winNumbers) ? winNumbers : games[code].config.winNumbers;
  games[code].config.progressThreshold = progressThreshold || games[code].config.progressThreshold;
  if (managerPassword) games[code].config.managerPassword = managerPassword;

  saveGames();
  res.json({ success: true, config: games[code].config });
});

// Admin 查詢所有遊戲代碼清單
app.get('/api/admin/game-list', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const codes = Object.keys(games).filter(code => !code.startsWith('__'));
  res.json({ codes });
});

// 修改管理員密碼（持久化）
app.post('/api/admin/change-password', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== 'Bearer admin-token') return res.status(403).json({ error: 'Unauthorized' });

  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: 'New password required' });

  adminPassword = newPassword;
  games.__adminPassword = adminPassword;
  saveGames();

  res.json({ message: '管理員密碼已更新' });
});

// 修改全域玩家密碼（持久化）
app.post('/api/admin/change-global-password', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== 'Bearer admin-token') return res.status(403).json({ error: 'Unauthorized' });

  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: 'New player password required' });

  globalPlayerPassword = newPassword;
  games.__globalPlayerPassword = globalPlayerPassword;
  saveGames();

  res.json({ message: '全域玩家密碼已更新' });
});

// 啟動伺服器
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});