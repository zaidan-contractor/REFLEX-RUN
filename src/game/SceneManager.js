// ==========================================================================
// REFLEXRUN 3D - SCENE & FPV CAMERA MANAGER
// ==========================================================================

import * as THREE from 'three';

export class SceneManager {
  constructor(container) {
    this.container = container;
    this.width = container.clientWidth || window.innerWidth;
    this.height = container.clientHeight || window.innerHeight;

    // Core Three.js components
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, this.width / this.height, 0.1, 150);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });

    // FPV Camera movement state
    this.playerLaneX = 0; // Target X lane (-2.8, 0, 2.8)
    this.currentCameraX = 0;
    this.playerY = 1.75; // Standard eye level (1.75m)
    this.currentCameraY = 1.75;
    this.cameraRoll = 0;

    // Dynamic head-bobbing & effects
    this.bobPhase = 0;
    this.shakeIntensity = 0;
    this.hitStopFrames = 0;

    this.init();
  }

  init() {
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    // Deep atmospheric fog
    this.scene.background = new THREE.Color(0x06080d);
    this.scene.fog = new THREE.FogExp2(0x06080d, 0.022);

    this.setupLighting();
    this.setupResizeHandler();
  }

  setupLighting() {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0x283244, 0.85);
    this.scene.add(ambientLight);

    // Directional moonbeam / chasm light
    const dirLight = new THREE.DirectionalLight(0xffaa55, 1.2);
    dirLight.position.set(10, 25, 10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 80;
    dirLight.shadow.camera.left = -15;
    dirLight.shadow.camera.right = 15;
    dirLight.shadow.camera.top = 25;
    dirLight.shadow.camera.bottom = -5;
    this.scene.add(dirLight);
    this.dirLight = dirLight;

    // Moving headlight attached to player camera
    this.playerLight = new THREE.PointLight(0xff6622, 1.8, 25, 1.2);
    this.playerLight.position.set(0, 1.5, 0);
    this.scene.add(this.playerLight);
  }

  setupResizeHandler() {
    window.addEventListener('resize', () => {
      this.width = this.container.clientWidth || window.innerWidth;
      this.height = this.container.clientHeight || window.innerHeight;
      this.camera.aspect = this.width / this.height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.width, this.height);
    });
  }

  triggerShake(amount = 0.4) {
    this.shakeIntensity = amount;
  }

  triggerHitStop(frames = 0) {
    // Punch impacts use screen shake and flash instead of visual freezing
  }

  update(playerZ, runSpeed, isJumping, isSquatting, targetLaneX, delta) {
    // Smooth lateral lane tracking (A/D or side-step)
    this.playerLaneX = targetLaneX;
    this.currentCameraX += (this.playerLaneX - this.currentCameraX) * Math.min(1.0, delta * 12.0);

    // Compute target Y height based on workout actions
    let targetY = 1.75; // Standard standing eye height
    if (isJumping) {
      targetY = 2.85; // Jump leap
    } else if (isSquatting) {
      targetY = 0.75; // Deep squat / slide drop
    }

    // Ultra-smooth, responsive vertical tracking for squats & jumps
    this.currentCameraY += (targetY - this.currentCameraY) * Math.min(1.0, delta * 16.0);

    // Running head-bobbing oscillation
    let bobY = 0;
    let bobX = 0;
    if (runSpeed > 0 && !isJumping && !isSquatting) {
      this.bobPhase += delta * runSpeed * 0.45;
      bobY = Math.sin(this.bobPhase * 2.0) * 0.05;
      bobX = Math.cos(this.bobPhase) * 0.035;
    }

    // Camera lean / roll when dodging lanes
    const lateralVel = (this.playerLaneX - this.currentCameraX);
    const targetRoll = -lateralVel * 0.08;
    this.cameraRoll += (targetRoll - this.cameraRoll) * Math.min(1.0, delta * 10.0);

    // Screen shake decay
    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeIntensity > 0.005) {
      shakeX = (Math.random() - 0.5) * this.shakeIntensity;
      shakeY = (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeIntensity *= Math.pow(0.05, delta);
    } else {
      this.shakeIntensity = 0;
    }

    // Apply to camera
    this.camera.position.set(
      this.currentCameraX + bobX + shakeX,
      this.currentCameraY + bobY + shakeY,
      playerZ
    );

    this.camera.rotation.set(0, 0, this.cameraRoll);

    // Update player point light position
    this.playerLight.position.set(
      this.currentCameraX,
      this.currentCameraY - 0.2,
      playerZ - 1.0
    );

    // Update directional light to follow player
    if (this.dirLight) {
      this.dirLight.position.z = playerZ + 10;
      this.dirLight.target.position.z = playerZ - 20;
      this.dirLight.target.updateMatrixWorld();
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
