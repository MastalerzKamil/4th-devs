/**
 * Rotate a cell's connections 90° clockwise, `times` times.
 */
function rotateConnections(cell, times) {
  let c = { ...cell };
  for (let i = 0; i < times % 4; i++) {
    c = { top: c.left, right: c.top, bottom: c.right, left: c.bottom };
  }
  return c;
}

/**
 * BFS connectivity check: source at (2,0) left must reach all required right exits.
 */
function checkConnectivity(grid, boundaryRight) {
  const visited = Array.from({ length: 3 }, () => Array(3).fill(false));

  const queue = [[2, 0]];
  visited[2][0] = true;

  while (queue.length) {
    const [r, c] = queue.shift();
    const cell = grid[r][c];
    if (!cell) continue;

    const dirs = [
      { dr: -1, dc: 0, from: "top", to: "bottom" },
      { dr: 1, dc: 0, from: "bottom", to: "top" },
      { dr: 0, dc: -1, from: "left", to: "right" },
      { dr: 0, dc: 1, from: "right", to: "left" },
    ];

    for (const { dr, dc, from, to } of dirs) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= 3 || nc < 0 || nc >= 3) continue;
      if (visited[nr][nc]) continue;
      if (cell[from] === 1 && grid[nr][nc]?.[to] === 1) {
        visited[nr][nc] = true;
        queue.push([nr, nc]);
      }
    }
  }

  // All right-side plants must be reachable
  for (let r = 0; r < 3; r++) {
    if (boundaryRight[r]) {
      if (!visited[r][2] || grid[r][2]?.right !== 1) return false;
    }
  }

  return true;
}

/**
 * Solve the puzzle using backtracking with boundary constraints.
 *
 * @param {Object[][]} cellTypes - 3x3 array of {top,right,bottom,left} (0|1)
 * @returns {{ rotations: number[], grid: Object[][] } | null}
 */
export function solvePuzzle(cellTypes) {
  // Try multiple boundary configurations
  const configs = [
    { left: [true, true, true],  right: [true, true, true], top: [false, false, false], bottom: [false, false, false], name: "all-left, all-right" },
    { left: [false, false, true], right: [true, true, true], top: [false, false, false], bottom: [false, false, false], name: "source-only, all-right" },
    { left: [null, null, true],  right: [true, true, true], top: [false, false, false], bottom: [false, false, false], name: "relaxed-left, all-right" },
    { left: [null, null, true],  right: [true, true, true], top: [null, null, null],    bottom: [null, null, null],    name: "relaxed-boundaries" },
  ];

  for (const cfg of configs) {
    const result = solveWithBoundary(cellTypes, cfg);
    if (result) {
      return { ...result, boundaryConfig: cfg.name };
    }
  }

  return null;
}

function solveWithBoundary(cellTypes, { left: bL, right: bR, top: bT, bottom: bB }) {
  const grid = [[], [], []];
  const rotations = new Array(9).fill(0);

  function backtrack(idx) {
    if (idx === 9) {
      if (!grid[2][0] || grid[2][0].left !== 1) return false;
      return checkConnectivity(grid, bR);
    }

    const row = Math.floor(idx / 3);
    const col = idx % 3;

    for (let rot = 0; rot < 4; rot++) {
      const cell = rotateConnections(cellTypes[row][col], rot);

      // Boundary constraints
      if (row === 0 && bT[col] !== null && cell.top !== (bT[col] ? 1 : 0)) continue;
      if (row === 2 && bB[col] !== null && cell.bottom !== (bB[col] ? 1 : 0)) continue;
      if (col === 0 && bL[row] !== null && cell.left !== (bL[row] ? 1 : 0)) continue;
      if (col === 2 && bR[row] !== null && cell.right !== (bR[row] ? 1 : 0)) continue;

      // Adjacency with already-placed cells
      if (row > 0 && grid[row - 1][col] && cell.top !== grid[row - 1][col].bottom) continue;
      if (col > 0 && grid[row][col - 1] && cell.left !== grid[row][col - 1].right) continue;

      grid[row][col] = cell;
      rotations[idx] = rot;
      if (backtrack(idx + 1)) return true;
      grid[row][col] = null;
    }

    return false;
  }

  if (backtrack(0)) {
    // Deep copy the grid
    const solvedGrid = grid.map(row => row.map(cell => ({ ...cell })));
    return { rotations: [...rotations], grid: solvedGrid };
  }

  return null;
}
