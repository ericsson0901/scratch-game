const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'games.json');

// 預設設定（移除 playerPassword）
let defaultConfig = {
  gridSize: 9,
  winNumbers: [7], // 改為陣列格式
  progressThreshold: 3
};

// 全域玩家密碼
let globalPlayerPassword = process.env.PLAYER_PASSWORD || 'player123';

// 管理員密碼
let adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

// 多場遊戲狀態
let games = {};

// 載入資料檔案
if (fs.existsSync(DATA_FILE)) {
  try {
    games = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    // 相容舊格式：將 winNumber 轉為 winNumbers 陣列
    for (const code in games) {
      const config = games[code].config;
      if (typeof config?.winNumber === 'number') {
        config.winNumbers = [config.winNumber];
        delete config.winNumber;
      }
    }
    // 載入持久化密碼
    if (games.__adminPassword) adminPassword = games.__adminPassword;
    if (games.__globalPlayerPassword) globalPlayerPassword = games.__globalPlayerPassword;

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

// 玩家登入（只驗證全域密碼）
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === globalPlayerPassword) {
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Invalid player password' });
});

// 管理員登入
app.post('/api/admin', (req, res) => {
  const { password } = req.body;
  if (password === adminPassword) {
    return res.json({ token: 'admin-token' });
  }
  res.status(401).json({ error: 'Invalid admin password' });
});

// 場次管理員登入
app.post('/api/manager/login', (req, res) => {
  const { code, password } = req.body;
  if (!games[code]) {
    return res.status(404).json({ error: 'Game not found' });
  }
  if (password !== games[code].config.managerPassword) {
    return res.status(401).json({ error: 'Invalid manager password' });
  }
  // 登入成功，給獨立 token
  return res.json({ token: `manager-token-${code}`, code });
});
// Admin 重設遊戲
app.post('/api/admin/reset', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { code } = req.body;
  if (!games[code]) {
    return res.status(404).json({ error: 'Game not found' });
  }

  initGame(code, games[code].config);

  res.json({ success: true, message: `遊戲 ${code} 已重設` });
});

// 建立遊戲
app.post('/api/admin/create-game', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') return res.status(403).json({ error: 'Unauthorized' });

  const { code, managerPassword } = req.body;
  if (!code) return res.status(400).json({ error: 'Game code required' });
  if (games[code]) return res.status(400).json({ error: 'Game already exists' });

  initGame(code);
  games[code].config.managerPassword = managerPassword || 'manager123';
  saveGames();

  res.json({ success: true, message: `遊戲 ${code} 已建立` });
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

// 修改遊戲設定（支援多個中獎號碼）
app.post('/api/admin/config', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') return res.status(403).json({ error: 'Unauthorized' });

  const { code, gridSize, winNumbers, progressThreshold, managerPassword } = req.body;
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  if (gridSize) {
    games[code].config.gridSize = gridSize;
    initGame(code, games[code].config);
  }
  if (winNumbers) {
    if (!Array.isArray(winNumbers)) {
      return res.status(400).json({ error: 'winNumbers must be an array' });
    }
    if (winNumbers.some(n => n > games[code].config.gridSize)) {
      return res.status(400).json({ error: 'Each winNumber must be within grid size' });
    }
    games[code].config.winNumbers = winNumbers;
  }
  if (progressThreshold !== undefined) games[code].config.progressThreshold = progressThreshold;
  if (managerPassword) games[code].config.managerPassword = managerPassword;

  saveGames();
  res.json({ success: true, config: games[code].config });
});

// Manager 修改中獎號碼（支援多個）
app.post('/api/manager/config/win', (req, res) => {
  const auth = req.headers.authorization;
  const { code, winNumbers } = req.body;
  if (!auth || auth !== `Bearer manager-token-${code}`) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  if (!Array.isArray(winNumbers)) {
    return res.status(400).json({ error: 'winNumbers must be an array' });
  }
  if (winNumbers.some(n => n > games[code].config.gridSize)) {
    return res.status(400).json({ error: 'Each winNumber must be within grid size' });
  }
  games[code].config.winNumbers = winNumbers;
  saveGames();
  res.json({ message: `遊戲 ${code} 中獎號碼已更新為 ${winNumbers.join(', ')}` });
});

