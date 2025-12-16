// app.js
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import crypto from 'crypto';

const app = express();
app.use(bodyParser.json());
app.use(cors());

// ===================
// 模擬資料庫（暫存）
// ===================
let games = {}; // { code: { gridSize, winningNumbers, scratched: [], progressThreshold, managerPassword } }
let adminPassword = 'admin123'; // 初始管理員密碼
let globalPlayerPassword = 'player123'; // 全域玩家密碼

let adminTokens = new Set();
let managerTokens = {}; // { token: code }

// ===================
// Helper
// ===================
function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

// ===================
// 管理員 API
// ===================

// 登入管理員
app.post('/api/admin', (req, res) => {
  const { password } = req.body;
  if (password === adminPassword) {
    const token = generateToken();
    adminTokens.add(token);
    return res.json({ token });
  }
  res.status(401).json({ error: '密碼錯誤' });
});

// 建立遊戲
app.post('/api/admin/create-game', (req, res) => {
  const auth = req.headers.authorization?.split(' ')[1];
  if (!adminTokens.has(auth)) return res.status(403).json({ error: '未授權' });

  const { code, managerPassword } = req.body;
  if (!code || !managerPassword) return res.status(400).json({ error: '請提供遊戲代碼與管理員密碼' });
  if (games[code]) return res.status(400).json({ error: '遊戲代碼已存在' });

  games[code] = {
    gridSize: 36,
    winningNumbers: [],
    scratched: Array(36).fill(null),
    progressThreshold: 3,
    managerPassword
  };
  res.json({ message: '遊戲建立成功', code });
});

// 重設遊戲
app.post('/api/admin/reset', (req, res) => {
  const auth = req.headers.authorization?.split(' ')[1];
  if (!adminTokens.has(auth)) return res.status(403).json({ error: '未授權' });

  const { code } = req.body;
  const game = games[code];
  if (!game) return res.status(404).json({ error: '找不到遊戲' });

  game.scratched = Array(game.gridSize).fill(null);
  res.json({ message: '遊戲已重製' });
});

// 刪除遊戲
app.post('/api/admin/delete-game', (req, res) => {
  const auth = req.headers.authorization?.split(' ')[1];
  if (!adminTokens.has(auth)) return res.status(403).json({ error: '未授權' });

  const { code } = req.body;
  if (!games[code]) return res.status(404).json({ error: '找不到遊戲' });
  delete games[code];
  res.json({ message: '遊戲已刪除' });
});

// 修改遊戲設定
app.post('/api/admin/config', (req, res) => {
  const auth = req.headers.authorization?.split(' ')[1];
  if (!adminTokens.has(auth)) return res.status(403).json({ error: '未授權' });

  const { code, gridSize, winNumbers, progressThreshold, managerPassword } = req.body;
  const game = games[code];
  if (!game) return res.status(404).json({ error: '找不到遊戲' });

  if (gridSize) {
    game.gridSize = gridSize;
    game.scratched = Array(gridSize).fill(null);
  }
  if (winNumbers) game.winningNumbers = winNumbers;
  if (progressThreshold) game.progressThreshold = progressThreshold;
  if (managerPassword) game.managerPassword = managerPassword;

  res.json({ success: true, config: game });
});

// 查看遊戲進度
app.get('/api/admin/progress', (req, res) => {
  const auth = req.headers.authorization?.split(' ')[1];
  if (!adminTokens.has(auth)) return res.status(403).json({ error: '未授權' });

  const code = req.query.code;
  const game = games[code];
  if (!game) return res.status(404).json({ error: '找不到遊戲' });

  const scratchedCount = game.scratched.filter(n => n !== null).length;
  const remainingCount = game.gridSize - scratchedCount;
  const thresholdReached = scratchedCount >= game.progressThreshold;

  res.json({ scratchedCount, remainingCount, progressThreshold: game.progressThreshold, thresholdReached });
});

// 遊戲清單
app.get('/api/admin/game-list', (req, res) => {
  const auth = req.headers.authorization?.split(' ')[1];
  if (!adminTokens.has(auth)) return res.status(403).json({ error: '未授權' });

  res.json({ codes: Object.keys(games) });
});

