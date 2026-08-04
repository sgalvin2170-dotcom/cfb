// Minimal ridge regression (closed-form), just enough for fitting ~5 highly
// correlated rating-source coefficients against a season of actual margins.
// No numpy equivalent in the JS ecosystem worth pulling in for a 5x5 solve —
// plain Gauss-Jordan elimination is simple and exact at this size.
// The plan calls for ridge or NNLS specifically *because* these sources are
// correlated and unconstrained OLS would be unstable; ridge shrinkage
// handles that without needing the extra complexity of a non-negativity
// constraint solver.

function transpose(A: number[][]): number[][] {
  return A[0].map((_, j) => A.map((row) => row[j]));
}

function matMul(A: number[][], B: number[][]): number[][] {
  const result: number[][] = [];
  for (let i = 0; i < A.length; i++) {
    result.push(new Array(B[0].length).fill(0));
    for (let j = 0; j < B[0].length; j++) {
      let sum = 0;
      for (let k = 0; k < B.length; k++) sum += A[i][k] * B[k][j];
      result[i][j] = sum;
    }
  }
  return result;
}

function matVecMul(A: number[][], v: number[]): number[] {
  return A.map((row) => row.reduce((sum, a, i) => sum + a * v[i], 0));
}

// Gauss-Jordan elimination with partial pivoting. Fine for the tiny (<=6x6)
// matrices this module ever sees.
function invert(A: number[][]): number[][] {
  const n = A.length;
  const aug = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[pivotRow][col])) pivotRow = row;
    }
    if (Math.abs(aug[pivotRow][col]) < 1e-12) {
      throw new Error('Matrix is singular or near-singular — cannot invert (check for duplicate/degenerate features)');
    }
    [aug[col], aug[pivotRow]] = [aug[pivotRow], aug[col]];

    const pivot = aug[col][col];
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = 0; j < 2 * n; j++) aug[row][j] -= factor * aug[col][j];
    }
  }

  return aug.map((row) => row.slice(n));
}

export interface RidgeResult {
  intercept: number;
  coefficients: number[]; // one per input feature column, same order as X's columns
}

// X: one row per sample, one column per feature (no intercept column — added
// internally). y: target values, same length as X. lambda: ridge penalty
// (0 = plain OLS, which is exactly what the plan says NOT to use here given
// how correlated these sources are).
export function ridgeRegression(X: number[][], y: number[], lambda: number): RidgeResult {
  if (X.length !== y.length || X.length === 0) {
    throw new Error('ridgeRegression: X and y must be the same non-zero length');
  }
  const numFeatures = X[0].length;
  const Xb = X.map((row) => [1, ...row]); // intercept column

  const Xt = transpose(Xb);
  const XtX = matMul(Xt, Xb);

  // Regularize every coefficient except the intercept (row/col 0).
  for (let i = 1; i <= numFeatures; i++) XtX[i][i] += lambda;

  const XtXinv = invert(XtX);
  const Xty = matVecMul(Xt, y);
  const beta = matVecMul(XtXinv, Xty);

  return { intercept: beta[0], coefficients: beta.slice(1) };
}
