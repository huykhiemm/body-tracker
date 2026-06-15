import { FilesetResolver, PoseLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

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
const fullscreenBtn   = document.getElementById('fullscreenBtn');

const elapsedTimeEl  = document.getElementById('elapsedTime');
const repCountEl     = document.getElementById('repCount');
const powerFillEl    = document.getElementById('powerFill');
const powerThumbEl   = document.getElementById('powerThumb');
const powerPercentEl = document.getElementById('powerPercent');
const repsBadgeEl    = document.querySelector('.reps-badge');

// RPG Mode DOM References
const rpgModeBtn      = document.getElementById('rpgModeBtn');
const bossHud         = document.getElementById('bossHud');
const bossSelect      = document.getElementById('bossSelect');
const bossHpVal       = document.getElementById('bossHpVal');
const bossMaxHpVal    = document.getElementById('bossMaxHpVal');
const bossAvatar      = document.getElementById('bossAvatar');
const bossHpFill      = document.getElementById('bossHpFill');

// ==========================================================================
// Section 3 – Camera Placement Guides (per mode)
// ==========================================================================
const GUIDES = {
    pushup: {
        icon:  '💪',
        title: 'Push-Up Tracker',
        steps: [
            ['📐', 'Place camera at floor level, 1–2m in front of you'],
            ['👤', 'Full body visible — head to feet in frame'],
            ['💡', 'Good lighting on your body, avoid backlight'],
        ],
    },
    plank: {
        icon:  '⏱',
        title: 'Plank Hold Timer',
        steps: [
            ['📐', 'Camera at floor level, facing you directly'],
            ['🧘', 'Get into position before pressing Start'],
            ['⚡', 'Hold timer starts automatically when form is detected'],
        ],
    },
    bicep: {
        icon:  '🦾',
        title: 'Bicep Curl Counter',
        steps: [
            ['📱', 'Camera at shoulder height, 1–2m away'],
            ['💪', 'Keep your curling arm fully visible in frame'],
            ['⏳', 'Hold 2.5s at the top of each curl for rep to count'],
        ],
    },
};

const LIVE_GUIDES = {
    pushup: {
        icon: '📐',
        instruction: 'Đặt máy sát sàn, cách 1.5m',
        details: 'Nằm nghiêng so với camera. Đảm bảo thấy rõ đầu, hông và chân. Giữ lưng thẳng.',
    },
    plank: {
        icon: '🧘',
        instruction: 'Đặt máy sát sàn, cách 1.5m',
        details: 'Giữ lưng, hông và đầu thẳng hàng. Đồng hồ tự động tạm dừng nếu hông bị võng/nâng quá cao.',
    },
    bicep: {
        icon: '💪',
        instruction: 'Đặt máy ngang ngực, cách 1.5m',
        details: 'Đứng thẳng, tay cầm tạ hướng về camera. Hạ hết cỡ góc 180°, gập sát góc 10° và giữ 2.5s.',
    },
};

function updateGuide(mode) {
    const g = GUIDES[mode];
    document.getElementById('guideIcon').textContent  = g.icon;
    document.getElementById('guideTitle').textContent = g.title;
    document.getElementById('guideSteps').innerHTML   = g.steps
        .map(([icon, text]) => `<li><span class="guide-icon-emoji">${icon}</span><span>${text}</span></li>`)
        .join('');

    // Update Apple-style floating live guide
    const lg = LIVE_GUIDES[mode];
    const liveIcon = document.getElementById('liveGuideIcon');
    const liveInst = document.getElementById('liveGuideInstruction');
    const liveText = document.getElementById('liveGuideStepText');
    if (liveIcon) liveIcon.textContent = lg.icon;
    if (liveInst) liveInst.textContent = lg.instruction;
    if (liveText) liveText.textContent = lg.details;
}

// ==========================================================================
// ==========================================================================
// Section 4 – State Variables
// ==========================================================================
let poseLandmarker   = null;
let webcamRunning    = false;
let lastVideoTime    = -1;
let animationFrameId = null;

const inputCanvas = document.createElement('canvas');
const inputCtx    = inputCanvas.getContext('2d', { willReadFrequently: true });

// Exercise mode
let currentMode = 'pushup';

// Shared rep-counting state
let pushupCount    = 0;
let stage          = 'up';
let secondsElapsed = 0;
let timerInterval  = null;

// Dynamic calibration (push-up & plank)
let minObservedDist = Infinity;
let maxObservedDist = -Infinity;
let smoothedPct     = 0;

// Plank state
let plankActive   = false;
let plankHoldSec  = 0;
let bestPlankSec  = 0;
let plankInterval = null;

// Bicep curl state
const BICEP_HOLD_MS = 2500;      // 2.5-second hold required at top (joint-safe)
let bicepHoldStart  = null;      // timestamp when arm first reached contracted zone
let bicepHoldValid  = false;     // hold duration was satisfied

// Biomechanics & Viewport HUD state
let activeSide = 'left';          // 'left' or 'right' side profile active
let activeElbowLandmark = null;
let activeHipLandmark = null;
let bicepHoldProgress = 0;        // 0.0 to 1.0 representing hold duration
let formFeedback = {
    isValid: true,
    message: ""
};

// RPG Mode Questline state database
const BOSS_LIST = [
    { name: "Holo Bat 🦇", maxHp: 30, avatar: "🦇" },
    { name: "Cyber Slime 💧", maxHp: 60, avatar: "💧" },
    { name: "Robo Goblin 🤖", maxHp: 120, avatar: "🤖" },
    { name: "Void Dragon 🐉", maxHp: 250, avatar: "🐉" },
    { name: "Cyber Golem 🪨", maxHp: 400, avatar: "🪨" },
    { name: "Omega Mech ⚔️", maxHp: 600, avatar: "⚔️" },
    { name: "Singularity Beast 👾", maxHp: 1000, avatar: "👾" }
];

let rpgModeActive = false;
let currentBossIndex = 1; // Default: Cyber Slime
let bossHp = BOSS_LIST[currentBossIndex].maxHp;
let todaySecondsOffset = 0;
let selectedDumbbellWeight = 5; // Default bicep damage selector

// ==========================================================================
// Section 5 – Timer & Tracker Helpers
// ==========================================================================
function startTimer() {
    clearInterval(timerInterval);
    secondsElapsed = 0;
    elapsedTimeEl.textContent = '0s';
    
    const todayStr = new Date().toISOString().split('T')[0];
    const history = getTelemetryHistory();
    todaySecondsOffset = (history[todayStr] || 0) * 60;
    
    timerInterval = setInterval(() => {
        secondsElapsed++;
        elapsedTimeEl.textContent = `${secondsElapsed}s`;
        
        // Dynamically increment history in local storage and update chart in real-time
        const currentTotalSeconds = todaySecondsOffset + secondsElapsed;
        const currentHistory = getTelemetryHistory();
        currentHistory[todayStr] = parseFloat((currentTotalSeconds / 60).toFixed(2));
        localStorage.setItem('gx_telemetry_history', JSON.stringify(currentHistory));
        
        if (telemetryChartInstance) {
            const sortedDates = Object.keys(currentHistory).sort();
            const todayIndex = sortedDates.indexOf(todayStr);
            if (todayIndex !== -1) {
                telemetryChartInstance.data.datasets[0].data[todayIndex] = currentHistory[todayStr];
                telemetryChartInstance.update('none'); // silent update
            }
        }
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

    // Plank
    clearInterval(plankInterval);
    plankInterval = null;
    plankActive   = false;
    plankHoldSec  = 0;
    bestPlankSec  = 0;

    // Bicep
    bicepHoldStart = null;
    bicepHoldValid = false;
    bicepHoldProgress = 0;
    activeElbowLandmark = null;
    activeHipLandmark = null;
    formFeedback.isValid = true;
    formFeedback.message = "";
    powerFillEl.classList.remove('holding');

    elapsedTimeEl.textContent  = '0s';
    powerPercentEl.textContent = '0%';
    powerFillEl.style.height   = '0%';
    if (powerThumbEl) powerThumbEl.style.bottom = '0%';

    repCountEl.textContent = currentMode === 'plank' ? '0s hold' : '0 reps';
}

if (resetStatsBtn) resetStatsBtn.addEventListener('click', resetTracker);

// ==========================================================================
// Section 6 – Exercise Mode Switcher
// ==========================================================================
function switchMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.exercise-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    
    // Show dumbbell weight selector widget only on Bicep Curl mode
    const weightWidget = document.getElementById('weightWidget');
    if (weightWidget) {
        if (mode === 'bicep') {
            weightWidget.classList.add('show');
        } else {
            weightWidget.classList.remove('show');
        }
    }
    
    updateGuide(mode);
    resetTracker();
}

document.querySelectorAll('.exercise-btn').forEach(btn => {
    btn.addEventListener('click', () => switchMode(btn.dataset.mode));
});

// Initialise guide for default mode
updateGuide(currentMode);

// ==========================================================================
// Section 7 – Fullscreen (with Mobile/iOS CSS Mock Fallback)
// ==========================================================================
const viewport = document.querySelector('.webcam-viewport');

function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function updateFullscreenIcon(isFs) {
    if (fullscreenBtn) {
        fullscreenBtn.innerHTML = isFs
            ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>`  // compress icon
            : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`; // expand icon
    }
}

function toggleFullscreen() {
    const isMock = isIOS() || !viewport.requestFullscreen;
    
    if (isMock) {
        const active = viewport.classList.toggle('mock-fullscreen');
        document.body.style.overflow = active ? 'hidden' : '';
        updateFullscreenIcon(active);
    } else {
        if (!document.fullscreenElement) {
            viewport.requestFullscreen().catch(() => {
                const active = viewport.classList.toggle('mock-fullscreen');
                document.body.style.overflow = active ? 'hidden' : '';
                updateFullscreenIcon(active);
            });
        } else {
            document.exitFullscreen().catch(() => {});
        }
    }
}

fullscreenBtn?.addEventListener('click', toggleFullscreen);

document.addEventListener('fullscreenchange', () => {
    const isFs = !!document.fullscreenElement;
    if (!isFs && viewport.classList.contains('mock-fullscreen')) {
        viewport.classList.remove('mock-fullscreen');
        document.body.style.overflow = '';
    }
    updateFullscreenIcon(isFs);
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && viewport.classList.contains('mock-fullscreen')) {
        viewport.classList.remove('mock-fullscreen');
        document.body.style.overflow = '';
        updateFullscreenIcon(false);
    }
});

// ==========================================================================
// Section 8 – MediaPipe Model Initialisation
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
        statusDot.style.background = '#ff1a40';
        statusDot.style.boxShadow  = '0 0 8px #ff1a40';
    }
}

