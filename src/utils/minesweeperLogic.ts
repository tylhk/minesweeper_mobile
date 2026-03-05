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
  
  // We want to retry generating until we find a solvable one, or max retries reached.
  // For a pure 'no-guess', we should use a solver. For simplicity, we ensure first click is a 0.
  const MAX_RETRIES = 50;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    board = generateEmptyBoard(rows, cols);
    let minesPlaced = 0;
    
    // Protect first click and its neighbors
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

    // Calculate neighbors
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
    
    // Attempt to solve it to guarantee no-guess.
    if (isSolvable(board, rows, cols, firstR, firstC, mines)) {
       break; // Found a no-guess board!
    }
  }
  
  // We will reveal the first click (and cascade)
  return board;
}

// A simple solver to check if the board is no-guess
function isSolvable(board: BoardData, rows: number, cols: number, startR: number, startC: number, totalMines: number): boolean {
  // Clone board state for solving
  const status: CellStatus[][] = Array(rows).fill(0).map(() => Array(cols).fill('hidden'));
  
  // Reveal start
  const queue: [number, number][] = [[startR, startC]];
  status[startR][startC] = 'revealed';
  
  while (queue.length > 0) {
    const [r, c] = queue.shift()!;
    if (board[r][c].neighborMines === 0 && !board[r][c].isMine) {
      for (const [nr, nc] of getNeighbors(r, c, rows, cols)) {
        if (status[nr][nc] === 'hidden') {
          status[nr][nc] = 'revealed';
          queue.push([nr, nc]);
        }
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    
    // Simple logic:
    // 1. If hidden neighbors == remaining mines for a cell, all hidden are mines (flag them)
    // 2. If flagged neighbors == neighborMines, all other hidden are safe (reveal them)
    
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (status[r][c] !== 'revealed' || board[r][c].isMine) continue;
        
        let hidden = 0;
        let flagged = 0;
        const hiddenCells: [number, number][] = [];
        
        for (const [nr, nc] of getNeighbors(r, c, rows, cols)) {
          if (status[nr][nc] === 'hidden') {
            hidden++;
            hiddenCells.push([nr, nc]);
          } else if (status[nr][nc] === 'flagged') {
            flagged++;
          }
        }
        
        const remainingToFind = board[r][c].neighborMines - flagged;
        
        if (hidden > 0 && remainingToFind === hidden) {
          // All hidden are mines
          for (const [hr, hc] of hiddenCells) {
            status[hr][hc] = 'flagged';
            changed = true;
          }
        } else if (hidden > 0 && remainingToFind === 0) {
          // All hidden are safe
          for (const [hr, hc] of hiddenCells) {
            status[hr][hc] = 'revealed';
            changed = true;
            if (board[hr][hc].neighborMines === 0) {
                // If we reveal a 0, we need to cascade it immediately
                // Simple way: just add it to a queue and cascade
                const q: [number, number][] = [[hr, hc]];
                while(q.length > 0) {
                    const [qr, qc] = q.shift()!;
                    for (const [nr, nc] of getNeighbors(qr, qc, rows, cols)) {
                        if (status[nr][nc] === 'hidden') {
                            status[nr][nc] = 'revealed';
                            changed = true;
                            if (board[nr][nc].neighborMines === 0) {
                                q.push([nr, nc]);
                            }
                        }
                    }
                }
            }
          }
        }
      }
    }
    
    // Advanced logic (Subset patterns - optional, but helps find more solvable boards)
    // We can implement 1-2 pattern checking here if basic logic gets stuck.
    // For now, simple logic is a good start. 
  }

  // Check if solved
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
