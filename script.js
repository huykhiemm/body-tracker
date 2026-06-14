import { FilesetResolver, PoseLandmarker, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

// ==========================================================================
// Section 1 – Dashboard Activity List
// ==========================================================================
let activities = [
    { id: 1, title: 'Code Review & refactoring', time: '10:30 AM', duration: '45 mins' },
    { id: 2, title: 'UI Design iteration',       time: '1:15 PM',  duration: '1.5 hrs'  },
    { id: 3, title: 'Team Sync-up Meeting',       time: '3:00 PM',  duration: '30 mins'  },
];

const activityList   = document.getElementById('activityList');
const addActivityBtn = document.getElementById('addActivityBtn');

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
}

function renderActivities() {
    if (activities.length === 0) {
        activityList.innerHTML = `<div class="activity-item loading"><p>No activities tracked today yet.</p></div>`;
        return;
    }
    activityList.innerHTML = '';
    activities.forEach(a => {
        const el = document.createElement('div');
        el.className = 'activity-item';
        el.innerHTML = `
            <div class="activity-info">
                <span class="activity-title">${escapeHTML(a.title)}</span>
                <span class="activity-time">${escapeHTML(a.time)}</span>
            </div>
            <div class="activity-duration">${escapeHTML(a.duration)}</div>`;
        activityList.appendChild(el);
    });
}

addActivityBtn.addEventListener('click', () => {
    const title = prompt('Enter activity title:');
    if (!title?.trim()) return;
    const duration = prompt('Enter duration (e.g., "1 hr", "45 mins"):') || 'N/A';
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    activities.unshift({ id: Date.now(), title: title.trim(), time, duration: duration.trim() });
    renderActivities();
});

setTimeout(renderActivities, 400);

// ==========================================================================
// Section 2 – DOM References
// ==========================================================================
const webcam          = document.getElementById('webcam');
const canvas          = document.getElementById('pose-overlay');
const ctx             = canvas.getContext('2d');
const startWebcamBtn  = document.getElementById('startWebcamBtn');
const viewportOverlay = document.getElementById('viewportOverlay');
const statusDot       = document.getElementById('statusDot');
const statusText      = document.getElementById('statusText');
const resetStatsBtn   = document.getElementById('resetStatsBtn');

// Tracker UI
const elapsedTimeEl  = document.getElementById('elapsedTime');
const repCountEl     = document.getElementById('repCount');
const powerFillEl    = document.getElementById('powerFill');
const powerThumbEl   = document.getElementById('powerThumb');
const powerPercentEl = document.getElementById('powerPercent');
const repsBadgeEl    = document.querySelector('.reps-badge');

// ==========================================================================
// Section 3 – State Variables
// ==========================================================================
let poseLandmarker   = null;
let webcamRunning    = false;
let lastVideoTime    = -1;
let animationFrameId = null;

// Off-screen canvas fed to MediaPipe — gives it explicit pixel dimensions
const inputCanvas = document.createElement('canvas');
const inputCtx    = inputCanvas.getContext('2d', { willReadFrequently: true });

// Exercise mode
let currentMode = 'pushup'; // 'pushup' | 'plank' | 'bicep'

// Shared push-up / bicep curl state
let pushupCount    = 0;
let stage          = 'up';
let secondsElapsed = 0;
let timerInterval  = null;

// Dynamic calibration (push-up mode)
let minObservedDist = Infinity;
let maxObservedDist = -Infinity;
let smoothedPct     = 0;

// Plank-specific state
let plankActive   = false;
let plankHoldSec  = 0;
let bestPlankSec  = 0;
let plankInterval = null;

