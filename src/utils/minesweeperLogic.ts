export type CellStatus = 'hidden' | 'revealed' | 'flagged';

export interface CellData {
  r: number;
  c: number;
  isMine: boolean;
  status: CellStatus;
  neighborMines: number;
}

export type BoardData = CellData[][];

export const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1]
];

export function getNeighbors(r: number, c: number, rows: number, cols: number): [number, number][] {
  const neighbors: [number, number][] = [];
  for (const [dr, dc] of DIRS) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
      neighbors.push([nr, nc]);
    }
  }
  return neighbors;
}

export function generateEmptyBoard(rows: number, cols: number): BoardData {
  const board: BoardData = [];
  for (let r = 0; r < rows; r++) {
    const row: CellData[] = [];
    for (let c = 0; c < cols; c++) {
      row.push({ r, c, isMine: false, status: 'hidden', neighborMines: 0 });
    }
    board.push(row);
  }
  return board;
}

/**
 * 极速版逻辑步进器
 */
function findNextStep(
  rows: number,
  cols: number,
  totalMines: number,
  neighborMap: number[][],
  currentStatus: ('hidden' | 'revealed' | 'mine')[]
): { involved: Set<string>; type: 'hint' | 'error' } | null {
  const getIdx = (r: number, c: number) => r * cols + c;
  const getCoords = (idx: number) => [Math.floor(idx / cols), idx % cols];

  // 1. 极速计数逻辑
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = getIdx(r, c);
      if (currentStatus[idx] !== 'revealed' || neighborMap[r][c] <= 0) continue;
      
      const ns = getNeighbors(r, c, rows, cols).map(([nr, nc]) => getIdx(nr, nc));
      const hidden = ns.filter(i => currentStatus[i] === 'hidden');
      const mines = ns.filter(i => currentStatus[i] === 'mine');
      const needed = neighborMap[r][c] - mines.length;

      if (hidden.length > 0 && (needed === hidden.length || needed === 0)) {
        const inv = new Set<string>();
        inv.add(`${r},${c}`);
        hidden.forEach(i => { const [hr, hc] = getCoords(i); inv.add(`${hr},${hc}`); });
        return { involved: inv, type: 'hint' };
      }
    }
  }

  // 2. 重叠集合推导 (2-1等模型)
  const numberedData = [];
  for (let i = 0; i < rows * cols; i++) {
    if (currentStatus[i] === 'revealed' && neighborMap[Math.floor(i / cols)][i % cols] > 0) {
      const ns = getNeighbors(Math.floor(i / cols), i % cols, rows, cols).map(([nr, nc]) => getIdx(nr, nc));
      const hidden = ns.filter(idx => currentStatus[idx] === 'hidden');
      if (hidden.length > 0) {
        const mines = ns.filter(idx => currentStatus[idx] === 'mine');
        numberedData.push({ 
          r: Math.floor(i / cols), c: i % cols, 
          needed: neighborMap[Math.floor(i / cols)][i % cols] - mines.length, 
          hidden: new Set(hidden) 
        });
      }
    }
  }

  for (let i = 0; i < numberedData.length; i++) {
    for (let j = i + 1; j < numberedData.length; j++) {
      const A = numberedData[i]; const B = numberedData[j];
      const onlyA = [...A.hidden].filter(idx => !B.hidden.has(idx));
      const onlyB = [...B.hidden].filter(idx => !A.hidden.has(idx));
      if (onlyA.length === 0 && onlyB.length === 0) continue;

      const diff = A.needed - B.needed;
      if (diff === onlyA.length || -diff === onlyB.length) {
        const inv = new Set<string>();
        inv.add(`${A.r},${A.c}`); inv.add(`${B.r},${B.c}`);
        onlyA.forEach(idx => inv.add(`${Math.floor(idx / cols)},${idx % cols}`));
        onlyB.forEach(idx => inv.add(`${Math.floor(idx / cols)},${idx % cols}`));
        if (inv.size > 2) return { involved: inv, type: 'hint' };
      }
    }
  }

  // 3. 全局剩余雷数
  let foundMines = 0; let totalHidden = 0; const hiddenIdxs = [];
  for (let i = 0; i < rows * cols; i++) {
    if (currentStatus[i] === 'mine') foundMines++;
    else if (currentStatus[i] === 'hidden') { totalHidden++; hiddenIdxs.push(i); }
  }
  if (totalHidden > 0 && (totalMines - foundMines === totalHidden || totalMines - foundMines === 0)) {
    const inv = new Set<string>();
    hiddenIdxs.forEach(i => inv.add(`${Math.floor(i / cols)},${i % cols}`));
    return { involved: inv, type: 'hint' };
  }

  return null;
}

