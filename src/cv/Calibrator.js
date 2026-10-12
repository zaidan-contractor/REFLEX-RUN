// ==========================================================================
// REFLEXRUN 3D - PS5-GRADE MOTION CLASSIFICATION ENGINE
// MediaPipe BlazePose 33-keypoint + 3D depth + ankle/knee joint angles
// Configurable sensitivity thresholds with persistence, direction inversion fix,
// auto-baseline, and real-time visual guide lines on canvas.
// ==========================================================================

export class Calibrator {
  static DEFAULTS = {
    jump: 0.12,      // % of torso height
    squat: 0.14,     // % of torso height
    step: 0.10,      // % of shoulder width
    punch: 0.16,
    invertX: true,   // Invert lateral direction so physical right = game right (default for laptop webcams)
    requireFist: false, // Optional strict fist shape gate (true = only clenched fist; false = smart extension + lateral lock)
    suppressPunchOnStep: true, // Prevent punch triggers while actively side-stepping
  };

  constructor(poseDetector) {
    this.poseDetector = poseDetector;
    this.videoElement = null;
    this.stream = null;

    // Calibration state
    this.isCalibrated = false;
    this.isCalibrating = false;
    this.calibrationFrames = [];
    this.countdownTimer = 3;

    // Auto-baseline learning buffer (smoothly initializes baseline from standing posture)
    this.autoBaselineFrames = [];
    this.hasAutoBaseline = false;

    // Neutral baseline values
    this.baselineX = 0.5;
    this.baselineY = 0.42;
    this.torsoHeight = 0.32;
    this.baselineWristLeftY = 0.60;
    this.baselineWristRightY = 0.60;
    this.baselineShoulderWidth = 0.22;

    // PS5-GRADE: Ankle & knee baseline for advanced detection
    this.baselineAnkleY = 0.90;
    this.baselineKneeAngle = 170;  // Standing knee angle (~170°)
    this.baselineHipX = 0.50;     // Hip X for more stable lane detection

    // Sensitivity parameters (configurable via sliders & persisted)
    this.jumpSensitivity = Calibrator.DEFAULTS.jump;
    this.squatSensitivity = Calibrator.DEFAULTS.squat;
    this.stepSensitivity = Calibrator.DEFAULTS.step;
    this.punchSensitivity = Calibrator.DEFAULTS.punch;
    this.invertX = Calibrator.DEFAULTS.invertX;
    this.requireFist = Calibrator.DEFAULTS.requireFist;
    this.suppressPunchOnStep = Calibrator.DEFAULTS.suppressPunchOnStep;

    this.loadSettings();

    // ----- Motion Debounce & Hold Durations -----
    this.lastPunchTime = 0;
    this.lastLeftPunchTime = 0;
    this.lastRightPunchTime = 0;
    this.punchCooldown = 240;  // ms per arm for fluid 1-2 combos
    this.punchHoldFrames = 0;  // Hold visual 'PUNCH' badge & canvas glow for ~160ms
    this.lastPunchSide = 'right';
    this.punchReach = 0;       // Live normalized arm reach (0-100%) for UI meters

    // Active state hold timers (in frames at 60fps, 18 frames = ~300ms)
    this.jumpHoldFrames = 0;
    this.squatHoldFrames = 0;
    this.jumpCooldownFrames = 0;
    this.squatCooldownFrames = 0;

    // Velocity tracking for shoulder Y and lateral translation
    this.prevShoulderX = 0.50;
    this.prevShoulderY = 0.42;
    this.prevDeltaX = 0;
    this.velocityY = 0;
    this.bodyVelX = 0;

    // Previous wrist positions for 2D velocity & relative impulse punch detection
    this.prevLWristX = 0.40;
    this.prevLWristY = 0.60;
    this.prevRWristX = 0.60;
    this.prevRWristY = 0.60;

    // PS5-GRADE: Z-depth tracking for punch detection (from world landmarks)
    this.prevLWristZ = 0;
    this.prevRWristZ = 0;
    this.prevLReachRatio = 0.60;
    this.prevRReachRatio = 0.60;

    // Active classified states
    this.currentAction = 'IDLE';
    this.isJumping = false;
    this.isSquatting = false;
    this.currentLaneX = 0;
    this.prevLaneX = 0;
    this.laneChanged = false;
  }

