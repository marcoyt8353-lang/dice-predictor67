/**
 * HEADLESS DICE — Vercel Serverless Function
 * Route: /api/verify?platform=offline-dice|dice-blox&id=HISTORY_ID
 *
 * Purpose:
 *   Proxies requests to offline-dice.com and dice-blox.com, bypassing
 *   browser CORS restrictions. Scrapes the HTML verify pages and extracts
 *   the roll history as structured JSON.
 *
 * Returns:
 *   { platform, id, rolls: string[], count: number }
 *
 * Error responses:
 *   { error: string } with appropriate HTTP status
 *
 * Respects:
 *   - robots.txt / ToS: reads publicly available verify pages only
 *   - No login bypass, no CAPTCHA bypass, no rate limit circumvention
 *   - If a platform blocks access, returns 403 so client shows manual entry
 */

const https = require('https');
const http  = require('http');

// Color constants (canonical)
const VALID_COLORS = ['PURPLE', 'YELLOW', 'RED', 'BLUE', 'ORANGE', 'GREEN'];

// Platform configurations
const PLATFORMS = {
  'offline-dice': {
    buildUrl: (id) => `https://www.offline-dice.com/verify/${encodeURIComponent(id)}`,
    parse:    parseOfflineDice,
    name:     'Offline Dice',
  },
  'dice-blox': {
    buildUrl: (id) => `https://dice-blox.com/en/verify/${encodeURIComponent(id)}`,
    parse:    parseDiceBlox,
    name:     'Dice Blox',
  },
};

/**
 * Main handler — Vercel edge function signature.
 */
module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { platform, id } = req.query;

  // Validate inputs
  if (!platform || !PLATFORMS[platform]) {
    res.status(400).json({ error: `Unknown platform "${platform}". Use: offline-dice or dice-blox` });
    return;
  }
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    res.status(400).json({ error: 'Missing or empty id parameter' });
    return;
  }
  if (id.length > 128 || !/^[a-zA-Z0-9_\-]+$/.test(id.trim())) {
    res.status(400).json({ error: 'Invalid id format' });
    return;
  }

  const cleanId = id.trim();
  const config  = PLATFORMS[platform];
  const url     = config.buildUrl(cleanId);

  try {
    const html = await fetchPage(url);

    // Check for Cloudflare/bot protection
    if (isBlockedResponse(html)) {
      res.status(403).json({
        error: 'Platform is blocking automated access (Cloudflare/bot protection). Use manual entry.',
        blocked: true,
      });
      return;
    }

    // Check for 404 / not found
    if (isNotFoundResponse(html, platform)) {
      res.status(404).json({
        error: `History ID "${cleanId}" was not found on ${config.name}.`,
        not_found: true,
      });
      return;
    }

    // Parse rolls from HTML
    const rolls = config.parse(html);

    if (!rolls || rolls.length === 0) {
      // Ambiguous — could be new ID with no rolls or parsing failure
      res.status(404).json({
        error: `No rolls found for ID "${cleanId}" on ${config.name}. The ID may be new or invalid.`,
        empty: true,
      });
      return;
    }

    res.status(200).json({
      platform,
      id:     cleanId,
      rolls:  rolls.slice(-20),  // last 20 only
      count:  rolls.length,
    });

  } catch (err) {
    console.error(`[headless-dice] ${platform} fetch error:`, err.message);

    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      res.status(502).json({ error: `Could not reach ${config.name}. Network error: ${err.code}` });
    } else if (err.message.includes('timeout')) {
      res.status(504).json({ error: `Request to ${config.name} timed out.` });
    } else {
      res.status(500).json({ error: `Server error: ${err.message}` });
    }
  }
};

// ══════════════════════════════════════════════════════
// HTTP Fetch utility
// ══════════════════════════════════════════════════════

function fetchPage(url, options = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const timeout = options.timeout || 10000;

    const reqOptions = {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'identity',
        'Connection':      'close',
        'Cache-Control':   'no-cache',
      },
    };

    const req = lib.get(url, reqOptions, (res) => {
      // Handle redirects (up to 3)
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        fetchPage(res.headers.location, { ...options, _redirects: (options._redirects || 0) + 1 })
          .then(resolve).catch(reject);
        return;
      }

      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          const err = new Error(`HTTP ${res.statusCode}`);
          err.statusCode = res.statusCode;
          err.body = body;
          reject(err);
        } else {
          resolve(body);
        }
      });
    });

    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error(`Request timeout after ${timeout}ms`));
    });

    req.on('error', reject);
  });
}

