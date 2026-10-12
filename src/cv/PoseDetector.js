// ==========================================================================
// REFLEXRUN 3D – PS5-GRADE POSE DETECTOR (MediaPipe BlazePose + Hands)
// 33 body keypoints (full 3D) + 21 hand keypoints per hand
// ==========================================================================

import {
  FilesetResolver,
  PoseLandmarker,
  HandLandmarker,
} from '@mediapipe/tasks-vision';

// BlazePose 33-keypoint index map (https://developers.google.com/mediapipe/solutions/vision/pose_landmarker)
const POSE = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
};

// Hand landmark indices for fist detection (finger tip vs MCP joints)
const HAND = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
};

export class PoseDetector {
  constructor() {
    this.poseLandmarker = null;
    this.handLandmarker = null;
    this.isModelReady = false;
    this.modelTier = 'full'; // 'lite' (ultra fast) | 'full' (balanced) | 'heavy' (high GPU)
    this.enableHandLandmarker = false; // Fast BlazePose 33-pt fist detection is enabled by default (0ms overhead)

    // Optical tracking engine resources (fallback when models fail)
    this.opticalCanvas = document.createElement('canvas');
    this.opticalCanvas.width = 160;
    this.opticalCanvas.height = 120;
    this.opticalCtx = this.opticalCanvas.getContext('2d', { willReadFrequently: true });
    this.prevFrameData = null;

    // Timestamp tracking for VIDEO mode
    this.lastPoseTimestamp = -1;
    this.lastHandTimestamp = -1;
    this._lastVideoCurrentTime = -1;
    this._lastProcessedPose = null;

    // Performance monitoring
    this.frameTimes = [];
    this.avgInferenceMs = 0;

    // Cache WASM fileset for model swapping
    this._wasmFileset = null;
  }

