/**
 * HEADLESS DICE — Platform Detector
 *
 * Auto-detects which platform (offline-dice or dice-blox) an ID belongs to,
 * then fetches roll history from that platform.
 *
 * Strategy:
 *   1. Try to detect platform from ID format (if any patterns are identifiable)
 *   2. Race both platforms in parallel (each independently)
 *   3. Return the first successful match
 *   4. If both fail, surface specific errors so the user can enter manually
 *
 * Architecture: Independent adapters — if one throws, the other still resolves.
 */

const PlatformDetector = (() => {

  // All registered adapters in priority order
  const ADAPTERS = [OfflineDiceAdapter, DiceBloxAdapter];

  /**
   * Detect platform and fetch rolls for a given history ID.
   *
   * Calls both adapters in parallel and returns whichever responds first
   * with valid data. If both fail, throws an aggregated error.
   *
   * @param {string} id - The history ID entered by the user
   * @param {function} [onStep] - Optional progress callback(stepText, stepState)
   * @returns {Promise<{platform: string, id: string, rolls: string[]}>}
   */
  async function detect(id, onStep = () => {}) {

    onStep('Querying Offline Dice...', 'active');
    onStep('Querying Dice Blox...', 'active');

    /**
     * Wrap each adapter's getHistory call so:
     *   - Success → resolve with data (includes platform tag)
     *   - Failure → resolve with null + error (never rejects the race)
     */
    const attempts = ADAPTERS.map(async (adapter) => {
      try {
        const result = await adapter.getHistory(id);
        if (result && result.rolls && result.rolls.length > 0) {
          return { success: true, data: result, adapter };
        }
        return { success: false, error: `No rolls found`, adapter };
      } catch (err) {
        return { success: false, error: err.message || String(err), adapter };
      }
    });

    // Race — collect results as they settle
    let firstSuccess = null;
    const errors = [];

    // Use Promise.allSettled equivalent but short-circuit on first success
    await new Promise((resolve) => {
      let remaining = attempts.length;

      attempts.forEach((p, i) => {
        p.then((result) => {
          if (result.success && !firstSuccess) {
            firstSuccess = result;
            resolve(); // short-circuit
          } else {
            if (!result.success) {
              errors.push({ adapter: ADAPTERS[i].PLATFORM_ID, error: result.error });
            }
          }
          remaining--;
          if (remaining === 0) resolve(); // all done
        });
      });
    });

    if (firstSuccess) {
      const platformName = firstSuccess.adapter.PLATFORM_ID;
      onStep(`✓ Detected: ${platformName}`, 'done');
      onStep(`✓ ${firstSuccess.data.rolls.length} rolls loaded`, 'done');
      return firstSuccess.data;
    }

    // Both failed — build a helpful error
    const errorSummary = errors.map(e => `${e.adapter}: ${e.error}`).join(' | ');
    throw new DetectionError(
      `Could not retrieve history from either platform. ${errorSummary}`,
      errors
    );
  }

  /**
   * Structured error with per-platform details.
   */
  class DetectionError extends Error {
    constructor(message, platformErrors = []) {
      super(message);
      this.name = 'DetectionError';
      this.platformErrors = platformErrors;
    }
  }

  /**
   * Classify the error to decide whether to show the manual entry panel.
   * - CORS / network → proxy issue, not user's fault
   * - 404 → ID not found on either platform
   * - Cloudflare/bot protection → requires manual entry
   */
  function classifyError(err) {
    if (!(err instanceof DetectionError)) return 'unknown';
    const allMessages = err.platformErrors.map(e => e.error.toLowerCase()).join(' ');

    if (allMessages.includes('cloudflare') || allMessages.includes('captcha') ||
        allMessages.includes('blocked') || allMessages.includes('403')) {
      return 'blocked';
    }
    if (allMessages.includes('404') || allMessages.includes('not found') ||
        allMessages.includes('no history') || allMessages.includes('no rolls')) {
      return 'not_found';
    }
    if (allMessages.includes('network') || allMessages.includes('failed to fetch') ||
        allMessages.includes('cors') || allMessages.includes('502') || allMessages.includes('503')) {
      return 'network';
    }
    return 'unknown';
  }

  return { detect, classifyError, DetectionError };
})();