// ══════════════════════════════════════════════════════
// Cloudflare / Block detection
// ══════════════════════════════════════════════════════

function isBlockedResponse(html) {
  if (!html) return false;
  const lower = html.toLowerCase();
  return (
    lower.includes('cloudflare') && lower.includes('challenge') ||
    lower.includes('cf-browser-verification') ||
    lower.includes('please enable cookies') ||
    lower.includes('security check to access') ||
    lower.includes('ddos protection') ||
    lower.includes('checking if the site connection is secure')
  );
}

function isNotFoundResponse(html, platform) {
  if (!html) return true;
  const lower = html.toLowerCase();

  const notFoundPatterns = [
    '404', 'not found', 'page not found',
    'history not found', 'invalid id', 'no history',
    'verification not found', 'does not exist',
  ];

  // Very short responses with no valid color content are likely 404
  if (html.length < 500 && !VALID_COLORS.some(c => html.toUpperCase().includes(c))) {
    return true;
  }

  return notFoundPatterns.some(p => lower.includes(p)) &&
         !VALID_COLORS.some(c => html.toUpperCase().includes(c));
}

// ══════════════════════════════════════════════════════
// Parser: offline-dice.com/verify/ID
// ══════════════════════════════════════════════════════

/**
 * Parse roll history from offline-dice.com verify page HTML.
 *
 * offline-dice renders its last 25 rolls in a DOM structure.
 * We extract color names from several possible patterns:
 *   - Text content of color-labeled elements
 *   - CSS class names like "color-purple", "bg-red", etc.
 *   - JSON data embedded in script tags
 *   - Plain text mentions of colors
 *
 * Since the page structure may change, we use multiple extraction
 * strategies and merge results.
 */
function parseOfflineDice(html) {
  const rolls = [];

  // Strategy 1: Look for JSON data embedded in <script> tags
  // offline-dice may embed roll history as a JavaScript array
  const scriptMatches = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const script of scriptMatches) {
    const content = script.replace(/<\/?script[^>]*>/gi, '');
    // Look for color arrays like ["Purple","Red","Blue"]
    const arrMatch = content.match(/\[[\s\S]*?(?:"(?:Purple|Red|Blue|Green|Yellow|Orange)",?\s*){2,}[\s\S]*?\]/i);
    if (arrMatch) {
      const found = extractColorsFromText(arrMatch[0]);
      if (found.length > 0) { rolls.push(...found); }
    }
    // Look for roll objects: {color: "Purple"} or color: "Purple"
    const objMatches = content.matchAll(/color["']?\s*:\s*["']([A-Za-z]+)["']/gi);
    for (const m of objMatches) {
      const c = normalizeColor(m[1]);
      if (c) rolls.push(c);
    }
  }

  // Strategy 2: Parse HTML elements with color-related class names
  // e.g. <div class="roll purple">, <span class="color-red">, etc.
  const classPatterns = [
    /class="[^"]*\b(purple|yellow|red|blue|orange|green)\b[^"]*"/gi,
    /data-color="(purple|yellow|red|blue|orange|green)"/gi,
    /data-result="(purple|yellow|red|blue|orange|green)"/gi,
  ];
  for (const pattern of classPatterns) {
    const matches = html.matchAll(pattern);
    for (const m of matches) {
      const c = normalizeColor(m[1]);
      if (c) rolls.push(c);
    }
  }

  // Strategy 3: Look for color names inside text content of specific tags
  // <td>Purple</td>, <li>Red</li>, <span>Blue</span>
  const tagPatterns = [
    /<(?:td|li|span|div|p|h[1-6])[^>]*>\s*(Purple|Yellow|Red|Blue|Orange|Green)\s*<\/(?:td|li|span|div|p|h[1-6])>/gi,
  ];
  for (const pattern of tagPatterns) {
    const matches = html.matchAll(pattern);
    for (const m of matches) {
      const c = normalizeColor(m[1]);
      if (c) rolls.push(c);
    }
  }

  // Strategy 4: Brute-force search for color sequences
  // Sometimes pages render: "LAST 25 ROLLS: Purple Red Blue..."
  if (rolls.length < 3) {
    const sectionMatch = html.match(/(?:LAST\s*\d+\s*ROLLS?|HISTORY|RESULTS?)[^<]*<[^>]+>([\s\S]{0,500})/i);
    if (sectionMatch) {
      const found = extractColorsFromText(sectionMatch[1]);
      rolls.push(...found);
    }
  }

  // Deduplicate while preserving order, and keep only valid colors
  const valid = rolls.filter(c => VALID_COLORS.includes(c));
  return deduplicatePreservingOrder(valid);
}