// ==========================================================================
// Section 9 – Camera Control
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
            viewport.classList.add('camera-active');
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
    powerFillEl.classList.remove('holding');
    if (powerThumbEl) powerThumbEl.style.bottom = '0%';

    viewportOverlay.classList.remove('hidden');
    viewport.classList.remove('camera-active');
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
// Section 10 – Prediction Loop
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
// Section 11 – Skeleton Drawing (custom, per-segment colors)
// ==========================================================================

// ==========================================================================
// Section 11 – Upgraded Visual Skeleton & Live HUD Drawing
// ==========================================================================

const SKELETON_CONNECTIONS = [
    // Left Arm
    { from: 11, to: 13, type: 'leftArm' },
    { from: 13, to: 15, type: 'leftArm' },
    // Right Arm
    { from: 12, to: 14, type: 'rightArm' },
    { from: 14, to: 16, type: 'rightArm' },
    // Torso
    { from: 11, to: 12, type: 'torso' },
    { from: 11, to: 23, type: 'torso' },
    { from: 12, to: 24, type: 'torso' },
    { from: 23, to: 24, type: 'torso' },
    // Left Leg
    { from: 23, to: 25, type: 'leftLeg' },
    { from: 25, to: 27, type: 'leftLeg' },
    // Right Leg
    { from: 24, to: 26, type: 'rightLeg' },
    { from: 26, to: 28, type: 'rightLeg' }
];

