// ==========================================================================
// REFLEXRUN 3D - MAIN GAME CONTROLLER & WORKOUT ENGINE
// ==========================================================================

import { SceneManager } from './SceneManager.js';
import { Environment } from './Environment.js';
import { ObstacleManager } from './ObstacleManager.js';
import { MonsterManager } from './MonsterManager.js';
import { PlayerHands } from './PlayerHands.js';
import { SoundManager } from '../audio/SoundManager.js';
import { Calibrator } from '../cv/Calibrator.js';
import { PoseDetector } from '../cv/PoseDetector.js';
import { PerformanceMonitor } from '../cv/PerformanceMonitor.js';
import { UIManager } from '../ui/UIManager.js';

export class GameController {
  constructor() {
    this.container = document.getElementById('game-container');

    // Subsystems
    this.sceneManager = new SceneManager(this.container);
    this.environment = new Environment(this.sceneManager.scene);
    this.obstacleManager = new ObstacleManager(this.sceneManager.scene);
    this.monsterManager = new MonsterManager(this.sceneManager.scene);
    this.playerHands = new PlayerHands(this.sceneManager.camera);
    this.sound = new SoundManager();
    this.ui = new UIManager();

    this.poseDetector = new PoseDetector();
    this.calibrator = new Calibrator(this.poseDetector);
    this.performanceMonitor = new PerformanceMonitor(this.poseDetector);

    // Asynchronous Vision Pipeline State (Decoupled from 60 FPS 3D Render Loop)
    this._isInferringPose = false;
    this._latestPose = null;
    this._latestMotion = null;

    // Player State
    this.playerZ = 0;
    this.runSpeed = 10.5; // m/s (~38 km/h)
    this.targetLaneX = 0; // -2.8 (Left), 0 (Center), 2.8 (Right)
    this.isJumping = false;
    this.isSquatting = false;

    // Keyboard Fallback State
    this.keys = {};
    this.keyboardJumpTimer = 0;
    this.keyboardSquatTimer = 0;

    // Workout Metrics State
    this.isRunning = false;
    this.isPaused = false;
    this.score = 0;
    this.distance = 0;
    this.lives = 3;
    this.combo = 0;
    this.comboMultiplier = 1;
    this.maxCombo = 1;
    this.comboTimer = 0;
    this.elapsedSeconds = 0;
    this.caloriesBurned = 0;
    this.estimatedBpm = 120;

    this.reps = {
      jumps: 0,
      squats: 0,
      punches: 0,
      steps: 0,
    };

    // Clock
    this.lastTime = performance.now();

    // Tutorial State
    this.tutorialStep = 0;
    this.tutorialTotalSteps = 6; // 0=intro, 1=jump, 2=squat, 3=step, 4=punch, 5=ready
    this.isTutorialActive = false;
    this.tutorialDetected = { jump: false, squat: false, step: false, punch: false };
    this.tutAdvanceTimeout = null;
    this.tutStep3StartLane = undefined;

    this.initEventListeners();
  }

  async init() {
    // Initialize pose detector (loads MediaPipe WASM + BlazePose model) and sound
    await this.poseDetector.init();
    this.initCalibrationUI();
  }

  initEventListeners() {
    // Keyboard inputs for manual testing and hybrid play
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;

      if (e.code === 'KeyW' || e.code === 'Space' || e.code === 'ArrowUp') {
        if (this.isTutorialActive) {
          this.processTutorialKeyboard('jump');
        }
        this.triggerJump();
      } else if (e.code === 'KeyS' || e.code === 'ArrowDown') {
        if (this.isTutorialActive) {
          this.processTutorialKeyboard('squat');
        }
        this.triggerSquat();
      } else if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
        if (this.isTutorialActive) {
          this.processTutorialKeyboard('step');
        }
        this.targetLaneX = Math.max(-2.8, this.targetLaneX - 2.8);
        this.reps.steps++;
        this.ui.bumpRep('steps');
      } else if (e.code === 'KeyD' || e.code === 'ArrowRight') {
        if (this.isTutorialActive) {
          this.processTutorialKeyboard('step');
        }
        this.targetLaneX = Math.min(2.8, this.targetLaneX + 2.8);
        this.reps.steps++;
        this.ui.bumpRep('steps');
      } else if (e.code === 'KeyJ') {
        if (this.isTutorialActive) {
          this.processTutorialKeyboard('punch');
        }
        this.triggerPunch('left');
      } else if (e.code === 'KeyK' || e.code === 'KeyF') {
        if (this.isTutorialActive) {
          this.processTutorialKeyboard('punch');
        }
        this.triggerPunch('right');
      } else if (e.code === 'Escape') {
        this.togglePause();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    // UI Buttons
    document.getElementById('btn-audio')?.addEventListener('click', () => {
      const active = this.sound.toggleMute();
      document.getElementById('btn-audio').textContent = active ? '🔊' : '🔇';
    });

    document.getElementById('btn-pause')?.addEventListener('click', () => {
      this.togglePause();
    });

    document.getElementById('btn-resume')?.addEventListener('click', () => {
      this.togglePause();
    });

    document.getElementById('btn-restart')?.addEventListener('click', () => {
      this.startRun();
    });

    document.getElementById('btn-quit')?.addEventListener('click', () => {
      this.endRun();
    });

    document.getElementById('btn-recalibrate')?.addEventListener('click', () => {
      this.isPaused = false;
      this.isRunning = false;
      this.sound.stopMusic();
      this.ui.showModal('calibration');
    });

    document.getElementById('btn-adjust-calib')?.addEventListener('click', () => {
      this.ui.showModal('calibration');
    });

    // PIP minimize, close, and HUD toggle buttons
    document.getElementById('btn-toggle-pip')?.addEventListener('click', () => {
      const pip = document.getElementById('webcam-pip');
      pip?.classList.toggle('minimized');
    });

    document.getElementById('btn-close-pip')?.addEventListener('click', () => {
      const pip = document.getElementById('webcam-pip');
      pip?.classList.add('hidden');
    });

    document.getElementById('btn-pip-hud')?.addEventListener('click', () => {
      const pip = document.getElementById('webcam-pip');
      pip?.classList.toggle('hidden');
    });
  }

