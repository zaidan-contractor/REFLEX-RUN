// ==========================================================================
// REFLEXRUN 3D – PERFORMANCE AUTO-TUNER
// Monitors inference FPS and auto-switches BlazePose model quality tier
// ==========================================================================

export class PerformanceMonitor {
  constructor(poseDetector) {
    this.poseDetector = poseDetector;
    this.checkIntervalMs = 2500; // Check every 2.5 seconds for rapid adaptation
    this.lastCheckTime = 0;
    this.currentTier = poseDetector?.modelTier || 'full';
    this.manualOverride = false; // If user manually picks a tier, don't auto-switch
    this.statusElement = null;

    // Tier thresholds (FPS below which we downgrade)
    this.DOWNGRADE_FPS = 25;  // If below 25 FPS or >35ms, drop tier
    this.UPGRADE_FPS = 50;    // If above 50 FPS and <18ms, try upgrading
    this.consecutiveLow = 0;
    this.consecutiveHigh = 0;
  }

  // Call this every frame from the game loop
  update() {
    if (this.manualOverride || !this.poseDetector?.isModelReady) return;

    const now = performance.now();
    if (now - this.lastCheckTime < this.checkIntervalMs) return;
    this.lastCheckTime = now;

    const fps = this.poseDetector.getInferenceFPS();
    const avgMs = this.poseDetector.avgInferenceMs;

    // Update status display
    this.updateStatusDisplay(fps, avgMs);

    // Auto-downgrade logic: drop if FPS is low OR if per-frame inference latency is sluggish (>35ms)
    if (fps < this.DOWNGRADE_FPS || avgMs > 35) {
      this.consecutiveLow++;
      this.consecutiveHigh = 0;

      if (this.consecutiveLow >= 1) { // Immediate adaptation (2.5s)
        const nextTier = this.getDowngradeTier();
        if (nextTier) {
          console.log(`⚡ PerformanceMonitor: Latency ${avgMs.toFixed(1)}ms / FPS ${fps.toFixed(0)} → auto-optimizing to ${nextTier.toUpperCase()}`);
          this.poseDetector.switchModelTier(nextTier);
          this.currentTier = nextTier;
          this.consecutiveLow = 0;
        }
      }
    } else if (fps > this.UPGRADE_FPS && avgMs < 16) {
      this.consecutiveHigh++;
      this.consecutiveLow = 0;

      if (this.consecutiveHigh >= 3) { // 3 consecutive high readings (7.5s of silky smooth performance)
        const nextTier = this.getUpgradeTier();
        if (nextTier) {
          console.log(`⚡ PerformanceMonitor: Headroom detected (FPS ${fps.toFixed(0)}) → upgrading to ${nextTier.toUpperCase()}`);
          this.poseDetector.switchModelTier(nextTier);
          this.currentTier = nextTier;
          this.consecutiveHigh = 0;
        }
      }
    } else {
      // FPS is acceptable
      this.consecutiveLow = 0;
      this.consecutiveHigh = 0;
    }
  }

  getDowngradeTier() {
    const tiers = ['heavy', 'full', 'lite'];
    const currentIdx = tiers.indexOf(this.currentTier);
    return currentIdx < tiers.length - 1 ? tiers[currentIdx + 1] : null;
  }

  getUpgradeTier() {
    const tiers = ['heavy', 'full', 'lite'];
    const currentIdx = tiers.indexOf(this.currentTier);
    return currentIdx > 0 ? tiers[currentIdx - 1] : null;
  }

  // Set a manual tier and disable auto-switching
  setManualTier(tier) {
    this.manualOverride = true;
    this.currentTier = tier;
    if (this.poseDetector) {
      this.poseDetector.switchModelTier(tier);
    }
  }

  // Re-enable auto-switching
  enableAutoTuning() {
    this.manualOverride = false;
    this.consecutiveLow = 0;
    this.consecutiveHigh = 0;
  }

  // Update the PIP header status badge if it exists
  updateStatusDisplay(fps, avgMs) {
    const pipTitle = document.querySelector('.pip-title');
    if (pipTitle) {
      const tierLabel = { heavy: 'HD', full: 'STD', lite: 'LITE' }[this.currentTier] || 'HD';
      pipTitle.textContent = `BODY TRACKER (${tierLabel})`;
    }
  }

  getTierLabel() {
    return { heavy: 'HD (33pt 3D)', full: 'STD (33pt 3D)', lite: 'LITE (33pt 3D)' }[this.currentTier] || 'HD';
  }
}