const JOINT_COLORS = {
    11: '#00f0ff', 13: '#00f0ff', 15: '#00f0ff', // Left arm (cyan)
    12: '#ff1a40', 14: '#ff1a40', 16: '#ff1a40', // Right arm (neon red)
    23: '#00ff88', 24: '#00ff88',                 // Hips (neon green)
    25: '#facc15', 27: '#facc15',                 // Left leg (amber)
    26: '#a855f7', 28: '#a855f7',                 // Right leg (purple)
};

function drawHUDLabel(ctx, x, y, text, isWarning = false) {
    if (!text) return;
    ctx.save();
    ctx.font = '600 11px Outfit, sans-serif';
    const textWidth = ctx.measureText(text).width;
    const padding = 8;
    const rectWidth = textWidth + padding * 2;
    const rectHeight = 20;
    
    // Draw background pill
    ctx.fillStyle = isWarning ? 'rgba(255, 26, 64, 0.9)' : 'rgba(0, 255, 136, 0.9)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1.5;
    
    ctx.beginPath();
    const rx = x - rectWidth / 2;
    const ry = y - 40; // float above joint
    ctx.roundRect(rx, ry, rectWidth, rectHeight, 6);
    ctx.fill();
    ctx.stroke();
    
    // Draw text
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, ry + rectHeight / 2);
    ctx.restore();
}

