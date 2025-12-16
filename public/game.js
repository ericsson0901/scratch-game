// game.js

let winningNumbers = []; // 中獎號碼陣列
let totalCells = 0;      // 總格子數
let gameCode = null;     // 當前遊戲代碼

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
    const res = await fetch(`/api/game/state?code=${encodeURIComponent(gameCode)}`);
    if (!res.ok) throw new Error('無法取得遊戲狀態');
    const state = await res.json();

    // 後端回傳中獎號碼、格子數、刮過的格子
    winningNumbers = state.winningNumbers || [];
    totalCells = state.gridSize || 36;

    document.getElementById('winning').innerText = winningNumbers.join(', ');

    const grid = document.getElementById('grid');
    grid.innerHTML = '';

    // 設定 grid 列數，正方形為主
    const root = Math.sqrt(totalCells);
    if (Number.isInteger(root)) {
      grid.style.gridTemplateColumns = `repeat(${root}, auto)`;
    } else {
      grid.style.gridTemplateColumns = `repeat(6, auto)`; // 預設 6 列
    }

    // 建立格子
    for (let i = 0; i < totalCells; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';

      if (state.scratched && state.scratched[i] !== null) {
        // 已刮過 → 直接顯示
        createScratchCell(cell, state.scratched[i], winningNumbers.includes(state.scratched[i]), true);
      }

      cell.onclick = () => scratch(i, cell);
      grid.appendChild(cell);
    }

    updateStats(state.scratched ? state.scratched.filter(n => n !== null).length : 0);

  } catch (e) {
    alert('載入遊戲失敗，請確認遊戲代碼是否正確');
    console.error(e);
  }
}
// 刮格子
async function scratch(i, cell) {
  if (cell.querySelector('.hiddenNumber')) return; // 已經刮過就不再刮

  // 放大格子
  cell.classList.add('enlarged');
  if (navigator.vibrate) navigator.vibrate(100);

  try {
    const res = await fetch('/api/game/scratch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: i, code: gameCode })
    });

    if (!res.ok) throw new Error('刮格子失敗');

    const data = await res.json();

    // 建立刮刮樂效果
    createScratchCell(cell, data.number, winningNumbers.includes(data.number), false);

    // 刮完後保持白底
    cell.classList.add('revealed');

    // 更新統計
    const scratchedCount = document.querySelectorAll('.cell .hiddenNumber').length;
    updateStats(scratchedCount);

    // 標記中獎
    if (winningNumbers.includes(data.number)) {
      cell.dataset.win = "true";
    }

  } catch (e) {
    alert('刮格子失敗，請稍後再試');
    console.error(e);
  }
}

// 更新刮格統計
function updateStats(scratchedCount) {
  document.getElementById('scratchedCount').innerText = scratchedCount;
  document.getElementById('remainingCount').innerText = totalCells - scratchedCount;
}

// 建立格子內號碼顯示
function createScratchCell(cell, number, isWinning, alreadyRevealed) {
  const span = document.createElement('span');
  span.className = 'hiddenNumber';
  span.innerText = number;

  if (alreadyRevealed) {
    cell.classList.add('revealed');
    if (isWinning) {
      cell.classList.add('win');
    }
  }

  cell.appendChild(span);

  // 點擊後縮小格子
  cell.addEventListener('transitionend', () => {
    if (cell.classList.contains('enlarged')) {
      cell.classList.remove('enlarged');
      if (isWinning) cell.classList.add('win');
    }
  }, { once: true });
}
