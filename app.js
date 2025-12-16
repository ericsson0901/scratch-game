const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { google } = require('googleapis');
const archiver = require('archiver');
const cron = require('node-cron');
const unzipper = require('unzipper'); // 新增：用來解壓縮 zip

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

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

// === 新增：每個代碼獨立存檔 ===
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
    } catch (err) {
      console.error("載入遊戲 " + code + " 資料失敗:", err);
    }
  }
}

// === 新增：載入所有遊戲檔案 ===
function loadAllGames() {
  const files = fs.readdirSync(__dirname).filter(f => f.startsWith('game-') && f.endsWith('.json'));
  for (const file of files) {
    const code = file.replace('game-', '').replace('.json', '');
    loadGame(code);
  }
  console.log("已載入所有遊戲代碼:", Object.keys(games));
}

// === 新增：密碼持久化檔案 ===
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
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

function getOAuthClient() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
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

    // 建立新檔案到指定資料夾（如果有設定）
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

    console.log("備份成功，檔案ID:", file.data.id);
  } catch (err) {
    console.error("備份失敗:", err);
  }
}

// === 新增：從 Google Drive 還原最新備份 ===
async function restoreFromDrive() {
  try {
    const auth = getOAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    // 找到最新的備份檔案
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

    // 解壓縮 zip，還原 game-*.json 檔案（包含 __config.json）
    await fs.createReadStream(path.join(__dirname, 'games-backup.zip'))
      .pipe(unzipper.Extract({ path: __dirname }))
      .promise();

    console.log("已還原遊戲 JSON 檔案");

    // 還原密碼設定
    loadPasswords();
  } catch (err) {
    console.error("還原失敗:", err);
  }
}

// 每半小時執行一次備份
cron.schedule('*/30 * * * *', backupZipToDrive);
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
  loadGame(code);
  if (!games[code]) {
    return res.status(404).json({ error: 'Game not found' });
  }
  if (password !== games[code].config.managerPassword) {
    return res.status(401).json({ error: 'Invalid manager password' });
  }
  // 登入成功，給獨立 token
  return res.json({ token: "manager-token-" + code, code });
});

// 玩家查詢遊戲代碼清單 (新增)
app.get('/api/game-list', (req, res) => {
  // 過濾掉特殊密碼欄位
  const codes = Object.keys(games).filter(code => !code.startsWith('__'));
  res.json({ codes });
});

// 玩家查詢遊戲狀態 (修改：增加 revealed 陣列)
app.get('/api/game/state', (req, res) => {
  const { code } = req.query;
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  const game = games[code];

  res.json({
    gridSize: game.config.gridSize,
    winningNumbers: game.config.winNumbers,
    progressThreshold: game.config.progressThreshold,
    scratched: game.scratched,
    // 新增 revealed 陣列：true/false 表示是否已刮過
    revealed: game.scratched.map(n => n !== null)
  });
});

// 玩家刮格子（支援多個中獎號碼）
app.post('/api/game/scratch', (req, res) => {
  const { index, code } = req.body;
  loadGame(code);
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
    saveGame(code);

    // === 新增：如果刮到的是中獎號碼，立即執行備份 ===
    if (winNumbers.includes(game.scratched[index])) {
      backupZipToDrive();
    }
  }

  // 修改回傳：除了號碼，也回傳 revealed 狀態
  res.json({
    number: game.scratched[index],
    revealed: true
  });
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

  const { code, gridSize, winNumbers, progressThreshold, managerPassword } = req.body;
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  games[code].config.gridSize = gridSize || games[code].config.gridSize;
  games[code].config.winNumbers = Array.isArray(winNumbers) ? winNumbers : games[code].config.winNumbers;
  games[code].config.progressThreshold = progressThreshold || games[code].config.progressThreshold;
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

// === Admin 查看遊戲進度 (新增) ===
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
  const thresholdReached = scratchedCount >= game.config.progressThreshold;

  res.json({
    scratchedCount,
    remainingCount,
    progressThreshold: game.config.progressThreshold,
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
  games.__adminPassword = adminPassword;
  savePasswords(); // 新增：持久化保存密碼
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
  savePasswords(); // 新增：持久化保存密碼
  res.json({ message: "全域玩家密碼已更新" });
});

// 啟動伺服器
app.listen(PORT, async () => {
  console.log("Server running on port " + PORT);
  // 新增：伺服器啟動時自動還原 Google Drive 最新備份並載入所有遊戲代碼與密碼
  await restoreFromDrive();
  loadAllGames();
  loadPasswords();
});