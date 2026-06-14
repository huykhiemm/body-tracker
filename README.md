# 💪 Push-Up Tracker

A real-time push-up counter that runs entirely in the browser using **MediaPipe Pose** and your webcam. No backend, no install — just open and go.

## Features

- 🎯 **Real-time pose detection** via MediaPipe Pose Landmarker (Lite model)
- 📊 **Dynamic calibration** — adapts to your body and camera angle automatically
- 🔢 **Rep counter** with flash animation on each counted push-up
- ⏱️ **Session timer** that starts when your camera does
- 📉 **Power bar** showing your depth (0% = up, 100% = chest near floor)
- 🦴 **Skeleton overlay** — white connection lines + blue landmark dots
- 📋 **Activity log** to track your workouts

## How to Use

1. Serve the project with any local HTTP server (required for ES Modules):
   ```bash
   # Node.js (no install needed)
   node -e "require('http').createServer((req,res)=>{const u=require('url').parse(req.url).pathname,f=require('path').join('.',u==='/'?'index.html':u),e=require('path').extname(f),m={'.html':'text/html','.css':'text/css','.js':'application/javascript'}[e]||'text/plain';require('fs').readFile(f,(err,d)=>err?res.writeHead(404)&&res.end():res.writeHead(200,{'Content-Type':m}).end(d))}).listen(3000,()=>console.log('http://localhost:3000'))"

   # Python
   python -m http.server 3000
   ```

2. Open **Chrome or Edge** at `http://localhost:3000`

3. Wait for **"Pose Model Ready"** status (first load downloads ~3MB model)

4. Click **Start Camera** and allow webcam access

5. Get into **push-up / plank position** — the bar will calibrate in the first few reps

6. Do your push-ups — reps are counted automatically!

## How Rep Counting Works

| Phase | Power Bar | Stage |
|-------|-----------|-------|
| Arms straight (up position) | ~0% | `up` |
| Lowering down | rising... | — |
| Chest near floor | >80% | `down` ✅ |
| Pushing back up | falling... | — |
| Arms straight again | <20% | `up` → **+1 rep** 🎉 |

The system uses **dynamic calibration** — it observes your actual min/max shoulder-to-wrist distance and scales within that range. This means it works regardless of camera angle, distance, or body size.

## Tech Stack

- **HTML / CSS / JavaScript** — no framework, no build step
- **MediaPipe Tasks Vision** — pose landmark detection
- **Google Fonts** — Outfit typeface

## Browser Support

Requires a **Chromium-based browser** (Chrome, Edge) for WebGL GPU delegate support.

## Project Structure

```
tracker/
├── index.html   — UI structure
├── style.css    — Dark theme design system
└── script.js    — MediaPipe logic + rep counter
```