function drawAngleArc(ctx, center, pt1, pt2, angleVal) {
    const a1 = Math.atan2(pt1.y - center.y, pt1.x - center.x);
    const a2 = Math.atan2(pt2.y - center.y, pt2.x - center.x);
    
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(center.x, center.y, 22, a1, a2, a1 > a2);
    ctx.stroke();
    
    // Draw text indicator
    ctx.font = 'bold 10px Outfit, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Compute label position slightly outside the arc
    const textAngle = a1 + (a2 - a1) / 2;
    const tx = center.x + Math.cos(textAngle) * 36;
    const ty = center.y + Math.sin(textAngle) * 36;
    
    // Draw mini background for legibility
    ctx.fillStyle = 'rgba(15, 15, 20, 0.75)';
    ctx.beginPath();
    ctx.arc(tx, ty, 10, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = '#ffffff';
    ctx.fillText(Math.round(angleVal) + '°', tx, ty);
    ctx.restore();
}

function drawColoredSkeleton(landmarks) {
    const w = canvas.width;
    const h = canvas.height;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1. Determine active side profile based on keypoint visibility sums
    const leftVis = (landmarks[11]?.visibility ?? 0) + (landmarks[23]?.visibility ?? 0) + (landmarks[27]?.visibility ?? 0);
    const rightVis = (landmarks[12]?.visibility ?? 0) + (landmarks[24]?.visibility ?? 0) + (landmarks[28]?.visibility ?? 0);
    activeSide = leftVis > rightVis ? 'left' : 'right';

    // 2. Resolve active joint coordinates
    const shoulder = landmarks[activeSide === 'left' ? 11 : 12];
    const elbow = landmarks[activeSide === 'left' ? 13 : 14];
    const wrist = landmarks[activeSide === 'left' ? 15 : 16];
    const hip = landmarks[activeSide === 'left' ? 23 : 24];
    const ankle = landmarks[activeSide === 'left' ? 27 : 28];

    // Reference active tracking joints globally
    activeElbowLandmark = elbow;
    activeHipLandmark = hip;

    // 3. Draw connection lines (bones)
    for (const conn of SKELETON_CONNECTIONS) {
        const la = landmarks[conn.from];
        const lb = landmarks[conn.to];
        if (!la || !lb || (la.visibility ?? 1) < 0.25 || (lb.visibility ?? 1) < 0.25) continue;

        const x1 = la.x * w;
        const y1 = la.y * h;
        const x2 = lb.x * w;
        const y2 = lb.y * h;

        let strokeColor = 'rgba(255, 255, 255, 0.12)';
        let lineWidth = 2;
        let isHighlighted = false;

        if (currentMode === 'bicep') {
            const isCurlingArm = (conn.type === 'leftArm' && activeSide === 'left') ||
                                 (conn.type === 'rightArm' && activeSide === 'right');
            if (isCurlingArm) {
                strokeColor = bicepHoldValid ? '#00ff88' : (bicepHoldStart ? '#facc15' : '#00f0ff');
                lineWidth = 5;
                isHighlighted = true;
            }
        } else if (currentMode === 'pushup' || currentMode === 'plank') {
            const isActiveSideBody = conn.type === 'torso' || 
                                     (conn.type === 'leftArm' && activeSide === 'left') ||
                                     (conn.type === 'rightArm' && activeSide === 'right') ||
                                     (conn.type === 'leftLeg' && activeSide === 'left') ||
                                     (conn.type === 'rightLeg' && activeSide === 'right');
            if (isActiveSideBody) {
                strokeColor = formFeedback.isValid ? '#00ff88' : '#ff1a40';
                lineWidth = 5;
                isHighlighted = true;
            }
        } else {
            strokeColor = JOINT_COLORS[conn.from] ?? 'rgba(100, 220, 255, 0.85)';
            lineWidth = 3.5;
            isHighlighted = true;
        }

        // Draw laser glow backing
        if (isHighlighted) {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.strokeStyle = strokeColor;
            ctx.globalAlpha = 0.28;
            ctx.lineWidth = lineWidth * 2.5;
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        }

        // Draw crisp core bone
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = isHighlighted ? '#ffffff' : strokeColor;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
    }

    // 4. Draw Joint Nodes
    landmarks.forEach((lm, idx) => {
        if ((lm.visibility ?? 1) < 0.25) return;
        if (idx < 11) return; // Skip face landmarks

        const x = lm.x * w;
        const y = lm.y * h;
        const isTargetJoint = (idx === 13 || idx === 14) || (idx === 23 || idx === 24);
        const isFromActiveSide = (activeSide === 'left' && [11,13,15,23,25,27].includes(idx)) ||
                                 (activeSide === 'right' && [12,14,16,24,26,28].includes(idx));

        const baseColor = JOINT_COLORS[idx] ?? '#64c8ff';

        if (isTargetJoint && isFromActiveSide) {
            // Active joint target marker
            ctx.save();
            ctx.globalAlpha = 0.25;
            ctx.fillStyle = baseColor;
            ctx.beginPath();
            const pulse = 10 + Math.sin(performance.now() / 150) * 3;
            ctx.arc(x, y, pulse, 0, Math.PI * 2);
            ctx.fill();

            // Middle white ring
            ctx.globalAlpha = 0.8;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(x, y, 6.5, 0, Math.PI * 2);
            ctx.stroke();

            // Core dot
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(x, y, 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        } else {
            // Normal / faded joint node
            ctx.save();
            ctx.fillStyle = isFromActiveSide ? baseColor : 'rgba(255, 255, 255, 0.25)';
            ctx.beginPath();
            ctx.arc(x, y, 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    });

    // 5. Draw Angle Arcs & Biomechanics Labels
    if (shoulder && elbow && wrist && (shoulder.visibility ?? 0) > 0.45 && (elbow.visibility ?? 0) > 0.45 && (wrist.visibility ?? 0) > 0.45) {
        const sx = shoulder.x * w;
        const sy = shoulder.y * h;
        const ex = elbow.x * w;
        const ey = elbow.y * h;
        const wx = wrist.x * w;
        const wy = wrist.y * h;

        const eAngle = getAngle(shoulder, elbow, wrist);

        if (currentMode === 'bicep') {
            drawAngleArc(ctx, { x: ex, y: ey }, { x: sx, y: sy }, { x: wx, y: wy }, eAngle);
            
            // Render elbow radial progress wheel
            if (bicepHoldProgress > 0) {
                ctx.beginPath();
                ctx.arc(ex, ey, 18, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
                ctx.lineWidth = 4;
                ctx.stroke();

                ctx.beginPath();
                ctx.arc(ex, ey, 18, -Math.PI / 2, -Math.PI / 2 + bicepHoldProgress * Math.PI * 2);
                ctx.strokeStyle = bicepHoldValid ? '#00ff88' : '#facc15';
                ctx.lineWidth = 4;
                ctx.stroke();

                ctx.save();
                ctx.font = 'bold 9px Outfit, sans-serif';
                ctx.fillStyle = bicepHoldValid ? '#00ff88' : '#facc15';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                if (bicepHoldProgress < 1) {
                    const rem = ((BICEP_HOLD_MS - (performance.now() - bicepHoldStart)) / 1000).toFixed(1);
                    ctx.fillText(rem + 's', ex, ey - 22);
                } else {
                    ctx.fillText('HOLD!', ex, ey - 22);
                }
                ctx.restore();
            }
        } else if (currentMode === 'pushup') {
            drawAngleArc(ctx, { x: ex, y: ey }, { x: sx, y: sy }, { x: wx, y: wy }, eAngle);
        }
    }

    if (shoulder && hip && ankle && (shoulder.visibility ?? 0) > 0.45 && (hip.visibility ?? 0) > 0.45 && (ankle.visibility ?? 0) > 0.45) {
        const sx = shoulder.x * w;
        const sy = shoulder.y * h;
        const hx = hip.x * w;
        const hy = hip.y * h;
        const ax = ankle.x * w;
        const ay = ankle.y * h;

        const hAngle = getAngle(shoulder, hip, ankle);

        if (currentMode === 'pushup' || currentMode === 'plank') {
            drawAngleArc(ctx, { x: hx, y: hy }, { x: sx, y: sy }, { x: ax, y: ay }, hAngle);
            drawHUDLabel(ctx, hx, hy, formFeedback.message, !formFeedback.isValid);
        }
    }

    ctx.restore();
}

// ==========================================================================
// Section 12 – Utility
// ==========================================================================
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
    if (powerThumbEl) powerThumbEl.style.bottom = `${display}%`;
    // powerPercentEl is set explicitly by each exercise handler
}

function flashRepBadge() {
    if (!repsBadgeEl) return;
    repsBadgeEl.classList.add('flash-active');
    setTimeout(() => repsBadgeEl.classList.remove('flash-active'), 600);
}

// ==========================================================================
// Section 13 – Exercise Biomechanics Logic
// ==========================================================================

// ── Push-Up ────────────────────────────────────────────────────────────────
function processPushUp(landmarks) {
    const shoulder = activeSide === 'left' ? landmarks[11] : landmarks[12];
    const wrist    = activeSide === 'left' ? landmarks[15] : landmarks[16];
    const hip      = activeSide === 'left' ? landmarks[23] : landmarks[24];
    const ankle    = activeSide === 'left' ? landmarks[27] : landmarks[28];

    if (!shoulder || !wrist) return;

    // Verify spine alignment (back-hip-ankle angle)
    if (shoulder && hip && ankle) {
        const hAngle = getAngle(shoulder, hip, ankle);
        if (hAngle < 162) {
            formFeedback.isValid = false;
            formFeedback.message = "⚠️ NÂNG HÔNG / SAGGY HIPS";
        } else if (hAngle > 196) {
            formFeedback.isValid = false;
            formFeedback.message = "⚠️ HẠ HÔNG / HIPS TOO HIGH";
        } else {
            formFeedback.isValid = true;
            formFeedback.message = "✓ THẲNG LƯNG / NEUTRAL SPINE";
        }
    } else {
        formFeedback.isValid = true;
        formFeedback.message = "✓ ĐANG PHÂN TÍCH / ANALYZING";
    }

    const distance = Math.abs(shoulder.y - wrist.y);

    if (distance < minObservedDist) minObservedDist = Math.max(0.04, distance);
    if (distance > maxObservedDist) maxObservedDist = distance;

    const range = maxObservedDist - minObservedDist;
    if (range < 0.08) { powerPercentEl.textContent = 'Cal…'; return; }

    let pct = ((maxObservedDist - distance) / range) * 100;
    pct = Math.max(0, Math.min(100, pct));
    smoothedPct = smoothedPct * 0.7 + pct * 0.3;
    const display = Math.round(smoothedPct);

    updatePowerBar(display);

    // Apply warn state to fill bar
    const fillEl = document.getElementById('powerFill');
    if (fillEl) {
        if (!formFeedback.isValid) {
            fillEl.style.background = '#ff1a40'; // Red warning
        } else {
            fillEl.style.background = '';
        }
    }

    powerPercentEl.textContent = formFeedback.isValid ? `${display}%` : "⚠️ FORM!";

    if (smoothedPct > 80) {
        stage = 'down';
    } else if (smoothedPct < 20 && stage === 'down') {
        stage = 'up';
        pushupCount++;
        repCountEl.textContent = `${pushupCount} reps`;
        flashRepBadge();
        triggerAttack(12); // Heavy Attack (Balanced)
    }
}

// ── Plank ───────────────────────────────────────────────────────────────────
function processPlank(landmarks) {
    const shoulder = activeSide === 'left' ? landmarks[11] : landmarks[12];
    const wrist    = activeSide === 'left' ? landmarks[15] : landmarks[16];
    const hip      = activeSide === 'left' ? landmarks[23] : landmarks[24];
    const ankle    = activeSide === 'left' ? landmarks[27] : landmarks[28];

    if (!shoulder || !wrist) {
        if (plankActive) {
            plankActive = false;
            clearInterval(plankInterval);
            plankInterval = null;
            repCountEl.textContent = `Best: ${bestPlankSec}s`;
            plankHoldSec = 0;
        }
        return;
    }

    // Verify spine alignment
    if (shoulder && hip && ankle) {
        const hAngle = getAngle(shoulder, hip, ankle);
        if (hAngle < 162) {
            formFeedback.isValid = false;
            formFeedback.message = "⚠️ NÂNG HÔNG / SAGGY HIPS";
        } else if (hAngle > 196) {
            formFeedback.isValid = false;
            formFeedback.message = "⚠️ HẠ HÔNG / HIPS TOO HIGH";
        } else {
            formFeedback.isValid = true;
            formFeedback.message = "✓ THẲNG LƯNG / NEUTRAL SPINE";
        }
    } else {
        formFeedback.isValid = true;
        formFeedback.message = "✓ ĐANG PHÂN TÍCH / ANALYZING";
    }

    const distance = Math.abs(shoulder.y - wrist.y);

    if (distance < minObservedDist) minObservedDist = Math.max(0.04, distance);
    if (distance > maxObservedDist) maxObservedDist = distance;

    const range = maxObservedDist - minObservedDist;
    if (range < 0.06) { powerPercentEl.textContent = 'Cal…'; return; }

    let pct = ((distance - minObservedDist) / range) * 100;
    pct = Math.max(0, Math.min(100, pct));
    smoothedPct = smoothedPct * 0.85 + pct * 0.15;
    const display = Math.round(smoothedPct);

    updatePowerBar(display);

    // Apply warn state to fill bar
    const fillEl = document.getElementById('powerFill');
    if (fillEl) {
        if (!formFeedback.isValid) {
            fillEl.style.background = '#ff1a40'; // Red warning
        } else {
            fillEl.style.background = '';
        }
    }

    powerPercentEl.textContent = formFeedback.isValid ? `${display}%` : "⚠️ FORM!";

    // Plank holds only count when posture is correct
    const inPosition = smoothedPct > 35 && smoothedPct < 95 && formFeedback.isValid;

    if (inPosition && !plankActive) {
        plankActive  = true;
        plankHoldSec = 0;
        plankInterval = setInterval(() => {
            plankHoldSec++;
            if (plankHoldSec > bestPlankSec) bestPlankSec = plankHoldSec;
            repCountEl.textContent = `${plankHoldSec}s hold`;
            flashRepBadge();
            triggerAttack(2); // DoT Attack (Balanced)
        }, 1000);
    } else if (!inPosition && plankActive) {
        plankActive = false;
        clearInterval(plankInterval);
        plankInterval = null;
        repCountEl.textContent = `Best: ${bestPlankSec}s`;
        plankHoldSec = 0;
    }
}

// ── Bicep Curl ──────────────────────────────────────────────────────────────
function processBicepCurl(landmarks) {
    const lShoulder = landmarks[11];
    const lElbow    = landmarks[13];
    const lWrist    = landmarks[15];
    const rShoulder = landmarks[12];
    const rElbow    = landmarks[14];
    const rWrist    = landmarks[16];

    let angle = null;
    let activeElbow = null;

    // Dynamic selection of active curling arm based on visibility & angle
    let lAngle = null;
    let rAngle = null;
    if (lShoulder && lElbow && lWrist && (lElbow.visibility ?? 0) > 0.45) {
        lAngle = getAngle(lShoulder, lElbow, lWrist);
    }
    if (rShoulder && rElbow && rWrist && (rElbow.visibility ?? 0) > 0.45) {
        rAngle = getAngle(rShoulder, rElbow, rWrist);
    }

    if (lAngle !== null && rAngle !== null) {
        if (lAngle < rAngle) {
            angle = lAngle;
            activeElbow = lElbow;
            activeSide = 'left';
        } else {
            angle = rAngle;
            activeElbow = rElbow;
            activeSide = 'right';
        }
    } else if (lAngle !== null) {
        angle = lAngle;
        activeElbow = lElbow;
        activeSide = 'left';
    } else if (rAngle !== null) {
        angle = rAngle;
        activeElbow = rElbow;
        activeSide = 'right';
    }

    if (angle === null) {
        formFeedback.isValid = true;
        formFeedback.message = "HIỂN THỊ TAY / SHOW ARM";
        return;
    }

    // Joint-safe range: 180° (extended) to 10° (contracted)
    const MIN_ANGLE = 10;
    const MAX_ANGLE = 180;
    let pct = ((MAX_ANGLE - angle) / (MAX_ANGLE - MIN_ANGLE)) * 100;
    pct = Math.max(0, Math.min(100, pct));

    smoothedPct = smoothedPct * 0.6 + pct * 0.4;
    const display = Math.round(smoothedPct);
    updatePowerBar(display);

    const fillEl = document.getElementById('powerFill');
    if (fillEl) {
        fillEl.style.background = '';
    }

    const nowMs = performance.now();

    if (smoothedPct > 70) {
        stage = 'down';
        powerPercentEl.textContent = `${display}%`;
        formFeedback.isValid = true;
        formFeedback.message = "GẬP HẾT CỠ / CONTRACTED";
    } else {
        powerPercentEl.textContent = `${display}%`;
        if (smoothedPct < 15) {
            formFeedback.isValid = true;
            formFeedback.message = "✓ THẲNG TAY / EXTENDED";

            if (stage === 'down') {
                pushupCount++;
                repCountEl.textContent = `${pushupCount} reps`;
                flashRepBadge();
                
                // Attack with selected dumbbell weight scale damage
                triggerAttack(selectedDumbbellWeight);
                stage = 'up';
            }
        } else {
            formFeedback.isValid = true;
            formFeedback.message = stage === 'down' ? "HẠ TẠ XUỐNG / LOWER WEIGHT" : "GẬP TAY LÊN / CURL UP";
        }
    }
}

// ==========================================================================
// Section 14 – Pose Result Handler
// ==========================================================================
function onPoseResult(result) {
    if (!webcamRunning) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!result?.landmarks?.length) return;

    for (const landmarks of result.landmarks) {
        drawColoredSkeleton(landmarks);

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

// Live Setup Guide Collapse/Expand Trigger
const liveSetupGuide = document.getElementById('liveSetupGuide');
const guideToggleBtn = document.getElementById('guideToggleBtn');

if (guideToggleBtn && liveSetupGuide) {
    guideToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Stop click from propagating
        liveSetupGuide.classList.toggle('collapsed');
    });

    // Expanding if clicked while collapsed
    liveSetupGuide.addEventListener('click', () => {
        if (liveSetupGuide.classList.contains('collapsed')) {
            liveSetupGuide.classList.remove('collapsed');
        }
    });
}

// ==========================================================================
// Section 15 – Digital Zoom & Drag-Pan Controls (Mobile & Desktop)
// ==========================================================================
const zoomBtns = document.querySelectorAll('.zoom-btn');
const dragHint = document.getElementById('dragHint');

let zoomFactor = 1.0;
let panX = 0;
let panY = 0;

let isDragging = false;
let startX = 0;
let startY = 0;
let basePanX = 0;
let basePanY = 0;
let hintTimeout = null;

function showDragHintToast() {
    if (!dragHint) return;
    dragHint.classList.add('show');
    if (hintTimeout) clearTimeout(hintTimeout);
    hintTimeout = setTimeout(() => {
        dragHint.classList.remove('show');
    }, 3500);
}

function updateViewportTransform() {
    if (!viewport) return;
    viewport.style.setProperty('--zoom-factor', zoomFactor);
    viewport.style.setProperty('--pan-x', `${panX}px`);
    viewport.style.setProperty('--pan-y', `${panY}px`);
}

function resetPanning() {
    panX = 0;
    panY = 0;
    updateViewportTransform();
}

if (zoomBtns && viewport) {
    zoomBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            zoomBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const prevZoom = zoomFactor;
            zoomFactor = parseFloat(btn.dataset.zoom) || 1.0;
            
            if (zoomFactor === 1.0) {
                resetPanning();
            } else {
                clampAndApplyPan(panX, panY);
                if (prevZoom === 1.0) {
                    showDragHintToast();
                }
            }
        });
    });

    function clampAndApplyPan(targetX, targetY) {
        const w = viewport.clientWidth;
        const h = viewport.clientHeight;
        
        // Max translation limit in local coordinate space (px):
        // limit = (1 - 1 / zoom) * size / 2
        const limitX = zoomFactor > 1.0 ? ((1 - 1 / zoomFactor) * w) / 2 : 0;
        const limitY = zoomFactor > 1.0 ? ((1 - 1 / zoomFactor) * h) / 2 : 0;
        
        panX = Math.max(-limitX, Math.min(limitX, targetX));
        panY = Math.max(-limitY, Math.min(limitY, targetY));
        
        updateViewportTransform();
    }

    function dragStart(e) {
        if (zoomFactor <= 1.0) return;
        
        isDragging = true;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        
        startX = clientX;
        startY = clientY;
        basePanX = panX;
        basePanY = panY;
        
        viewport.style.cursor = 'grabbing';
    }

    function dragMove(e) {
        if (!isDragging) return;
        
        if (e.cancelable) e.preventDefault();
        
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        
        const deltaX = clientX - startX;
        const deltaY = clientY - startY;
        
        // Translate relative to scale and mirror:
        // x moves negative because of scaleX(-1) mirror translation
        const localDeltaX = -deltaX / zoomFactor;
        const localDeltaY = deltaY / zoomFactor;
        
        clampAndApplyPan(basePanX + localDeltaX, basePanY + localDeltaY);
    }

    function dragEnd() {
        isDragging = false;
        viewport.style.cursor = '';
    }

    // Touch Event Listeners
    viewport.addEventListener('touchstart', dragStart, { passive: false });
    viewport.addEventListener('touchmove', dragMove, { passive: false });
    viewport.addEventListener('touchend', dragEnd);
    viewport.addEventListener('touchcancel', dragEnd);

    // Mouse Event Listeners
    viewport.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', dragMove);
    document.addEventListener('mouseup', dragEnd);
}

