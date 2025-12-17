const express = require('express');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { google } = require('googleapis');
const archiver = require('archiver');
// const cron = require('node-cron'); // ❌ 移除原本的 cron 定時備份
const unzipper = require('unzipper');

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// 預設設定（移除 playerPassword）
let defaultConfig = {
  gridSize: 9,
  winNumbers: [7], // 改為陣列格式
  progressThreshold: 3,
  thresholds: {} // 新增: 每個號碼獨立門檻
};

// 全域玩家密碼
let globalPlayerPassword = process.env.PLAYER_PASSWORD || 'player123';

// 管理員密碼
let adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

// 多場遊戲狀態
let games = {};
// === 每個代碼獨立存檔 ===
function getGameFilePath(code) {
  return path.join(__dirname, "game-" + code + ".json");
}

function saveGame(code) {
  const file = getGameFilePath(code);
  fs.writeFileSync(file, JSON.stringify(games[code], null, 2));
}

function loadGame(code) {
  const file = getGameFilePath(code);
  if (fs.existsSync(file)) {
    try {
      games[code] = JSON.parse(fs.readFileSync(file, 'utf-8'));
      // 相容舊格式：將 winNumber 轉為 winNumbers 陣列
      const config = games[code].config;
      if (typeof config?.winNumber === 'number') {
        config.winNumbers = [config.winNumber];
        delete config.winNumber;
      }
      // 相容舊格式：如果 thresholds 不存在，建立空物件
      if (!config.thresholds) {
        config.thresholds = {};
      }
    } catch (err) {
      console.error("載入遊戲 " + code + " 資料失敗:", err);
    }
  }
}

// === 載入所有遊戲檔案 ===
function loadAllGames() {
  const files = fs.readdirSync(__dirname).filter(f => f.startsWith('game-') && f.endsWith('.json'));
  for (const file of files) {
    const code = file.replace('game-', '').replace('.json', '');
    loadGame(code);
  }
  console.log("已載入所有遊戲代碼:", Object.keys(games));
}

// === 密碼持久化檔案 ===
function savePasswords() {
  const file = path.join(__dirname, "game-__config.json");
  const data = {
    globalPlayerPassword,
    adminPassword
  };
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function loadPasswords() {
  const file = path.join(__dirname, "game-__config.json");
  if (fs.existsSync(file)) {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (data.globalPlayerPassword) globalPlayerPassword = data.globalPlayerPassword;
    if (data.adminPassword) adminPassword = data.adminPassword;
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
    config: { ...config, thresholds: config.thresholds || {} }
  };
  saveGame(code);
}
// === Admin 與 Manager 登入 API ===
// Admin 登入：比對 adminPassword
app.post('/api/admin', (req, res) => {
  const { password } = req.body;
  if (password === adminPassword) {
    return res.json({ token: "admin-token" });
  }
  res.status(401).json({ error: 'Invalid admin password' });
});

// Manager 登入：比對遊戲代碼的 managerPassword
app.post('/api/manager/login', (req, res) => {
  const { code, password } = req.body;
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  if (password === games[code].config.managerPassword) {
    return res.json({ token: "manager-token-" + code, code });
  }
  res.status(401).json({ error: 'Invalid manager password' });
});

// === 心跳檢測機制 ===
let gameLocks = {}; 
// 結構: { gameCode: { playerId, lastHeartbeat: Date } }

// 延遲備份計時器
let backupTimer = null;
function scheduleBackupAfterLeave() {
  if (backupTimer) {
    clearTimeout(backupTimer);
    backupTimer = null;
  }
  if (Object.keys(gameLocks).length === 0) {
    backupTimer = setTimeout(async () => {
      try {
        await backupZipToDrive();
        console.log("所有玩家離開後一小時 → 已執行備份");
      } catch (err) {
        console.error("延遲備份失敗:", err);
      }
      backupTimer = null;
    }, 3600000); // 一小時
  }
}

// 玩家進入遊戲 → 鎖定代碼
app.post('/api/join-game', (req, res) => {
  const { code, playerId } = req.body;
  if (!playerId) {
    return res.status(400).json({ error: 'Player ID required' });
  }
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  if (gameLocks[code]) {
    const lock = gameLocks[code];
    if (lock.playerId === playerId) {
      gameLocks[code] = { playerId, lastHeartbeat: Date.now() };
      return res.json({ success: true, message: '重新進入遊戲成功' });
    }
    return res.status(400).json({ error: '此遊戲代碼已被使用中' });
  }

  gameLocks[code] = { playerId, lastHeartbeat: Date.now() };

  if (backupTimer) {
    clearTimeout(backupTimer);
    backupTimer = null;
    console.log("玩家重新進入 → 延遲備份取消");
  }

  res.json({ success: true });
});

// 玩家心跳 → 更新 lastHeartbeat
app.post('/api/heartbeat', (req, res) => {
  const { code, playerId } = req.body;
  if (gameLocks[code] && gameLocks[code].playerId === playerId) {
    gameLocks[code].lastHeartbeat = Date.now();
    return res.json({ success: true });
  }
  res.status(400).json({ error: '遊戲未鎖定或玩家不符' });
});

// 定時檢查 → 超過 3 分鐘沒心跳就解除鎖定
setInterval(() => {
  const now = Date.now();
  let removed = false;
  for (const code in gameLocks) {
    if (now - gameLocks[code].lastHeartbeat > 45000) {
      console.log(`遊戲 ${code} 鎖定解除`);
      delete gameLocks[code];
      removed = true;
    }
  }
  if (removed) scheduleBackupAfterLeave();
}, 60000);

// 玩家登入（只驗證全域密碼）
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === globalPlayerPassword) {
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Invalid player password' });
});