// ==========================================================================
// Section 4 – Timer & Tracker Helpers
// ==========================================================================
function startTimer() {
    clearInterval(timerInterval);
    secondsElapsed = 0;
    elapsedTimeEl.textContent = '0s';
    timerInterval = setInterval(() => {
        secondsElapsed++;
        elapsedTimeEl.textContent = `${secondsElapsed}s`;
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
}

function resetTracker() {
    pushupCount     = 0;
    stage           = 'up';
    secondsElapsed  = 0;
    minObservedDist = Infinity;
    maxObservedDist = -Infinity;
    smoothedPct     = 0;

    // Plank state
    clearInterval(plankInterval);
    plankInterval = null;
    plankActive   = false;
    plankHoldSec  = 0;
    bestPlankSec  = 0;

    elapsedTimeEl.textContent  = '0s';
    powerPercentEl.textContent = '0%';
    powerFillEl.style.height   = '0%';
    if (powerThumbEl) powerThumbEl.style.bottom = '0%';

    // Badge label depends on mode
    repCountEl.textContent = currentMode === 'plank' ? '0s hold' : '0 reps';
}

if (resetStatsBtn) {
    resetStatsBtn.addEventListener('click', resetTracker);
}

// ==========================================================================
// Section 5 – Exercise Mode Switcher
// ==========================================================================
function switchMode(mode) {
    currentMode = mode;

    // Update tab styles
    document.querySelectorAll('.exercise-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    resetTracker();
}

document.querySelectorAll('.exercise-btn').forEach(btn => {
    btn.addEventListener('click', () => switchMode(btn.dataset.mode));
});

// ==========================================================================
// Section 6 – MediaPipe Model Initialisation
// ==========================================================================
async function initializePoseModel() {
    try {
        statusText.textContent = 'Loading WASM resolver…';
        const vision = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'
        );

        statusText.textContent = 'Loading Pose model…';
        poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
                delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numPoses: 1,
            outputSegmentationMasks: false,
        });

        statusDot.className    = 'status-dot ready';
        statusText.textContent = 'Pose Model Ready';
    } catch (err) {
        console.error('[Tracker] Model init failed:', err);
        statusText.textContent     = 'Model Error';
        statusDot.style.background = '#ef4444';
        statusDot.style.boxShadow  = '0 0 8px #ef4444';
    }
}

// ==========================================================================
// Section 7 – Camera Control
// ==========================================================================
async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        });
        webcam.srcObject = stream;

        webcam.addEventListener('loadeddata', () => {
            canvas.width  = webcam.videoWidth;
            canvas.height = webcam.videoHeight;

            webcamRunning = true;
            viewportOverlay.classList.add('hidden');
            statusDot.className        = 'status-dot active';
            statusText.textContent     = 'Tracking Active';
            startWebcamBtn.textContent = 'Stop Camera';
            if (resetStatsBtn) resetStatsBtn.style.display = 'block';

            resetTracker();
            startTimer();
            animationFrameId = requestAnimationFrame(predictLoop);
        }, { once: true });
    } catch (err) {
        console.error('[Tracker] Camera error:', err);
        alert('Could not access webcam. Please check your camera permissions.');
    }
}

function stopCamera() {
    webcamRunning = false;
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;

    stopTimer();

    // Stop plank hold timer if active
    clearInterval(plankInterval);
    plankInterval = null;
    plankActive   = false;

    const tracks = webcam.srcObject?.getTracks() ?? [];
    tracks.forEach(t => t.stop());
    webcam.srcObject = null;
    lastVideoTime    = -1;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    powerPercentEl.textContent = '0%';
    powerFillEl.style.height   = '0%';
    if (powerThumbEl) powerThumbEl.style.bottom = '0%';

    viewportOverlay.classList.remove('hidden');
    statusDot.className        = 'status-dot ready';
    statusText.textContent     = 'Pose Model Ready';
    startWebcamBtn.textContent = 'Start Camera';
    if (resetStatsBtn) resetStatsBtn.style.display = 'none';
}

async function handleWebcamToggle() {
    if (!poseLandmarker) {
        alert('Pose model is still loading. Please wait a moment.');
        return;
    }
    webcamRunning ? stopCamera() : await startCamera();
}