// ==========================================================================
// Section 18 – Liquid Ambient Particle Background (Optimized)
// ==========================================================================
function initAmbientBackground() {
    const canvas = document.getElementById('bg-particles');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    let w = canvas.width = window.innerWidth;
    let h = canvas.height = window.innerHeight;
    
    // Resize handler with debounce
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            w = canvas.width = window.innerWidth;
            h = canvas.height = window.innerHeight;
        }, 150);
    });
    
    const particles = [];
    const colors = ['#ff1a40', '#00f0ff', '#a855f7'];
    
    // Create ~35 slow moving particles
    for (let i = 0; i < 35; i++) {
        particles.push({
            x: Math.random() * w,
            y: Math.random() * h,
            vx: (Math.random() - 0.5) * 0.25,
            vy: (Math.random() - 0.5) * 0.25,
            radius: Math.random() * 4 + 2,
            color: colors[Math.floor(Math.random() * colors.length)],
            alpha: Math.random() * 0.35 + 0.1
        });
    }
    
    function animate() {
        ctx.clearRect(0, 0, w, h);
        
        particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            
            // Screen boundaries wrapping
            if (p.x < 0) p.x = w;
            if (p.x > w) p.x = 0;
            if (p.y < 0) p.y = h;
            if (p.y > h) p.y = 0;
            
            ctx.save();
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = p.color;
            ctx.shadowBlur = 10;
            ctx.shadowColor = p.color;
            
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
        
        requestAnimationFrame(animate);
    }
    
    animate();
}