  async init(tier = 'full') {
    this.modelTier = tier;

    try {
      // Load WASM runtime
      console.log('⚡ ReflexRun: Initializing MediaPipe WASM runtime...');
      this._wasmFileset = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      // Model URLs from Google's CDN
      const poseModelUrls = {
        heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task',
        full:  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
        lite:  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
      };

      // Initialize PoseLandmarker (BlazePose)
      console.log(`⚡ ReflexRun: Loading BlazePose ${tier.toUpperCase()} model (33 keypoints, 3D)...`);
      this.poseLandmarker = await PoseLandmarker.createFromOptions(this._wasmFileset, {
        baseOptions: {
          modelAssetPath: poseModelUrls[tier],
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      // Load HandLandmarker only if explicitly requested (otherwise use 0ms BlazePose landmark heuristic)
      if (this.enableHandLandmarker) {
        try {
          const handModelUrl = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';
          this.handLandmarker = await HandLandmarker.createFromOptions(this._wasmFileset, {
            baseOptions: {
              modelAssetPath: handModelUrl,
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.4,
            minHandPresenceConfidence: 0.4,
            minTrackingConfidence: 0.4,
          });
          console.log('✅ ReflexRun: Hand Landmarker ready.');
        } catch (handErr) {
          console.warn('⚠️ ReflexRun: Hand Landmarker skipped, using high-speed pose fist detection:', handErr);
          this.handLandmarker = null;
        }
      }

      this.isModelReady = true;
      console.log(`✅ ReflexRun: MediaPipe BlazePose ${tier.toUpperCase()} ready — 33 keypoints, full 3D, GPU-accelerated.`);
      return;
    } catch (e) {
      console.warn('⚠️ ReflexRun: MediaPipe initialization failed, falling back to optical tracker:', e);
      this.isModelReady = false;
    }

    console.log('⚡ ReflexRun: Optical body tracking engine active (60 FPS zero-latency fallback).');
  }

  // Switch model tier at runtime (called by PerformanceMonitor)
  async switchModelTier(newTier) {
    if (newTier === this.modelTier || !this._wasmFileset) return;
    console.log(`⚡ ReflexRun: Switching pose model from ${this.modelTier.toUpperCase()} → ${newTier.toUpperCase()}...`);

    const poseModelUrls = {
      heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task',
      full:  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
      lite:  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
    };

    try {
      if (this.poseLandmarker) {
        this.poseLandmarker.close();
      }
      this.poseLandmarker = await PoseLandmarker.createFromOptions(this._wasmFileset, {
        baseOptions: {
          modelAssetPath: poseModelUrls[newTier],
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      this.modelTier = newTier;
      this.lastPoseTimestamp = -1;
      console.log(`✅ ReflexRun: Switched to BlazePose ${newTier.toUpperCase()}.`);
    } catch (e) {
      console.error('Failed to switch model tier:', e);
    }
  }

  async estimatePose(videoElement) {
    if (!videoElement || videoElement.readyState < 2) return null;

    // Zero-overhead frame check: if webcam hardware hasn't produced a new video frame yet,
    // immediately return the last cached pose without burning CPU/GPU cycles!
    if (this._lastProcessedPose && videoElement.currentTime === this._lastVideoCurrentTime) {
      return this._lastProcessedPose;
    }
    this._lastVideoCurrentTime = videoElement.currentTime;

    let rawPose = null;
    const inferenceStart = performance.now();

    // 1. MediaPipe BlazePose if model is loaded
    if (this.isModelReady && this.poseLandmarker) {
      try {
        const timestamp = performance.now();
        // Ensure monotonically increasing timestamps
        if (timestamp <= this.lastPoseTimestamp) {
          return this._lastProcessedPose || null;
        }
        this.lastPoseTimestamp = timestamp;

        const poseResult = this.poseLandmarker.detectForVideo(videoElement, timestamp);

        if (poseResult && poseResult.landmarks && poseResult.landmarks.length > 0) {
          rawPose = this.normalizeMediaPipePose(poseResult);
        }
      } catch (e) {
        // Fall back to optical
        console.warn('Pose detection frame error:', e);
      }
    }

    // 2. High-speed Optical Body & Silhouette Motion Tracker (fallback)
    if (!rawPose) {
      rawPose = this.estimateOpticalPose(videoElement);
    }

    // 3. High-Speed Fist Detection
    // BlazePose 33-point landmarks already provide wrist, thumb, index, and pinky positions!
    // Finger-clustering analysis runs in 0.001ms with zero extra neural net overhead.
    if (rawPose) {
      if (this.enableHandLandmarker && this.handLandmarker) {
        try {
          const handTimestamp = performance.now();
          if (handTimestamp > this.lastHandTimestamp) {
            this.lastHandTimestamp = handTimestamp;
            const handResult = this.handLandmarker.detectForVideo(videoElement, handTimestamp);
            const fists = this.analyzeHandLandmarks(handResult, rawPose);
            rawPose.isLeftFist = fists.isLeftFist;
            rawPose.isRightFist = fists.isRightFist;
          }
        } catch (e) {
          rawPose.isLeftFist = this.heuristicFistCheck(rawPose, 'left');
          rawPose.isRightFist = this.heuristicFistCheck(rawPose, 'right');
        }
      } else {
        rawPose.isLeftFist = this.heuristicFistCheck(rawPose, 'left');
        rawPose.isRightFist = this.heuristicFistCheck(rawPose, 'right');
      }
    }

    // 4. Track inference performance
    const inferenceMs = performance.now() - inferenceStart;
    this.frameTimes.push(inferenceMs);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    this.avgInferenceMs = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;

    if (rawPose) {
      this._lastProcessedPose = rawPose;
    }
    return rawPose;
  }

  // Get current FPS for performance monitoring
  getInferenceFPS() {
    if (this.avgInferenceMs <= 0) return 60;
    return Math.min(60, 1000 / this.avgInferenceMs);
  }

  // ---------------------------------------------------------------
  // MediaPipe BlazePose 33-keypoint normalization
  // ---------------------------------------------------------------
  normalizeMediaPipePose(poseResult) {
    const landmarks = poseResult.landmarks[0]; // Normalized [0,1] coords
    const worldLandmarks = poseResult.worldLandmarks?.[0] || null; // 3D meters

    const lm = (idx) => landmarks[idx] || { x: 0.5, y: 0.5, z: 0, visibility: 0 };

    const nose = lm(POSE.NOSE);
    const leftShoulder = lm(POSE.LEFT_SHOULDER);
    const rightShoulder = lm(POSE.RIGHT_SHOULDER);
    const leftHip = lm(POSE.LEFT_HIP);
    const rightHip = lm(POSE.RIGHT_HIP);
    const leftWrist = lm(POSE.LEFT_WRIST);
    const rightWrist = lm(POSE.RIGHT_WRIST);
    const leftElbow = lm(POSE.LEFT_ELBOW);
    const rightElbow = lm(POSE.RIGHT_ELBOW);
    const leftKnee = lm(POSE.LEFT_KNEE);
    const rightKnee = lm(POSE.RIGHT_KNEE);
    const leftAnkle = lm(POSE.LEFT_ANKLE);
    const rightAnkle = lm(POSE.RIGHT_ANKLE);
    const leftHeel = lm(POSE.LEFT_HEEL);
    const rightHeel = lm(POSE.RIGHT_HEEL);

    // Core body anchors
    const midShoulderX = (leftShoulder.x + rightShoulder.x) / 2;
    const midShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
    const midHipX = (leftHip.x + rightHip.x) / 2;
    const midHipY = (leftHip.y + rightHip.y) / 2;

    const torsoHeight = Math.max(0.08, Math.abs(midHipY - midShoulderY));
    const shoulderWidth = Math.max(0.08, Math.abs(leftShoulder.x - rightShoulder.x));

    // Confidence: average of shoulder and hip visibility
    const shoulderConf = ((leftShoulder.visibility || 0) + (rightShoulder.visibility || 0)) / 2;
    const hipConf = ((leftHip.visibility || 0) + (rightHip.visibility || 0)) / 2;
    const overallConf = Math.max(shoulderConf, (shoulderConf + hipConf) / 2);

    // Knee angle for squat detection (only compute if hip, knee, and ankle are actually in frame)
    const leftLegVisible = ((leftHip.visibility || 0) > 0.35) && ((leftKnee.visibility || 0) > 0.35) && ((leftAnkle.visibility || 0) > 0.35);
    const rightLegVisible = ((rightHip.visibility || 0) > 0.35) && ((rightKnee.visibility || 0) > 0.35) && ((rightAnkle.visibility || 0) > 0.35);
    const hasLegTracking = leftLegVisible || rightLegVisible;

    const leftKneeAngle = leftLegVisible ? this.computeAngle(leftHip, leftKnee, leftAnkle) : 170;
    const rightKneeAngle = rightLegVisible ? this.computeAngle(rightHip, rightKnee, rightAnkle) : 170;
    const avgKneeAngle = hasLegTracking
      ? ((leftLegVisible ? leftKneeAngle : rightKneeAngle) + (rightLegVisible ? rightKneeAngle : leftKneeAngle)) / 2
      : 170;

    // Z-depth from world landmarks (wrist Z for punch detection)
    let leftWristZ = 0, rightWristZ = 0;
    let leftShoulderZ = 0, rightShoulderZ = 0;
    if (worldLandmarks) {
      const wlm = (idx) => worldLandmarks[idx] || { x: 0, y: 0, z: 0, visibility: 0 };
      leftWristZ = wlm(POSE.LEFT_WRIST).z;
      rightWristZ = wlm(POSE.RIGHT_WRIST).z;
      leftShoulderZ = wlm(POSE.LEFT_SHOULDER).z;
      rightShoulderZ = wlm(POSE.RIGHT_SHOULDER).z;
    }

    return {
      // Core body (backward-compatible with old format)
      midShoulderX,
      midShoulderY,
      leftShoulderX: leftShoulder.x,
      leftShoulderY: leftShoulder.y,
      rightShoulderX: rightShoulder.x,
      rightShoulderY: rightShoulder.y,
      midHipX,
      midHipY,
      torsoHeight,
      shoulderWidth,

      // Arms
      leftElbowX: leftElbow.x,
      leftElbowY: leftElbow.y,
      rightElbowX: rightElbow.x,
      rightElbowY: rightElbow.y,
      leftWristX: leftWrist.x,
      leftWristY: leftWrist.y,
      leftWristScore: leftWrist.visibility || 0,
      rightWristX: rightWrist.x,
      rightWristY: rightWrist.y,
      rightWristScore: rightWrist.visibility || 0,

      // Head
      noseY: nose.y,

      // Lower body tracking & visibility
      leftKneeX: leftKnee.x,
      leftKneeY: leftKnee.y,
      leftKneeScore: leftKnee.visibility || 0,
      rightKneeX: rightKnee.x,
      rightKneeY: rightKnee.y,
      rightKneeScore: rightKnee.visibility || 0,
      leftAnkleX: leftAnkle.x,
      leftAnkleY: leftAnkle.y,
      leftAnkleScore: leftAnkle.visibility || 0,
      rightAnkleX: rightAnkle.x,
      rightAnkleY: rightAnkle.y,
      rightAnkleScore: rightAnkle.visibility || 0,
      leftHeelY: leftHeel.y,
      rightHeelY: rightHeel.y,
      hasLegTracking,

      // Joint angles
      leftKneeAngle,
      rightKneeAngle,
      avgKneeAngle,

      // 3D Z-depth (meters, negative = closer to camera)
      leftWristZ,
      rightWristZ,
      leftShoulderZ,
      rightShoulderZ,

      // Confidence & raw data
      confidence: overallConf,
      rawKeypoints: landmarks,
      worldLandmarks,
    };
  }

  // Compute angle at vertex B in triangle A-B-C (in degrees)
  computeAngle(a, b, c) {
    if (!a || !b || !c) return 170; // Default to standing

    const ba = { x: a.x - b.x, y: a.y - b.y };
    const bc = { x: c.x - b.x, y: c.y - b.y };

    const dot = ba.x * bc.x + ba.y * bc.y;
    const magBA = Math.hypot(ba.x, ba.y);
    const magBC = Math.hypot(bc.x, bc.y);

    if (magBA < 0.001 || magBC < 0.001) return 170;

    const cosAngle = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
    return Math.acos(cosAngle) * (180 / Math.PI);
  }

  // ---------------------------------------------------------------
  // True ML fist detection from Hand Landmarker (21 keypoints)
  // ---------------------------------------------------------------
  analyzeHandLandmarks(handResult, pose) {
    let isLeftFist = true;
    let isRightFist = true;

    if (!handResult || !handResult.landmarks || handResult.landmarks.length === 0) {
      // No hands detected — default to fist (allow punching)
      return { isLeftFist: true, isRightFist: true };
    }

    // Process each detected hand
    for (let i = 0; i < handResult.landmarks.length; i++) {
      const hand = handResult.landmarks[i];
      const handedness = handResult.handednesses?.[i]?.[0];

      // Determine which side (MediaPipe mirrors: "Left" label = user's right hand)
      const isRightHand = handedness?.categoryName === 'Left'; // Mirrored
      const isLeftHand = handedness?.categoryName === 'Right';

      const isFist = this.isHandClenched(hand);

      if (isLeftHand) isLeftFist = isFist;
      if (isRightHand) isRightFist = isFist;
    }

    return { isLeftFist, isRightFist };
  }

  // Check if hand is clenched by measuring finger curl angles
  isHandClenched(landmarks) {
    if (!landmarks || landmarks.length < 21) return true;

    const lm = (idx) => landmarks[idx];

    // For each finger, check if tip is curled toward palm
    // A curled finger has its tip closer to the wrist than its MCP joint
    const fingers = [
      // [MCP, PIP, DIP, TIP]
      [HAND.INDEX_MCP, HAND.INDEX_PIP, HAND.INDEX_DIP, HAND.INDEX_TIP],
      [HAND.MIDDLE_MCP, HAND.MIDDLE_PIP, HAND.MIDDLE_DIP, HAND.MIDDLE_TIP],
      [HAND.RING_MCP, HAND.RING_PIP, HAND.RING_DIP, HAND.RING_TIP],
      [HAND.PINKY_MCP, HAND.PINKY_PIP, HAND.PINKY_DIP, HAND.PINKY_TIP],
    ];

    let curledFingers = 0;

    for (const [mcpIdx, pipIdx, dipIdx, tipIdx] of fingers) {
      const mcp = lm(mcpIdx);
      const pip = lm(pipIdx);
      const tip = lm(tipIdx);

      // Measure angle at PIP joint (MCP → PIP → TIP)
      // Straight finger: ~170-180°, Curled fist: ~40-80°
      const angle = this.computeAngle(mcp, pip, tip);

      if (angle < 110) {
        curledFingers++;
      }
    }

    // Fist: at least 3 of 4 fingers curled
    return curledFingers >= 3;
  }

  // Heuristic fist check using pose keypoints (when hand model unavailable)
  heuristicFistCheck(pose, side) {
    if (!pose.rawKeypoints || pose.rawKeypoints.length < 33) return true;

    if (side === 'left') {
      const wrist = pose.rawKeypoints[POSE.LEFT_WRIST];
      const pinky = pose.rawKeypoints[POSE.LEFT_PINKY];
      const index = pose.rawKeypoints[POSE.LEFT_INDEX];
      const thumb = pose.rawKeypoints[POSE.LEFT_THUMB];

      if (!wrist || !pinky || !index || !thumb) return true;

      // When fist is clenched, fingertip landmarks cluster tightly near wrist
      const pinkyDist = Math.hypot(pinky.x - wrist.x, pinky.y - wrist.y);
      const indexDist = Math.hypot(index.x - wrist.x, index.y - wrist.y);
      const thumbDist = Math.hypot(thumb.x - wrist.x, thumb.y - wrist.y);
      const avgDist = (pinkyDist + indexDist + thumbDist) / 3;

      // Tight cluster = fist (threshold ~0.05 normalized)
      return avgDist < 0.07;
    } else {
      const wrist = pose.rawKeypoints[POSE.RIGHT_WRIST];
      const pinky = pose.rawKeypoints[POSE.RIGHT_PINKY];
      const index = pose.rawKeypoints[POSE.RIGHT_INDEX];
      const thumb = pose.rawKeypoints[POSE.RIGHT_THUMB];

      if (!wrist || !pinky || !index || !thumb) return true;

      const pinkyDist = Math.hypot(pinky.x - wrist.x, pinky.y - wrist.y);
      const indexDist = Math.hypot(index.x - wrist.x, index.y - wrist.y);
      const thumbDist = Math.hypot(thumb.x - wrist.x, thumb.y - wrist.y);
      const avgDist = (pinkyDist + indexDist + thumbDist) / 3;

      return avgDist < 0.07;
    }
  }

  // ---------------------------------------------------------------
  // Optical fallback (unchanged from original for zero-dependency mode)
  // ---------------------------------------------------------------
  estimateOpticalPose(videoElement) {
    const w = this.opticalCanvas.width;
    const h = this.opticalCanvas.height;
    this.opticalCtx.drawImage(videoElement, 0, 0, w, h);
    const frame = this.opticalCtx.getImageData(0, 0, w, h);
    const data = frame.data;

    let motionX = 0, motionY = 0, motionWeight = 0;
    let totalWeight = 0, sumX = 0, sumY = 0;
    let minY = h, maxY = 0;
    let upperSumY = 0, upperCount = 0;
    let lowerSumY = 0, lowerCount = 0;
    let leftStrikeMotion = 0, rightStrikeMotion = 0;
    let leftMotionY = h * 0.45, rightMotionY = h * 0.45;
    const halfW = w / 2;

    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const brightness = (r + g + b) / 3;

        if (brightness > 25 && brightness < 230) {
          sumX += x; sumY += y; totalWeight++;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;

          const midH = (minY + maxY) / 2 || h / 2;
          if (y < midH) { upperSumY += y; upperCount++; }
          else { lowerSumY += y; lowerCount++; }

          if (this.prevFrameData) {
            const pr = this.prevFrameData[i], pg = this.prevFrameData[i + 1], pb = this.prevFrameData[i + 2];
            const diff = Math.abs(r - pr) + Math.abs(g - pg) + Math.abs(b - pb);
            if (diff > 50) {
              motionX += x; motionY += y; motionWeight++;
              if (y > minY * 0.9 && y < (minY + maxY) * 0.65) {
                if (x < halfW) { leftStrikeMotion++; leftMotionY = y; }
                else { rightStrikeMotion++; rightMotionY = y; }
              }
            }
          }
        }
      }
    }

    this.prevFrameData = new Uint8ClampedArray(data);

    if (totalWeight < 100) return null;

    const rawCenterX = sumX / totalWeight / w;
    const centerY = sumY / totalWeight / h;
    const heightSpan = (maxY - minY) / h;
    const torsoHeight = Math.max(0.18, heightSpan * 0.45);
    const shoulderY = upperCount > 10 ? (upperSumY / upperCount / h) : (centerY - heightSpan * 0.22);
    const hipY = lowerCount > 10 ? (lowerSumY / lowerCount / h) : (centerY + heightSpan * 0.25);
    const shoulderWidth = 0.24;

    const opticalPunchLeft = leftStrikeMotion > 14;
    const opticalPunchRight = rightStrikeMotion > 14;

    return {
      midShoulderX: rawCenterX,
      midShoulderY: shoulderY,
      leftShoulderX: rawCenterX - shoulderWidth * 0.5,
      leftShoulderY: shoulderY,
      rightShoulderX: rawCenterX + shoulderWidth * 0.5,
      rightShoulderY: shoulderY,
      midHipX: rawCenterX,
      midHipY: hipY,
      torsoHeight,
      shoulderWidth,
      leftElbowX: rawCenterX - shoulderWidth * 0.6,
      leftElbowY: shoulderY + torsoHeight * 0.35,
      rightElbowX: rawCenterX + shoulderWidth * 0.6,
      rightElbowY: shoulderY + torsoHeight * 0.35,
      leftWristX: opticalPunchLeft ? rawCenterX - 0.18 : rawCenterX - 0.10,
      leftWristY: opticalPunchLeft ? (leftMotionY / h) : (shoulderY + torsoHeight * 0.50),
      leftWristScore: opticalPunchLeft ? 0.75 : 0.4,
      rightWristX: opticalPunchRight ? rawCenterX + 0.18 : rawCenterX + 0.10,
      rightWristY: opticalPunchRight ? (rightMotionY / h) : (shoulderY + torsoHeight * 0.50),
      rightWristScore: opticalPunchRight ? 0.75 : 0.4,
      opticalPunchLeft,
      opticalPunchRight,
      noseY: shoulderY - 0.08,
      confidence: Math.min(0.85, totalWeight / 600),
      // Lower body unavailable in optical mode — use defaults
      leftKneeAngle: 170,
      rightKneeAngle: 170,
      avgKneeAngle: 170,
      leftAnkleY: hipY + torsoHeight * 0.8,
      rightAnkleY: hipY + torsoHeight * 0.8,
      leftWristZ: 0,
      rightWristZ: 0,
      leftShoulderZ: 0,
      rightShoulderZ: 0,
      motionCenterY: motionWeight > 10 ? (motionY / motionWeight / h) : centerY,
      motionMagnitude: motionWeight / totalWeight,
    };
  }
}