  initCalibrationUI() {
    const video = document.getElementById('calib-video');
    const pipVideo = document.getElementById('webcam-video');
    const statusText = document.getElementById('calib-status-text');
    const countdownEl = document.getElementById('calib-countdown');
    const silhouette = document.getElementById('silhouette-guide');

    // Initialize all sensitivity sliders, badges, and mirror steering controls
    this.initSensitivityControls();

    // Setup camera stream
    this.calibrator.setupCamera(video).then((success) => {
      const tutVideo = document.getElementById('tut-video');
      if (success) {
        if (pipVideo) {
          pipVideo.srcObject = this.calibrator.stream;
          pipVideo.play().catch(() => {});
        }
        if (tutVideo) {
          tutVideo.srcObject = this.calibrator.stream;
          tutVideo.play().catch(() => {});
        }
        statusText.textContent = 'Camera ready! Step back so head & torso fit in frame.';
      } else {
        statusText.textContent = 'Webcam unavailable. You can play using Keyboard Controls [W, A, S, D, J, K]!';
      }
    });

    // START RUN NOW button (starts game immediately)
    document.getElementById('btn-play-now')?.addEventListener('click', () => {
      this.startRun();
    });

    // Start calibration button (runs 3s countdown, locks baseline, and starts run)
    document.getElementById('btn-start-calibration')?.addEventListener('click', () => {
      countdownEl.classList.remove('hidden');
      this.calibrator.startCalibration(
        (countdown) => {
          countdownEl.textContent = countdown;
        },
        () => {
          countdownEl.classList.add('hidden');
          statusText.textContent = 'Calibration LOCKED! Starting run...';
          silhouette?.classList.add('aligned');
          setTimeout(() => {
            this.startRun();
          }, 600);
        }
      );
    });

    // Open tutorial button
    document.getElementById('btn-open-tutorial')?.addEventListener('click', () => {
      this.startTutorial();
    });

    // Backward compatibility for quick-start button
    document.getElementById('btn-quick-start')?.addEventListener('click', () => {
      this.startRun();
    });
  }

  initSensitivityControls() {
    this.syncSensitivityUI();

    const onJumpChange = (val) => {
      this.calibrator.setJumpSensitivity(parseFloat(val) / 100);
      this.syncSensitivityUI();
      this.redrawActiveCanvas();
    };

    const onSquatChange = (val) => {
      this.calibrator.setSquatSensitivity(parseFloat(val) / 100);
      this.syncSensitivityUI();
      this.redrawActiveCanvas();
    };

    const onStepChange = (val) => {
      this.calibrator.setStepSensitivity(parseFloat(val) / 100);
      this.syncSensitivityUI();
      this.redrawActiveCanvas();
    };

    const onPunchChange = (val) => {
      this.calibrator.setPunchSensitivity(parseFloat(val) / 100);
      this.syncSensitivityUI();
      this.redrawActiveCanvas();
    };

    const onInvertChange = (checked) => {
      this.calibrator.setInvertX(checked);
      this.syncSensitivityUI();
      this.redrawActiveCanvas();
    };

    const onRequireFistChange = (checked) => {
      this.calibrator.setRequireFist(checked);
      this.syncSensitivityUI();
      this.redrawActiveCanvas();
    };

    const onStepLockChange = (checked) => {
      this.calibrator.setSuppressPunchOnStep(checked);
      this.syncSensitivityUI();
      this.redrawActiveCanvas();
    };

    const onReset = () => {
      this.calibrator.resetDefaults();
      this.syncSensitivityUI();
      this.redrawActiveCanvas();
      this.sound.playComboChime(1);
    };

    // Calibration modal inputs
    document.getElementById('slider-jump')?.addEventListener('input', (e) => onJumpChange(e.target.value));
    document.getElementById('slider-squat')?.addEventListener('input', (e) => onSquatChange(e.target.value));
    document.getElementById('slider-step')?.addEventListener('input', (e) => onStepChange(e.target.value));
    document.getElementById('slider-punch')?.addEventListener('input', (e) => onPunchChange(e.target.value));
    document.getElementById('toggle-invert-x')?.addEventListener('change', (e) => onInvertChange(e.target.checked));
    document.getElementById('toggle-require-fist')?.addEventListener('change', (e) => onRequireFistChange(e.target.checked));
    document.getElementById('toggle-step-lock')?.addEventListener('change', (e) => onStepLockChange(e.target.checked));
    document.getElementById('btn-reset-sensitivity')?.addEventListener('click', onReset);

    // Tutorial modal inputs
    document.getElementById('tut-slider-jump')?.addEventListener('input', (e) => onJumpChange(e.target.value));
    document.getElementById('tut-slider-squat')?.addEventListener('input', (e) => onSquatChange(e.target.value));
    document.getElementById('tut-slider-step')?.addEventListener('input', (e) => onStepChange(e.target.value));
    document.getElementById('tut-slider-punch')?.addEventListener('input', (e) => onPunchChange(e.target.value));
    document.getElementById('tut-toggle-invert-x')?.addEventListener('change', (e) => onInvertChange(e.target.checked));
    document.getElementById('tut-toggle-require-fist')?.addEventListener('change', (e) => onRequireFistChange(e.target.checked));
    document.getElementById('tut-toggle-step-lock')?.addEventListener('change', (e) => onStepLockChange(e.target.checked));
    document.getElementById('btn-tut-reset-sensitivity')?.addEventListener('click', onReset);
  }

