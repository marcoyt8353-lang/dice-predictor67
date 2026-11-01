/**
 * HEADLESS DICE — Offline Dice Adapter
 * Platform: offline-dice.com
 *
 * Offline Dice shows roll history at /verify/ID as an HTML page.
 * Since the browser can't fetch cross-origin HTML directly, we proxy
 * through our Vercel serverless function at /api/verify.
 *
 * Color normalization: offline-dice uses Red/Orange/Yellow/Green/Blue/Purple
 * which matches our canonical palette exactly.
 */

const OfflineDiceAdapter = (() => {

  const PLATFORM_ID = 'offline-dice';
  const BASE_URL    = 'https://www.offline-dice.com/verify/';

  /**
   * Canonical color names this platform uses.
   * Must match offline-dice.com output exactly (case-insensitive match applied).
   */
  const VALID_COLORS = new Set(['PURPLE','YELLOW','RED','BLUE','ORANGE','GREEN']);

  /**
   * Normalize a raw color string from the page to canonical uppercase.
   * offline-dice uses "Purple", "Red", "Blue", "Green", "Yellow", "Orange".
   */
  function normalizeColor(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const upper = raw.trim().toUpperCase();
    if (VALID_COLORS.has(upper)) return upper;

    // Fuzzy matching for slight variations
    const MAP = {
      'PURPL': 'PURPLE', 'MORADO': 'PURPLE', 'VIOLETA': 'PURPLE',
      'AMARILLO': 'YELLOW', 'JAUNE': 'YELLOW',
      'ROJO': 'RED', 'ROUGE': 'RED',
      'AZUL': 'BLUE', 'BLEU': 'BLUE',
      'NARANJA': 'ORANGE', 'ORANGE': 'ORANGE',
      'VERDE': 'GREEN', 'VERT': 'GREEN',
    };
    for (const [k, v] of Object.entries(MAP)) {
      if (upper.startsWith(k)) return v;
    }
    return null;
  }

  /**
   * Try to detect if an ID belongs to offline-dice by fetching its verify page.
   * Returns true if the page loads and contains recognizable roll data.
   *
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async function probe(id) {
    try {
      const result = await fetchVerifyPage(id);
      return result !== null && result.rolls.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Fetch the verify page for a given ID via the backend proxy.
   *
   * @param {string} id
   * @returns {Promise<{platform: string, id: string, rolls: string[], raw: any}>}
   */
  async function fetchVerifyPage(id) {
    const proxyUrl = `/api/verify?platform=offline-dice&id=${encodeURIComponent(id)}`;

    const resp = await fetch(proxyUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      const msg = err.error || `HTTP ${resp.status}`;
      // Distinguish "not found" from "server error"
      if (resp.status === 404) return null; // ID doesn't exist on this platform
      throw new Error(`offline-dice proxy error: ${msg}`);
    }

    const data = await resp.json();

    if (!data || !Array.isArray(data.rolls)) {
      return null;
    }

    // Normalize colors
    const rolls = data.rolls
      .map(normalizeColor)
      .filter(Boolean);

    if (rolls.length === 0) return null;

    return {
      platform: PLATFORM_ID,
      id: String(id),
      rolls: rolls.slice(-20),  // keep last 20
      raw: data,
    };
  }

  /**
   * Main public method: fetch roll history for a given ID.
   *
   * @param {string} id
   * @returns {Promise<{platform: string, id: string, rolls: string[]}>}
   */
  async function getHistory(id) {
    const result = await fetchVerifyPage(id);
    if (!result) throw new Error(`No history found for ID "${id}" on Offline Dice.`);
    return result;
  }

  return { probe, getHistory, PLATFORM_ID, normalizeColor };
})();