  loadSettings() {
    try {
      const saved = localStorage.getItem('reflexrun_motion_settings');
      if (saved) {
        const s = JSON.parse(saved);
        if (typeof s.jump === 'number' && !isNaN(s.jump)) this.jumpSensitivity = s.jump;
        if (typeof s.squat === 'number' && !isNaN(s.squat)) this.squatSensitivity = s.squat;
        if (typeof s.step === 'number' && !isNaN(s.step)) this.stepSensitivity = s.step;
        if (typeof s.punch === 'number' && !isNaN(s.punch)) this.punchSensitivity = s.punch;
        if (typeof s.invertX === 'boolean') this.invertX = s.invertX;
        if (typeof s.requireFist === 'boolean') this.requireFist = s.requireFist;
        if (typeof s.suppressPunchOnStep === 'boolean') this.suppressPunchOnStep = s.suppressPunchOnStep;
      }
    } catch (e) {
      console.warn('Could not load motion settings from localStorage:', e);
    }
  }

  saveSettings() {
    try {
      localStorage.setItem('reflexrun_motion_settings', JSON.stringify({
        jump: this.jumpSensitivity,
        squat: this.squatSensitivity,
        step: this.stepSensitivity,
        punch: this.punchSensitivity,
        invertX: this.invertX,
        requireFist: this.requireFist,
        suppressPunchOnStep: this.suppressPunchOnStep,
      }));
    } catch (e) {
      console.warn('Could not save motion settings to localStorage:', e);
    }
  }

  resetDefaults() {
    this.jumpSensitivity = Calibrator.DEFAULTS.jump;
    this.squatSensitivity = Calibrator.DEFAULTS.squat;
    this.stepSensitivity = Calibrator.DEFAULTS.step;
    this.punchSensitivity = Calibrator.DEFAULTS.punch;
    this.invertX = Calibrator.DEFAULTS.invertX;
    this.requireFist = Calibrator.DEFAULTS.requireFist;
    this.suppressPunchOnStep = Calibrator.DEFAULTS.suppressPunchOnStep;
    this.saveSettings();
  }

  setJumpSensitivity(val) {
    this.jumpSensitivity = Math.max(0.02, Math.min(0.85, val));
    this.saveSettings();
  }

  setSquatSensitivity(val) {
    this.squatSensitivity = Math.max(0.03, Math.min(0.85, val));
    this.saveSettings();
  }

  setStepSensitivity(val) {
    this.stepSensitivity = Math.max(0.02, Math.min(0.70, val));
    this.saveSettings();
  }

  setPunchSensitivity(val) {
    this.punchSensitivity = Math.max(0.04, Math.min(0.70, val));
    this.saveSettings();
  }

  setInvertX(val) {
    this.invertX = Boolean(val);
    this.saveSettings();
  }

  setRequireFist(val) {
    this.requireFist = Boolean(val);
    this.saveSettings();
  }

  setSuppressPunchOnStep(val) {
    this.suppressPunchOnStep = Boolean(val);
    this.saveSettings();
  }

