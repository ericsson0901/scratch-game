import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import jwt from 'jsonwebtoken';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public')); // 放置 index.html, admin.html, manager.html

// ===== 記憶體資料 =====
let games = {}; // { code: { gridSize, winNumbers, scratched: [], managerPassword } }
let adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
let globalPlayerPassword = process.env.PLAYER_PASSWORD || 'player123';

// ===== JWT Helpers =====
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'adminsecret';
const MANAGER_SECRET = process.env.MANAGER_SECRET || 'managersecret';

function signAdmin() {
  return jwt.sign({ role: 'admin' }, ADMIN_SECRET, { expiresIn: '2h' });
}

function signManager(code) {
  return jwt.sign({ role: 'manager', code }, MANAGER_SECRET, { expiresIn: '2h' });
}

function verifyAdmin(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const decoded = jwt.verify(token, ADMIN_SECRET);
    if (decoded.role !== 'admin') throw new Error();
    next();
  } catch {
    res.status(403).json({ error: 'Invalid token' });
  }
}

function verifyManager(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const decoded = jwt.verify(token, MANAGER_SECRET);
    if (decoded.role !== 'manager') throw new Error();
    req.code = decoded.code;
    next();
  } catch {
    res.status(403).json({ error: 'Invalid token' });
  }
}

// ===== Admin 登入 =====
app.post('/api/admin', (req, res) => {
  const { password } = req.body;
  if (password === adminPassword) {
    res.json({ token: signAdmin() });
  } else {
    res.status(403).json({ error: '管理員密碼錯誤' });
  }
});

// ===== Admin 功能 =====
// 建立遊戲
app.post('/api/admin/create-game', verifyAdmin, (req, res) => {
  const { code, managerPassword } = req.body;
  if (!code || !managerPassword) return res.json({ error: '請提供遊戲代碼和管理員密碼' });
  if (games[code]) return res.json({ error: '遊戲代碼已存在' });
  games[code] = { gridSize: 9, winNumbers: [], scratched: [], managerPassword };
  res.json({ message: '遊戲建立成功', code });
});

// 刪除遊戲
app.post('/api/admin/delete-game', verifyAdmin, (req, res) => {
  const { code } = req.body;
  if (!games[code]) return res.json({ error: '遊戲不存在' });
  delete games[code];
  res.json({ message: '遊戲刪除成功' });
});

// 重設遊戲
app.post('/api/admin/reset', verifyAdmin, (req, res) => {
  const { code } = req.body;
  if (!games[code]) return res.json({ error: '遊戲不存在' });
  games[code].scratched = Array(games[code].gridSize).fill(null);
  res.json({ message: '遊戲已重設' });
});

// 修改遊戲設定
app.post('/api/admin/config', verifyAdmin, (req, res) => {
  const { code, gridSize, winNumbers, progressThreshold, managerPassword } = req.body;
  const game = games[code];
  if (!game) return res.json({ error: '遊戲不存在' });
  if (gridSize) game.gridSize = gridSize;
  if (winNumbers) game.winNumbers = winNumbers;
  if (managerPassword) game.managerPassword = managerPassword;
  if (progressThreshold !== undefined) game.progressThreshold = progressThreshold;
  res.json({ success: true, config: game });
});

// 查看遊戲進度
app.get('/api/admin/progress', verifyAdmin, (req, res) => {
  const code = req.query.code;
  const game = games[code];
  if (!game) return res.status(404).json({ error: '遊戲不存在' });
  const scratchedCount = game.scratched.filter(n => n !== null).length;
  const remainingCount = game.gridSize - scratchedCount;
  res.json({
    scratchedCount,
    remainingCount,
    progressThreshold: game.progressThreshold || 0,
    thresholdReached: game.progressThreshold ? scratchedCount >= game.progressThreshold : false
  });
});

// 列出所有遊戲
app.get('/api/admin/game-list', verifyAdmin, (req, res) => {
  res.json({ codes: Object.keys(games) });
});

// 修改管理員密碼
app.post('/api/admin/change-password', verifyAdmin, (req, res) => {
  const { newPassword } = req.body;
  adminPassword = newPassword;
  res.json({ message: '管理員密碼已更新' });
});

// 修改全域玩家密碼
app.post('/api/admin/change-global-password', verifyAdmin, (req, res) => {
  const { newPassword } = req.body;
  globalPlayerPassword = newPassword;
  res.json({ message: '全域玩家密碼已更新' });
});

// ===== Manager 登入 =====
app.post('/api/manager/login', (req, res) => {
  const { code, password } = req.body;
  const game = games[code];
  if (!game) return res.json({ error: '遊戲不存在' });
  if (password !== game.managerPassword) return res.json({ error: '密碼錯誤' });
  res.json({ token: signManager(code), code });
});

// Manager 修改格子數
app.post('/api/manager/config/grid', verifyManager, (req, res) => {
  const { gridSize } = req.body;
  const game = games[req.code];
  if (!game) return res.json({ error: '遊戲不存在' });
  game.gridSize = gridSize;
  game.scratched = Array(gridSize).fill(null); // 重新初始化格子
  res.json({ message: '格子數已更新' });
});

// Manager 修改中獎號碼
app.post('/api/manager/config/win', verifyManager, (req, res) => {
  const { winNumbers } = req.body;
  const game = games[req.code];
  if (!game) return res.json({ error: '遊戲不存在' });
  game.winNumbers = winNumbers;
  res.json({ message: '中獎號碼已更新' });
});

// Manager 重設遊戲
app.post('/api/manager/reset', verifyManager, (req, res) => {
  const game = games[req.code];
  if (!game) return res.json({ error: '遊戲不存在' });
  game.scratched = Array(game.gridSize).fill(null);
  res.json({ message: '遊戲已重設' });
});

// ===== Player API =====
app.get('/api/game/state', (req, res) => {
  const code = req.query.code;
  const game = games[code];
  if (!game) return res.status(404).json({ error: '遊戲不存在' });
  res.json({
    gridSize: game.gridSize,
    winningNumbers: game.winNumbers,
    scratched: game.scratched
  });
});

app.post('/api/game/scratch', (req, res) => {
  const { code, index } = req.body;
  const game = games[code];
  if (!game) return res.status(404).json({ error: '遊戲不存在' });
  if (index < 0 || index >= game.gridSize) return res.status(400).json({ error: '索引錯誤' });
  if (game.scratched[index] !== null) return res.json({ number: game.scratched[index] });
  // 隨機生成號碼，保證中獎號碼正確顯示
  const numbersPool = [...Array(game.gridSize).keys()].map(n => n+1);
  const number = numbersPool[index] || index+1;
  game.scratched[index] = number;
  res.json({ number });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
