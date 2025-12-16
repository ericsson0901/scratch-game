// app.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // 前端檔案放在 public 資料夾

// ======================
// 資料存放 (記憶體)
// ======================
const games = {}; // key: gameCode -> {gridSize, scratched:[], winningNumbers:[], progressThreshold, managerPassword}
let adminPassword = 'admin123'; // 初始 admin 密碼
let globalPlayerPassword = 'player123'; // 全域玩家密碼

// ======================
// 工具函式
// ======================
function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

function authAdmin(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth) return res.status(401).json({ error: '未授權' });
  const token = auth.split(' ')[1];
  if (token !== adminToken) return res.status(403).json({ error: '無效 Token' });
  next();
}

function authManager(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth) return res.status(401).json({ error: '未授權' });
  const token = auth.split(' ')[1];
  if (!managerTokens[req.body.code] || managerTokens[req.body.code] !== token) {
    return res.status(403).json({ error: '無效 Token' });
  }
  next();
}

// ======================
// Token 管理
// ======================
let adminToken = null;
const managerTokens = {}; // code -> token

// ======================
// 玩家端 API
// ======================

// 玩家登入 (如果有密碼)
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === globalPlayerPassword) {
    return res.json({ success: true });
  } else {
    return res.status(403).json({ error: '密碼錯誤' });
  }
});

// 取得遊戲狀態
app.get('/api/game/state', (req, res) => {
  const code = req.query.code;
  if (!games[code]) return res.status(404).json({ error: '找不到遊戲' });

  const game = games[code];
  res.json({
    gridSize: game.gridSize,
    scratched: game.scratched,
    winningNumbers: game.winningNumbers
  });
});

// 刮格子
app.post('/api/game/scratch', (req, res) => {
  const { code, index } = req.body;
  if (!games[code]) return res.status(404).json({ error: '找不到遊戲' });

  const game = games[code];
  if (!game.scratched[index]) {
    // 隨機生成一個數字
    const number = Math.floor(Math.random() * game.gridSize) + 1;
    game.scratched[index] = number;
    return res.json({ number });
  } else {
    return res.json({ number: game.scratched[index] });
  }
});

// ======================
// Admin 端 API
// ======================

// 管理員登入
app.post('/api/admin', (req, res) => {
  const { password } = req.body;
  if (password === adminPassword) {
    adminToken = generateToken();
    res.json({ token: adminToken });
  } else {
    res.status(403).json({ error: '密碼錯誤' });
  }
});

// 建立遊戲
app.post('/api/admin/create-game', authAdmin, (req, res) => {
  const { code, managerPassword } = req.body;
  if (games[code]) return res.status(400).json({ error: '遊戲代碼已存在' });

  games[code] = {
    gridSize: 9,
    scratched: Array(9).fill(null),
    winningNumbers: [],
    progressThreshold: 3,
    managerPassword: managerPassword
  };
  res.json({ message: '遊戲建立成功' });
});

// 修改設定
app.post('/api/admin/config', authAdmin, (req, res) => {
  const { code, gridSize, winNumbers, progressThreshold, managerPassword } = req.body;
  if (!games[code]) return res.status(404).json({ error: '找不到遊戲' });

  const game = games[code];
  game.gridSize = gridSize ?? game.gridSize;
  game.winningNumbers = winNumbers ?? game.winningNumbers;
  game.progressThreshold = progressThreshold ?? game.progressThreshold;
  if (managerPassword) game.managerPassword = managerPassword;

  res.json({ success: true, config: game });
});

// 重設遊戲
app.post('/api/admin/reset', authAdmin, (req, res) => {
  const { code } = req.body;
  if (!games[code]) return res.status(404).json({ error: '找不到遊戲' });
  games[code].scratched = Array(games[code].gridSize).fill(null);
  res.json({ message: '遊戲已重設' });
});

// 刪除遊戲
app.post('/api/admin/delete-game', authAdmin, (req, res) => {
  const { code } = req.body;
  if (!games[code]) return res.status(404).json({ error: '找不到遊戲' });
  delete games[code];
  res.json({ message: '遊戲已刪除' });
});

// 查看進度
app.get('/api/admin/progress', authAdmin, (req, res) => {
  const code = req.query.code;
  if (!games[code]) return res.status(404).json({ error: '找不到遊戲' });

  const game = games[code];
  const scratchedCount = game.scratched.filter(n => n !== null).length;
  const remainingCount = game.gridSize - scratchedCount;
  const thresholdReached = scratchedCount >= game.progressThreshold;

  res.json({
    scratchedCount,
    remainingCount,
    progressThreshold: game.progressThreshold,
    thresholdReached
  });
});

// 遊戲代碼清單
app.get('/api/admin/game-list', authAdmin, (req, res) => {
  res.json({ codes: Object.keys(games) });
});

// 修改管理員密碼
app.post('/api/admin/change-password', authAdmin, (req, res) => {
  const { newPassword } = req.body;
  adminPassword = newPassword;
  res.json({ message: '管理員密碼已更新' });
});

// 修改全域玩家密碼
app.post('/api/admin/change-global-password', authAdmin, (req, res) => {
  const { newPassword } = req.body;
  globalPlayerPassword = newPassword;
  res.json({ message: '玩家密碼已更新' });
});

// ======================
// Manager 端 API
// ======================

// 登入 manager
app.post('/api/manager/login', (req, res) => {
  const { code, password } = req.body;
  if (!games[code]) return res.status(404).json({ error: '找不到遊戲' });
  const game = games[code];
  if (password !== game.managerPassword) return res.status(403).json({ error: '密碼錯誤' });

  const token = generateToken();
  managerTokens[code] = token;
  res.json({ token, code });
});

// 修改格子數
app.post('/api/manager/config/grid', authManager, (req, res) => {
  const { code, gridSize } = req.body;
  if (!games[code]) return res.status(404).json({ error: '找不到遊戲' });
  const game = games[code];
  game.gridSize = gridSize;
  game.scratched = Array(gridSize).fill(null);
  res.json({ message: '格子數已更新' });
});

// 修改中獎號碼
app.post('/api/manager/config/win', authManager, (req, res) => {
  const { code, winNumbers } = req.body;
  if (!games[code]) return res.status(404).json({ error: '找不到遊戲' });
  const game = games[code];
  game.winningNumbers = winNumbers;
  res.json({ message: '中獎號碼已更新' });
});

// 重製遊戲
app.post('/api/manager/reset', authManager, (req, res) => {
  const { code } = req.body;
  if (!games[code]) return res.status(404).json({ error: '找不到遊戲' });
  const game = games[code];
  game.scratched = Array(game.gridSize).fill(null);
  res.json({ message: '遊戲已重製' });
});

// ======================
// 啟動伺服器
// ======================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Available at http://localhost:${PORT}`);
});
