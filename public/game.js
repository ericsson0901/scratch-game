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

      // 修改：點擊事件加上 isAnyCellEnlarged 判斷
      cell.onclick = () => {
        if (isAnyCellEnlarged && !cell.classList.contains('enlarged')) {
          return; // 有格子放大時，其他格子點擊無效
        }
        scratch(i, cell);
      };

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

  // 放大
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

    // ❌ 移除這行，避免強制判定已刮開
    // cell.classList.add('revealed');

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