const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'games.json');

// 預設設定
let defaultConfig = {
  gridSize: 9,
  winNumber: 7,
  playerPassword: 'player123'
};

// 多場遊戲狀態
let games = {};

// 載入資料檔案
if (fs.existsSync(DATA_FILE)) {
  try {
    games = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    console.log('遊戲資料已載入');
  } catch (err) {
    console.error('載入遊戲資料失敗:', err);
  }
}

// 儲存資料
function saveGames() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(games, null, 2));
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

// 玩家登入
app.post('/api/login', (req, res) => {
  const { password, code } = req.body;
  if (!games[code]) return res.status(404).json({ error: 'Game code not found' });
  if (password === games[code].config.playerPassword) {
    return res.json({ token: 'player-token', code });
  }
  res.status(401).json({ error: 'Invalid player password' });
});

// 管理員登入
let adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
app.post('/api/admin', (req, res) => {
  const { password } = req.body;
  if (password === adminPassword) {
    return res.json({ token: 'admin-token' });
  }
  res.status(401).json({ error: 'Invalid admin password' });
});

// 建立遊戲
app.post('/api/admin/create-game', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') return res.status(403).json({ error: 'Unauthorized' });

  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Game code required' });
  if (games[code]) return res.status(400).json({ error: 'Game already exists' });

  initGame(code);
  res.json({ success: true, message: `遊戲 ${code} 已建立` });
});

// 重設遊戲
app.post('/api/admin/reset', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') return res.status(403).json({ error: 'Unauthorized' });

  const { code } = req.body;
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  initGame(code, games[code].config);
  res.json({ success: true, message: `遊戲 ${code} 已重設` });
});

// 刪除遊戲
app.post('/api/admin/delete-game', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') return res.status(403).json({ error: 'Unauthorized' });

  const { code } = req.body;
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  delete games[code];
  saveGames();
  res.json({ success: true, message: `遊戲 ${code} 已刪除` });
});

// 修改遊戲設定
app.post('/api/admin/config', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') return res.status(403).json({ error: 'Unauthorized' });

  const { code, gridSize, winNumber, playerPassword } = req.body;
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  if (gridSize) games[code].config.gridSize = gridSize;
  if (winNumber) games[code].config.winNumber = winNumber;
  if (playerPassword) games[code].config.playerPassword = playerPassword;

  saveGames();
  res.json({ success: true, config: games[code].config });
});

// 查看遊戲代碼清單
app.get('/api/admin/game-list', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') return res.status(403).json({ error: 'Unauthorized' });
  res.json({ codes: Object.keys(games) });
});

// 遊戲狀態
app.get('/api/game/state', (req, res) => {
  const { code } = req.query;
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });
  res.json({
    gridSize: games[code].config.gridSize,
    winningNumber: games[code].config.winNumber,
    scratched: games[code].scratched
  });
});

// 刮格子
app.post('/api/game/scratch', (req, res) => {
  const { index, code } = req.body;
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });
  if (games[code].scratched[index] === null) {
    games[code].scratched[index] = games[code].numbers[index];
    saveGames();
  }
  res.json({ number: games[code].scratched[index] });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});