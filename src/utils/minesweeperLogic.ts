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
      row.push({
        r,
        c,
        isMine: false,
        status: 'hidden',
        neighborMines: 0,
      });
    }
    board.push(row);
  }
  return board;
}

export function generateBoard(rows: number, cols: number, mines: number, firstR: number, firstC: number): BoardData {
  let board = generateEmptyBoard(rows, cols);
  
  // 增加重试次数，因为求解器变强了，我们可以找到更多高质量解
  const MAX_RETRIES = 100;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    board = generateEmptyBoard(rows, cols);
    let minesPlaced = 0;
    
    // 保护起始点及其邻居，确保第一下必定大面积铺开
    const protectedCells = new Set<string>();
    protectedCells.add(`${firstR},${firstC}`);
    for (const [nr, nc] of getNeighbors(firstR, firstC, rows, cols)) {
      protectedCells.add(`${nr},${nc}`);
    }

    while (minesPlaced < mines) {
      const r = Math.floor(Math.random() * rows);
      const c = Math.floor(Math.random() * cols);
      if (!board[r][c].isMine && !protectedCells.has(`${r},${c}`)) {
        board[r][c].isMine = true;
        minesPlaced++;
      }
    }

    // 计算邻居雷数
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!board[r][c].isMine) {
          let count = 0;
          for (const [nr, nc] of getNeighbors(r, c, rows, cols)) {
            if (board[nr][nc].isMine) count++;
          }
          board[r][c].neighborMines = count;
        }
      }
    }
    
    // 使用升级后的求解器验证
    if (isSolvable(board, rows, cols, firstR, firstC, mines)) {
       break;
    }
  }
  
  return board;
}

/**
 * 升级版模拟求解器：
 * 包含基础计数逻辑 + 高级子集缩减逻辑 (Subset Logic)
 */
function isSolvable(board: BoardData, rows: number, cols: number, startR: number, startC: number, totalMines: number): boolean {
  const status: CellStatus[][] = Array(rows).fill(0).map(() => Array(cols).fill('hidden'));
  
  const revealSafe = (r: number, c: number) => {
    if (status[r][c] !== 'hidden') return;
    status[r][c] = 'revealed';
    if (board[r][c].neighborMines === 0 && !board[r][c].isMine) {
      getNeighbors(r, c, rows, cols).forEach(([nr, nc]) => revealSafe(nr, nc));
    }
  };

  revealSafe(startR, startC);

  let changed = true;
  while (changed) {
    changed = false;
    
    // 1. 基础逻辑：初级求解 (Counting)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (status[r][c] !== 'revealed' || board[r][c].isMine || board[r][c].neighborMines === 0) continue;
        
        const neighbors = getNeighbors(r, c, rows, cols);
        const hiddenCells = neighbors.filter(([nr, nc]) => status[nr][nc] === 'hidden');
        const flaggedCount = neighbors.filter(([nr, nc]) => status[nr][nc] === 'flagged').length;
        
        const remainingToFind = board[r][c].neighborMines - flaggedCount;
        
        if (hiddenCells.length > 0) {
          if (remainingToFind === hiddenCells.length) {
            hiddenCells.forEach(([hr, hc]) => { status[hr][hc] = 'flagged'; });
            changed = true;
          } else if (remainingToFind === 0) {
            hiddenCells.forEach(([hr, hc]) => revealSafe(hr, hc));
            changed = true;
          }
        }
      }
    }
    
    if (changed) continue;

    // 2. 高级逻辑：集合缩减 (Subset / Overlap Logic)
    // 识别 1-2-1 等高级模式，处理重叠区域的差值推导
    const numberedCells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (status[r][c] === 'revealed' && board[r][c].neighborMines > 0) {
          const neighbors = getNeighbors(r, c, rows, cols);
          const hidden = neighbors.filter(([nr, nc]) => status[nr][nc] === 'hidden');
          if (hidden.length > 0) {
            const flagged = neighbors.filter(([nr, nc]) => status[nr][nc] === 'flagged');
            numberedCells.push({
              r, c,
              needed: board[r][c].neighborMines - flagged.length,
              hidden: new Set(hidden.map(([hr, hc]) => `${hr},${hc}`))
            });
          }
        }
      }
    }

    for (let i = 0; i < numberedCells.length; i++) {
      for (let j = 0; j < numberedCells.length; j++) {
        if (i === j) continue;
        const A = numberedCells[i];
        const B = numberedCells[j];

        // 检查 A 的隐藏邻居是否是 B 的真子集
        const isSubset = [...A.hidden].every(pos => B.hidden.has(pos));
        if (isSubset && A.hidden.size < B.hidden.size) {
          const diffSize = B.hidden.size - A.hidden.size;
          const diffMines = B.needed - A.needed;

          // 推论 1：如果 B 多出的格子数刚好等于多出的雷数 -> 多出的全是雷
          if (diffSize === diffMines && diffMines > 0) {
            B.hidden.forEach(pos => {
              if (!A.hidden.has(pos)) {
                const [r, c] = pos.split(',').map(Number);
                if (status[r][c] === 'hidden') {
                  status[r][c] = 'flagged';
                  changed = true;
                }
              }
            });
          }
          // 推论 2：如果 B 多出的雷数是 0 -> 多出的全是安全区
          if (diffMines === 0 && diffSize > 0) {
            B.hidden.forEach(pos => {
              if (!A.hidden.has(pos)) {
                const [r, c] = pos.split(',').map(Number);
                if (status[r][c] === 'hidden') {
                  revealSafe(r, c);
                  changed = true;
                }
              }
            });
          }
        }
      }
      if (changed) break;
    }
  }

  // 最终校验：是否所有非雷格均已逻辑翻开
  let revealedSafeCount = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (status[r][c] === 'revealed' && !board[r][c].isMine) {
        revealedSafeCount++;
      }
    }
  }
  
  return revealedSafeCount === (rows * cols - totalMines);
}
