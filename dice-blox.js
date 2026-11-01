/**
 * HEADLESS DICE — Dice Blox Adapter
 * Platform: dice-blox.com
 *
 * Dice Blox shows roll history at /en/verify/ID.
 * Uses the same proxy backend with platform=dice-blox.
 *
 * Color normalization: dice-blox may use slightly different naming
 * conventions; all are normalized to the 6 canonical colors.
 */

const DiceBloxAdapter = (() => {

  const PLATFORM_ID = 'dice-blox';
  const BASE_URL    = 'https://dice-blox.com/en/verify/';

  const VALID_COLORS = new Set(['PURPLE','YELLOW','RED','BLUE','ORANGE','GREEN']);

  /**
   * Normalize color from dice-blox page output.
   * dice-blox may use different capitalizations or language variants.
   */
  function normalizeColor(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const upper = raw.trim().toUpperCase()
      .replace(/[^A-Z]/g, '');  // strip non-alpha chars

    if (VALID_COLORS.has(upper)) return upper;

    // Extended map for dice-blox specific variants or localized names
    const MAP = {
      'PURPL': 'PURPLE', 'MORAD': 'PURPLE', 'LILA': 'PURPLE', 'VIOLA': 'PURPLE',
      'AMARIL': 'YELLOW', 'GELB': 'YELLOW', 'JAUNE': 'YELLOW',
      'ROJO': 'RED', 'ROT': 'RED', 'ROUGE': 'RED', 'ROSSO': 'RED',
      'AZUL': 'BLUE', 'BLAU': 'BLUE', 'BLEU': 'BLUE', 'BLU': 'BLUE',
      'NARANJ': 'ORANGE', 'ORANJE': 'ORANGE', 'ORANG': 'ORANGE',
      'VERDE': 'GREEN', 'GRUEN': 'GREEN', 'VERT': 'GREEN', 'GRUN': 'GREEN',
    };

    for (const [k, v] of Object.entries(MAP)) {
      if (upper.startsWith(k)) return v;
    }
    return null;
  }

  /**
   * Probe whether an ID exists on dice-blox.
   * Returns true if we get roll data back.
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
   * Fetch and parse the verify page from dice-blox via the proxy.
   *
   * @param {string} id
   * @returns {Promise<{platform: string, id: string, rolls: string[], raw: any}|null>}
   */
  async function fetchVerifyPage(id) {
    const proxyUrl = `/api/verify?platform=dice-blox&id=${encodeURIComponent(id)}`;

    const resp = await fetch(proxyUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      const msg = err.error || `HTTP ${resp.status}`;
      if (resp.status === 404) return null;
      throw new Error(`dice-blox proxy error: ${msg}`);
    }

    const data = await resp.json();

    if (!data || !Array.isArray(data.rolls)) {
      return null;
    }

    const rolls = data.rolls
      .map(normalizeColor)
      .filter(Boolean);

    if (rolls.length === 0) return null;

    return {
      platform: PLATFORM_ID,
      id: String(id),
      rolls: rolls.slice(-20),
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
    if (!result) throw new Error(`No history found for ID "${id}" on Dice Blox.`);
    return result;
  }

  return { probe, getHistory, PLATFORM_ID, normalizeColor };
})();
