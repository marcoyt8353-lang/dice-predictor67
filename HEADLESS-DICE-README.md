# HEADLESS DICE — Deployment Guide

## Project Structure
```
HEADLESS-DICE/
├── index.html          ← Main page
├── package.json        ← Node dependencies
├── vercel.json         ← Vercel routing config
├── api/
│   └── verify.js       ← Serverless proxy (Node.js)
├── js/
│   ├── app.js          ← Main application controller
│   ├── detector.js     ← Auto-detection engine
│   ├── statistics.js   ← Analysis & prediction engine
│   └── adapters/
│       ├── offline-dice.js  ← Offline Dice adapter
│       └── dice-blox.js     ← Dice Blox adapter
└── css/
    └── style.css       ← Dark gaming stylesheet
```

## Deploy to Vercel (5 steps)

1. **Create a GitHub repo** and push all project files
2. **Go to vercel.com** → New Project → Import your repo
3. **Framework Preset**: Other (Static Site)
4. **Root Directory**: leave as `/`
5. **Click Deploy** — done!

The `api/verify.js` function auto-deploys as a Vercel Serverless Function.
The `index.html + css + js` deploy as static files.

## Local Development

```bash
npm install
npm run dev
# Opens at http://localhost:3000
```

## How It Works

### Platform Detection
1. User enters a history ID
2. Both adapters query `/api/verify?platform=X&id=Y` in parallel
3. First to return valid rolls wins → `OfflineDiceAdapter` or `DiceBloxAdapter`
4. If both fail → shows error with manual entry option

### Backend Proxy (`api/verify.js`)
- Fetches `offline-dice.com/verify/ID` or `dice-blox.com/en/verify/ID` server-side
- Bypasses browser CORS restrictions (legal — reads public pages)
- Extracts color rolls from HTML using 4 parsing strategies
- Returns `{ platform, id, rolls: string[] }` as JSON

### Statistics Engine
- **Frequency analysis**: counts each color in last 20 rolls
- **Weighted scoring**: recent rolls count more (recency bias)
- **Prediction**: blended score — 70% observed + 30% theoretical (1/6)
- **Markov chain**: P(next | last) from transition matrix
- **Entropy**: Shannon entropy as diversity metric (max = log₂6 ≈ 2.585 bits)
- **Confidence signal**: deviation from uniform distribution

### Manual Entry Fallback
If a platform blocks access or an ID isn't found, users can paste rolls:
```
PURPLE,RED,BLUE,GREEN,YELLOW,ORANGE,...
```
The same analysis engine processes both scraped and manual data identically.

## Statistics — What the Numbers Mean

| Metric | Explanation |
|--------|-------------|
| Predicted color | Color with highest weighted frequency in sample |
| Percentage | 70% observed + 30% theoretical. NOT a true probability |
| Strong Signal | >45% deviation from uniform distribution |
| Markov State | Most likely next color based on transition from last roll |
| Entropy | Higher = more diverse distribution (closer to fair) |

**⚠ Important**: offline-dice.com and dice-blox.com use CSPRNG — results are truly random. Predictions here reflect observed sample patterns only.

## Extending

### Add a new platform
1. Create `js/adapters/new-platform.js` following the `OfflineDiceAdapter` interface
2. Add to `ADAPTERS` array in `js/detector.js`
3. Add a parser function in `api/verify.js`
4. Add to the `PLATFORMS` map in `api/verify.js`

### Customize color palette
Edit the hex values in `css/style.css` under `:root`
