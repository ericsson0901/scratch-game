const express = require('express');
const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

let games = {};
let adminPassword = "admin123";
let globalPlayerPassword = "player123";

const TARGET_FOLDER_ID = process.env.GDRIVE_FOLDER_ID || "YOUR_FOLDER_ID";

// === Google Drive OAuth ===
function getOAuthClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GDRIVE_SERVICE_JSON || "{}"),
    scopes: ['https://www.googleapis.com/auth/drive']
  });
  return auth;
}

// === 備份到 Google Drive ===
async function backupZipToDrive() {
  try {
    const auth = getOAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    const fileMetadata = {
      name: 'games-backup.zip',
      parents: [TARGET_FOLDER_ID]
    };
    const media = {
      mimeType: 'application/zip',
      body: fs.createReadStream(path.join(__dirname, 'games-backup.zip'))
    };

    await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id'
    });

    console.log("已備份到 Google Drive");
  } catch (err) {
    console.error("備份失敗:", err);
  }
}

// === 從 Google Drive 還原最新備份 ===
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

// === 基礎函式 ===
function loadAllGames() {
  try {
    const files = fs.readdirSync(__dirname)
      .filter(f => f.endsWith('.json') && !f.startsWith('__'));
    files.forEach(f => {
      const code = path.basename(f, '.json');
      try {
        const data = JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf-8'));
        games[code] = data;
      } catch (err) {
        console.error("讀取遊戲檔案失敗:", f, err);
      }
    });
    console.log("已載入所有遊戲:", Object.keys(games));
  } catch (err) {
    console.error("掃描遊戲檔案失敗:", err);
  }
}

function loadGame(code) {
  if (!code) return;
  if (games[code]) return;
  const filePath = path.join(__dirname, `${code}.json`);
  if (fs.existsSync(filePath)) {
    try {
      games[code] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
      console.error(`讀取 ${code}.json 失敗:`, err);
    }
  }
}

function saveGame(code) {
  if (!code || !games[code]) return;
  try {
    fs.writeFileSync(
      path.join(__dirname, `${code}.json`),
      JSON.stringify(games[code], null, 2),
      'utf-8'
    );
  } catch (err) {
    console.error(`寫入 ${code}.json 失敗:`, err);
  }
}

function loadPasswords() {
  const file = path.join(__dirname, '__passwords.json');
  if (!fs.existsSync(file)) return;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (data.adminPassword) adminPassword = data.adminPassword;
    if (data.globalPlayerPassword) globalPlayerPassword = data.globalPlayerPassword;
  } catch (err) {
    console.error("讀取密碼檔失敗:", err);
  }
}

function savePasswords() {
  const file = path.join(__dirname, '__passwords.json');
  const data = {
    adminPassword,
    globalPlayerPassword
  };
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error("寫入密碼檔失敗:", err);
  }
}

// === Admin 與 Manager 登入 API ===
app.post('/api/admin', (req, res) => {
  const { password } = req.body;
  if (password === adminPassword) {
    return res.json({ token: "admin-token" });
  }
  res.status(401).json({ error: 'Invalid admin password' });
});

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
    }, 3600000);
  }
}

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

app.post('/api/heartbeat', (req, res) => {
  const { code, playerId } = req.body;
  if (gameLocks[code] && gameLocks[code].playerId === playerId) {
    gameLocks[code].lastHeartbeat = Date.now();
    return res.json({ success: true });
  }
  res.status(400).json({ error: '遊戲未鎖定或玩家不符' });
});

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

// === 玩家刮格子 API ===
app.post('/api/game/scratch', (req, res) => {
  const { code, index } = req.body;
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  const game = games[code];
  if (index < 0 || index >= game.config.gridSize * game.config.gridSize) {
    return res.status(400).json({ error: 'Invalid index' });
  }

  if (game.scratched[index] !== null) {
    return res.json({ alreadyRevealed: true, number: game.scratched[index] });
  }

  // 隨機產生號碼
  let number = Math.floor(Math.random() * 100) + 1;

  // 檢查 thresholds → 若未達門檻則替換成其他號碼
  if (game.config.thresholds && game.config.thresholds[number]) {
    const threshold = game.config.thresholds[number];
    const count = game.scratched.filter(n => n !== null).length;
    if (count < threshold) {
      number = Math.floor(Math.random() * 100) + 1;
    }
  }

  game.scratched[index] = number;
  saveGame(code);

  // 立即備份
  backupZipToDrive();

  res.json({ number, isWin: game.config.winNumbers.includes(number) });
});

// === Manager API ===
app.post('/api/manager/config', (req, res) => {
  const { code, gridSize, winNumbers, managerPassword } = req.body;
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  games[code].config.gridSize = gridSize;
  games[code].config.winNumbers = winNumbers;
  games[code].config.managerPassword = managerPassword;
  saveGame(code);

  res.json({ success: true, config: games[code].config });
});

// === Admin 建立遊戲 ===
app.post('/api/admin/create-game', (req, res) => {
  const { code, managerPassword } = req.body;
  if (games[code]) return res.status(400).json({ error: 'Game already exists' });

  games[code] = {
    config: {
      gridSize: 5,
      winNumbers: [],
      progressThreshold: 0,
      thresholds: {},
      managerPassword
    },
    scratched: Array(25).fill(null)
  };
  saveGame(code);

  res.json({ success: true, message: 'Game created', code });
});

// === Admin 重設遊戲 ===
app.post('/api/admin/reset', (req, res) => {
  const { code } = req.body;
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  games[code].scratched = Array(games[code].config.gridSize * games[code].config.gridSize).fill(null);
  saveGame(code);

  res.json({ success: true, message: 'Game reset' });
});

// === Admin 刪除遊戲 ===
app.post('/api/admin/delete-game', (req, res) => {
  const { code } = req.body;
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  delete games[code];
  fs.unlinkSync(path.join(__dirname, code + '.json'));

  res.json({ success: true, message: 'Game deleted' });
});

// === Admin 查看進度 (顯示 thresholds 狀態) ===
app.get('/api/admin/progress', (req, res) => {
  const { code } = req.query;
  loadGame(code);
  if (!games[code]) return res.status(404).json({ error: 'Game not found' });

  const game = games[code];
  const scratchedCount = game.scratched.filter(n => n !== null).length;
  const remainingCount = game.scratched.length - scratchedCount;

  const progress = {};
  if (game.config.thresholds) {
    for (const [num, threshold] of Object.entries(game.config.thresholds)) {
      progress[num] = {
        threshold,
        thresholdReached: scratchedCount >= threshold
      };
    }
  }

  res.json({ scratchedCount, remainingCount, progress });
});

// === Admin 修改密碼 ===
app.post('/api/admin/change-password', (req, res) => {
  const { newPassword } = req.body;
  adminPassword = newPassword;
  savePasswords();
  res.json({ success: true, message: 'Admin password updated' });
});

// === Admin 修改全域玩家密碼 ===
app.post('/api/admin/change-global-password', (req, res) => {
  const { newPassword } = req.body;
  globalPlayerPassword = newPassword;
  savePasswords();
  res.json({ success: true, message: 'Global player password updated' });
});

// === 啟動伺服器 ===
app.listen(PORT, async () => {
  console.log("Server running on port " + PORT);
  await restoreFromDrive();   // 啟動時自動還原
  loadAllGames();
  loadPasswords();
});