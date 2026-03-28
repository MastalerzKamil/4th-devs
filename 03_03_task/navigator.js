/**
 * Deterministic reactor navigator.
 *
 * Board: 7 cols × 5 rows (1-indexed in task description, 0-indexed here).
 * Robot is always on the bottom row (row index 4).
 * Each reactor block is 2 cells tall and bounces between the top (rows 0-1)
 * and bottom (rows 3-4) of the board.
 *
 * Blocks move exactly ONE step per command issued (including 'wait').
 * The robot occupies row 4; it is crushed if a block bottom overlaps row 4,
 * i.e. blockTopRow >= 3.
 */

const BLOCK_SIZE = 2;
const BOARD_HEIGHT = 5;
const MAX_TOP = BOARD_HEIGHT - BLOCK_SIZE; // = 3  (rows 3-4 = dangerous)
const ROBOT_ROW = BOARD_HEIGHT - 1;        // = 4

/**
 * Parse the map string into a 2-D grid and extract the robot column index (0-based).
 *
 * Map legend:  P=robot  G=goal  B=block  .=empty
 * Example (initial):
 *   .......
 *   .......
 *   ..B.B..
 *   ..B.B..
 *   P....G.
 */
export function parseMap(mapStr) {
  const rows = mapStr.trim().split('\n').map(r => r.split(''));
  const height = rows.length;
  const width = rows[0].length;

  let robotCol = -1;
  let goalCol = -1;
  // blockTopRow[col] = topmost row index where 'B' appears in that column
  const blockTopRow = {};

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const cell = rows[r][c];
      if (cell === 'P') robotCol = c;
      if (cell === 'G') goalCol = c;
      if (cell === 'B') {
        if (blockTopRow[c] === undefined || r < blockTopRow[c]) {
          blockTopRow[c] = r;
        }
      }
    }
  }

  return { rows, height, width, robotCol, goalCol, blockTopRow };
}

/**
 * Simulate one block-movement step.
 * Returns the new topRow for the given block, and the new direction.
 *
 * @param {number} topRow   current top row index (0-based)
 * @param {string} dir      'up' | 'down'
 */
function stepBlock(topRow, dir) {
  let next = topRow + (dir === 'down' ? 1 : -1);
  if (next > MAX_TOP) {
    // Bounce off bottom: overshoot means we reverse and move up
    next = MAX_TOP - 1;
    dir = 'up';
  } else if (next < 0) {
    // Bounce off top
    next = 1;
    dir = 'down';
  } else {
    if (next === MAX_TOP) dir = 'up';   // will reverse next step
    if (next === 0) dir = 'down';        // will reverse next step
  }
  return { topRow: next, dir };
}

/**
 * Is a block's top-row safe for the robot (won't occupy robot row)?
 * Safe = block bottom (topRow + BLOCK_SIZE - 1) < ROBOT_ROW
 *       i.e. topRow + 1 < 4  →  topRow < 3  →  topRow <= 2
 */
function isSafeTopRow(topRow) {
  return topRow + BLOCK_SIZE - 1 < ROBOT_ROW; // topRow <= 2
}

/**
 * Predict the top-row and direction of a block after `steps` moves.
 */
export function predictBlock(topRow, dir, steps) {
  let t = topRow;
  let d = dir;
  for (let i = 0; i < steps; i++) {
    const res = stepBlock(t, d);
    t = res.topRow;
    d = res.dir;
  }
  return { topRow: t, dir: d };
}

/**
 * Determine whether a given column is safe for the robot after `stepsAhead` moves.
 *
 * @param {number}  col
 * @param {object}  blockTopRow  current blockTopRow map
 * @param {object}  blockDir     current direction map (col → 'up'|'down')
 * @param {number}  stepsAhead
 */
export function isColSafe(col, blockTopRow, blockDir, stepsAhead = 0) {
  if (blockTopRow[col] === undefined) return true; // no block in this column

  if (stepsAhead === 0) {
    return isSafeTopRow(blockTopRow[col]);
  }

  const dir = blockDir[col] || 'down'; // assume moving down if unknown (conservative)
  const { topRow } = predictBlock(blockTopRow[col], dir, stepsAhead);
  return isSafeTopRow(topRow);
}

/**
 * Decide the next command for the robot.
 *
 * Strategy (as specified in the task):
 *  1. Move right if the next column is safe now AND after blocks move one step.
 *  2. Wait if we can't move right but current column stays safe after one step.
 *  3. Move left if waiting is also dangerous (block about to crush us).
 *
 * @param {number} robotCol
 * @param {number} goalCol
 * @param {object} blockTopRow
 * @param {object} blockDir
 * @returns {string}  'right' | 'wait' | 'left' | 'done'
 */
export function decideCommand(robotCol, goalCol, blockTopRow, blockDir) {
  if (robotCol === goalCol) return 'done';

  const nextCol = robotCol + 1;

  // Check next column: must be safe after blocks take their step with the 'right' command
  const nextSafeAfterMove = isColSafe(nextCol, blockTopRow, blockDir, 1);

  if (nextSafeAfterMove) {
    return 'right';
  }

  // Can't move right — check if we can wait in the current column
  // After 'wait', blocks move 1 step
  const currentSafeAfterWait = isColSafe(robotCol, blockTopRow, blockDir, 1);

  if (currentSafeAfterWait) {
    return 'wait';
  }

  // Both right and wait are dangerous — retreat left
  return 'left';
}

/**
 * Update the block direction map by comparing previous and current top rows.
 *
 * @param {object} prevTopRow   blockTopRow from the previous step
 * @param {object} currTopRow   blockTopRow from the current step
 * @param {object} dirMap       mutable direction map to update in place
 */
export function updateBlockDirs(prevTopRow, currTopRow, dirMap) {
  for (const col in currTopRow) {
    const prev = prevTopRow[col];
    const curr = currTopRow[col];
    if (prev !== undefined && curr !== undefined && prev !== curr) {
      dirMap[col] = curr > prev ? 'down' : 'up';
    }
  }
}