// ==========================================================================
// Section 8 – Prediction Loop
// ==========================================================================
function predictLoop() {
    if (!webcamRunning) return;

    const nowMs = performance.now();
    if (webcam.currentTime !== lastVideoTime) {
        lastVideoTime = webcam.currentTime;

        if (inputCanvas.width !== webcam.videoWidth || inputCanvas.height !== webcam.videoHeight) {
            inputCanvas.width  = webcam.videoWidth;
            inputCanvas.height = webcam.videoHeight;
        }

        inputCtx.drawImage(webcam, 0, 0);
        const result = poseLandmarker.detectForVideo(inputCanvas, nowMs);
        onPoseResult(result);
    }

    animationFrameId = requestAnimationFrame(predictLoop);
}

// ==========================================================================
// Section 9 – Utility
// ==========================================================================

// Angle (degrees) at joint B in the triangle A–B–C
function getAngle(a, b, c) {
    const ab = { x: a.x - b.x, y: a.y - b.y };
    const cb = { x: c.x - b.x, y: c.y - b.y };
    const dot = ab.x * cb.x + ab.y * cb.y;
    const mag = Math.sqrt(ab.x ** 2 + ab.y ** 2) * Math.sqrt(cb.x ** 2 + cb.y ** 2);
    if (mag === 0) return 0;
    return Math.acos(Math.max(-1, Math.min(1, dot / mag))) * (180 / Math.PI);
}

function updatePowerBar(display) {
    powerFillEl.style.height          = `${display}%`;
    powerPercentEl.textContent        = `${display}%`;
    if (powerThumbEl) powerThumbEl.style.bottom = `${display}%`;
}

function flashRepBadge() {
    if (!repsBadgeEl) return;
    repsBadgeEl.classList.add('flash-active');
    setTimeout(() => repsBadgeEl.classList.remove('flash-active'), 600);
}

// ==========================================================================
// Section 10 – Exercise Logic
// ==========================================================================

// ── Mode: Push-Up ──────────────────────────────────────────────────────────
function processPushUp(landmarks) {
    const shoulder = landmarks[11];
    const wrist    = landmarks[15];

    if (!shoulder || !wrist) return;

    const distance = Math.abs(shoulder.y - wrist.y);

    if (distance < minObservedDist) minObservedDist = Math.max(0.04, distance);
    if (distance > maxObservedDist) maxObservedDist = distance;

    const range = maxObservedDist - minObservedDist;

    if (range < 0.08) {
        powerPercentEl.textContent = 'Cal…';
        return;
    }

    let pct = ((maxObservedDist - distance) / range) * 100;
    pct = Math.max(0, Math.min(100, pct));

    smoothedPct = smoothedPct * 0.7 + pct * 0.3;
    updatePowerBar(Math.round(smoothedPct));

    if (smoothedPct > 80) {
        stage = 'down';
    } else if (smoothedPct < 20 && stage === 'down') {
        stage = 'up';
        pushupCount++;
        repCountEl.textContent = `${pushupCount} reps`;
        flashRepBadge();
    }
}