// 玩家查詢遊戲代碼清單
app.get('/api/game-list', (req, res) => {
  const codes = Object.keys(games).filter(code => !code.startsWith('__'));
  res.json({ codes });
});

// 玩家查詢遊戲狀態
app.get('/api/game/state', (req, res) => {
  const { code } = req.query;
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  const game = games[code];
  res.json({
    gridSize: game.config.gridSize,
    winningNumbers: game.config.winNumbers,
    scratched: game.scratched,
    revealed: game.scratched.map(n => n !== null)
    // 不回傳 thresholds，避免玩家看到
  });
});
// 玩家刮格子（含進度門檻替換中獎號碼 + 中獎立即備份）
app.post('/api/game/scratch', async (req, res) => {
  const { code, index } = req.body;
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  const game = games[code];
  if (index < 0 || index >= game.config.gridSize) {
    return res.status(400).json({ error: 'Invalid index' });
  }

  if (game.scratched[index] !== null) {
    return res.json({ number: game.scratched[index] });
  }

  let number = game.numbers[index];
  const scratchedCount = game.scratched.filter(n => n !== null).length;

  // 在進度門檻前，如果刮到中獎號碼 → 替換掉
  if (game.config.winNumbers.includes(number)) {
    const threshold = game.config.thresholds?.[number] ?? game.config.progressThreshold;
    if (scratchedCount < threshold) {
      const availableIndexes = game.numbers
        .map((n, i) => ({ n, i }))
        .filter(obj => game.scratched[obj.i] === null && !game.config.winNumbers.includes(obj.n) && obj.i !== index);

      if (availableIndexes.length > 0) {
        const swapTarget = availableIndexes[Math.floor(Math.random() * availableIndexes.length)];
        game.numbers[swapTarget.i] = number;
        number = swapTarget.n;
        game.numbers[index] = number;
      }
    }
  }

  game.scratched[index] = number;
  saveGame(code);

  if (game.config.winNumbers.includes(number)) {
    try {
      await backupZipToDrive();
      console.log(`遊戲 ${code} 中獎號碼刮出 → 已執行備份`);
    } catch (err) {
      console.error("中獎備份失敗:", err);
    }
  }

  res.json({ number });
});

// === Manager 重製遊戲 ===
app.post('/api/manager/reset', (req, res) => {
  const auth = req.headers.authorization;
  const { code } = req.body;
  if (!auth || auth !== "Bearer manager-token-" + code) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  initGame(code, games[code].config);
  res.json({ message: "遊戲 " + code + " 已由場次管理員重製" });
});