  syncSensitivityUI() {
    const jumpVal = Math.round(this.calibrator.jumpSensitivity * 100);
    const squatVal = Math.round(this.calibrator.squatSensitivity * 100);
    const stepVal = Math.round(this.calibrator.stepSensitivity * 100);
    const punchVal = Math.round(this.calibrator.punchSensitivity * 100);
    const invertVal = this.calibrator.invertX;
    const requireFistVal = this.calibrator.requireFist;
    const stepLockVal = this.calibrator.suppressPunchOnStep;

    // Sliders
    const sJump = document.getElementById('slider-jump');
    const sSquat = document.getElementById('slider-squat');
    const sStep = document.getElementById('slider-step');
    const sPunch = document.getElementById('slider-punch');
    const tInvert = document.getElementById('toggle-invert-x');
    const tFist = document.getElementById('toggle-require-fist');
    const tStepLock = document.getElementById('toggle-step-lock');

    const tutSJump = document.getElementById('tut-slider-jump');
    const tutSSquat = document.getElementById('tut-slider-squat');
    const tutSStep = document.getElementById('tut-slider-step');
    const tutSPunch = document.getElementById('tut-slider-punch');
    const tutTInvert = document.getElementById('tut-toggle-invert-x');
    const tutTFist = document.getElementById('tut-toggle-require-fist');
    const tutTStepLock = document.getElementById('tut-toggle-step-lock');

    if (sJump) sJump.value = jumpVal;
    if (sSquat) sSquat.value = squatVal;
    if (sStep) sStep.value = stepVal;
    if (sPunch) sPunch.value = punchVal;
    if (tInvert) tInvert.checked = invertVal;
    if (tFist) tFist.checked = requireFistVal;
    if (tStepLock) tStepLock.checked = stepLockVal;

    if (tutSJump) tutSJump.value = jumpVal;
    if (tutSSquat) tutSSquat.value = squatVal;
    if (tutSStep) tutSStep.value = stepVal;
    if (tutSPunch) tutSPunch.value = punchVal;
    if (tutTInvert) tutTInvert.checked = invertVal;
    if (tutTFist) tutTFist.checked = requireFistVal;
    if (tutTStepLock) tutTStepLock.checked = stepLockVal;

    // Numerical badges
    const setTxt = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };

    setTxt('val-jump', `${jumpVal}%`);
    setTxt('val-squat', `${squatVal}%`);
    setTxt('val-step', `${stepVal}%`);
    setTxt('val-punch', `${punchVal}%`);