// Initialise background loop
initAmbientBackground();

// ==========================================================================
// Section 16 – RPG Boss Battle Questline Mechanics
// ==========================================================================
function updateBossHpBar() {
    const boss = BOSS_LIST[currentBossIndex];
    const pct = (bossHp / boss.maxHp) * 100;
    if (bossHpFill) bossHpFill.style.width = `${pct}%`;
    if (bossHpVal) bossHpVal.textContent = bossHp;
    if (bossMaxHpVal) bossMaxHpVal.textContent = boss.maxHp;
}

function spawnSlashEffect() {
    const container = document.getElementById('battleEffects');
    if (!container) return;
    
    const slash = document.createElement('div');
    slash.className = 'slash-effect';
    const rotation = Math.random() * 360;
    const left = 35 + Math.random() * 30;
    const top = 35 + Math.random() * 30;
    
    slash.style.setProperty('--rot', `${rotation}deg`);
    slash.style.left = `${left}%`;
    slash.style.top = `${top}%`;
    
    container.appendChild(slash);
    setTimeout(() => slash.remove(), 350);
}

function spawnDamageText(damage) {
    const container = document.getElementById('battleEffects');
    if (!container) return;
    
    const dmgText = document.createElement('div');
    dmgText.className = 'damage-text';
    dmgText.textContent = `-${damage} HP`;
    const left = 35 + Math.random() * 30;
    const top = 35 + Math.random() * 30;
    
    dmgText.style.left = `${left}%`;
    dmgText.style.top = `${top}%`;
    
    container.appendChild(dmgText);
    setTimeout(() => dmgText.remove(), 800);
}