  async setupCamera(videoElement) {
    this.videoElement = videoElement;
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'user',
          },
          audio: false,
        });
        if (this.videoElement) {
          this.videoElement.srcObject = this.stream;
          await this.videoElement.play().catch(() => {});
        }
        return true;
      } catch (err) {
        console.warn('Webcam permission denied or unavailable:', err);
        return false;
      }
    }
    return false;
  }

  // Quick baseline re-centering: can be called anytime (e.g. from tutorial button)
  lockBaselineFromPose(pose) {
    if (!pose) return false;
    this.baselineX = pose.midShoulderX;
    this.baselineY = pose.midShoulderY;
    this.torsoHeight = Math.max(0.08, pose.torsoHeight);
    this.baselineWristLeftY = pose.leftWristY || 0.60;
    this.baselineWristRightY = pose.rightWristY || 0.60;
    this.baselineShoulderWidth = pose.shoulderWidth || 0.22;
    this.baselineAnkleY = ((pose.leftAnkleY || 0.90) + (pose.rightAnkleY || 0.90)) / 2;
    this.baselineKneeAngle = pose.avgKneeAngle || 170;
    this.baselineHipX = pose.midHipX || pose.midShoulderX;
    this.prevShoulderY = this.baselineY;
    this.isCalibrated = true;
    this.hasAutoBaseline = true;
    console.log('⚡ ReflexRun: Baseline locked (PS5-grade):', {
      X: this.baselineX.toFixed(3),
      Y: this.baselineY.toFixed(3),
      torso: this.torsoHeight.toFixed(3),
      ankleY: this.baselineAnkleY.toFixed(3),
      kneeAngle: this.baselineKneeAngle.toFixed(1),
    });
    return true;
  }

  startCalibration(onProgress, onComplete) {
    this.isCalibrating = true;
    this.calibrationFrames = [];
    this.countdownTimer = 3;

    let secondsLeft = 3;
    if (onProgress) onProgress(secondsLeft);

    const interval = setInterval(() => {
      secondsLeft--;
      if (onProgress) onProgress(secondsLeft);

      if (secondsLeft <= 0) {
        clearInterval(interval);
        this.finalizeCalibration();
        if (onComplete) onComplete();
      }
    }, 1000);
  }

  finalizeCalibration() {
    this.isCalibrating = false;
    const pool = this.calibrationFrames.length > 5 ? this.calibrationFrames : this.autoBaselineFrames;

    if (pool.length > 0) {
      const sorted = (arr) => [...arr].sort((a, b) => a - b);
      const median = (arr) => {
        const s = sorted(arr);
        const mid = Math.floor(s.length / 2);
        return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
      };

      this.baselineX = median(pool.map(f => f.midShoulderX));
      this.baselineY = median(pool.map(f => f.midShoulderY));
      this.torsoHeight = Math.max(0.18, median(pool.map(f => f.torsoHeight)));
      this.baselineWristLeftY = median(pool.map(f => f.leftWristY));
      this.baselineWristRightY = median(pool.map(f => f.rightWristY));
      this.baselineShoulderWidth = median(pool.map(f => f.shoulderWidth || 0.22));
      this.baselineAnkleY = median(pool.map(f => ((f.leftAnkleY || 0.90) + (f.rightAnkleY || 0.90)) / 2));
      this.baselineKneeAngle = median(pool.map(f => f.avgKneeAngle || 170));
      this.baselineHipX = median(pool.map(f => f.midHipX || f.midShoulderX));
      this.prevShoulderY = this.baselineY;
    }

    this.isCalibrated = true;
    this.hasAutoBaseline = true;
    console.log('⚡ ReflexRun: Calibration finalized. Baseline locked:', {
      baselineX: this.baselineX.toFixed(3),
      baselineY: this.baselineY.toFixed(3),
      torsoHeight: this.torsoHeight.toFixed(3),
      shoulderWidth: this.baselineShoulderWidth.toFixed(3),
      baselineAnkleY: this.baselineAnkleY.toFixed(3),
      baselineKneeAngle: this.baselineKneeAngle.toFixed(1),
      baselineHipX: this.baselineHipX.toFixed(3),
    });
  }

  // Called on every game loop frame to classify user motion
  processFrame(pose) {
    if (!pose) {
      return {
        action: 'IDLE',
        isJumping: false,
        isSquatting: false,
        laneX: this.currentLaneX,
        laneChanged: false,
        punchTriggered: false,
        punchSide: null,
        deltaX: 0,
        deltaY: 0,
        pose: null,
      };
    }

    // Auto-baseline learning: if not yet calibrated, collect initial standing frames to lock baseline
    if (!this.isCalibrated) {
      this.autoBaselineFrames.push(pose);
      if (this.autoBaselineFrames.length > 40) {
        this.autoBaselineFrames.shift();
      }
      if (this.autoBaselineFrames.length >= 10 && !this.hasAutoBaseline) {
        this.baselineX = pose.midShoulderX;
        this.baselineY = pose.midShoulderY;
        this.torsoHeight = Math.max(0.08, pose.torsoHeight);
        this.baselineWristLeftY = pose.leftWristY || 0.60;
        this.baselineWristRightY = pose.rightWristY || 0.60;
        this.baselineShoulderWidth = pose.shoulderWidth || 0.22;
        this.baselineAnkleY = ((pose.leftAnkleY || 0.90) + (pose.rightAnkleY || 0.90)) / 2;
        this.baselineKneeAngle = pose.avgKneeAngle || 170;
        this.baselineHipX = pose.midHipX || pose.midShoulderX;
        this.prevShoulderY = this.baselineY;
        this.hasAutoBaseline = true;
      }
    }

    // Collect frames during 3s countdown calibration
    if (this.isCalibrating && pose.confidence >= 0.2) {
      this.calibrationFrames.push(pose);
    }

    // Deviations from baseline
    // Jumping (UP): shoulder Y decreases => deltaY is negative
    // Squatting (DOWN): shoulder Y increases => deltaY is positive
    const deltaY = pose.midShoulderY - this.baselineY;

    // Lateral deviation: in raw camera coordinates, moving to physical right decreases X.
    // When invertX is true (default for front webcams), deltaX is positive for physical right movement!
    const rawDeltaX = pose.midShoulderX - this.baselineX;
    const deltaX = (this.invertX ? -1 : 1) * rawDeltaX;

    // Body / Shoulder Velocity tracking (for lateral motion isolation)
    this.bodyVelX = pose.midShoulderX - (this.prevShoulderX ?? pose.midShoulderX);
    const bodyVelY = pose.midShoulderY - (this.prevShoulderY ?? pose.midShoulderY);
    this.prevShoulderX = pose.midShoulderX;
    this.prevShoulderY = pose.midShoulderY;
    this.velocityY = bodyVelY;

    // 2D Wrist velocities in absolute camera frame
    const lWristVelX = pose.leftWristX - (this.prevLWristX ?? pose.leftWristX);
    const lWristVelY = pose.leftWristY - (this.prevLWristY ?? pose.leftWristY);
    const rWristVelX = pose.rightWristX - (this.prevRWristX ?? pose.rightWristX);
    const rWristVelY = pose.rightWristY - (this.prevRWristY ?? pose.rightWristY);

    // RELATIVE Wrist Velocity (Isolated from body motion: cancels 100% of lateral side-steps!)
    const relLWristVelX = lWristVelX - this.bodyVelX;
    const relLWristVelY = lWristVelY - bodyVelY;
    const relRWristVelX = rWristVelX - this.bodyVelX;
    const relRWristVelY = rWristVelY - bodyVelY;

    const relLWristSpeed = Math.hypot(relLWristVelX, relLWristVelY);
    const relRWristSpeed = Math.hypot(relRWristVelX, relRWristVelY);

    this.prevLWristX = pose.leftWristX;
    this.prevLWristY = pose.leftWristY;
    this.prevRWristX = pose.rightWristX;
    this.prevRWristY = pose.rightWristY;

    // =================================================================
    // 1. PS5-GRADE JUMP DETECTION
    //    Primary: Shoulder Y rise (backward-compatible)
    //    Enhanced: Ankle Y rise (feet leaving ground) + Knee extension
    // =================================================================
    const jumpThreshold = -this.jumpSensitivity * this.torsoHeight;
    const jumpApexReached = deltaY < jumpThreshold;
    const jumpImpulse = (deltaY < jumpThreshold * 0.65) && (this.velocityY < -0.003);

    // PS5-GRADE: Ankle-based jump confirmation (ankles rising = feet off ground)
    const avgAnkleY = ((pose.leftAnkleY || this.baselineAnkleY) + (pose.rightAnkleY || this.baselineAnkleY)) / 2;
    const ankleRise = this.baselineAnkleY - avgAnkleY; // Positive = feet rising
    const ankleJump = ankleRise > (this.jumpSensitivity * this.torsoHeight * 0.5); // Ankle confirms air

    // PS5-GRADE: Knee extension during jump (knees straighten to ~165-180°)
    const kneeExtension = (pose.avgKneeAngle || 170) > 155;

    // Composite jump: shoulder-based OR (ankle-rise AND knee-extend)
    const jumpDetected = jumpApexReached || jumpImpulse || (ankleJump && kneeExtension);

    if (this.jumpCooldownFrames > 0) {
      this.jumpCooldownFrames--;
    }

    if (jumpDetected && this.jumpCooldownFrames === 0 && !this.isSquatting) {
      this.isJumping = true;
      this.jumpHoldFrames = 18; // Hold jump state for ~300ms
    } else if (this.jumpHoldFrames > 0) {
      this.jumpHoldFrames--;
      this.isJumping = true;
    } else {
      if (this.isJumping) {
        this.jumpCooldownFrames = 6; // Brief cooldown after landing
      }
      this.isJumping = false;
    }

    // =================================================================
    // 2. PS5-GRADE SQUAT / SLIDE DETECTION
    //    Primary: Shoulder Y drop (backward-compatible)
    //    Enhanced: Knee bend angle (hip→knee→ankle gives precise squat depth)
    // =================================================================
    const squatThreshold = this.squatSensitivity * this.torsoHeight;
    const squatDepthReached = deltaY > squatThreshold;
    const squatImpulse = (deltaY > squatThreshold * 0.60) && (this.velocityY > 0.002);

    // Knee angle squat detection (only if leg tracking is verified active)
    const kneeAngle = pose.avgKneeAngle || 170;
    const kneeBend = Boolean(pose.hasLegTracking && kneeAngle < 142);

    // Immediate squat detection on depth reached, downward impulse, or knee bend
    const squatDetected = squatDepthReached || squatImpulse || kneeBend;

    if (this.squatCooldownFrames > 0) {
      this.squatCooldownFrames--;
    }

    // A squat stays active continuously as long as the player remains low (50% hysteresis)
    const isStayingLow = deltaY > (squatThreshold * 0.50) || (pose.hasLegTracking && kneeAngle < 152);

    if (squatDetected && this.squatCooldownFrames === 0 && !this.isJumping) {
      this.isSquatting = true;
      this.squatHoldFrames = 10;
    } else if (isStayingLow && !this.isJumping) {
      this.isSquatting = true;
      this.squatHoldFrames = 10;
    } else if (this.squatHoldFrames > 0) {
      this.squatHoldFrames--;
      this.isSquatting = true;
    } else {
      if (this.isSquatting) {
        this.squatCooldownFrames = 4;
      }
      this.isSquatting = false;
    }

    // =================================================================
    // 3. PS5-GRADE SIDE-STEP / LANE DETECTION
    //    Enhanced: Uses hip X centroid (more stable than shoulders during arm movements)
    // =================================================================
    // Use hip X if available (more stable core anchor), fall back to shoulder X
    const hipDeltaX = pose.midHipX ? ((this.invertX ? -1 : 1) * (pose.midHipX - this.baselineHipX)) : deltaX;
    // Blend shoulder and hip delta for maximum stability (70% hip, 30% shoulder)
    const blendedDeltaX = pose.midHipX ? (hipDeltaX * 0.7 + deltaX * 0.3) : deltaX;

    const stepEnterThreshold = Math.max(0.04, this.stepSensitivity * this.baselineShoulderWidth * 1.5);
    const stepExitThreshold = stepEnterThreshold * 0.55;

    let newLaneX = this.currentLaneX;

    if (this.currentLaneX === 0) {
      if (blendedDeltaX < -stepEnterThreshold) {
        newLaneX = -2.8; // Left Lane
      } else if (blendedDeltaX > stepEnterThreshold) {
        newLaneX = 2.8;  // Right Lane
      }
    } else if (this.currentLaneX < 0) {
      // In Left Lane: exit towards center when body returns past exit threshold
      if (blendedDeltaX > -stepExitThreshold) {
        newLaneX = 0;
      }
      if (blendedDeltaX > stepEnterThreshold) {
        newLaneX = 2.8;
      }
    } else {
      // In Right Lane: exit towards center
      if (blendedDeltaX < stepExitThreshold) {
        newLaneX = 0;
      }
      if (blendedDeltaX < -stepEnterThreshold) {
        newLaneX = -2.8;
      }
    }

    this.laneChanged = newLaneX !== this.currentLaneX;
    this.prevLaneX = this.currentLaneX;
    this.currentLaneX = newLaneX;

    // =================================================================
    // 4. PS5-GRADE INTENTIONAL PUNCH DETECTION
    //    Enhanced: Z-depth thrust from 3D world landmarks
    //    + Extension + Relative Thrust + Step Lock
    // =================================================================
    let punchTriggered = false;
    let punchSide = null;
    const now = Date.now();

    // 1. Arm Reach Ratios (Euclidean distance from shoulder to wrist / torso height)
    const lShoulderX = pose.leftShoulderX || (pose.midShoulderX - 0.12);
    const lShoulderY = pose.leftShoulderY || pose.midShoulderY;
    const leftArmReach = Math.hypot(pose.leftWristX - lShoulderX, pose.leftWristY - lShoulderY);
    const leftReachRatio = leftArmReach / Math.max(0.16, this.torsoHeight);

    const rShoulderX = pose.rightShoulderX || (pose.midShoulderX + 0.12);
    const rShoulderY = pose.rightShoulderY || pose.midShoulderY;
    const rightArmReach = Math.hypot(pose.rightWristX - rShoulderX, pose.rightWristY - rShoulderY);
    const rightReachRatio = rightArmReach / Math.max(0.16, this.torsoHeight);

    // Live continuous reach level (0 to 100%) for diagnostic meters
    // Guard stance / resting is ~0-35%, forward punch reaches 70-100%
    const lReachPct = Math.max(0, Math.min(100, ((leftReachRatio - 0.45) / 0.50) * 100));
    const rReachPct = Math.max(0, Math.min(100, ((rightReachRatio - 0.45) / 0.50) * 100));
    this.punchReach = Math.max(lReachPct, rReachPct);

    // 2. Active Rate of Arm Extension Delta (speed of extending outward from shoulder)
    const lReachDelta = leftReachRatio - (this.prevLReachRatio ?? leftReachRatio);
    const rReachDelta = rightReachRatio - (this.prevRReachRatio ?? rightReachRatio);
    this.prevLReachRatio = leftReachRatio;
    this.prevRReachRatio = rightReachRatio;

    // PS5-GRADE: Z-depth velocity from world landmarks (negative Z = closer to camera = forward thrust)
    const lWristZVel = (pose.leftWristZ || 0) - (this.prevLWristZ || 0);
    const rWristZVel = (pose.rightWristZ || 0) - (this.prevRWristZ || 0);
    this.prevLWristZ = pose.leftWristZ || 0;
    this.prevRWristZ = pose.rightWristZ || 0;
    // Wrist moving toward camera = negative Z velocity = forward punch thrust
    const lZThrust = lWristZVel < -0.008;
    const rZThrust = rWristZVel < -0.008;

    // 3. Side-Stepping / Lateral Motion Suppression
    // When the whole body translates laterally across lanes, lock punches so side-stepping never triggers a punch!
    const isSideStepping = Math.abs(this.bodyVelX) > 0.0045 || this.laneChanged || Math.abs(deltaX - (this.prevDeltaX ?? deltaX)) > 0.005;
    this.prevDeltaX = deltaX;

    const stepSuppressLeft = this.suppressPunchOnStep && isSideStepping && !(leftReachRatio > 1.05 && lReachDelta > 0.020);
    const stepSuppressRight = this.suppressPunchOnStep && isSideStepping && !(rightReachRatio > 1.05 && rReachDelta > 0.020);

    // 4. Striking Height Corridor (above waist, below head top)
    const waistY = pose.midHipY - 0.03;
    const headTopY = pose.midShoulderY - 0.28;
    const leftInZone = pose.leftWristY < waistY && pose.leftWristY > headTopY;
    const rightInZone = pose.rightWristY < waistY && pose.rightWristY > headTopY;

    // 5. Reach Threshold scaled by punch reach slider (min 8%, default 16%, max 28%)
    const reachThreshold = Math.max(0.68, 1.05 - (this.punchSensitivity * 1.5));

    // 6. Fist Check: If requireFist mode is enabled, require clenched fist contour
    const leftFistPassed = !this.requireFist || (pose.isLeftFist !== false);
    const rightFistPassed = !this.requireFist || (pose.isRightFist !== false);

    // 7. PS5-GRADE Intentional Strike Condition
    // Requires Arm Extension + (Relative Thrust OR Z-Depth Forward Thrust) + Fist + No Side-Step
    const leftArmExtended = leftInZone && (leftReachRatio >= reachThreshold);
    const leftActiveThrust = (relLWristSpeed > 0.015) || (lReachDelta > 0.008) || (relLWristVelY < -0.012) || lZThrust;

    const rightArmExtended = rightInZone && (rightReachRatio >= reachThreshold);
    const rightActiveThrust = (relRWristSpeed > 0.015) || (rReachDelta > 0.008) || (relRWristVelY < -0.012) || rZThrust;

    // Cooldown check per arm
    const leftCooldownOk = (now - this.lastLeftPunchTime > this.punchCooldown) && (now - this.lastPunchTime > 140);
    const rightCooldownOk = (now - this.lastRightPunchTime > this.punchCooldown) && (now - this.lastPunchTime > 140);

    const leftPunchHit = leftCooldownOk && !stepSuppressLeft && leftArmExtended && leftActiveThrust && leftFistPassed;
    const rightPunchHit = rightCooldownOk && !stepSuppressRight && rightArmExtended && rightActiveThrust && rightFistPassed;

    if (leftPunchHit) {
      punchTriggered = true;
      punchSide = 'left';
      this.lastLeftPunchTime = now;
      this.lastPunchTime = now;
      this.lastPunchSide = 'left';
      this.punchHoldFrames = 10; // ~160ms hold for action badge and visual glow
    } else if (rightPunchHit) {
      punchTriggered = true;
      punchSide = 'right';
      this.lastRightPunchTime = now;
      this.lastPunchTime = now;
      this.lastPunchSide = 'right';
      this.punchHoldFrames = 10;
    }

    // =================================================================
    // 5. ACTION TAG CLASSIFICATION
    // =================================================================
    if (this.punchHoldFrames > 0) {
      this.punchHoldFrames--;
    }

    if (this.isJumping) {
      this.currentAction = 'JUMP';
    } else if (this.isSquatting) {
      this.currentAction = 'SLIDE';
    } else if (punchTriggered || this.punchHoldFrames > 0) {
      this.currentAction = 'PUNCH';
    } else if (this.currentLaneX < -1) {
      this.currentAction = 'STEP LEFT';
    } else if (this.currentLaneX > 1) {
      this.currentAction = 'STEP RIGHT';
    } else {
      this.currentAction = 'RUN';
    }

    return {
      action: this.currentAction,
      isJumping: this.isJumping,
      isSquatting: this.isSquatting,
      laneX: this.currentLaneX,
      laneChanged: this.laneChanged,
      punchTriggered,
      punchSide: punchSide || this.lastPunchSide,
      punchReach: this.punchReach,
      isSideStepping,
      isLeftFist: pose.isLeftFist ?? true,
      isRightFist: pose.isRightFist ?? true,
      deltaX,
      deltaY,
      velocityY: this.velocityY,
      pose,
    };
  }

  // Draw full skeleton and calibration guide lines onto any target canvas
  drawSkeleton(canvas, pose, showLabels = true) {
    if (!canvas || !pose) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Dynamic threshold coordinates
    const jumpLineY = (this.baselineY - this.jumpSensitivity * this.torsoHeight) * h;
    const squatLineY = (this.baselineY + this.squatSensitivity * this.torsoHeight) * h;
    const baselineLineY = this.baselineY * h;
    const baselineLineX = this.baselineX * w;

    // Step lane thresholds on canvas
    const stepThreshPx = Math.max(16, this.stepSensitivity * this.baselineShoulderWidth * 1.5 * w);
    const laneLeftX = baselineLineX - stepThreshPx;
    const laneRightX = baselineLineX + stepThreshPx;

    // Helper to draw text un-mirrored (since canvas has CSS scaleX(-1))
    const drawTextUnmirrored = (text, x, y, align = 'center') => {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(-1, 1);
      ctx.textAlign = align;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };

    // Draw Lane Boundaries (Vertical Dashed Lines)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(laneLeftX, 0);
    ctx.lineTo(laneLeftX, h);
    ctx.moveTo(laneRightX, 0);
    ctx.lineTo(laneRightX, h);
    ctx.stroke();

    // Draw Baseline Crosshair (Green dashed line)
    ctx.strokeStyle = 'rgba(0, 230, 118, 0.45)';
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(0, baselineLineY);
    ctx.lineTo(w, baselineLineY);
    ctx.moveTo(baselineLineX, 0);
    ctx.lineTo(baselineLineX, h);
    ctx.stroke();

    // Draw Jump Ceiling (Cyan line)
    ctx.strokeStyle = this.isJumping ? '#00e5ff' : 'rgba(0, 229, 255, 0.55)';
    ctx.lineWidth = this.isJumping ? 2.5 : 1.5;
    ctx.setLineDash(this.isJumping ? [] : [5, 5]);
    ctx.beginPath();
    ctx.moveTo(0, jumpLineY);
    ctx.lineTo(w, jumpLineY);
    ctx.stroke();

    // Draw Squat Floor (Amber/Orange line)
    ctx.strokeStyle = this.isSquatting ? '#ff9800' : 'rgba(255, 152, 0, 0.55)';
    ctx.lineWidth = this.isSquatting ? 2.5 : 1.5;
    ctx.setLineDash(this.isSquatting ? [] : [5, 5]);
    ctx.beginPath();
    ctx.moveTo(0, squatLineY);
    ctx.lineTo(w, squatLineY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw Threshold Zone Labels if space allows
    if (showLabels && h > 100) {
      ctx.font = 'bold 10px Orbitron, monospace';

      // Jump line label (placed top-right in unmirrored screen view)
      ctx.fillStyle = 'rgba(0, 229, 255, 0.85)';
      drawTextUnmirrored(`▲ JUMP (${Math.round(this.jumpSensitivity * 100)}%)`, 80, Math.max(14, jumpLineY - 5), 'center');

      // Squat line label
      ctx.fillStyle = 'rgba(255, 152, 0, 0.85)';
      drawTextUnmirrored(`▼ SQUAT (${Math.round(this.squatSensitivity * 100)}%)`, 80, Math.min(h - 8, squatLineY + 14), 'center');

      // Baseline label
      ctx.fillStyle = 'rgba(0, 230, 118, 0.75)';
      drawTextUnmirrored('— BASELINE —', w - 60, baselineLineY - 5, 'center');

      // Lane boundary labels
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '9px Orbitron, monospace';
      // Due to canvas scaleX(-1), laneLeftX renders on screen right, laneRightX renders on screen left
      drawTextUnmirrored('LANE L', laneRightX, 22, 'center');
      drawTextUnmirrored('LANE R', laneLeftX, 22, 'center');
    }

    // Coordinate mapping
    const sx = pose.midShoulderX * w;
    const sy = pose.midShoulderY * h;
    const hx = pose.midHipX * w;
    const hy = pose.midHipY * h;
    const lwX = (pose.leftWristX || pose.midShoulderX - 0.1) * w;
    const lwY = (pose.leftWristY || pose.midShoulderY + 0.15) * h;
    const rwX = (pose.rightWristX || pose.midShoulderX + 0.1) * w;
    const rwY = (pose.rightWristY || pose.midShoulderY + 0.15) * h;
    const leY = (pose.leftElbowY || (pose.midShoulderY + 0.1)) * h;
    const reY = (pose.rightElbowY || (pose.midShoulderY + 0.1)) * h;

    const stateColor = this.isJumping ? '#00e5ff' : (this.isSquatting ? '#ff9800' : '#00e676');

    // Torso Spine Line
    ctx.strokeStyle = stateColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(hx, hy);
    ctx.stroke();

    // Shoulder Bar Line
    const halfSw = (pose.shoulderWidth || this.baselineShoulderWidth) * 0.5 * w;
    ctx.strokeStyle = stateColor;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(sx - halfSw, sy);
    ctx.lineTo(sx + halfSw, sy);
    ctx.stroke();

    // Arms: Shoulders to Wrists
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.6)';
    ctx.lineWidth = 2;
    // Left arm
    ctx.beginPath();
    ctx.moveTo(sx - halfSw, sy);
    ctx.lineTo(lwX, leY);
    ctx.lineTo(lwX, lwY);
    ctx.stroke();
    // Right arm
    ctx.beginPath();
    ctx.moveTo(sx + halfSw, sy);
    ctx.lineTo(rwX, reY);
    ctx.lineTo(rwX, rwY);
    ctx.stroke();

    // Head / Nose Circle
    const noseY = (pose.noseY || (pose.midShoulderY - 0.08)) * h;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(sx, noseY, 5, 0, Math.PI * 2);
    ctx.fill();

    // Shoulder Joint Node
    ctx.fillStyle = stateColor;
    ctx.shadowColor = stateColor;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(sx, sy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Hip Joint Node
    ctx.fillStyle = '#ff5722';
    ctx.beginPath();
    ctx.arc(hx, hy, 4, 0, Math.PI * 2);
    ctx.fill();

    // Lower Body Legs: Hips to Knees to Ankles (PS5-Grade Full Body Tracking)
    if (pose.leftKneeY && pose.leftAnkleY) {
      const lkX = (pose.leftKneeX || (pose.midHipX - 0.08)) * w;
      const lkY = pose.leftKneeY * h;
      const laX = (pose.leftAnkleX || (pose.midHipX - 0.08)) * w;
      const laY = pose.leftAnkleY * h;
      const rkX = (pose.rightKneeX || (pose.midHipX + 0.08)) * w;
      const rkY = pose.rightKneeY * h;
      const raX = (pose.rightAnkleX || (pose.midHipX + 0.08)) * w;
      const raY = pose.rightAnkleY * h;

      ctx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
      ctx.lineWidth = 2;
      // Left leg
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(lkX, lkY);
      ctx.lineTo(laX, laY);
      ctx.stroke();
      // Right leg
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(rkX, rkY);
      ctx.lineTo(raX, raY);
      ctx.stroke();

      // Knee joints
      ctx.fillStyle = stateColor;
      ctx.beginPath();
      ctx.arc(lkX, lkY, 3.5, 0, Math.PI * 2);
      ctx.arc(rkX, rkY, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Ankle joints
      ctx.fillStyle = '#00e5ff';
      ctx.beginPath();
      ctx.arc(laX, laY, 3.5, 0, Math.PI * 2);
      ctx.arc(raX, raY, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Wrists (Punch Trackers & Shockwave Effects)
    const isPunchActive = (this.punchHoldFrames > 0) || (Date.now() - this.lastPunchTime < 280);
    const isLeftPunch = isPunchActive && this.lastPunchSide === 'left';
    const isRightPunch = isPunchActive && this.lastPunchSide === 'right';

    // Left Fist
    ctx.fillStyle = isLeftPunch ? '#ff1744' : '#00e5ff';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = isLeftPunch ? 16 : 4;
    ctx.beginPath();
    ctx.arc(lwX, lwY, isLeftPunch ? 10 : 5, 0, Math.PI * 2);
    ctx.fill();

    if (isLeftPunch) {
      // Punch shockwave ring
      ctx.strokeStyle = 'rgba(255, 23, 68, 0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(lwX, lwY, 18, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Right Fist
    ctx.fillStyle = isRightPunch ? '#ff1744' : '#00e5ff';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = isRightPunch ? 16 : 4;
    ctx.beginPath();
    ctx.arc(rwX, rwY, isRightPunch ? 10 : 5, 0, Math.PI * 2);
    ctx.fill();

    if (isRightPunch) {
      ctx.strokeStyle = 'rgba(255, 23, 68, 0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(rwX, rwY, 18, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.shadowBlur = 0;

    // Fist status indicators near hands if requireFist is enabled
    if (this.requireFist && showLabels) {
      ctx.font = '10px sans-serif';
      drawTextUnmirrored(pose.isLeftFist ? '✊' : '✋', lwX, lwY - 14, 'center');
      drawTextUnmirrored(pose.isRightFist ? '✊' : '✋', rwX, rwY - 14, 'center');
    }

    // Active Action Badge at bottom (right-reading)
    ctx.font = 'bold 12px Orbitron, monospace';
    const badgeColor = isPunchActive ? '#ff1744' : stateColor;
    ctx.fillStyle = badgeColor;
    const badgeText = isPunchActive ? `PUNCH ${this.lastPunchSide.toUpperCase()} 🥊` : this.currentAction;
    drawTextUnmirrored(badgeText, w / 2, h - 8, 'center');
  }
}
