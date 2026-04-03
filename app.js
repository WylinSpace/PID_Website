// DOM Elements
const simCanvas = document.getElementById('simCanvas');
const simCtx = simCanvas.getContext('2d');
const graphCanvas = document.getElementById('graphCanvas');
const graphCtx = graphCanvas.getContext('2d');
const graphContainer = document.getElementById('graph-container');

// UI Controls
const modeSelect = document.getElementById('mode-select');
const sliderP = document.getElementById('slider-p');
const sliderI = document.getElementById('slider-i');
const sliderD = document.getElementById('slider-d');
const sliderTarget = document.getElementById('slider-target');

const valP = document.getElementById('val-p');
const valI = document.getElementById('val-i');
const valD = document.getElementById('val-d');
const valTarget = document.getElementById('val-target');

const lblTarget = document.getElementById('label-target');
const lblActual = document.getElementById('label-actual');
const currentModeLabel = document.getElementById('currentModeLabel');

const checkNoise = document.getElementById('check-noise');
const checkContDist = document.getElementById('check-continuous-dist');

const btnDisturbance = document.getElementById('btn-disturbance');
const btnToggleGraph = document.getElementById('btn-toggle-graph');
const btnReset = document.getElementById('btn-reset');

const btnPresetUnder = document.getElementById('preset-under');
const btnPresetPerfect = document.getElementById('preset-perfect');
const btnPresetOver = document.getElementById('preset-over');

const startOverlay = document.getElementById('start-overlay');
const btnStart = document.getElementById('btn-start');

// State Variables
let lastTime = 0;
let animationFrameId = null;
let isStarted = false;

// Graph Data
const maxGraphPoints = 200;
let graphDataActual = new Array(maxGraphPoints).fill(0);
let graphDataTarget = new Array(maxGraphPoints).fill(0);

// Colors (match CSS)
const colTarget = '#06b6d4';
const colActual = '#d946ef';

// Physics System Base Class
class System {
    constructor() {
        this.angle = 0; // degrees
        this.velocity = 0; // degrees/sec
        this.acceleration = 0;

        // PID state
        this.integral = 0;
        this.prevError = 0;

        // Settings
        this.targetAngle = 0;
        this.kp = 1.0;
        this.ki = 0.0;
        this.kd = 0.5;
        this.maxTorque = 10000;
    }

    reset() {
        this.angle = 0;
        this.velocity = 0;
        this.acceleration = 0;
        this.integral = 0;
        this.prevError = 0;
    }

    applyCustomDisturbance() {
        // Sudden kick in velocity
        this.velocity += (Math.random() > 0.5 ? 300 : -300);
    }

    update(dt) {
        // Add noise to sensor reading if enabled
        let sensorAngle = this.angle;
        if (checkNoise.checked) {
            sensorAngle += (Math.random() * 4 - 2); // +/- 2 deg noise
        }

        // Calculate PID
        let error = this.targetAngle - sensorAngle;

        // Continuous disturbance
        if (checkContDist.checked) {
            // Unpredictable wind pushing on it
            error -= Math.sin(Date.now() / 1000) * 10;
        }

        // Anti-windup for integral
        if (Math.abs(error) < 50) {
            this.integral += error * dt;
        }

        // Clamp integral
        let iLim = 5000;
        this.integral = Math.max(-iLim, Math.min(iLim, this.integral));

        let derivative = (error - this.prevError) / dt;
        this.prevError = error;

        // Control Output (Torque)
        // We multiply by 100 to map the 0-5 slider range to realistic motor torque strengths
        // needed to fight the 500-1500 gravity magnitudes in the simulation
        let torque = ((this.kp * error) + (this.ki * this.integral) + (this.kd * derivative)) * 100;
        torque = Math.max(-this.maxTorque, Math.min(this.maxTorque, torque));

        this.applyPhysics(dt, torque);
    }

    applyPhysics(dt, torque) {
        // Implement in subclass
    }