function triggerVictory() {
    const boss = BOSS_LIST[currentBossIndex];
    const overlay = document.getElementById('victoryOverlay');
    const bossNameEl = document.getElementById('victoryBossName');
    
    if (bossNameEl) bossNameEl.textContent = `${boss.name} DEFEATED!`;
    if (overlay) {
        overlay.classList.add('show');
        setTimeout(() => {
            overlay.classList.remove('show');
            logVictoryActivity(boss);
            bossHp = boss.maxHp;
            updateBossHpBar();
        }, 3000);
    }
}

function logVictoryActivity(boss) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    activities.unshift({
        id: Date.now(),
        title: `🏆 DEFEATED: ${boss.name}`,
        time,
        duration: 'QUEST SECURED'
    });
    renderActivities();
}

function triggerAttack(damage) {
    if (!rpgModeActive || bossHp <= 0) return;
    
    bossHp = Math.max(0, bossHp - damage);
    updateBossHpBar();
    
    if (bossAvatar) {
        bossAvatar.classList.remove('shake');
        void bossAvatar.offsetWidth; // Force layout recalculation
        bossAvatar.classList.add('shake');
    }
    
    spawnSlashEffect();
    spawnDamageText(damage);
    
    if (bossHp <= 0) {
        triggerVictory();
    }
}

