/**
 * HEADLESS DICE — Statistics Engine
 *
 * Analyzes the last N rolls to compute:
 *  - Color frequency & percentage
 *  - Prediction based on recent frequency deviation
 *  - Markov chain state (transition from last roll)
 *  - Shannon entropy (diversity index)
 *  - Streak detection
 *  - Confidence signal levels
 *
 * TRANSPARENCY NOTE:
 *   These dice have an equal 1/6 theoretical probability for each color.
 *   Predictions here are based on OBSERVED frequency deviations in a small
 *   sample (≤20 rolls). They do NOT imply the next roll is truly predictable.
 *   High confidence = stronger deviation from uniform distribution in sample;
 *   it does NOT mean the result is certain. Always communicate this clearly.
 */

const Statistics = (() => {

  const COLORS = ['PURPLE', 'YELLOW', 'RED', 'BLUE', 'ORANGE', 'GREEN'];
  const THEORETICAL_PROB = 1 / 6; // ~16.67% per color (fair die)

  /**
   * Core analysis function.
   *
   * @param {string[]} rolls - Array of color strings (up to 20)
   * @returns {object} Full statistics object
   */
  function analyze(rolls) {
    if (!rolls || rolls.length === 0) {
      return emptyStats();
    }

    const n = rolls.length;
    const valid = rolls.filter(r => COLORS.includes(r));
    if (valid.length === 0) return emptyStats();

    // ── Frequency count ──
    const freq = {};
    COLORS.forEach(c => freq[c] = 0);
    valid.forEach(c => freq[c]++);

    // ── Percentages ──
    const pct = {};
    COLORS.forEach(c => pct[c] = freq[c] / valid.length);

    // ── Sort by frequency desc ──
    const sorted = [...COLORS].sort((a, b) => freq[b] - freq[a]);

    // ── Prediction logic ──
    // We look at two signals:
    //   1. Raw frequency: which color appeared most often?
    //   2. Recency weight: more recent rolls count more
    // We combine them with equal weight and compare to the theoretical uniform.
    //
    // The "confidence" reflects how far the observed distribution deviates
    // from uniform. A perfectly uniform sample yields no signal.

    const weighted = computeWeightedScores(valid);
    const sortedByScore = [...COLORS].sort((a, b) => weighted[b] - weighted[a]);

    const top = sortedByScore[0];
    const topScore = weighted[top];
    const secondColor = sortedByScore[1];
    const secondScore = weighted[secondColor];

    // Normalize score to [0,1] range for display
    const maxPossibleScore = 1.0;
    const normalizedTop = Math.min(topScore / maxPossibleScore, 1);

    // Convert to pseudo-probability: blend observed (70%) + theoretical (30%)
    // This prevents overconfidence on tiny samples and keeps predictions honest.
    const blendedTopPct = (normalizedTop * 0.7) + (THEORETICAL_PROB * 0.3);
    const topPct = blendedTopPct;

    // Signal strength based on deviation from uniform
    const deviation = Math.abs(topPct - THEORETICAL_PROB) / THEORETICAL_PROB;
    let signalLevel, signalText;
    if (deviation < 0.10) {
      signalLevel = 'none';
      signalText  = 'NO CLEAR SIGNAL';
    } else if (deviation < 0.25) {
      signalLevel = 'weak';
      signalText  = 'WEAK SIGNAL';
    } else if (deviation < 0.45) {
      signalLevel = 'moderate';
      signalText  = 'MODERATE SIGNAL';
    } else {
      signalLevel = 'strong';
      signalText  = 'STRONG SIGNAL';
    }

    // ── Markov chain: transition from last roll ──
    const markov = computeMarkov(valid);
    const lastRoll = valid[valid.length - 1];
    const markovPrediction = markov.nextMost(lastRoll);

    // ── Streaks ──
    const streaks = computeStreaks(valid);

    // ── Shannon entropy ──
    const entropy = computeEntropy(pct, valid.length);

    // ── Consecutive run of same color at end ──
    const currentStreak = getCurrentStreak(valid);

    // ── Final prediction display percentage ──
    // This is derived from the OBSERVED sample, not a certainty.
    const displayPct = (topPct * 100).toFixed(1) + '%';
    const secondDisplayPct = ((weighted[secondColor] * 0.7 + THEORETICAL_PROB * 0.3) * 100).toFixed(1) + '%';

    // ── Prediction description ──
    const desc = buildDescription({
      top, topFreq: freq[top], n: valid.length,
      deviation, signalLevel, currentStreak, markovPrediction,
    });

    return {
      rolls: valid,
      n: valid.length,
      freq,
      pct,
      sorted,
      weighted,
      sortedByScore,
      prediction: {
        color:       top,
        displayPct,
        rawPct:      topPct,
        signalLevel,
        signalText,
        description: desc,
      },
      secondary: {
        color:      secondColor,
        displayPct: secondDisplayPct,
      },
      markov: {
        lastRoll,
        prediction: markovPrediction,
        transitions: markov.transitions,
      },
      streaks: {
        all: streaks,
        current: currentStreak,
        maxStreak: Math.max(...Object.values(streaks).map(s => s.max), 0),
      },
      entropy: {
        value: entropy,
        max:   Math.log2(6),
        ratio: entropy / Math.log2(6),
      },
    };
  }

  /**
   * Weighted scoring: older rolls count less.
   * roll at position i (0=oldest, n-1=newest) gets weight (i+1)/n
   */
  function computeWeightedScores(rolls) {
    const n = rolls.length;
    const score = {};
    COLORS.forEach(c => score[c] = 0);

    rolls.forEach((color, i) => {
      const weight = (i + 1) / n;
      score[color] += weight;
    });

    // Normalize to [0,1]
    const total = Object.values(score).reduce((a, b) => a + b, 0);
    if (total > 0) COLORS.forEach(c => score[c] /= total);

    return score;
  }

  /**
   * Simple first-order Markov chain from the roll sequence.
   * Computes transition probabilities: P(next | current).
   */
  function computeMarkov(rolls) {
    const transitions = {};
    COLORS.forEach(from => {
      transitions[from] = {};
      COLORS.forEach(to => transitions[from][to] = 0);
    });

    for (let i = 0; i < rolls.length - 1; i++) {
      transitions[rolls[i]][rolls[i+1]]++;
    }

    // Normalize
    COLORS.forEach(from => {
      const total = Object.values(transitions[from]).reduce((a, b) => a + b, 0);
      if (total > 0) {
        COLORS.forEach(to => transitions[from][to] /= total);
      } else {
        // No transitions from this state: uniform prior
        COLORS.forEach(to => transitions[from][to] = THEORETICAL_PROB);
      }
    });

    function nextMost(color) {
      if (!color || !transitions[color]) return null;
      return COLORS.reduce((best, c) =>
        transitions[color][c] > transitions[color][best] ? c : best
      , COLORS[0]);
    }

    return { transitions, nextMost };
  }

  /**
   * Compute max and last streak for each color.
   */
  function computeStreaks(rolls) {
    const streaks = {};
    COLORS.forEach(c => streaks[c] = { max: 0, current: 0 });

    let prev = null, run = 0;
    for (const color of rolls) {
      if (color === prev) { run++; } else { run = 1; }
      streaks[color].current = (color === rolls[rolls.length - 1]) ? run : 0;
      if (run > streaks[color].max) streaks[color].max = run;
      prev = color;
    }
    return streaks;
  }

  /**
   * Current streak of the last color in the roll list.
   */
  function getCurrentStreak(rolls) {
    if (!rolls.length) return { color: null, count: 0 };
    const last = rolls[rolls.length - 1];
    let count = 0;
    for (let i = rolls.length - 1; i >= 0; i--) {
      if (rolls[i] === last) count++; else break;
    }
    return { color: last, count };
  }

  /**
   * Shannon entropy of the color distribution.
   * Max = log2(6) ≈ 2.585 bits (perfectly uniform)
   */
  function computeEntropy(pct, n) {
    if (n < 2) return 0;
    let h = 0;
    COLORS.forEach(c => {
      const p = pct[c];
      if (p > 0) h -= p * Math.log2(p);
    });
    return h;
  }

  /**
   * Build a human-readable description of the prediction logic.
   */
  function buildDescription({ top, topFreq, n, deviation, signalLevel, currentStreak, markovPrediction }) {
    const parts = [];

    // Sample size caveat
    parts.push(`Based on ${n} roll${n !== 1 ? 's' : ''} analyzed.`);

    // Main signal
    parts.push(`${top} appeared ${topFreq}/${n} times (${((topFreq/n)*100).toFixed(0)}% of sample vs 16.7% expected).`);

    // Deviation
    if (signalLevel === 'none') {
      parts.push('Distribution is near-uniform — no reliable pattern detected in this sample.');
    } else if (signalLevel === 'weak') {
      parts.push('Slight deviation from uniform distribution. Pattern is inconclusive.');
    } else if (signalLevel === 'moderate') {
      parts.push('Moderate frequency bias observed in this sample window.');
    } else {
      parts.push('Strong frequency bias detected. This may indicate a hot streak or sample skew.');
    }

    // Streak
    if (currentStreak.count >= 2) {
      parts.push(`${currentStreak.color} is on a streak of ${currentStreak.count}.`);
    }

    // Markov note
    if (markovPrediction && markovPrediction !== top) {
      parts.push(`Markov chain (based on transitions) suggests ${markovPrediction} as alternate next.`);
    }

    // Disclaimer — always included
    parts.push('⚠ These are statistical patterns in a small sample. Each roll is independently random (CSPRNG).');

    return parts.join(' ');
  }

  /**
   * Empty stats placeholder for initial/no-data state.
   */
  function emptyStats() {
    const freq = {};
    const pct  = {};
    COLORS.forEach(c => { freq[c] = 0; pct[c] = 0; });
    return {
      rolls: [], n: 0, freq, pct,
      sorted: [...COLORS],
      sortedByScore: [...COLORS],
      prediction: {
        color: null, displayPct: '—',
        rawPct: 0, signalLevel: 'none',
        signalText: 'NO DATA', description: 'Load a history to see predictions.',
      },
      secondary: { color: null, displayPct: '—' },
      markov: { lastRoll: null, prediction: null, transitions: {} },
      streaks: { all: {}, current: { color: null, count: 0 }, maxStreak: 0 },
      entropy: { value: 0, max: Math.log2(6), ratio: 0 },
    };
  }

  /**
   * Parse a manual roll string like "PURPLE,RED,BLUE,GREEN,..."
   * Returns array of valid color strings.
   */
  function parseManualInput(text) {
    if (!text) return [];
    return text
      .split(/[\s,;|/\n]+/)
      .map(s => s.trim().toUpperCase())
      .filter(s => COLORS.includes(s));
  }

  return { analyze, parseManualInput, COLORS, THEORETICAL_PROB };
})();