// === Manager 修改格子數 ===
app.post('/api/manager/config/grid', (req, res) => {
  const auth = req.headers.authorization;
  const { code, gridSize } = req.body;
  if (!auth || auth !== "Bearer manager-token-" + code) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  games[code].config.gridSize = gridSize;
  saveGame(code);
  res.json({ message: "遊戲 " + code + " 格子數已更新為 " + gridSize });
});

// === Manager 修改中獎號碼 ===
app.post('/api/manager/config/win', (req, res) => {
  const auth = req.headers.authorization;
  const { code, winNumbers } = req.body;
  if (!auth || auth !== "Bearer manager-token-" + code) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  games[code].config.winNumbers = Array.isArray(winNumbers) ? winNumbers : games[code].config.winNumbers;
  saveGame(code);
  res.json({ message: "遊戲 " + code + " 中獎號碼已更新為 " + games[code].config.winNumbers.join(', ') });
});

// === Admin 建立遊戲 ===
app.post('/api/admin/create-game', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { code, managerPassword } = req.body;
  if (!code) return res.status(400).json({ error: 'Game code required' });
  loadGame(code);
  if (games[code]) return res.status(400).json({ error: 'Game already exists' });

  initGame(code, { ...defaultConfig, managerPassword });
  res.json({ message: "遊戲 " + code + " 已建立" });
});
// === Admin 重設遊戲 ===
app.post('/api/admin/reset', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { code } = req.body;
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  initGame(code, games[code].config);
  res.json({ message: "遊戲 " + code + " 已重設" });
});

// === Admin 刪除遊戲 ===
app.post('/api/admin/delete-game', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { code } = req.body;
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  delete games[code];
  const file = getGameFilePath(code);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ message: "遊戲 " + code + " 已刪除" });
});

// === Admin 修改遊戲設定 ===
app.post('/api/admin/config', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { code, gridSize, winNumbers, progressThreshold, thresholds, managerPassword } = req.body;
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  games[code].config.gridSize = gridSize || games[code].config.gridSize;
  games[code].config.winNumbers = Array.isArray(winNumbers) ? winNumbers : games[code].config.winNumbers;
  games[code].config.progressThreshold = progressThreshold || games[code].config.progressThreshold;
  if (thresholds) games[code].config.thresholds = thresholds;
  if (managerPassword) games[code].config.managerPassword = managerPassword;

  saveGame(code);
  res.json({ success: true, config: games[code].config });
});

// Admin 查詢所有遊戲代碼清單
app.get('/api/admin/game-list', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const codes = Object.keys(games).filter(code => !code.startsWith('__'));
  res.json({ codes });
});

// === Admin 查看遊戲進度 ===
app.get('/api/admin/progress', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { code } = req.query;
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  const game = games[code];
  const scratchedCount = game.scratched.filter(n => n !== null).length;
  const remainingCount = game.scratched.filter(n => n === null).length;

  // 回傳每個號碼的進度
  const progress = {};
  for (const win of game.config.winNumbers) {
    const threshold = game.config.thresholds?.[win] ?? game.config.progressThreshold;
    progress[win] = {
      scratchedCount,
      threshold,
      thresholdReached: scratchedCount >= threshold
    };
  }

  res.json({
    scratchedCount,
    remainingCount,
    progress
  });
});

// 修改管理員密碼（持久化）
app.post('/api/admin/change-password', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') return res.status(403).json({ error: 'Unauthorized' });

  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: 'New password required' });

  adminPassword = newPassword;
  games.__adminPassword = adminPassword;
  savePasswords();
  res.json({ message: "管理員密碼已更新" });
});

// 修改全域玩家密碼（持久化）
app.post('/api/admin/change-global-password', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') return res.status(403).json({ error: 'Unauthorized' });

  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: 'New player password required' });

  globalPlayerPassword = newPassword;
  games.__globalPlayerPassword = globalPlayerPassword;
  savePasswords();
  res.json({ message: "全域玩家密碼已更新" });
});

// 啟動伺服器
app.listen(PORT, async () => {
  console.log("Server running on port " + PORT);
  await restoreFromDrive();
  loadAllGames();
  loadPasswords();
});