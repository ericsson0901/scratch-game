// app.js
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public')); // 你的 HTML/CSS/JS 放在 public 資料夾

// ========================
// 資料存放 (內存)
// ========================
let adminPassword = 'admin123'; // 初始管理員密碼
let globalPlayerPassword = 'player123'; // 初始玩家密碼
const games = {}; // { code: { managerPassword, gridSize, winningNumbers: [], scratched: [], progressThreshold } }
const managerTokens = {}; // { token: code }
const adminTokens = {}; // { token: true }

// ========================
// Helper
// ========================
function generateToken() {
  return uuidv4();
}

// ========================
// Admin API
// ========================
app.post('/api/admin', (req, res) => {
  const { password } = req.body;
  if (password === adminPassword) {
    const token = generateToken();
    adminTokens[token] = true;
    return res.json({ token });
  }
  res.status(401).json({ error: '管理員密碼錯誤' });
});

// 建立新遊戲
app.post('/api/admin/create-game', (req, res) => {
  const auth = req.headers['authorization'];
  if (!auth || !adminTokens[auth.replace('Bearer ','')]) return res.status(401).json({ error: '未授權' });

  const { code, managerPassword } = req.body;
  if (!code || !managerPassword) return res.status(400).json({ error: '缺少參數' });
  if (games[code]) return res.status(400).json({ error: '遊戲已存在' });

  games[code] = {
    managerPassword,
    gridSize: 9,
    winningNumbers: [],
    scratched: [],
    progressThreshold: 3
  };

  res.json({ message: '遊戲建立成功' });
});

// 刪除遊戲
app.post('/api/admin/delete-game', (req, res) => {
  const auth = req.headers['authorization'];
  if (!auth || !adminTokens[auth.replace('Bearer ','')]) return res.status(401).json({ error: '未授權' });

  const { code } = req.body;
  if (!games[code]) return res.status(404).json({ error: '遊戲不存在' });
  delete games[code];
  res.json({ message: '遊戲已刪除' });
});

// 重設遊戲
app.post('/api/admin/reset', (req, res) => {
  const auth = req.headers['authorization'];
  if (!auth || !adminTokens[auth.replace('Bearer ','')]) return res.status(401).json({ error: '未授權' });

  const { code } = req.body;
  if (!games[code]) return res.status(404).json({ error: '遊戲不存在' });
  const g = games[code];
  g.scratched = [];
  g.winningNumbers = [];
  res.json({ message: '遊戲已重置' });
});

// 修改遊戲設定
app.post('/api/admin/config', (req, res) => {
  const auth = req.headers['authorization'];
  if (!auth || !adminTokens[auth.replace('Bearer ','')]) return res.status(401).json({ error: '未授權' });

  const { code, gridSize, winNumbers, progressThreshold, managerPassword } = req.body;
  const g = games[code];
  if (!g) return res.status(404).json({ error: '遊戲不存在' });
  if (managerPassword !== g.managerPassword) return res.status(403).json({ error: '場次管理員密碼錯誤' });

  g.gridSize = gridSize || g.gridSize;
  g.winningNumbers = winNumbers || g.winningNumbers;
  g.progressThreshold = progressThreshold || g.progressThreshold;

  res.json({ success: true, config: g });
});

// 取得遊戲清單 (admin)
app.get('/api/admin/game-list', (req, res) => {
  const auth = req.headers['authorization'];
  if (!auth || !adminTokens[auth.replace('Bearer ','')]) return res.status(401).json({ error: '未授權' });

  res.json({ codes: Object.keys(games) });
});

// 修改管理員密碼
app.post('/api/admin/change-password', (req, res) => {
  const auth = req.headers['authorization'];
  if (!auth || !adminTokens[auth.replace('Bearer ','')]) return res.status(401).json({ error: '未授權' });

  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: '缺少新密碼' });
  adminPassword = newPassword;
  res.json({ message: '管理員密碼已更新' });
});

// 修改全域玩家密碼
app.post('/api/admin/change-global-password', (req, res) => {
  const auth = req.headers['authorization'];
  if (!auth || !adminTokens[auth.replace('Bearer ','')]) return res.status(401).json({ error: '未授權' });

  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: '缺少新密碼' });
  globalPlayerPassword = newPassword;
  res.json({ message: '全域玩家密碼已更新' });
});

// ========================
// Manager API
// ========================
app.post('/api/manager/login', (req, res) => {
  const { code, password } = req.body;
  const g = games[code];
  if (!g || g.managerPassword !== password) return res.status(401).json({ error: '登入失敗' });

  const token = generateToken();
  managerTokens[token] = code;
  res.json({ token, code });
});

// 修改格子數
app.post('/api/manager/config/grid', (req, res) => {
  const auth = req.headers['authorization'];
  const code = managerTokens[auth.replace('Bearer ','')];
  if (!code) return res.status(401).json({ error: '未授權' });

  const { gridSize } = req.body;
  if (!gridSize) return res.status(400).json({ error: '缺少 gridSize' });

  games[code].gridSize = gridSize;
  res.json({ message: '格子數已更新' });
});

// 修改中獎號碼
app.post('/api/manager/config/win', (req, res) => {
  const auth = req.headers['authorization'];
  const code = managerTokens[auth.replace('Bearer ','')];
  if (!code) return res.status(401).json({ error: '未授權' });

  const { winNumbers } = req.body;
  if (!winNumbers || !Array.isArray(winNumbers)) return res.status(400).json({ error: '缺少 winNumbers' });

  games[code].winningNumbers = winNumbers;
  res.json({ message: '中獎號碼已更新' });
});

// 重置遊戲
app.post('/api/manager/reset', (req, res) => {
  const auth = req.headers['authorization'];
  const code = managerTokens[auth.replace('Bearer ','')];
  if (!code) return res.status(401).json({ error: '未授權' });

  games[code].scratched = [];
  res.json({ message: '遊戲已重置' });
});

// ========================
// Player API
// ========================
// 取得遊戲列表 (無需登入)
app.get('/api/game-list', (req, res) => {
  res.json({ codes: Object.keys(games) });
});

// 取得遊戲狀態
app.get('/api/game/state', (req, res) => {
  const { code } = req.query;
  const g = games[code];
  if (!g) return res.status(404).json({ error: '遊戲不存在' });

  res.json({
    gridSize: g.gridSize,
    winningNumbers: g.winningNumbers,
    scratched: g.scratched
  });
});

// 刮格子
app.post('/api/game/scratch', (req, res) => {
  const { code, index } = req.body;
  const g = games[code];
  if (!g) return res.status(404).json({ error: '遊戲不存在' });
  if (typeof index !== 'number' || index < 0 || index >= g.gridSize) return res.status(400).json({ error: 'index 無效' });

  // 產生號碼 (若已刮過就回傳相同號碼)
  if (!g.scratched[index]) {
    const number = Math.floor(Math.random() * 100); // 0~99 隨機號碼
    g.scratched[index] = number;
  }

  res.json({ number: g.scratched[index] });
});

// ========================
// 啟動 Server
// ========================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Available at http://localhost:${PORT}`);
});
