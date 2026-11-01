/**
 * HEADLESS DICE — Main Application
 *
 * Wires the UI together:
 *   - Verify button → PlatformDetector → Statistics → render
 *   - Manual entry fallback
 *   - Toast messages
 *   - Sound toggle
 *   - Local storage for last ID
 */

;(function() {
  'use strict';

  // ──────────────────────────────────────────────
  // DOM refs
  // ──────────────────────────────────────────────
  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const elInput        = $('#history-id-input');
  const elClearBtn     = $('#clear-input-btn');
  const elBtnVerify    = $('#btn-verify');
  const elVerifyText   = $('#verify-btn-text');
  const elVerifySpinner = $('#verify-spinner');
  const elPlatformBadge = $('#platform-badge');
  const elStatusMsg    = $('#status-msg');
  const elManualPanel  = $('#manual-panel');
  const elManualInput  = $('#manual-input');
  const elBtnManual    = $('#btn-manual-analyze');
  const elDashboard    = $('#dashboard');
  const elLoadingOverlay = $('#loading-overlay');
  const elLoadingText  = $('#loading-text');
  const elLoadingSteps = $('#loading-steps');
  const elToast        = $('#toast');
  const elRollStrip    = $('#roll-strip');
  const elRollCount    = $('#roll-count-badge');
  const elBtnSound     = $('#btn-sound');
  const elBtnDiscord   = $('#btn-discord');
  const elBtnLogout    = $('#btn-logout');

  // ──────────────────────────────────────────────
  // App state
  // ──────────────────────────────────────────────
  let state = {
    soundEnabled: true,
    lastId: '',
    lastResult: null,
    isLoading: false,
  };

  // ──────────────────────────────────────────────
  // Init
  // ──────────────────────────────────────────────
  function init() {
    // Restore last ID from localStorage
    const saved = localStorage.getItem('hd_last_id');
    if (saved) {
      elInput.value = saved;
      showClearBtn();
    }

    // Sound preference
    const savedSound = localStorage.getItem('hd_sound');
    if (savedSound === '0') setSoundEnabled(false);

    // Event listeners
    elBtnVerify.addEventListener('click', handleVerify);
    elInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleVerify(); });
    elInput.addEventListener('input', () => {
      if (elInput.value.trim()) showClearBtn(); else hideClearBtn();
    });
    elClearBtn.addEventListener('click', () => {
      elInput.value = ''; hideClearBtn(); elInput.focus();
    });
    elBtnManual.addEventListener('click', handleManualAnalyze);
    elBtnSound.addEventListener('click', () => setSoundEnabled(!state.soundEnabled));
    elBtnDiscord.addEventListener('click', () => window.open('https://discord.gg/headlessdice', '_blank'));
    elBtnLogout.addEventListener('click', () => { showToast('Logged out.', 'info'); });
  }

  // ──────────────────────────────────────────────
  // Verify handler
  // ──────────────────────────────────────────────
  async function handleVerify() {
    const id = elInput.value.trim();
    if (!id) { showToast('Enter a history ID first.', 'error'); elInput.focus(); return; }
    if (state.isLoading) return;

    state.isLoading = true;
    setVerifyLoading(true);
    showLoading('Detecting platform...');
    hidePlatformBadge();
    clearStatusMsg();
    hideManualPanel();

    // Persist ID
    localStorage.setItem('hd_last_id', id);
    state.lastId = id;

    // Loading steps UI
    const steps = ['Querying Offline Dice...', 'Querying Dice Blox...', 'Processing rolls...'];
    renderLoadingSteps(steps);

    try {
      const result = await PlatformDetector.detect(id, (text, stepState) => {
        updateLoadingStep(text, stepState);
      });

      // Success
      updateLoadingText('Analyzing statistics...');
      const stats = Statistics.analyze(result.rolls);

      state.lastResult = { result, stats };

      hideLoading();
      renderAll(result, stats);
      showPlatformBadge(result.platform);
      setStatusMsg(`${result.rolls.length} rolls loaded`, 'ok');
      showToast(`✓ History loaded from ${formatPlatformName(result.platform)}`, 'success');
      playSound();

    } catch (err) {
      hideLoading();
      handleDetectionError(err, id);
    } finally {
      state.isLoading = false;
      setVerifyLoading(false);
    }
  }

  // ──────────────────────────────────────────────
  // Error handling
  // ──────────────────────────────────────────────
  function handleDetectionError(err, id) {
    const errorClass = PlatformDetector.classifyError(err);
    console.error('[HEADLESS DICE] Detection error:', err);

    if (errorClass === 'blocked') {
      setStatusMsg('Platform blocked automated access — use manual entry below.', 'error');
      showManualPanel();
      showToast('Platform protection detected. Enter rolls manually.', 'error');
    } else if (errorClass === 'not_found') {
      setStatusMsg(`ID "${id}" not found on either platform.`, 'error');
      showToast('ID not found. Check the ID and try again.', 'error');
    } else if (errorClass === 'network') {
      setStatusMsg('Network error — is the Vercel function deployed?', 'error');
      showManualPanel();
      showToast('Network error. You can enter rolls manually.', 'error');
    } else {
      setStatusMsg('Could not retrieve history. Try manual entry below.', 'error');
      showManualPanel();
      showToast('Could not detect platform. Try manual entry.', 'error');
    }

    // Show manual panel always on error so user has a path forward
    showManualPanel();
  }

  // ──────────────────────────────────────────────
  // Manual analyze
  // ──────────────────────────────────────────────
  function handleManualAnalyze() {
    const raw = elManualInput.value.trim();
    if (!raw) { showToast('Enter rolls above first.', 'error'); return; }

    const rolls = Statistics.parseManualInput(raw);
    if (rolls.length === 0) {
      showToast('No valid colors found. Use: PURPLE, RED, BLUE, GREEN, YELLOW, ORANGE', 'error');
      return;
    }
    if (rolls.length < 5) {
      showToast(`Only ${rolls.length} valid rolls. Predictions improve with 10+.`, 'info');
    }

    const stats = Statistics.analyze(rolls);
    const fakeResult = { platform: 'manual', id: state.lastId || 'manual', rolls };
    state.lastResult = { result: fakeResult, stats };

    renderAll(fakeResult, stats);
    showPlatformBadge('manual');
    setStatusMsg(`${rolls.length} rolls entered manually`, 'ok');
    showToast(`Analyzed ${rolls.length} manual rolls.`, 'success');
    playSound();
    hideManualPanel();
  }

  // ──────────────────────────────────────────────
  // Render everything
  // ──────────────────────────────────────────────
  function renderAll(result, stats) {
    renderRollStrip(result.rolls);
    renderPrediction(stats);
    renderBreakdown(stats);
    renderStatCards(stats);
    showDashboard();
  }

  // Roll history strip
  function renderRollStrip(rolls) {
    elRollStrip.innerHTML = '';
    if (!rolls || rolls.length === 0) {
      elRollStrip.innerHTML = '<span style="color:var(--text-muted);font-size:13px">No rolls loaded.</span>';
      elRollCount.textContent = '0';
      return;
    }
    elRollCount.textContent = rolls.length;

    rolls.forEach((color, i) => {
      const chip = document.createElement('div');
      chip.className = `roll-chip chip-${color}`;
      chip.title = `Roll #${i + 1}: ${color}`;
      chip.style.animationDelay = `${i * 0.04}s`;

      const label = document.createElement('span');
      label.textContent = color.slice(0, 2);
      chip.appendChild(label);

      const idx = document.createElement('span');
      idx.className = 'chip-index';
      idx.textContent = i + 1;
      chip.appendChild(idx);

      elRollStrip.appendChild(chip);
    });
  }

  // Prediction card
  function renderPrediction(stats) {
    const p = stats.prediction;
    const s = stats.secondary;

    const dot = $('#pred-dot');
    const name = $('#pred-color-name');
    const pct  = $('#pred-pct');
    const sig  = $('#pred-signal');
    const sigText = $('#pred-signal-text');
    const desc = $('#pred-desc');
    const altEl = $('#pred-alt');

    if (!p.color) {
      dot.className = 'prediction-color-dot';
      dot.style.background = 'var(--text-dim)';
      name.textContent = '—';
      pct.textContent = '—';
      sigText.textContent = 'NO DATA';
      desc.textContent = p.description;
      altEl.style.display = 'none';
      return;
    }

    // Color dot
    dot.className = `prediction-color-dot bg-${p.color} dot-glow-${p.color}`;

    // Color name
    name.className = `prediction-color-name color-${p.color}`;
    name.textContent = p.color;

    // Percentage
    pct.textContent = p.displayPct;

    // Signal
    const sigClass = {
      none: 'signal-none', weak: 'signal-weak',
      moderate: '', strong: '',
    }[p.signalLevel] || '';
    sig.className = `prediction-signal ${sigClass}`;
    sigText.textContent = p.signalText;

    // Description
    desc.textContent = p.description;

    // Alt color
    if (s.color) {
      altEl.style.display = 'block';
      const altDot = $('#alt-dot');
      const altColor = $('#alt-color');
      const altPct   = $('#alt-pct');
      altDot.className = `alt-dot bg-${s.color}`;
      altColor.className = `color-${s.color}`;
      altColor.textContent = s.color;
      altPct.textContent = s.displayPct;
    } else {
      altEl.style.display = 'none';
    }
  }

  // Probability breakdown
  function renderBreakdown(stats) {
    const list = $('#breakdown-list');
    list.innerHTML = '';

    if (!stats.rolls || stats.rolls.length === 0) {
      list.innerHTML = '<div class="breakdown-empty">Load a history to see breakdown.</div>';
      return;
    }

    const sortedColors = stats.sortedByScore;

    sortedColors.forEach((color, i) => {
      const rawPct = stats.pct[color] * 100;
      const displayPct = rawPct.toFixed(1) + '%';
      const barWidth = rawPct;

      const row = document.createElement('div');
      row.className = 'breakdown-row';

      row.innerHTML = `
        <span class="breakdown-name color-${color}">${color}</span>
        <span class="breakdown-dot dot-${color}"></span>
        <div class="breakdown-bar-wrap">
          <div class="breakdown-bar bar-${color}" style="width:0%" data-target="${barWidth}"></div>
        </div>
        <span class="breakdown-pct ${i === 0 ? 'rank-1' : ''}">${displayPct}</span>
      `;

      list.appendChild(row);
    });

    // Animate bars after paint
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        list.querySelectorAll('.breakdown-bar').forEach(bar => {
          const target = parseFloat(bar.dataset.target);
          bar.style.width = target + '%';
        });
      });
    });
  }

  // Stat cards
  function renderStatCards(stats) {
    const p = stats.prediction;
    const markov = stats.markov;
    const entropy = stats.entropy;
    const streaks = stats.streaks;
    const s = stats.secondary;

    // TOP SIGNAL
    $('#stat-top-signal').textContent = p.color || '—';
    $('#stat-top-signal').className = `stat-value color-${p.color || ''}`;
    $('#stat-top-signal-sub').textContent = p.displayPct + ' frequency';

    // HEDGE #2
    $('#stat-hedge').textContent = s.color || '—';
    $('#stat-hedge').className = `stat-value color-${s.color || ''}`;
    $('#stat-hedge-sub').textContent = s.displayPct + ' frequency';

    // MARKOV STATE
    const markovNext = markov.prediction;
    $('#stat-markov').textContent = markovNext || '—';
    $('#stat-markov').className = `stat-value color-${markovNext || ''}`;
    const lastRollTxt = markov.lastRoll ? `from ${markov.lastRoll}` : 'no data';
    $('#stat-markov-sub').textContent = `next (${lastRollTxt})`;

    // ENTROPY
    const entropyPct = (entropy.ratio * 100).toFixed(0);
    $('#stat-entropy').textContent = entropy.value.toFixed(2);
    $('#stat-entropy-sub').textContent = `bits (${entropyPct}% diversity)`;
    const entropyColor = entropy.ratio > 0.85 ? 'var(--c-green)' :
                         entropy.ratio > 0.65 ? 'var(--c-yellow)' : 'var(--c-orange)';
    $('#stat-entropy').style.color = entropyColor;
  }

  // ──────────────────────────────────────────────
  // UI helpers
  // ──────────────────────────────────────────────
  function showDashboard() {
    elDashboard.style.opacity = '1';
    elDashboard.style.pointerEvents = 'auto';
    elDashboard.classList.add('dashboard-visible');
  }

  function setVerifyLoading(on) {
    elBtnVerify.disabled = on;
    elVerifyText.style.display = on ? 'none' : 'block';
    elVerifySpinner.style.display = on ? 'block' : 'none';
  }

  function showLoading(text) {
    elLoadingText.textContent = text || 'Loading...';
    elLoadingSteps.innerHTML = '';
    elLoadingOverlay.style.display = 'flex';
  }

  function hideLoading() {
    elLoadingOverlay.style.display = 'none';
  }

  function updateLoadingText(text) {
    elLoadingText.textContent = text;
  }

  function renderLoadingSteps(steps) {
    elLoadingSteps.innerHTML = steps.map((s, i) =>
      `<div class="loading-step" id="lstep-${i}">${s}</div>`
    ).join('');
  }

  function updateLoadingStep(text, stepState) {
    // Mark current active step as done, set next to active
    const active = elLoadingSteps.querySelector('.step-active');
    if (active) active.classList.replace('step-active', 'step-done');

    if (stepState === 'done') return;

    // Find first pending step and activate it
    const pending = elLoadingSteps.querySelector('.loading-step:not(.step-done):not(.step-active)');
    if (pending) {
      pending.classList.add('step-active');
      pending.textContent = text;
    }
  }

  function showPlatformBadge(platform) {
    elPlatformBadge.style.display = 'inline-block';
    elPlatformBadge.className = 'meta-platform';
    if (platform === 'offline-dice') {
      elPlatformBadge.classList.add('platform-offline');
      elPlatformBadge.textContent = '◉ OFFLINE DICE';
    } else if (platform === 'dice-blox') {
      elPlatformBadge.classList.add('platform-diceblox');
      elPlatformBadge.textContent = '◉ DICE BLOX';
    } else {
      elPlatformBadge.classList.add('platform-manual');
      elPlatformBadge.textContent = '◉ MANUAL';
    }
  }

  function hidePlatformBadge() {
    elPlatformBadge.style.display = 'none';
    elPlatformBadge.textContent = '';
    elPlatformBadge.className = 'meta-platform';
  }

  function setStatusMsg(msg, type) {
    elStatusMsg.textContent = msg;
    elStatusMsg.className = 'meta-status';
    if (type === 'error') elStatusMsg.classList.add('status-error');
    if (type === 'ok')    elStatusMsg.classList.add('status-ok');
  }

  function clearStatusMsg() {
    elStatusMsg.textContent = '';
    elStatusMsg.className = 'meta-status';
  }

  function showManualPanel() { elManualPanel.style.display = 'block'; }
  function hideManualPanel() { elManualPanel.style.display = 'none'; }

  function showClearBtn() { elClearBtn.style.display = 'block'; }
  function hideClearBtn() { elClearBtn.style.display = 'none'; }

  // ──────────────────────────────────────────────
  // Toast
  // ──────────────────────────────────────────────
  let toastTimer;
  function showToast(msg, type = 'info') {
    clearTimeout(toastTimer);
    elToast.textContent = msg;
    elToast.className = `toast toast-${type}`;
    void elToast.offsetWidth; // reflow
    elToast.classList.add('toast-show');
    toastTimer = setTimeout(() => elToast.classList.remove('toast-show'), 3500);
  }

  // ──────────────────────────────────────────────
  // Sound
  // ──────────────────────────────────────────────
  function setSoundEnabled(enabled) {
    state.soundEnabled = enabled;
    localStorage.setItem('hd_sound', enabled ? '1' : '0');
    $('#icon-sound-on').style.display  = enabled ? 'block' : 'none';
    $('#icon-sound-off').style.display = enabled ? 'none'  : 'block';
  }

  function playSound() {
    if (!state.soundEnabled) return;
    try {
      // Tiny beep synthesized via Web Audio API
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.25);
    } catch {
      // Sound not available, ignore silently
    }
  }

  // ──────────────────────────────────────────────
  // Utilities
  // ──────────────────────────────────────────────
  function formatPlatformName(platform) {
    return {
      'offline-dice': 'Offline Dice',
      'dice-blox':    'Dice Blox',
      'manual':       'manual entry',
    }[platform] || platform;
  }

  // Start
  init();
})();