// ── Mode: Plank ─────────────────────────────────────────────────────────────
// Detection: shoulder→wrist Y distance stays in a stable mid-range.
// Timer counts continuous seconds held. Best time persists per session reset.
function processPlank(landmarks) {
    const shoulder = landmarks[11];
    const wrist    = landmarks[15];

    if (!shoulder || !wrist) {
        // Lost detection — stop hold
        if (plankActive) {
            plankActive = false;
            clearInterval(plankInterval);
            plankInterval = null;
            repCountEl.textContent = `Best: ${bestPlankSec}s`;
            plankHoldSec = 0;
        }
        return;
    }

    const distance = Math.abs(shoulder.y - wrist.y);

    // Expand calibration range
    if (distance < minObservedDist) minObservedDist = Math.max(0.04, distance);
    if (distance > maxObservedDist) maxObservedDist = distance;

    const range = maxObservedDist - minObservedDist;
    if (range < 0.06) {
        powerPercentEl.textContent = 'Cal…';
        return;
    }

    // High pct = arms extended forward/down = plank form
    let pct = ((distance - minObservedDist) / range) * 100;
    pct = Math.max(0, Math.min(100, pct));
    smoothedPct = smoothedPct * 0.85 + pct * 0.15; // slower smoothing = more stable
    updatePowerBar(Math.round(smoothedPct));

    // In plank when power bar is in a stable mid-to-high range
    const inPosition = smoothedPct > 35 && smoothedPct < 95;

    if (inPosition && !plankActive) {
        plankActive  = true;
        plankHoldSec = 0;
        plankInterval = setInterval(() => {
            plankHoldSec++;
            if (plankHoldSec > bestPlankSec) bestPlankSec = plankHoldSec;
            repCountEl.textContent = `${plankHoldSec}s hold`;
            flashRepBadge();
        }, 1000);
    } else if (!inPosition && plankActive) {
        plankActive = false;
        clearInterval(plankInterval);
        plankInterval = null;
        repCountEl.textContent = `Best: ${bestPlankSec}s`;
        plankHoldSec = 0;
    }
}

// ── Mode: Bicep Curl ────────────────────────────────────────────────────────
// Measures elbow angle (shoulder→elbow→wrist).
// 180° = arm extended (0%) → 0° = fully contracted (100%).
// Rep counted when arm returns to extended after a full contraction.
function processBicepCurl(landmarks) {
    const lShoulder = landmarks[11];
    const lElbow    = landmarks[13];
    const lWrist    = landmarks[15];
    const rShoulder = landmarks[12];
    const rElbow    = landmarks[14];
    const rWrist    = landmarks[16];

    let angle = null;

    // Prefer left arm; fall back to right if left not fully visible
    if (lShoulder && lElbow && lWrist) {
        angle = getAngle(lShoulder, lElbow, lWrist);
    } else if (rShoulder && rElbow && rWrist) {
        angle = getAngle(rShoulder, rElbow, rWrist);
    }

    if (angle === null) return;

    // 180° extended → 0%  |  0° contracted → 100%
    let pct = ((180 - angle) / 180) * 100;
    pct = Math.max(0, Math.min(100, pct));

    smoothedPct = smoothedPct * 0.6 + pct * 0.4;
    updatePowerBar(Math.round(smoothedPct));

    // State machine: count reps on full contraction cycle
    if (smoothedPct > 70) {
        stage = 'down'; // arm contracted (confusingly named "down" for parity)
    } else if (smoothedPct < 15 && stage === 'down') {
        stage = 'up'; // arm back to extended → rep complete
        pushupCount++;
        repCountEl.textContent = `${pushupCount} reps`;
        flashRepBadge();
    }
}

// ==========================================================================
// Section 11 – Draw Skeleton on Canvas
// ==========================================================================
const drawingUtils = new DrawingUtils(ctx);

function onPoseResult(result) {
    if (!webcamRunning) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!result?.landmarks?.length) return;

    for (const landmarks of result.landmarks) {
        // White skeleton connection lines
        drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
            color: '#ffffff',
            lineWidth: 2,
        });

        // Blue landmark dots
        drawingUtils.drawLandmarks(landmarks, {
            color: '#4a90d9',
            fillColor: '#4a90d9',
            radius: 4,
            lineWidth: 1,
        });

        // Dispatch to the active exercise logic
        if (currentMode === 'pushup') processPushUp(landmarks);
        else if (currentMode === 'plank')  processPlank(landmarks);
        else if (currentMode === 'bicep')  processBicepCurl(landmarks);
    }
}

// ==========================================================================
// Boot
// ==========================================================================
initializePoseModel();
startWebcamBtn.addEventListener('click', handleWebcamToggle);