    setTxt('tut-val-jump', `${jumpVal}%`);
    setTxt('tut-val-squat', `${squatVal}%`);
    setTxt('tut-val-step', `${stepVal}%`);
    setTxt('tut-val-punch', `${punchVal}%`);
  }

  redrawActiveCanvas() {
    if (!this._latestPose) return;
    const calibModal = document.getElementById('calibration-modal');
    if (calibModal && !calibModal.classList.contains('hidden')) {
      const calibCanvas = document.getElementById('calib-canvas');
      if (calibCanvas) this.calibrator.drawSkeleton(calibCanvas, this._latestPose, true);
    }
    if (this.isTutorialActive) {
      const tutCanvas = document.getElementById('tut-skeleton-canvas');
      if (tutCanvas) this.calibrator.drawSkeleton(tutCanvas, this._latestPose, true);
    }
  }

  getActiveVideo() {
    // If tutorial modal is visible, sample from tutorial video
    if (this.isTutorialActive) {
      const tutVideo = document.getElementById('tut-video');
      if (tutVideo && tutVideo.videoWidth > 0 && !tutVideo.paused) return tutVideo;
    }

    // If calibration modal is visible, sample from calib video
    const calibModal = document.getElementById('calibration-modal');
    if (calibModal && !calibModal.classList.contains('hidden')) {
      const calibVideo = document.getElementById('calib-video');
      if (calibVideo && calibVideo.videoWidth > 0) return calibVideo;
    }

    // While in-game or paused, sample from PIP video
    const pipVideo = document.getElementById('webcam-video');
    if (pipVideo && pipVideo.videoWidth > 0) return pipVideo;

    // Fallback to any ready video element
    const all = [
      document.getElementById('tut-video'),
      document.getElementById('webcam-video'),
      document.getElementById('calib-video'),
    ];
    return all.find((v) => v && v.videoWidth > 0) || null;
  }

  startRun() {
    if (this.tutAdvanceTimeout) {
      clearTimeout(this.tutAdvanceTimeout);
      this.tutAdvanceTimeout = null;
    }
    this.isTutorialActive = false;
    this.ui.hideAllModals();
    this.ui.hideActionPrompt();
    this.ui.showHud(true);

    // Guaranteed cleanup of any leftover backdrop or countdown
    ['calibration-modal', 'tutorial-modal', 'pause-modal', 'summary-modal', 'calib-countdown'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });

    // Reset game state
    this.playerZ = 0;
    this.runSpeed = 10.5;
    this.targetLaneX = 0;
    this.score = 0;
    this.distance = 0;
    this.lives = 3;
    this.combo = 0;
    this.comboMultiplier = 1;
    this.maxCombo = 1;
    this.comboTimer = 0;
    this.elapsedSeconds = 0;
    this.caloriesBurned = 0;
    this.estimatedBpm = 120;

    this.reps = { jumps: 0, squats: 0, punches: 0, steps: 0 };

    this.obstacleManager.reset();
    this.monsterManager.reset();

    this.isRunning = true;
    this.isPaused = false;
    this.lastTime = performance.now();

    this.sound.startMusic();
    this.sound.speakPrompt('Run!');
  }

  // =====================================================
  // TUTORIAL SYSTEM
  // =====================================================
  startTutorial() {
    this.sound.ensureContext();
    if (this.tutAdvanceTimeout) {
      clearTimeout(this.tutAdvanceTimeout);
      this.tutAdvanceTimeout = null;
    }
    this.tutorialStep = 0;
    this.isTutorialActive = true;
    this.tutorialDetected = { jump: false, squat: false, step: false, punch: false };
    this.tutStep3StartLane = undefined;

    // Connect tutorial video element to camera stream
    const tutVideo = document.getElementById('tut-video');
    if (tutVideo && this.calibrator.stream) {
      if (tutVideo.srcObject !== this.calibrator.stream) {
        tutVideo.srcObject = this.calibrator.stream;
      }
      tutVideo.play().catch(() => {});
    }

    // Auto-center baseline from current stance if available
    if (this._latestPose && !this.calibrator.isCalibrated) {
      this.calibrator.lockBaselineFromPose(this._latestPose);
    }

    this.ui.showModal('tutorial');
    this.updateTutorialUI();
    this.initTutorialEventListeners();
  }

  initTutorialEventListeners() {
    // Prevent double-binding
    if (this._tutListenersAdded) return;
    this._tutListenersAdded = true;

    document.getElementById('btn-tut-next')?.addEventListener('click', () => {
      this.tutorialNext();
    });

    document.getElementById('btn-tut-prev')?.addEventListener('click', () => {
      this.tutorialPrev();
    });

    document.getElementById('btn-skip-tutorial')?.addEventListener('click', () => {
      if (this.tutAdvanceTimeout) {
        clearTimeout(this.tutAdvanceTimeout);
        this.tutAdvanceTimeout = null;
      }
      this.isTutorialActive = false;
      this.ui.hideAllModals();
      this.startRun();
    });

    // Re-center baseline button in tutorial camera window
    document.getElementById('btn-tut-recalibrate')?.addEventListener('click', () => {
      if (this._latestPose) {
        this.calibrator.lockBaselineFromPose(this._latestPose);
        const hint = document.getElementById('tut-cam-status-hint');
        if (hint) {
          hint.textContent = '✅ Baseline locked to your current standing height!';
          hint.style.color = '#00e676';
          setTimeout(() => {
            hint.textContent = 'Stand 5-7 ft back with head & torso visible';
            hint.style.color = '';
          }, 2500);
        }
        this.sound.playComboChime(2);
      } else {
        const hint = document.getElementById('tut-cam-status-hint');
        if (hint) {
          hint.textContent = 'Stand in frame first!';
        }
      }
    });
  }

  tutorialNext() {
    if (this.tutAdvanceTimeout) {
      clearTimeout(this.tutAdvanceTimeout);
      this.tutAdvanceTimeout = null;
    }

    if (this.tutorialStep < this.tutorialTotalSteps - 1) {
      this.tutorialStep++;
      if (this.tutorialStep === 3) {
        this.tutStep3StartLane = this.currentLaneX;
      }
      this.updateTutorialUI();
    } else {
      // Last step: start the game
      this.isTutorialActive = false;
      this.ui.hideAllModals();
      this.startRun();
    }
  }

  tutorialPrev() {
    if (this.tutAdvanceTimeout) {
      clearTimeout(this.tutAdvanceTimeout);
      this.tutAdvanceTimeout = null;
    }

    if (this.tutorialStep > 0) {
      this.tutorialStep--;
      if (this.tutorialStep === 3) {
        this.tutStep3StartLane = this.currentLaneX;
      }
      this.updateTutorialUI();
    }
  }

  updateTutorialUI() {
    // Update progress bar
    const progress = ((this.tutorialStep + 1) / this.tutorialTotalSteps) * 100;
    const progressFill = document.getElementById('tutorial-progress-fill');
    if (progressFill) progressFill.style.width = `${progress}%`;

    // Update step badge
    const badge = document.getElementById('tut-step-badge');
    if (badge) badge.textContent = `STEP ${this.tutorialStep + 1} / ${this.tutorialTotalSteps}`;

    // Show active step, hide others
    for (let i = 0; i < this.tutorialTotalSteps; i++) {
      const stepEl = document.getElementById(`tut-step-${i}`);
      if (stepEl) {
        stepEl.classList.toggle('active', i === this.tutorialStep);
      }
    }

    // Update nav button states
    const prevBtn = document.getElementById('btn-tut-prev');
    const nextBtn = document.getElementById('btn-tut-next');

    if (prevBtn) prevBtn.disabled = (this.tutorialStep === 0);
    if (nextBtn) {
      nextBtn.textContent = (this.tutorialStep === this.tutorialTotalSteps - 1) ? 'START RUN! ⚡' : 'NEXT →';
    }

    // Pure visual sync of detection rings - NEVER call markTutDetected or set timers here!
    const practiceMoves = [
      { key: 'jump', name: 'JUMP' },
      { key: 'squat', name: 'SQUAT' },
      { key: 'step', name: 'SIDE-STEP' },
      { key: 'punch', name: 'PUNCH' },
    ];

    practiceMoves.forEach(({ key, name }) => {
      const ring = document.getElementById(`tut-detect-${key}`);
      const status = document.getElementById(`tut-status-${key}`);
      const isDetected = Boolean(this.tutorialDetected[key]);
      if (ring) {
        ring.classList.toggle('detected', isDetected);
      }
      if (status) {
        status.textContent = isDetected ? `${name} DETECTED! ✓` : `Waiting for ${name}...`;
      }
    });
  }

  markTutDetected(move) {
    const practiceSteps = { 1: 'jump', 2: 'squat', 3: 'step', 4: 'punch' };
    // Only accept detection for the CURRENT active practice step!
    if (practiceSteps[this.tutorialStep] !== move) return;

    const ringId = `tut-detect-${move}`;
    const statusId = `tut-status-${move}`;
    const ring = document.getElementById(ringId);
    const status = document.getElementById(statusId);

    if (ring && !ring.classList.contains('detected')) {
      ring.classList.add('detected');
      if (status) status.textContent = `${move.toUpperCase()} DETECTED! ✓`;
      this.sound.playComboChime(2);

      // Cancel any existing auto-advance timer to avoid stacking
      if (this.tutAdvanceTimeout) {
        clearTimeout(this.tutAdvanceTimeout);
      }

      // Auto-advance to the next step after a clear, satisfying 1.2s delay
      this.tutAdvanceTimeout = setTimeout(() => {
        this.tutAdvanceTimeout = null;
        if (this.isTutorialActive && practiceSteps[this.tutorialStep] === move) {
          this.tutorialNext();
        }
      }, 1200);
    }
  }

  // Called from the main update loop when tutorial is active
  processTutorialInput(motion) {
    if (!this.isTutorialActive) return;

    // Step 1 (index 1): Detect JUMP
    if (this.tutorialStep === 1 && motion.isJumping && !this.tutorialDetected.jump) {
      this.tutorialDetected.jump = true;
      this.markTutDetected('jump');
    }
    // Step 2 (index 2): Detect SQUAT
    else if (this.tutorialStep === 2 && motion.isSquatting && !this.tutorialDetected.squat) {
      this.tutorialDetected.squat = true;
      this.markTutDetected('squat');
    }
    // Step 3 (index 3): Detect SIDE STEP
    else if (this.tutorialStep === 3 && !this.tutorialDetected.step) {
      if (this.tutStep3StartLane === undefined) {
        this.tutStep3StartLane = this.currentLaneX;
      }
      const hasLaneSwitched = motion.laneChanged || (this.currentLaneX !== this.tutStep3StartLane);
      if (hasLaneSwitched) {
        this.tutorialDetected.step = true;
        this.markTutDetected('step');
      }
    }
    // Step 4 (index 4): Detect PUNCH
    else if (this.tutorialStep === 4 && (motion.punchTriggered || motion.action === 'PUNCH') && !this.tutorialDetected.punch) {
      this.tutorialDetected.punch = true;
      this.triggerPunch(motion.punchSide || 'right');
      this.markTutDetected('punch');
    }
  }

  // Handle keyboard-triggered tutorial detection
  processTutorialKeyboard(move) {
    if (!this.isTutorialActive) return;
    const stepMoveMap = { 1: 'jump', 2: 'squat', 3: 'step', 4: 'punch' };
    const expectedMove = stepMoveMap[this.tutorialStep];
    if (move === expectedMove && !this.tutorialDetected[move]) {
      this.tutorialDetected[move] = true;
      if (move === 'punch') {
        this.triggerPunch('right');
      }
      this.markTutDetected(move);
    }
  }

  togglePause() {
    if (!this.isRunning) return;
    this.isPaused = !this.isPaused;
    if (this.isPaused) {
      this.sound.stopMusic();
      this.ui.showModal('pause');
    } else {
      this.sound.startMusic();
      this.ui.hideAllModals();
      this.lastTime = performance.now();
    }
  }

  triggerJump() {
    this.isJumping = true;
    this.keyboardJumpTimer = 0.55; // 550ms jump air-time
    this.sound.playJumpWhoosh();
    this.reps.jumps++;
    this.ui.bumpRep('jumps');
  }

  triggerSquat() {
    this.isSquatting = true;
    this.keyboardSquatTimer = 0.65; // 650ms slide duration
    this.sound.playSlideScrape();
    this.reps.squats++;
    this.ui.bumpRep('squats');
  }

  triggerPunch(side = 'right') {
    this.playerHands.triggerPunch(side);
    this.sound.playPunchImpact();
    this.reps.punches++;
    this.ui.bumpRep('punches');

    // Check if monster in reach
    const hit = this.monsterManager.checkPunchHit(this.playerZ, this.targetLaneX);
    if (hit) {
      this.ui.hideActionPrompt();
      this.sound.playMonsterShatter();
      this.sceneManager.triggerShake(0.5);
      this.ui.triggerHitFlash();
      this.addCombo(250);
      this.ui.showFeedback('CRUSHED! +250', 'crushed');
    }
  }

  addCombo(points = 100) {
    this.combo++;
    this.comboTimer = 3.5; // Combo hold window
    this.comboMultiplier = Math.min(8, 1 + Math.floor(this.combo / 4));
    if (this.comboMultiplier > this.maxCombo) {
      this.maxCombo = this.comboMultiplier;
    }
    this.score += points * this.comboMultiplier;
    this.sound.playComboChime(this.comboMultiplier);
    this.sound.setBpm(128 + this.comboMultiplier * 3);
  }

  resetCombo() {
    this.combo = 0;
    this.comboMultiplier = 1;
    this.sound.setBpm(128);
  }

  takeDamage() {
    this.lives--;
    this.resetCombo();
    this.sound.playDamage();
    this.sceneManager.triggerShake(0.65);
    this.ui.triggerDamageVfx();
    this.ui.showFeedback('HIT! -1 STAMINA', 'miss');

    if (this.lives <= 0) {
      this.endRun();
    }
  }

  endRun() {
    this.isRunning = false;
    this.sound.stopMusic();
    this.sound.speakPrompt('Workout Complete!');

    this.ui.showWorkoutSummary({
      score: this.score,
      distance: this.distance,
      maxCombo: this.maxCombo,
      elapsedSeconds: this.elapsedSeconds,
      caloriesBurned: this.caloriesBurned,
      reps: this.reps,
    });
  }

  // Obstacle event handler
  handleObstacleEvent(event, type, obs) {
    if (event === 'APPROACHING') {
      if (type === 'JUMP') {
        this.ui.showActionPrompt('JUMP', 'HOP OVER SPIKES');
        this.sound.speakPrompt('Jump!');
      } else if (type === 'SLIDE') {
        this.ui.showActionPrompt('SLIDE', 'DUCK UNDER BLADES');
        this.sound.speakPrompt('Slide!');
      } else if (type === 'STEP') {
        this.ui.showActionPrompt('DODGE', 'CLEAR THE LANE');
        this.sound.speakPrompt('Step!');
      }
    } else if (event === 'SUCCESS') {
      this.ui.hideActionPrompt();
      this.addCombo(150);
      this.ui.showFeedback('PERFECT! +150', 'perfect');
      if (type === 'JUMP') this.ui.bumpRep('jumps');
      if (type === 'SLIDE') this.ui.bumpRep('squats');
      if (type === 'STEP') this.ui.bumpRep('steps');
    } else if (event === 'HIT') {
      this.ui.hideActionPrompt();
      this.takeDamage();
    }
  }

  handleMonsterEvent(event, monster) {
    if (event === 'APPROACHING') {
      this.ui.showActionPrompt('PUNCH', 'SHATTER GOLEM');
      this.sound.speakPrompt('Punch!');
    } else if (event === 'ATTACK') {
      this.ui.hideActionPrompt();
      this.takeDamage();
    }
  }

  // Asynchronous camera vision pipeline (completely decoupled from 60 FPS 3D render loop)
  scheduleCameraProcessing() {
    if (this._isInferringPose) return;
    const activeVideo = this.getActiveVideo();
    if (!activeVideo || activeVideo.videoWidth === 0 || activeVideo.paused) return;

    this._isInferringPose = true;
    this.poseDetector.estimatePose(activeVideo).then((pose) => {
      this._isInferringPose = false;
      if (!pose) return;

      this._latestPose = pose;
      const motion = this.calibrator.processFrame(pose);
      this._latestMotion = motion;

      // Render camera canvas overlays & UI meters
      this.renderCameraOverlays(pose, motion);

      // In-game pose action triggers
      if (this.isRunning && !this.isPaused) {
        // Continuous squat tracking (motion tracking holds squat naturally without timer cutoff)
        if (this.keyboardSquatTimer <= 0) {
          if (motion.isSquatting && !this.isSquatting) {
            this.sound.playSlideScrape();
            this.reps.squats++;
            this.ui.bumpRep('squats');
          }
          this.isSquatting = Boolean(motion.isSquatting);
        }

        // Continuous jump tracking
        if (this.keyboardJumpTimer <= 0) {
          if (motion.isJumping && !this.isJumping) {
            this.sound.playJumpWhoosh();
            this.reps.jumps++;
            this.ui.bumpRep('jumps');
          }
          this.isJumping = Boolean(motion.isJumping);
        }

        if (motion.punchTriggered) {
          this.triggerPunch(motion.punchSide || 'right');
        }
        // Lateral lane tracking from body position
        if (Math.abs(motion.laneX - this.targetLaneX) > 1.5) {
          this.targetLaneX = motion.laneX;
          this.reps.steps++;
          this.ui.bumpRep('steps');
        }
      }
    }).catch((err) => {
      this._isInferringPose = false;
      console.warn('Pose inference error:', err);
    });
  }

  renderCameraOverlays(pose, motion) {
    if (!pose || !motion) return;

    // 1. Calibration Screen: Render live skeleton and diagnostic meters
    const calibModal = document.getElementById('calibration-modal');
    if (calibModal && !calibModal.classList.contains('hidden')) {
      const calibCanvas = document.getElementById('calib-canvas');
      const calibVideo = document.getElementById('calib-video');
      if (calibCanvas && calibVideo) {
        const targetW = calibVideo.clientWidth || 400;
        const targetH = calibVideo.clientHeight || 300;
        if (calibCanvas.width !== targetW) calibCanvas.width = targetW;
        if (calibCanvas.height !== targetH) calibCanvas.height = targetH;
        this.calibrator.drawSkeleton(calibCanvas, pose, true);
      }

      // Diagnostic meters in Calibration Screen
      const vertVal = document.getElementById('meter-vert-val');
      const latVal = document.getElementById('meter-lat-val');
      const punchFill = document.getElementById('meter-punch-fill');
      const silhouette = document.getElementById('silhouette-guide');
      const statusText = document.getElementById('calib-status-text');

      if (vertVal) {
        const vPercent = Math.max(5, Math.min(95, 50 + (motion.deltaY / 0.25) * 50));
        vertVal.style.top = `${vPercent}%`;
      }
      if (latVal) {
        const lPercent = Math.max(5, Math.min(95, 50 + (motion.deltaX / 0.25) * 50));
        latVal.style.left = `${lPercent}%`;
      }
      if (punchFill) {
        punchFill.style.width = `${Math.round(motion.punchReach || 0)}%`;
      }
      // Alignment check
      const isCentered = Math.abs(pose.midShoulderX - 0.5) < 0.18;
      const isGoodDist = pose.torsoHeight > 0.16 && pose.torsoHeight < 0.65;
      if (silhouette) {
        if (isCentered && isGoodDist && pose.confidence > 0.25) {
          silhouette.classList.add('aligned');
          if (!this.calibrator.isCalibrating && statusText) {
            statusText.textContent = 'READY! Alignment locked. Press CALIBRATE CAMERA.';
          }
        } else {
          silhouette.classList.remove('aligned');
        }
      }
    }

    // 2. Tutorial Screen: Render live skeleton, camera action pill, and motion levels
    if (this.isTutorialActive) {
      const tutCanvas = document.getElementById('tut-skeleton-canvas');
      const tutVideo = document.getElementById('tut-video');
      if (tutCanvas && tutVideo) {
        const targetW = tutVideo.clientWidth || 320;
        const targetH = tutVideo.clientHeight || 220;
        if (tutCanvas.width !== targetW) tutCanvas.width = targetW;
        if (tutCanvas.height !== targetH) tutCanvas.height = targetH;
        this.calibrator.drawSkeleton(tutCanvas, pose, true);
      }

      // Action badge in tutorial camera
      const tutActionPill = document.getElementById('tut-cam-action-pill');
      if (tutActionPill) {
        tutActionPill.textContent = motion.action;
        tutActionPill.className = `tut-cam-action-pill ${motion.action.toLowerCase().replace(/\s+/g, '-')}`;
      }

      // Vertical height pin
      const heightPin = document.getElementById('tut-height-pin');
      if (heightPin) {
        const hPercent = Math.max(0, Math.min(100, 50 + (motion.deltaY / 0.25) * 50));
        heightPin.style.top = `${hPercent}%`;
      }

      // Lateral pin
      const latPin = document.getElementById('tut-lat-pin');
      if (latPin) {
        const lPercent = Math.max(5, Math.min(95, 50 + (motion.deltaX / 0.25) * 50));
        latPin.style.left = `${lPercent}%`;
      }

      // Punch reach fill
      const tutPunchFill = document.getElementById('tut-punch-fill');
      if (tutPunchFill) {
        tutPunchFill.style.width = `${Math.round(motion.punchReach || 0)}%`;
      }

      // Lane marks in tutorial viewport
      const markLeft = document.getElementById('tut-mark-left');
      const markCenter = document.getElementById('tut-mark-center');
      const markRight = document.getElementById('tut-mark-right');
      if (markLeft && markCenter && markRight) {
        markLeft.classList.toggle('active', motion.laneX < -1);
        markCenter.classList.toggle('active', Math.abs(motion.laneX) <= 1);
        markRight.classList.toggle('active', motion.laneX > 1);
      }

      // Feed motion to tutorial step detector
      this.processTutorialInput(motion);
    }

    // 3. Game Run / In-Game HUD: Render on PIP canvas
    const pipCanvas = document.getElementById('webcam-skeleton-canvas');
    const pipVideo = document.getElementById('webcam-video');
    if (pipCanvas && pipVideo) {
      const targetW = pipVideo.clientWidth || 220;
      const targetH = pipVideo.clientHeight || 150;
      if (pipCanvas.width !== targetW) pipCanvas.width = targetW;
      if (pipCanvas.height !== targetH) pipCanvas.height = targetH;
      this.calibrator.drawSkeleton(pipCanvas, pose, false);
    }

    // Update PIP tag
    this.ui.updatePipTag(motion.action);
  }

  // 60 FPS Continuous 3D Game Render Loop (Never blocked by CV inference)
  update() {
    const now = performance.now();
    const delta = Math.min(0.06, (now - this.lastTime) / 1000);
    this.lastTime = now;

    // Asynchronously dispatch camera pose detection in background
    this.scheduleCameraProcessing();

    // Process Game Loop if Running
    if (this.isRunning && !this.isPaused) {
      // Progress forward distance
      this.playerZ -= this.runSpeed * delta;
      this.distance += this.runSpeed * delta;
      this.elapsedSeconds += delta;

      // Accelerate speed slightly as distance increases
      this.runSpeed = Math.min(18.0, 10.5 + (this.distance / 250));

      // Handle keyboard jump/squat timers
      if (this.keyboardJumpTimer > 0) {
        this.keyboardJumpTimer -= delta;
        if (this.keyboardJumpTimer <= 0) this.isJumping = false;
      }
      if (this.keyboardSquatTimer > 0) {
        this.keyboardSquatTimer -= delta;
        if (this.keyboardSquatTimer <= 0) this.isSquatting = false;
      }

      // Combo cooldown
      if (this.comboTimer > 0) {
        this.comboTimer -= delta;
        if (this.comboTimer <= 0) this.resetCombo();
      }

      // Workout Science Calorie & Heart Rate Formula
      // MET values: Average high intensity workout MET = 7.5
      // Calorie burn rate = (7.5 * 3.5 * 70kg / 200) / 60 = ~0.15 kcal/second
      const intensity = 1.0 + (this.comboMultiplier * 0.25) + (this.runSpeed / 20);
      this.caloriesBurned += (0.13 * intensity) * delta;
      this.estimatedBpm = Math.min(175, 120 + this.comboMultiplier * 6 + (this.reps.jumps + this.reps.squats) * 0.5);

      // Update 3D Subsystems
      this.environment.update(this.playerZ, delta);
      this.obstacleManager.update(
        this.playerZ,
        this.targetLaneX,
        this.isJumping,
        this.isSquatting,
        delta,
        (ev, type, obs) => this.handleObstacleEvent(ev, type, obs)
      );
      this.monsterManager.update(
        this.playerZ,
        this.targetLaneX,
        delta,
        (ev, monster) => this.handleMonsterEvent(ev, monster)
      );
      this.playerHands.update(this.runSpeed, delta);

      // Update UI Stats
      this.ui.updateStats({
        distance: this.distance,
        speed: this.runSpeed,
        comboMultiplier: this.comboMultiplier,
        comboProgress: this.comboTimer / 3.5,
        caloriesBurned: this.caloriesBurned,
        estimatedBpm: this.estimatedBpm,
        lives: this.lives,
        reps: this.reps,
      });
    }

    // Update FPV Camera and Render 3D Scene
    this.sceneManager.update(
      this.playerZ,
      this.runSpeed,
      this.isJumping,
      this.isSquatting,
      this.targetLaneX,
      delta
    );
    this.sceneManager.render();

    // Performance auto-tuner: monitors FPS and switches model quality tier
    this.performanceMonitor.update();

    requestAnimationFrame(() => this.update());
  }
}