    draw(ctx, width, height) {
        // Implement in subclass
    }
}

// Subclass: Rotating Arm (Pendulum with gravity pulling down, 0 deg is right, -90 is down)
class RotatingArm extends System {
    applyPhysics(dt, torque) {
        // Gravity torque depends on arm angle (-90 is straight down, stable. 90 is straight up, unstable)
        // 0 deg is horizontal right.
        // Let's assume gravity pulls towards -90 deg.
        let rad = (this.angle + 90) * Math.PI / 180;
        let gravityTorque = -900 * Math.sin(rad);

        // Friction
        let frictionTorque = -5 * this.velocity;

        this.acceleration = torque + gravityTorque + frictionTorque;
        this.velocity += this.acceleration * dt;

        // Limit velocity slightly
        this.velocity *= 0.99;

        this.angle += this.velocity * dt;
    }

    draw(ctx, width, height) {
        const cx = width / 2;
        const cy = height / 2;
        const armLength = Math.min(width, height) * 0.35;

        // Draw Base Motor
        ctx.beginPath();
        ctx.arc(cx, cy, 30, 0, Math.PI * 2);
        ctx.fillStyle = '#334155';
        ctx.fill();
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 4;
        ctx.stroke();

        // Target Line (dashed)
        let tRad = -this.targetAngle * Math.PI / 180; // Invert for canvas (up is neg y)
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(tRad) * armLength * 1.2, cy + Math.sin(tRad) * armLength * 1.2);
        ctx.strokeStyle = colTarget + '80'; // semi-transparent
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);

        // System Arm (Solid)
        let aRad = -this.angle * Math.PI / 180;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(aRad) * armLength, cy + Math.sin(aRad) * armLength);
        ctx.strokeStyle = colActual;
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Tip Node
        ctx.beginPath();
        ctx.arc(cx + Math.cos(aRad) * armLength, cy + Math.sin(aRad) * armLength, 12, 0, Math.PI * 2);
        ctx.fillStyle = '#f8fafc';
        ctx.fill();
    }
}

// Subclass: Self-Balancing Robot (Inverted Pendulum, 0 deg is upright)
class SelfBalancingRobot extends System {
    applyPhysics(dt, torque) {
        // Gravity pulls away from 0 deg! Unstable equilibrium.
        // If angle > 0, it accelerates positively.
        let rad = this.angle * Math.PI / 180;
        let gravityTorque = 1500 * Math.sin(rad);

        // Friction is low
        let frictionTorque = -2 * this.velocity;

        // Robot motor tries to counter-act
        // The torque here actually represents wheel acceleration moving the base under the robot
        this.acceleration = torque + gravityTorque + frictionTorque;

        this.velocity += this.acceleration * dt;
        this.velocity *= 0.99; // some dampening

        this.angle += this.velocity * dt;

        // If it falls over completely, it crashes (hits floor)
        if (Math.abs(this.angle) > 90) {
            this.angle = 90 * Math.sign(this.angle);
            this.velocity = 0;
            // Clear integral windup on crash
            this.integral = 0;
        }
    }

    draw(ctx, width, height) {
        const cx = width / 2;
        const cy = height * 0.7; // Lower center
        const heightRobot = Math.min(width, height) * 0.4;

        // Ground Line
        ctx.beginPath();
        ctx.moveTo(cx - 200, cy + 20);
        ctx.lineTo(cx + 200, cy + 20);
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 4;
        ctx.stroke();

        // Target Line (dashed upright)
        let tRad = -(this.targetAngle + 90) * Math.PI / 180;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(tRad) * heightRobot, cy + Math.sin(tRad) * heightRobot);
        ctx.strokeStyle = colTarget + '80';
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);

        // Robot Body (Pendulum)
        let aRad = -(this.angle + 90) * Math.PI / 180;
        let headX = cx + Math.cos(aRad) * heightRobot;
        let headY = cy + Math.sin(aRad) * heightRobot;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(headX, headY);
        ctx.strokeStyle = colActual;
        ctx.lineWidth = 16;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Robot Head (Heavy mass)
        ctx.beginPath();
        ctx.arc(headX, headY, 25, 0, Math.PI * 2);
        ctx.fillStyle = '#f43f5e'; // red mass
        ctx.fill();

        // Robot Wheel
        ctx.beginPath();
        ctx.arc(cx, cy, 20, 0, Math.PI * 2);
        ctx.fillStyle = '#94a3b8';
        ctx.fill();
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 4;
        ctx.stroke();
    }
}

