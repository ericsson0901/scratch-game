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
  progressThresholds: { "7": 3 } // 👉 修改：改成物件，支援每個號碼獨立門檻
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
      // 👉 相容舊格式：如果只有單一 progressThreshold，轉換成物件
      if (typeof config?.progressThreshold === 'number') {
        const thresholds = {};
        (config.winNumbers || []).forEach(num => {
          thresholds[num] = config.progressThreshold;
        });
        config.progressThresholds = thresholds;
        delete config.progressThreshold;
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

// === Google Drive 備份設定（改用 OAuth） ===
function getOAuthClient() {
  if (!process.env.GOOGLE_CREDENTIALS || !process.env.GOOGLE_TOKEN) {
    throw new Error('Missing Google OAuth environment variables');
  }

  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const token = JSON.parse(process.env.GOOGLE_TOKEN);

  const { client_secret, client_id, redirect_uris } =
    credentials.installed || credentials.web;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  oAuth2Client.setCredentials(token);
  return oAuth2Client;
}
// 共用資料夾 ID（可選，如果要指定資料夾）
const TARGET_FOLDER_ID = '1ZbWY6V2RCllvccOsL6cftTz1kqZENE9Y';
// 打包所有遊戲 JSON 成 zip 並上傳到 Google Drive
async function backupZipToDrive() {
  try {
    const zipPath = path.join(__dirname, 'games-backup.zip');
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(output);

    // 加入所有 game-*.json 檔案（包含 __config.json）
    const files = fs.readdirSync(__dirname).filter(f => f.startsWith('game-') && f.endsWith('.json'));
    for (const file of files) {
      archive.file(path.join(__dirname, file), { name: file });
    }

    // 等待壓縮完成
    await new Promise((resolve, reject) => {
      output.on('finish', resolve);
      output.on('error', reject);
      archive.finalize();
    });

    // 建立 OAuth client
    const auth = getOAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    // 壓縮完成後再建立讀取串流
    const media = {
      mimeType: 'application/zip',
      body: fs.createReadStream(zipPath),
    };

    // 先檢查是否已有舊檔案
    const listRes = await drive.files.list({
      q: "name='games-backup.zip' and '" + TARGET_FOLDER_ID + "' in parents",
      fields: 'files(id, name)',
      pageSize: 1
    });

    if (listRes.data.files.length > 0) {
      // 覆寫舊檔案
      const fileId = listRes.data.files[0].id;
      await drive.files.update({
        fileId,
        media,
      });
      console.log("備份成功，已覆寫舊檔案 ID:", fileId);
    } else {
      // 沒有舊檔案 → 建立新檔案
      const requestBody = {
        name: 'games-backup.zip',
        mimeType: 'application/zip',
      };
      if (TARGET_FOLDER_ID) {
        requestBody.parents = [TARGET_FOLDER_ID];
      }

      const file = await drive.files.create({
        requestBody,
        media,
        uploadType: 'media'
      });

      console.log("備份成功，建立新檔案 ID:", file.data.id);
    }
  } catch (err) {
    console.error("備份失敗:", err);
  }
}
// 從 Google Drive 還原最新備份
async function restoreFromDrive() {
  try {
    const auth = getOAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    const res = await drive.files.list({
      q: "name='games-backup.zip' and '" + TARGET_FOLDER_ID + "' in parents",
      orderBy: 'createdTime desc',
      pageSize: 1,
      fields: 'files(id, name)'
    });

    if (res.data.files.length === 0) {
      console.log("沒有找到備份檔案");
      return;
    }

    const fileId = res.data.files[0].id;
    const dest = fs.createWriteStream(path.join(__dirname, 'games-backup.zip'));

    await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' })
      .then(resp => {
        return new Promise((resolve, reject) => {
          resp.data.pipe(dest);
          dest.on('finish', resolve);
          dest.on('error', reject);
        });
      });

    console.log("已下載最新備份 zip");

    await fs.createReadStream(path.join(__dirname, 'games-backup.zip'))
      .pipe(unzipper.Extract({ path: __dirname }))
      .promise();

    console.log("已還原遊戲 JSON 檔案");

    loadPasswords();
  } catch (err) {
    console.error("還原失敗:", err);
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
  // 如果已有計時器 → 先清掉
  if (backupTimer) {
    clearTimeout(backupTimer);
    backupTimer = null;
  }
  // 檢查是否所有遊戲都沒有玩家鎖定
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
    // ✅ 如果是同一個 playerId → 允許覆蓋鎖定
    if (lock.playerId === playerId) {
      gameLocks[code] = { playerId, lastHeartbeat: Date.now() };
      return res.json({ success: true, message: '重新進入遊戲成功' });
    }
    // ❌ 如果是不同玩家 → 一律拒絕，直到心跳過期由定時器清理
    return res.status(400).json({ error: '此遊戲代碼已被使用中' });
  }

  // 建立新鎖定（舊鎖定不存在）
  gameLocks[code] = { playerId, lastHeartbeat: Date.now() };

  // 有玩家進入 → 取消延遲備份
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
  // 如果有遊戲解除 → 嘗試排程延遲備份
  if (removed) scheduleBackupAfterLeave();
}, 60000); // 每分鐘檢查一次
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
    progressThresholds: game.config.progressThresholds, // 👉 修改：回傳物件，但玩家端不會顯示
    scratched: game.scratched,
    revealed: game.scratched.map(n => n !== null)
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

  // 👉 修改：檢查該號碼的專屬門檻
  const thresholds = game.config.progressThresholds || {};
  const thresholdForNumber = thresholds[number];

  if (typeof thresholdForNumber === 'number' &&
      scratchedCount < thresholdForNumber &&
      game.config.winNumbers.includes(number)) {

    // 找一個尚未刮開且不是中獎號碼的格子
    const availableIndexes = game.numbers
      .map((n, i) => ({ n, i }))
      .filter(obj => game.scratched[obj.i] === null && !game.config.winNumbers.includes(obj.n) && obj.i !== index);

    if (availableIndexes.length > 0) {
      const swapTarget = availableIndexes[Math.floor(Math.random() * availableIndexes.length)];

      // 把中獎號碼移到新的位置
      game.numbers[swapTarget.i] = number;

      // 原本位置顯示替代號碼
      number = swapTarget.n;
      game.numbers[index] = number;
    }
  }

  game.scratched[index] = number;
  saveGame(code);

  // ✅ 如果刮出的號碼是中獎號碼 → 立刻執行備份
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

  const { code, gridSize, winNumbers, progressThresholds, managerPassword } = req.body;
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  games[code].config.gridSize = gridSize || games[code].config.gridSize;
  games[code].config.winNumbers = Array.isArray(winNumbers) ? winNumbers : games[code].config.winNumbers;
  games[code].config.progressThresholds = typeof progressThresholds === 'object' ? progressThresholds : games[code].config.progressThresholds;
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

  res.json({
    scratchedCount,
    remainingCount,
    progressThresholds: game.config.progressThresholds || {},
    thresholdReached: scratchedCount >= Math.min(...Object.values(game.config.progressThresholds || { 0: 0 }))
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