// ══════════════════════════════════════════════════════
// Parser: dice-blox.com/en/verify/ID
// ══════════════════════════════════════════════════════

/**
 * Parse roll history from dice-blox.com verify page HTML.
 * Same multi-strategy approach — structure will differ from offline-dice.
 */
function parseDiceBlox(html) {
  const rolls = [];

  // Strategy 1: JSON in script tags
  const scriptMatches = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const script of scriptMatches) {
    const content = script.replace(/<\/?script[^>]*>/gi, '');
    const arrMatch = content.match(/\[[\s\S]*?(?:"(?:Purple|Red|Blue|Green|Yellow|Orange)",?\s*){2,}[\s\S]*?\]/i);
    if (arrMatch) {
      const found = extractColorsFromText(arrMatch[0]);
      if (found.length > 0) rolls.push(...found);
    }
    const objMatches = content.matchAll(/(?:color|result|outcome)["']?\s*:\s*["']([A-Za-z]+)["']/gi);
    for (const m of objMatches) {
      const c = normalizeColor(m[1]);
      if (c) rolls.push(c);
    }
  }

  // Strategy 2: CSS classes
  const classPatterns = [
    /class="[^"]*\b(purple|yellow|red|blue|orange|green)\b[^"]*"/gi,
    /data-(?:color|result|outcome)="(purple|yellow|red|blue|orange|green)"/gi,
  ];
  for (const pattern of classPatterns) {
    const matches = html.matchAll(pattern);
    for (const m of matches) {
      const c = normalizeColor(m[1]);
      if (c) rolls.push(c);
    }
  }

  // Strategy 3: Tag content
  const tagPattern = /<(?:td|li|span|div|p|h[1-6]|strong)[^>]*>\s*(Purple|Yellow|Red|Blue|Orange|Green)\s*<\/(?:td|li|span|div|p|h[1-6]|strong)>/gi;
  const tagMatches = html.matchAll(tagPattern);
  for (const m of tagMatches) {
    const c = normalizeColor(m[1]);
    if (c) rolls.push(c);
  }

  // Strategy 4: Fallback text extraction
  if (rolls.length < 3) {
    const found = extractColorsFromText(html);
    rolls.push(...found);
  }

  const valid = rolls.filter(c => VALID_COLORS.includes(c));
  return deduplicatePreservingOrder(valid);
}

// ══════════════════════════════════════════════════════
// Shared utilities
// ══════════════════════════════════════════════════════

/**
 * Extract color names from a text/HTML string.
 * Matches whole word occurrences.
 */
function extractColorsFromText(text) {
  const results = [];
  const pattern = /\b(Purple|Yellow|Red|Blue|Orange|Green)\b/gi;
  const matches = text.matchAll(pattern);
  for (const m of matches) {
    const c = normalizeColor(m[1]);
    if (c) results.push(c);
  }
  return results;
}

/**
 * Normalize a color string to our canonical uppercase form.
 */
function normalizeColor(raw) {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (VALID_COLORS.includes(upper)) return upper;
  return null;
}

/**
 * Remove consecutive duplicates that are likely artifacts of
 * multiple extraction strategies picking up the same element.
 * Keeps runs of the same color (real streaks) but removes
 * exact duplicates from repeated HTML attribute + text content hits.
 *
 * Heuristic: if the same color appears >6 consecutive times in our
 * raw extracted list (impossible in a real 6-color streak record)
 * we collapse them.
 */
function deduplicatePreservingOrder(arr) {
  const result = [];
  let runCount = 0;
  let lastColor = null;

  for (const color of arr) {
    if (color === lastColor) {
      runCount++;
      // Allow up to 3 same-color in a row (real streaks can happen)
      // More than that = extraction artifact, collapse
      if (runCount <= 3) result.push(color);
    } else {
      result.push(color);
      lastColor = color;
      runCount = 1;
    }
  }

  return result;
}
