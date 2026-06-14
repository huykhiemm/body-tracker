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

// Tracker UI — cache all references once at module level
const elapsedTimeEl  = document.getElementById('elapsedTime');
const repCountEl     = document.getElementById('repCount');
const powerFillEl    = document.getElementById('powerFill');
const powerThumbEl   = document.getElementById('powerThumb');
const powerPercentEl = document.getElementById('powerPercent');
const repsBadgeEl    = document.querySelector('.reps-badge'); // cached — used on every rep

// ==========================================================================
// Section 3 – State Variables
// ==========================================================================
let poseLandmarker   = null;
let webcamRunning    = false;
let lastVideoTime    = -1;
let animationFrameId = null;

// Off-screen canvas fed to MediaPipe — gives it explicit pixel dimensions
// so NORM_RECT projection works correctly on non-square (4:3) video.
const inputCanvas = document.createElement('canvas');
const inputCtx    = inputCanvas.getContext('2d', { willReadFrequently: true });

// Push-up state
let pushupCount    = 0;
let stage          = 'up';   // 'up' | 'down'
let secondsElapsed = 0;
let timerInterval  = null;

// Dynamic calibration — self-adjusts to each user's actual movement range
let minObservedDist = Infinity;   // smallest shoulder→wrist Y distance seen ("down")
let maxObservedDist = -Infinity;  // largest  shoulder→wrist Y distance seen ("up")
let smoothedPct     = 0;          // exponentially-smoothed bar percentage

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

    elapsedTimeEl.textContent  = '0s';
    repCountEl.textContent     = '0 reps';
    powerPercentEl.textContent = '0%';
    powerFillEl.style.height   = '0%';
    if (powerThumbEl) powerThumbEl.style.bottom = '0%';
}

if (resetStatsBtn) {
    resetStatsBtn.addEventListener('click', resetTracker);
}

// ==========================================================================
// Section 5 – MediaPipe Model Initialisation
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
            runningMode: 'VIDEO', // synchronous — result returned directly from detectForVideo
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
// Section 6 – Camera Control
// ==========================================================================
async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        });
        webcam.srcObject = stream;

        // {once:true} prevents listener accumulation on repeated stop/start cycles.
        // Canvas is sized here — loadeddata guarantees videoWidth/Height are non-zero.
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

    const tracks = webcam.srcObject?.getTracks() ?? [];
    tracks.forEach(t => t.stop());
    webcam.srcObject = null;
    lastVideoTime    = -1;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Reset power bar to neutral state
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
// Section 7 – Prediction Loop
// ==========================================================================
function predictLoop() {
    if (!webcamRunning) return;

    const nowMs = performance.now();
    if (webcam.currentTime !== lastVideoTime) {
        lastVideoTime = webcam.currentTime;

        // Keep input canvas in sync with video dimensions
        if (inputCanvas.width !== webcam.videoWidth || inputCanvas.height !== webcam.videoHeight) {
            inputCanvas.width  = webcam.videoWidth;
            inputCanvas.height = webcam.videoHeight;
        }

        // Draw video frame to off-screen canvas — gives MediaPipe explicit pixel dimensions,
        // fixing the NORM_RECT projection issue on non-square (4:3) video.
        inputCtx.drawImage(webcam, 0, 0);

        // VIDEO mode returns result synchronously — no async callback needed
        const result = poseLandmarker.detectForVideo(inputCanvas, nowMs);
        onPoseResult(result);
    }

    animationFrameId = requestAnimationFrame(predictLoop);
}

// ==========================================================================
// Section 8 – Power Bar & Rep Counting
// ==========================================================================
function processPushUp(landmarks) {
    const shoulder = landmarks[11]; // Left Shoulder
    const wrist    = landmarks[15]; // Left Wrist

    if (!shoulder || !wrist) return;

    const distance = Math.abs(shoulder.y - wrist.y);

    // Expand calibration range as the user moves
    if (distance < minObservedDist) minObservedDist = Math.max(0.04, distance);
    if (distance > maxObservedDist) maxObservedDist = distance;

    const range = maxObservedDist - minObservedDist;

    // Require at least 0.08 range before counting — avoids false reps
    // from casual movement while the session is just starting.
    if (range < 0.08) {
        powerPercentEl.textContent = 'Cal…';
        return;
    }

    // Map: maxObserved (arms up/straight) → 0%  |  minObserved (chest low) → 100%
    let pct = ((maxObservedDist - distance) / range) * 100;
    pct = Math.max(0, Math.min(100, pct));

    // Exponential smoothing (70/30) — reduces jitter without noticeable lag
    smoothedPct = smoothedPct * 0.7 + pct * 0.3;
    const display = Math.round(smoothedPct);

    // Update power bar UI
    powerFillEl.style.height          = `${display}%`;
    powerPercentEl.textContent        = `${display}%`;
    if (powerThumbEl) powerThumbEl.style.bottom = `${display}%`;

    // Rep state machine
    if (smoothedPct > 80) {
        stage = 'down';
    } else if (smoothedPct < 20 && stage === 'down') {
        stage = 'up';
        pushupCount++;
        repCountEl.textContent = `${pushupCount} reps`;

        // Flash the rep badge on each counted rep
        if (repsBadgeEl) {
            repsBadgeEl.classList.add('flash-active');
            setTimeout(() => repsBadgeEl.classList.remove('flash-active'), 600);
        }
    }
}

// ==========================================================================
// Section 9 – Draw Skeleton on Canvas
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

        processPushUp(landmarks);
    }
}

// ==========================================================================
// Boot
// ==========================================================================
initializePoseModel();
startWebcamBtn.addEventListener('click', handleWebcamToggle);
