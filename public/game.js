let winningNumbers = []; // 改成陣列
let totalCells = 0;
let gameCode = null;

// 提供給 index.html 呼叫
function startGame(code) {
  gameCode = code;
  document.getElementById('selectGame').style.display = 'none';
  document.getElementById('game').style.display = 'block';
  loadGame();
}

// 載入遊戲狀態
async function loadGame() {
  try {
    const state = await fetch(`/api/game/state?code=${encodeURIComponent(gameCode)}`)
      .then(r => r.json());

    winningNumbers = state.winningNumbers || []; // 後端回傳陣列
    totalCells = state.gridSize;
    document.getElementById('winning').innerText = winningNumbers.join(', ');

    const grid = document.getElementById('grid');
    grid.innerHTML = '';

    // 動態設定 grid 列數
    const root = Math.sqrt(state.gridSize);
    if (Number.isInteger(root)) {
      grid.style.gridTemplateColumns = `repeat(${root}, auto)`;
    } else {
      grid.style.gridTemplateColumns = `repeat(6, auto)`; // 預設 6 列
    }

    // 建立格子
    for (let i = 0; i < state.gridSize; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';

      if (state.scratched[i] !== null) {
        // 已刮過 → 不放大，直接顯示 revealed 狀態
        createScratchCell(
          cell,
          state.scratched[i],
          winningNumbers.includes(state.scratched[i]),
          true // alreadyRevealed
        );
      }

      cell.onclick = () => scratch(i, cell);
      grid.appendChild(cell);
    }

    updateStats(state.scratched.filter(n => n !== null).length);
  } catch (e) {
    alert('載入遊戲失敗，請確認遊戲代碼是否正確');
  }
}

// 刮格子
async function scratch(i, cell) {
  if (cell.querySelector('.hiddenNumber')) return; // 已經刮過就不再刮

  // 放大並白底
  cell.classList.add('enlarged');
  if (navigator.vibrate) navigator.vibrate(100);

  try {
    const res = await fetch('/api/game/scratch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: i, code: gameCode })
    });
    const data = await res.json();

    // 使用刮刮樂效果顯示號碼（新刮的 → not revealed）
    createScratchCell(cell, data.number, winningNumbers.includes(data.number), false);

    // 刮完後保持白底
    cell.classList.add('revealed');

    const scratchedCount = document.querySelectorAll('.cell .hiddenNumber').length;
    updateStats(scratchedCount);

    // 標記中獎，不要馬上提示
    if (winningNumbers.includes(data.number)) {
      cell.dataset.win = "true";
    }
  } catch (e) {
    alert('刮格子失敗，請稍後再試');
  }
}

// 更新統計資訊
function updateStats(scratchedCount) {
  document.getElementById('scratchedCount').innerText = scratchedCount;
  document.getElementById('remainingCount').innerText = totalCells - scratchedCount;
}
document.getElementById('refreshFullDistributionBtn').addEventListener('click', async () => {
  const code = document.getElementById('fullDistributionGameCode').value;
  const res = await fetch('/api/admin/full-distribution?code=' + encodeURIComponent(code), {
    headers: { 'Authorization': 'Bearer ' + adminToken }
  });
  if (res.ok) {
    const data = await res.json();
    const grid = document.getElementById('distributionGrid');
    grid.innerHTML = '';

    // 動態設定 grid 列數
    const root = Math.sqrt(data.gridSize);
    if (Number.isInteger(root)) {
      grid.style.gridTemplateColumns = `repeat(${root}, 60px)`;
    } else {
      grid.style.gridTemplateColumns = `repeat(6, 60px)`; // 預設 6 列
    }

    // 建立格子顯示號碼
    data.numbers.forEach(num => {
      const cell = document.createElement('div');
      cell.textContent = num;
      cell.style.width = '60px';
      cell.style.height = '60px';
      cell.style.display = 'flex';
      cell.style.justifyContent = 'center';
      cell.style.alignItems = 'center';
      cell.style.border = '1px solid #444';
      cell.style.borderRadius = '5px';
      cell.style.background = '#eee';
      cell.style.color = '#000';
      grid.appendChild(cell);
    });
  } else {
    alert('查無此遊戲代碼');
  }
});
