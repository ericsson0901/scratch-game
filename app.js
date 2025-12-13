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
const auth = new google.auth.GoogleAuth({
  keyFile: 'service-account.json', // 你的金鑰檔路徑
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
// 玩家登入
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === globalPlayerPassword) return res.json({ success: true });
  res.status(401).json({ error: 'Invalid player password' });
});

// 管理員登入
app.post('/api/admin', (req, res) => {
  const { password } = req.body;
  if (password === adminPassword) return res.json({ token: 'admin-token' });
  res.status(401).json({ error: 'Invalid admin password' });
});

// 場次管理員登入
app.post('/api/manager/login', (req, res) => {
  const { code, password } = req.body;
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });
  if (password !== games[code].config.managerPassword) return res.status(401).json({ error: 'Invalid manager password' });
  res.json({ token: `manager-token-${code}`, code });
});

// 玩家查詢遊戲代碼清單
app.get('/api/game-list', (req, res) => {
  const codes = Object.keys(games).filter(code => !code.startsWith('__'));
  res.json({ codes });
});

// 玩家查詢遊戲狀態
app.get('/api/game/state', (req, res) => {
  const { code } = req.query;
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });
  const game = games[code];
  res.json({
    gridSize: game.config.gridSize,
    winningNumbers: game.config.winNumbers,
    progressThreshold: game.config.progressThreshold,
    scratched: game.scratched,
    revealed: game.scratched.map(n => n !== null)
  });
});

// 玩家刮格子
app.post('/api/game/scratch', (req, res) => {
  const { index, code } = req.body;
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });
  const game = games[code];
  const { winNumbers, progressThreshold, gridSize } = game.config;
  if (index < 0 || index >= gridSize) return res.status(400).json({ error: 'Invalid index' });

  if (game.scratched[index] === null) {
    let chosen = game.numbers[index];
    const scratchedCount = game.scratched.filter(n => n !== null).length;
    if (winNumbers.includes(chosen) && scratchedCount < progressThreshold) {
      const availableIndexes = game.scratched
        .map((val, idx) => (val === null && !winNumbers.includes(game.numbers[idx]) ? idx : null))
        .filter(idx => idx !== null);
      if (availableIndexes.length > 0) {
        const swapIndex = availableIndexes[Math.floor(Math.random() * availableIndexes.length)];
        const temp = game.numbers[swapIndex];
        game.numbers[swapIndex] = chosen;
        game.numbers[index] = temp;
        chosen = temp;
      }
    }
    game.scratched[index] = chosen;
    saveGames();
  }
  res.json({ number: game.scratched[index], revealed: true });
});

// === 其他 Manager / Admin 路由 ===
// （重製遊戲、修改格子數、中獎號碼、建立/刪除/重設遊戲、修改密碼等）
// 保持原本邏輯，只是呼叫 saveGames() 來持久化

// 啟動伺服器
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});