// 修改管理員密碼
app.post('/api/admin/change-password', (req, res) => {
  const auth = req.headers.authorization?.split(' ')[1];
  if (!adminTokens.has(auth)) return res.status(403).json({ error: '未授權' });

  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: '請輸入新密碼' });
  adminPassword = newPassword;
  res.json({ message: '管理員密碼已更新' });
});

// 修改全域玩家密碼
app.post('/api/admin/change-global-password', (req, res) => {
  const auth = req.headers.authorization?.split(' ')[1];
  if (!adminTokens.has(auth)) return res.status(403).json({ error: '未授權' });

  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: '請輸入新密碼' });
  globalPlayerPassword = newPassword;
  res.json({ message: '全域玩家密碼已更新' });
});

// ===================
// 場次管理員 API
// ===================

// 登入場次管理員
app.post('/api/manager/login', (req, res) => {
  const { code, password } = req.body;
  const game = games[code];
  if (!game) return res.status(404).json({ error: '找不到遊戲' });
  if (password !== game.managerPassword) return res.status(401).json({ error: '密碼錯誤' });

  const token = generateToken();
  managerTokens[token] = code;
  res.json({ token, code });
});

// 修改格子數
app.post('/api/manager/config/grid', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const code = managerTokens[token];
  if (!code) return res.status(403).json({ error: '未授權' });

  const game = games[code];
  if (!game) return res.status(404).json({ error: '找不到遊戲' });

  const { gridSize } = req.body;
  if (!gridSize || gridSize < 1) return res.status(400).json({ error: '格子數無效' });

  game.gridSize = gridSize;
  game.scratched = Array(gridSize).fill(null);
  res.json({ message: '格子數已更新', gridSize });
});

// 修改中獎號碼
app.post('/api/manager/config/win', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const code = managerTokens[token];
  if (!code) return res.status(403).json({ error: '未授權' });

  const game = games[code];
  if (!game) return res.status(404).json({ error: '找不到遊戲' });

  const { winNumbers } = req.body;
  if (!winNumbers || !Array.isArray(winNumbers)) return res.status(400).json({ error: '請提供中獎號碼陣列' });

  game.winningNumbers = winNumbers;
  res.json({ message: '中獎號碼已更新', winNumbers });
});

// 重製遊戲
app.post('/api/manager/reset', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const code = managerTokens[token];
  if (!code) return res.status(403).json({ error: '未授權' });

  const game = games[code];
  if (!game) return res.status(404).json({ error: '找不到遊戲' });

  game.scratched = Array(game.gridSize).fill(null);
  res.json({ message: '遊戲已重製' });
});

// ===================
// 玩家端 API
// ===================

// 取得遊戲狀態
app.get('/api/game/state', (req, res) => {
  const code = req.query.code;
  const game = games[code];
  if (!game) return res.status(404).json({ error: '找不到遊戲' });

  res.json({
    winningNumbers: game.winningNumbers,
    gridSize: game.gridSize,
    scratched: game.scratched
  });
});

// 刮格子
app.post('/api/game/scratch', (req, res) => {
  const { index, code } = req.body;
  const game = games[code];
  if (!game) return res.status(404).json({ error: '找不到遊戲' });

  if (index < 0 || index >= game.gridSize) return res.status(400).json({ error: '格子編號錯誤' });
  if (game.scratched[index] !== null) return res.status(400).json({ error: '格子已刮過' });

  // 模擬隨機號碼（如果中獎號碼存在則選擇其中一個）
  let number = Math.floor(Math.random() * 100) + 1;
  // 假如該格子對應 winningNumbers，則直接用該號碼
  if (game.winningNumbers.length > 0 && Math.random() < 0.2) {
    number = game.winningNumbers[Math.floor(Math.random() * game.winningNumbers.length)];
  }

  game.scratched[index] = number;
  res.json({ number });
});

// ===================
// 啟動服務
// ===================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