if (rpgModeBtn && bossHud) {
    rpgModeBtn.addEventListener('click', () => {
        rpgModeActive = !rpgModeActive;
        rpgModeBtn.classList.toggle('rpg-on', rpgModeActive);
        rpgModeBtn.textContent = rpgModeActive ? '🕹️ RPG MODE: ON' : '🕹️ RPG MODE: OFF';
        bossHud.classList.toggle('show', rpgModeActive);
        
        // Collapse setup guide if RPG HUD is shown to save screen space
        const liveSetupGuide = document.getElementById('liveSetupGuide');
        if (liveSetupGuide) {
            if (rpgModeActive) {
                liveSetupGuide.classList.add('collapsed');
            } else {
                liveSetupGuide.classList.remove('collapsed');
            }
        }
    });
}

if (bossSelect) {
    bossSelect.addEventListener('change', (e) => {
        currentBossIndex = parseInt(e.target.value) || 0;
        const boss = BOSS_LIST[currentBossIndex];
        bossHp = boss.maxHp;
        if (bossAvatar) bossAvatar.textContent = boss.avatar;
        updateBossHpBar();
    });
}

// Bicep Dumbbell Weight selector click listeners
const weightBtns = document.querySelectorAll('.weight-btn');
if (weightBtns) {
    weightBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            weightBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedDumbbellWeight = parseInt(btn.dataset.weight) || 5;
        });
    });
}

// Set initial Boss HP view
updateBossHpBar();

// ==========================================================================
// Section 17 – LocalStorage Telemetry Seeding & Chart Initialization
// ==========================================================================
let telemetryChartInstance = null;

function getTelemetryHistory() {
    const raw = localStorage.getItem('gx_telemetry_history');
    if (raw) {
        try {
            return JSON.parse(raw);
        } catch(e) {}
    }
    
    // Seed 7 days of training time (Monday to Sunday)
    const seeded = {};
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        seeded[dateStr] = i === 0 ? 0 : Math.floor(Math.random() * 20) + 5; // seed mock minutes
    }
    localStorage.setItem('gx_telemetry_history', JSON.stringify(seeded));
    return seeded;
}

function initTelemetryChart() {
    const canvas = document.getElementById('telemetryChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const history = getTelemetryHistory();
    const sortedDates = Object.keys(history).sort();
    const dataValues = sortedDates.map(d => history[d]);
    
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const displayLabels = sortedDates.map(dateStr => {
        const d = new Date(dateStr);
        return dayNames[d.getDay()] + ' ' + d.getDate();
    });
    
    const gradient = ctx.createLinearGradient(0, 0, 0, 250);
    gradient.addColorStop(0, 'rgba(255, 26, 64, 0.2)');
    gradient.addColorStop(1, 'rgba(255, 26, 64, 0.0)');
    
    telemetryChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: displayLabels,
            datasets: [{
                label: 'DAILY TRAINING DURATION (MINUTES)',
                data: dataValues,
                borderColor: '#ff1a40',
                borderWidth: 2,
                backgroundColor: gradient,
                fill: true,
                tension: 0.35,
                pointBackgroundColor: '#ff1a40',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 1.5,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: '#a0a5b5',
                        font: {
                            family: 'Orbitron',
                            size: 10,
                            weight: 'bold'
                        }
                    }
                },
                tooltip: {
                    backgroundColor: '#0c0d12',
                    borderColor: '#ff1a40',
                    borderWidth: 1,
                    titleFont: { family: 'Orbitron', size: 11, weight: 'bold' },
                    bodyFont: { family: 'Outfit', size: 11 },
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            return ` ${context.parsed.y.toFixed(1)} mins`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(26, 28, 38, 0.3)'
                    },
                    ticks: {
                        color: '#5e6375',
                        font: { family: 'Orbitron', size: 9, weight: 'bold' }
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(26, 28, 38, 0.3)'
                    },
                    ticks: {
                        color: '#5e6375',
                        font: { family: 'Orbitron', size: 9 },
                        callback: function(val) {
                            return val + 'm';
                        }
                    },
                    suggestedMin: 0,
                    suggestedMax: 30
                }
            }
        }
    });
}

// Boot Chart.js
initTelemetryChart();