// Current System Instance
let currentSystem = new RotatingArm();

// Resize Handler
function resizeCanvases() {
    const simRect = simCanvas.parentElement.getBoundingClientRect();
    simCanvas.width = simRect.width;
    simCanvas.height = simRect.height;

    const graphRect = graphCanvas.parentElement.getBoundingClientRect();
    if (graphRect.width > 0) {
        graphCanvas.width = graphRect.width;
        graphCanvas.height = graphRect.height;
    }
}
window.addEventListener('resize', resizeCanvases);

// Settings up UI Listeners
function updateParams() {
    currentSystem.kp = parseFloat(sliderP.value);
    currentSystem.ki = parseFloat(sliderI.value);
    currentSystem.kd = parseFloat(sliderD.value);
    currentSystem.targetAngle = parseFloat(sliderTarget.value);

    valP.innerText = currentSystem.kp.toFixed(1);
    valI.innerText = currentSystem.ki.toFixed(2);
    valD.innerText = currentSystem.kd.toFixed(2);
    valTarget.innerText = currentSystem.targetAngle.toFixed(0) + '°';
}

[sliderP, sliderI, sliderD, sliderTarget].forEach(s => s.addEventListener('input', updateParams));

modeSelect.addEventListener('change', (e) => {
    // Switch System
    if (e.target.value === 'arm') {
        currentSystem = new RotatingArm();
        currentModeLabel.innerText = "Rotating Arm";
    } else {
        currentSystem = new SelfBalancingRobot();
        currentModeLabel.innerText = "Self-Balancing Robot";

        // Robot specific defaults
        sliderP.value = 4.0;
        sliderI.value = 0.5;
        sliderD.value = 2.0;
        sliderTarget.value = 0; // Usually balances at 0
        updateParams();
    }

    // Clear Graph
    graphDataActual.fill(0);
    graphDataTarget.fill(0);
    updateParams();
});

btnReset.addEventListener('click', () => {
    currentSystem.reset();
    graphDataActual.fill(currentSystem.angle);
    graphDataTarget.fill(currentSystem.targetAngle);
});

btnDisturbance.addEventListener('click', () => {
    currentSystem.applyCustomDisturbance();
});

btnToggleGraph.addEventListener('click', () => {
    graphContainer.classList.toggle('hidden');
    if (graphContainer.classList.contains('hidden')) {
        btnToggleGraph.innerText = "Show Graph";
    } else {
        btnToggleGraph.innerText = "Hide Graph";
    }
});

// Presets
btnPresetUnder.addEventListener('click', () => {
    sliderP.value = 3.0; // High P
    sliderI.value = 0.0;
    sliderD.value = 0.1; // Low D
    updateParams();
});

btnPresetPerfect.addEventListener('click', () => {
    if (modeSelect.value === 'arm') {
        sliderP.value = 1.5;
        sliderI.value = 0.05;
        sliderD.value = 0.8;
    } else {
        sliderP.value = 4.0;
        sliderI.value = 0.05;
        sliderD.value = 1.0;
    }
    updateParams();
});

btnPresetOver.addEventListener('click', () => {
    if (modeSelect.value === 'arm') {
        sliderP.value = 0.5; // Weak P
        sliderI.value = 0.01;
        sliderD.value = 1.5; // High D
    } else {
        sliderP.value = 2.0;
        sliderI.value = 0.0;
        sliderD.value = 2.5;
    }
    updateParams();
});

