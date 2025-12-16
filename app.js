const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');

app.use(bodyParser.json());

// 模擬資料庫
let games = [];  // 存儲遊戲資料
let adminPassword = 'admin_password'; // 管理員密碼
let globalPassword = 'global_player_password';  // 全域玩家密碼

// 模擬管理員登入驗證
let adminToken = null;

// 1. 管理員登入 API
app.post('/api/admin', (req, res) => {
  const { password } = req.body;
  if (password === adminPassword) {
    adminToken = jwt.sign({ role: 'admin' }, 'secret', { expiresIn: '1h' });
    res.json({ token: adminToken });
  } else {
    res.status(401).json({ error: '密碼錯誤' });
  }
});

// 2. 創建遊戲 API
app.post('/api/admin/create-game', (req, res) => {
  const { code, managerPassword } = req.body;
  if (!adminToken) return res.status(401).json({ error: '未授權' });
  
  // 實際上，應該檢查 managerPassword 是否正確
  games.push({ code, managerPassword, gridSize: 9, winNumbers: [], progressThreshold: 3 });
  res.json({ message: '遊戲創建成功' });
});

// 3. 重置遊戲 API
app.post('/api/admin/reset', (req, res) => {
  const { code } = req.body;
  const game = games.find(g => g.code === code);
  if (!game) return res.status(404).json({ error: '遊戲未找到' });

  // 重設遊戲邏輯
  game.winNumbers = [];
  game.gridSize = 9;
  game.progressThreshold = 3;

  res.json({ message: '遊戲已重設' });
});

// 4. 刪除遊戲 API
app.post('/api/admin/delete-game', (req, res) => {
  const { code } = req.body;
  games = games.filter(g => g.code !== code);
  res.json({ message: '遊戲已刪除' });
});

// 5. 查看遊戲進度 API
app.get('/api/admin/progress', (req, res) => {
  const { code } = req.query;
  const game = games.find(g => g.code === code);
  if (!game) return res.status(404).json({ error: '遊戲未找到' });

  const scratchedCount = game.winNumbers.length;
  const remainingCount = game.gridSize - scratchedCount;
  const thresholdReached = scratchedCount >= game.progressThreshold;

  res.json({
    scratchedCount,
    remainingCount,
    progressThreshold: game.progressThreshold,
    thresholdReached
  });
});

// 6. 更新遊戲設定 API
app.post('/api/admin/config', (req, res) => {
  const { code, gridSize, winNumbers, progressThreshold, managerPassword } = req.body;
  const game = games.find(g => g.code === code);
  if (!game) return res.status(404).json({ error: '遊戲未找到' });

  // 檢查管理員密碼
  if (game.managerPassword !== managerPassword) {
    return res.status(401).json({ error: '密碼錯誤' });
  }

  // 更新遊戲設定
  game.gridSize = gridSize;
  game.winNumbers = winNumbers;
  game.progressThreshold = progressThreshold;

  res.json({ success: true, config: game });
});

// 7. 修改管理員密碼 API
app.post('/api/admin/change-password', (req, res) => {
  const { newPassword } = req.body;
  adminPassword = newPassword;
  res.json({ message: '管理員密碼已更新' });
});

// 8. 修改全域玩家密碼 API
app.post('/api/admin/change-global-password', (req, res) => {
  const { newPassword } = req.body;
  globalPassword = newPassword;
  res.json({ message: '全域玩家密碼已更新' });
});

// 9. 場次管理員登入 API
app.post('/api/manager/login', (req, res) => {
  const { code, password } = req.body;
  const game = games.find(g => g.code === code);
  if (!game || game.managerPassword !== password) {
    return res.status(401).json({ error: '密碼錯誤或遊戲代碼不存在' });
  }
  const managerToken = jwt.sign({ role: 'manager', gameCode: code }, 'secret', { expiresIn: '1h' });
  res.json({ token: managerToken, code });
});

// 10. 更新格子數 API
app.post('/api/manager/config/grid', (req, res) => {
  const { code, gridSize } = req.body;
  const game = games.find(g => g.code === code);
  if (!game) return res.status(404).json({ error: '遊戲未找到' });

  game.gridSize = gridSize;
  res.json({ message: '格子數已更新' });
});

// 11. 更新中獎號碼 API
app.post('/api/manager/config/win', (req, res) => {
  const { code, winNumbers } = req.body;
  const game = games.find(g => g.code === code);
  if (!game) return res.status(404).json({ error: '遊戲未找到' });

  game.winNumbers = winNumbers;
  res.json({ message: '中獎號碼已更新' });
});

// 12. 重製遊戲 API
app.post('/api/manager/reset', (req, res) => {
  const { code } = req.body;
  const game = games.find(g => g.code === code);
  if (!game) return res.status(404).json({ error: '遊戲未找到' });

  // 重置遊戲
  game.winNumbers = [];
  game.gridSize = 9;
  game.progressThreshold = 3;

  res.json({ message: '遊戲已重製' });
});

// 13. 更新遊戲代碼清單 API (管理員可查看所有遊戲代碼)
app.get('/api/admin/game-list', (req, res) => {
  if (!adminToken) return res.status(401).json({ error: '未授權' });

  const codes = games.map(game => game.code);
  res.json({ codes });
});

// 假設有一個根 API 端點用來測試
app.get('/', (req, res) => {
  res.send('Hello, Welcome to the Admin & Manager API!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