export function generateBoard(rows: number, cols: number, mines: number, firstR: number, firstC: number): BoardData {
  let bestScore = -1;
  let bestBoard: BoardData | null = null;

  for (let attempt = 0; attempt < 200; attempt++) {
    const board = generateEmptyBoard(rows, cols);
    let placed = 0;
    const protectedCells = new Set([`${firstR},${firstC}`]);
    getNeighbors(firstR, firstC, rows, cols).forEach(([nr, nc]) => protectedCells.add(`${nr},${nc}`));

    while (placed < mines) {
      const r = Math.floor(Math.random() * rows); const c = Math.floor(Math.random() * cols);
      if (!board[r][c].isMine && !protectedCells.has(`${r},${c}`)) { board[r][c].isMine = true; placed++; }
    }

    const neighborMap = board.map((row, r) => row.map((cell, c) => 
      cell.isMine ? -1 : getNeighbors(r, c, rows, cols).filter(([nr, nc]) => board[nr][nc].isMine).length
    ));

    const currentStatus: ('hidden' | 'revealed' | 'mine')[] = Array(rows * cols).fill('hidden');
    const q = [[firstR, firstC]];
    while (q.length > 0) {
      const [r, c] = q.shift()!; const idx = r * cols + c;
      if (currentStatus[idx] !== 'hidden') continue;
      currentStatus[idx] = 'revealed';
      if (neighborMap[r][c] === 0) getNeighbors(r, c, rows, cols).forEach(n => q.push(n));
    }

    let steps = 0;
    while (steps < 1000) {
      const next = findNextStep(rows, cols, mines, neighborMap, currentStatus);
      if (!next) break;
      next.involved.forEach(pos => {
        const [r, c] = pos.split(',').map(Number); const idx = r * cols + c;
        if (currentStatus[idx] === 'hidden') {
          if (board[r][c].isMine) currentStatus[idx] = 'mine';
          else {
            const sq = [[r, c]];
            while (sq.length > 0) {
              const [sr, sc] = sq.shift()!; const sidx = sr * cols + sc;
              if (currentStatus[sidx] === 'hidden') {
                currentStatus[sidx] = 'revealed';
                if (neighborMap[sr][sc] === 0) getNeighbors(sr, sc, rows, cols).forEach(n => sq.push(n));
              }
            }
          }
        }
      });
      steps++;
    }

    const revealedCount = currentStatus.filter(s => s === 'revealed').length;
    if (revealedCount === (rows * cols - mines)) {
      board.forEach((row, r) => row.forEach((cell, c) => cell.neighborMines = neighborMap[r][c]));
      return board;
    }

    if (revealedCount > bestScore) {
      bestScore = revealedCount;
      board.forEach((row, r) => row.forEach((cell, c) => cell.neighborMines = neighborMap[r][c]));
      bestBoard = board;
    }
  }
  return bestBoard!;
}

export interface HintResult { involved: Set<string>; type: 'hint' | 'error'; }

export function getHint(board: BoardData, rows: number, cols: number): HintResult | null {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c].status === 'flagged' && !board[r][c].isMine) return { involved: new Set([`${r},${c}`]), type: 'error' };
    }
  }

  const neighborMap = board.map(row => row.map(cell => cell.neighborMines));
  const currentStatus: ('hidden' | 'revealed' | 'mine')[] = Array(rows * cols).fill('hidden');
  
  let totalMines = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c].isMine) totalMines++;
      if (board[r][c].status === 'revealed') {
        const q = [[r, c]];
        while (q.length > 0) {
          const [qr, qc] = q.shift()!; const idx = qr * cols + qc;
          if (currentStatus[idx] === 'hidden') {
            currentStatus[idx] = 'revealed';
            if (neighborMap[qr][qc] === 0) getNeighbors(qr, qc, rows, cols).forEach(n => q.push(n));
          }
        }
      }
      if (board[r][c].status === 'flagged' && board[r][c].isMine) currentStatus[r * cols + c] = 'mine';
    }
  }

  for (let limit = 0; limit < 100; limit++) {
    const next = findNextStep(rows, cols, totalMines, neighborMap, currentStatus);
    if (!next) break;
    let isNew = false;
    for (const pos of next.involved) {
      const [r, c] = pos.split(',').map(Number);
      if (board[r][c].status === 'hidden') { isNew = true; break; }
    }
    if (isNew) return next;
    next.involved.forEach(pos => {
      const [r, c] = pos.split(',').map(Number);
      const idx = r * cols + c;
      if (currentStatus[idx] === 'hidden') {
        if (board[r][c].isMine) currentStatus[idx] = 'mine';
        else {
          const q = [[r, c]];
          while (q.length > 0) {
            const [qr, qc] = q.shift()!; const qidx = qr * cols + qc;
            if (currentStatus[qidx] === 'hidden') {
              currentStatus[qidx] = 'revealed';
              if (neighborMap[qr][qc] === 0) getNeighbors(qr, qc, rows, cols).forEach(n => q.push(n));
            }
          }
        }
      }
    });
  }
  return null;
}