// Manager 修改格子數
app.post('/api/manager/config/grid', (req, res) => {
  const auth = req.headers.authorization;
  const { code, gridSize } = req.body;
  if (!auth || auth !== `Bearer manager-token-${code}`) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });
  if (!gridSize || gridSize <= 0) {
    return res.status(400).json({ error: 'Invalid grid size' });
  }

  games[code].config.gridSize = gridSize;
  initGame(code, games[code].config);

  res.json({ message: `遊戲 ${code} 格子數已更新為 ${gridSize}` });
});

// Manager 重製遊戲
app.post('/api/manager/reset', (req, res) => {
  const auth = req.headers.authorization;
  const { code } = req.body;
  if (!auth || auth !== `Bearer manager-token-${code}`) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  initGame(code, games[code].config);

  res.json({ message: `遊戲 ${code} 已重製` });
});
// 查詢所有遊戲代碼清單 (Admin)
app.get('/api/admin/game-list', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  // 過濾掉特殊密碼欄位
  const codes = Object.keys(games).filter(code => !code.startsWith('__'));
  res.json({ codes });
});

// 玩家查詢遊戲代碼清單 (新增)
app.get('/api/game-list', (req, res) => {
  // 過濾掉特殊密碼欄位
  const codes = Object.keys(games).filter(code => !code.startsWith('__'));
  res.json({ codes });
});

// 玩家查詢遊戲狀態
app.get('/api/game/state', (req, res) => {
  const { code } = req.query;
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });
  res.json({
    gridSize: games[code].config.gridSize,
    winningNumbers: games[code].config.winNumbers,
    progressThreshold: games[code].config.progressThreshold,
    scratched: games[code].scratched
  });
});

// 玩家刮格子（支援多個中獎號碼）
app.post('/api/game/scratch', (req, res) => {
  const { index, code } = req.body;
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  const game = games[code];
  const { winNumbers, progressThreshold, gridSize } = game.config;

  if (index < 0 || index >= gridSize) {
    return res.status(400).json({ error: 'Invalid index' });
  }

  if (game.scratched[index] === null) {
    let chosen = game.numbers[index];
    const scratchedCount = game.scratched.filter(n => n !== null).length;

    // 還沒達到門檻而且刮到中獎號碼 → 移位
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

  res.json({ number: game.scratched[index] });
});

// 查看遊戲進度
app.get('/api/admin/progress', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') return res.status(403).json({ error: 'Unauthorized' });

  const { code } = req.query;
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  const scratchedCount = games[code].scratched.filter(n => n !== null).length;
  const remainingCount = games[code].config.gridSize - scratchedCount;
  const thresholdReached = scratchedCount >= games[code].config.progressThreshold;

  res.json({
    scratchedCount,
    remainingCount,
    progressThreshold: games[code].config.progressThreshold,
    thresholdReached
  });
});

// 修改管理員密碼（持久化）
app.post('/api/admin/change-password', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') return res.status(403).json({ error: 'Unauthorized' });

  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: 'New password required' });

  adminPassword = newPassword;
  games.__adminPassword = adminPassword; // 存到檔案
  saveGames();

  res.json({ message: '管理員密碼已更新' });
});

// 修改全域玩家密碼（持久化）
app.post('/api/admin/change-global-password', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') return res.status(403).json({ error: 'Unauthorized' });

  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: 'New player password required' });

  globalPlayerPassword = newPassword;
  games.__globalPlayerPassword = globalPlayerPassword; // 存到檔案
  saveGames();

  res.json({ message: '全域玩家密碼已更新' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});