btnStart.addEventListener('click', () => {
    isStarted = true;
    startOverlay.classList.add('hidden');
    // Keep lastTime fresh so physics don't jump when the overlay hides
    lastTime = performance.now();
});

// Main Loop
function frame(time) {
    if (!lastTime) {
        lastTime = time;
        animationFrameId = requestAnimationFrame(frame);
        return; // Skip the very first frame to establish a valid delta-time
    }
    let dt = (time - lastTime) / 1000;
    lastTime = time;

    // Cap dt for stability if switching tabs
    if (dt > 0.1) dt = 0.1;

    if (isStarted) {
        // 1. Process Physics
        currentSystem.update(dt);

        // 2. Update Graph Data
        graphDataActual.shift();
        graphDataActual.push(currentSystem.angle);

        graphDataTarget.shift();
        graphDataTarget.push(currentSystem.targetAngle);
    }

    // 3. Update Text Overlays (always run so they reflect initial state)
    lblActual.innerText = currentSystem.angle.toFixed(1);
    lblTarget.innerText = currentSystem.targetAngle.toFixed(1);

    // 4. Render Simulation
    simCtx.clearRect(0, 0, simCanvas.width, simCanvas.height);
    currentSystem.draw(simCtx, simCanvas.width, simCanvas.height);

    // 5. Render Graph
    if (!graphContainer.classList.contains('hidden')) {
        drawGraph();
    }

    animationFrameId = requestAnimationFrame(frame);
}

function drawGraph() {
    graphCtx.clearRect(0, 0, graphCanvas.width, graphCanvas.height);

    // Draw Grid / Center line
    graphCtx.strokeStyle = '#334155';
    graphCtx.lineWidth = 1;
    graphCtx.beginPath();
    graphCtx.moveTo(0, graphCanvas.height / 2);
    graphCtx.lineTo(graphCanvas.width, graphCanvas.height / 2);
    graphCtx.stroke();

    const w = graphCanvas.width;
    const h = graphCanvas.height;
    const paddingY = 20;
    const usableH = h - paddingY * 2;

    // We want to scale graph dynamically. Let's find max val or fixed range.
    // For angles mostly -180 to 180, but can overshoot. Let's fix range to -200 to 200.
    const maxRange = 200;

    const plotY = (val) => {
        let normalized = (val + maxRange) / (maxRange * 2); // 0 to 1
        normalized = Math.max(0, Math.min(1, normalized)); // clamp
        return h - (paddingY + normalized * usableH); // Y is inverted in canvas
    };

    // Draw Target Line
    graphCtx.beginPath();
    graphCtx.strokeStyle = colTarget;
    graphCtx.lineWidth = 2;
    graphDataTarget.forEach((val, i) => {
        let x = (i / maxGraphPoints) * w;
        let y = plotY(val);
        if (i === 0) graphCtx.moveTo(x, y);
        else graphCtx.lineTo(x, y);
    });
    graphCtx.stroke();

    // Draw Actual Line
    graphCtx.beginPath();
    graphCtx.strokeStyle = colActual;
    graphCtx.lineWidth = 2;
    graphDataActual.forEach((val, i) => {
        let x = (i / maxGraphPoints) * w;
        let y = plotY(val);
        if (i === 0) graphCtx.moveTo(x, y);
        else graphCtx.lineTo(x, y);
    });
    graphCtx.stroke();

    // Gradient overlay for visual fade
    let grad = graphCtx.createLinearGradient(0, 0, w / 3, 0);
    grad.addColorStop(0, 'rgba(30, 41, 59, 1)');
    grad.addColorStop(1, 'rgba(30, 41, 59, 0)');
    graphCtx.fillStyle = grad;
    graphCtx.fillRect(0, 0, w / 3, h);
}

// initialization
resizeCanvases();
updateParams();
requestAnimationFrame(frame);
