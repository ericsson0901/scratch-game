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
    const state = await fetch(`/api/game/${encodeURIComponent(gameCode)}`)
      .then(r => r.json());

    // 從後端 config 讀取設定
    winningNumbers = state.config.winNumbers || [];
    totalCells = state.config.gridSize;
    document.getElementById('winning').innerText = winningNumbers.join(', ');

    const grid = document.getElementById('grid');
    grid.innerHTML = '';

    // 動態設定 grid 列數
    const root = Math.sqrt(state.config.gridSize);
    if (Number.isInteger(root)) {
      grid.style.gridTemplateColumns = `repeat(${root}, auto)`;
    } else {
      grid.style.gridTemplateColumns = `repeat(6, auto)`; // 預設 6 列
    }

    // 建立格子
    for (let i = 0; i < state.config.gridSize; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';

      if (state.scratched[i] !== null) {
        // 已刮過 → 顯示 revealed 狀態
        createScratchCell(
          cell,
          state.scratched[i],
          winningNumbers.includes(state.scratched[i]),
          true // alreadyRevealed
        );
      }

      // 點擊事件
      cell.onclick = () => {
        if (isAnyCellEnlarged && !cell.classList.contains('enlarged')) {
          return; // 有格子放大時，其他格子點擊無效
        }
        scratch(i, cell);
      };

      grid.appendChild(cell);
    }

    // 初始化統計：只算已刮過的格子
    updateStats(state.scratched.filter(n => n !== null).length);
  } catch (e) {
    alert('載入遊戲失敗，請確認遊戲代碼是否正確');
  }
}

// 刮格子
async function scratch(i, cell) {
  if (cell.querySelector('.hiddenNumber')) return; // 已經刮過就不再刮

  // 放大效果
  cell.classList.add('enlarged');
  if (navigator.vibrate) navigator.vibrate(100);

  try {
    const res = await fetch(`/api/game/${gameCode}/scratch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: i })
    });
    const data = await res.json();

    // 顯示號碼
    createScratchCell(cell, data.number, winningNumbers.includes(data.number), false);

    // 更新統計
    const scratchedCount = document.querySelectorAll('.cell.revealed').length;
    updateStats(scratchedCount);

    // 標記中獎
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