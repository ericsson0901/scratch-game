const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// ====== 工具函式 ======
function hash(pwd) {
  return crypto.createHash('sha256').update(pwd).digest('hex');
}

function loadAdmin() {
  if (!fs.existsSync('admin.json')) {
    return {
      adminPasswordHash: hash(process.env.ADMIN_PASSWORD || 'admin123'),
      loginPasswordHash: hash('player123'),
      gridSize: 9,
      winningNumber: 7,
      scratched: []
    };
  }
  return JSON.parse(fs.readFileSync('admin.json'));
}

function saveAdmin(admin) {
  fs.writeFileSync('admin.json', JSON.stringify(admin, null, 2));
}

// ====== 玩家登入 ======
app.post('/api/login', (req, res) => {
  const admin = loadAdmin();
  const { password } = req.body;
  if (hash(password) === admin.loginPasswordHash) {
    res.json({ token: 'player-token' });
  } else {
    res.status(401).json({ error: 'invalid password' });
  }
});

// ====== 遊戲狀態 ======
app.get('/api/game/state', (req, res) => {
  const admin = loadAdmin();
  res.json({
    gridSize: admin.gridSize,
    winningNumber: admin.winningNumber,
    scratched: admin.scratched
  });
});

// ====== 刮格子 ======
app.post('/api/game/scratch', (req, res) => {
  const admin = loadAdmin();
  const { index } = req.body;
  if (!admin.scratched.includes(index)) {
    admin.scratched.push(index);
    saveAdmin(admin);
  }
  res.json({ number: (index % admin.gridSize) + 1 });
});

// ====== 管理員登入 ======
app.post('/api/admin/login', (req, res) => {
  const admin = loadAdmin();
  const { password } = req.body;
  if (hash(password) === admin.adminPasswordHash) {
    res.json({ token: 'admin-token' });
  } else {
    res.status(401).json({ error: 'invalid admin password' });
  }
});

// ====== 管理員操作 ======
function requireAdmin(req, res, next) {
  if (req.headers['x-admin-token'] === 'admin-token') next();
  else res.status(403).json({ error: 'not authorized' });
}

// 更新玩家登入密碼
app.post('/api/admin/password', requireAdmin, (req, res) => {
  const admin = loadAdmin();
  admin.loginPasswordHash = hash(req.body.newLoginPassword);
  saveAdmin(admin);
  res.json({ ok: true });
});

// 更新遊戲設定
app.post('/api/admin/config', requireAdmin, (req, res) => {
  const admin = loadAdmin();
  admin.gridSize = parseInt(req.body.gridSize);
  admin.winningNumber = parseInt(req.body.winningNumber);
  saveAdmin(admin);
  res.json({ ok: true });
});

// 重新開始遊戲
app.post('/api/admin/reset', requireAdmin, (req, res) => {
  const admin = loadAdmin();
  admin.scratched = [];
  saveAdmin(admin);
  res.json({ ok: true });
});

// 更新後端登入密碼
app.post('/api/admin/updatePassword', requireAdmin, (req, res) => {
  const admin = loadAdmin();
  const newPwd = req.body.newPassword;
  if (!newPwd || newPwd.length < 4) {
    return res.status(400).json({ error: 'password too short' });
  }
  admin.adminPasswordHash = hash(newPwd);
  saveAdmin(admin);
  res.json({ ok: true });
});

// 查看狀態
app.get('/api/admin/state', requireAdmin, (req, res) => {
  const admin = loadAdmin();
  res.json(admin);
});

// ====== 啟動伺服器 ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});