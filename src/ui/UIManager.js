// ==========================================================================
// REFLEXRUN 3D - USER INTERFACE & HUD MANAGER
// ==========================================================================

export class UIManager {
  constructor() {
    // HUD Elements
    this.hud = document.getElementById('hud');
    this.distanceEl = document.getElementById('hud-distance');
    this.speedEl = document.getElementById('hud-speed');
    this.comboEl = document.getElementById('hud-combo');
    this.comboFill = document.getElementById('combo-fill');
    this.caloriesEl = document.getElementById('hud-calories');
    this.bpmEl = document.getElementById('hud-bpm');
    this.heartsEl = document.getElementById('health-hearts');

    // Action Prompts
    this.promptContainer = document.getElementById('action-prompt');
    this.promptIcon = document.getElementById('prompt-icon');
    this.promptText = document.getElementById('prompt-text');
    this.promptSubtext = document.getElementById('prompt-subtext');
    this.feedbackEl = document.getElementById('floating-feedback');

    // Rep Counters
    this.countJumps = document.getElementById('count-jumps');
    this.countSquats = document.getElementById('count-squats');
    this.countPunches = document.getElementById('count-punches');
    this.countSteps = document.getElementById('count-steps');

    this.chipJumps = document.getElementById('rep-jumps');
    this.chipSquats = document.getElementById('rep-squats');
    this.chipPunches = document.getElementById('rep-punches');
    this.chipSteps = document.getElementById('rep-steps');

    // Screen VFX Overlays
    this.damageVignette = document.getElementById('vignette-damage');
    this.hitFlash = document.getElementById('hit-flash');

    // Modals
    this.calibrationModal = document.getElementById('calibration-modal');
    this.pauseModal = document.getElementById('pause-modal');
    this.summaryModal = document.getElementById('summary-modal');
    this.tutorialModal = document.getElementById('tutorial-modal');

    // Summary Elements
    this.sumGrade = document.getElementById('summary-grade');
    this.sumMessage = document.getElementById('summary-message');
    this.sumCalories = document.getElementById('sum-calories');
    this.sumDistance = document.getElementById('sum-distance');
    this.sumMaxCombo = document.getElementById('sum-max-combo');
    this.sumTime = document.getElementById('sum-time');
    this.sumJumps = document.getElementById('sum-jumps');
    this.sumSquats = document.getElementById('sum-squats');
    this.sumPunches = document.getElementById('sum-punches');
    this.sumSteps = document.getElementById('sum-steps');

    // PIP
    this.pipBox = document.getElementById('webcam-pip');
    this.pipActionTag = document.getElementById('pip-action-tag');
    this.pipIndicator = document.getElementById('pip-status-dot');

    this.feedbackTimeout = null;
    this.promptTimeout = null;
  }

  showHud(show = true) {
    if (show) {
      this.hud.classList.remove('hidden');
    } else {
      this.hud.classList.add('hidden');
    }
  }

  updateStats(stats) {
    // Distance
    this.distanceEl.innerHTML = `${Math.floor(stats.distance)} <span class="unit">M</span>`;
    this.speedEl.textContent = `${Math.floor(stats.speed * 3.6)} KM/H`;

    // Combo
    this.comboEl.textContent = `x${stats.comboMultiplier}`;
    this.comboFill.style.width = `${Math.min(100, stats.comboProgress * 100)}%`;

    // Calories & Heart Rate
    this.caloriesEl.innerHTML = `${stats.caloriesBurned.toFixed(1)} <span class="unit">KCAL</span>`;
    this.bpmEl.textContent = `⚡ ${Math.floor(stats.estimatedBpm)} BPM`;

    // Hearts
    const hearts = this.heartsEl.querySelectorAll('.heart');
    hearts.forEach((h, idx) => {
      if (idx < stats.lives) {
        h.classList.remove('lost');
      } else {
        h.classList.add('lost');
      }
    });

    // Reps
    this.countJumps.textContent = stats.reps.jumps;
    this.countSquats.textContent = stats.reps.squats;
    this.countPunches.textContent = stats.reps.punches;
    this.countSteps.textContent = stats.reps.steps;
  }

  bumpRep(type) {
    let chip = null;
    if (type === 'jumps') chip = this.chipJumps;
    else if (type === 'squats') chip = this.chipSquats;
    else if (type === 'punches') chip = this.chipPunches;
    else if (type === 'steps') chip = this.chipSteps;

    if (chip) {
      chip.classList.add('bump');
      setTimeout(() => chip.classList.remove('bump'), 180);
    }
  }

  showActionPrompt(action, subtext = '', durationMs = 1200) {
    const actionIcons = {
      JUMP: '🦘',
      SLIDE: '🔻',
      PUNCH: '🥊',
      'STEP LEFT': '⬅️',
      'STEP RIGHT': '➡️',
      DODGE: '↔️',
      RUNNING: '🏃',
    };

    this.promptIcon.textContent = actionIcons[action] || '⚡';
    this.promptText.textContent = action;
    this.promptSubtext.textContent = subtext || 'REACT FAST!';

    this.promptContainer.classList.add('show');
    this.promptContainer.classList.add('pulse');

    clearTimeout(this.promptPulseTimeout);
    this.promptPulseTimeout = setTimeout(() => {
      this.promptContainer.classList.remove('pulse');
    }, 250);

    clearTimeout(this.promptHideTimeout);
    if (durationMs > 0) {
      this.promptHideTimeout = setTimeout(() => {
        this.promptContainer.classList.remove('show');
      }, durationMs);
    }
  }

  hideActionPrompt() {
    clearTimeout(this.promptHideTimeout);
    clearTimeout(this.promptPulseTimeout);
    if (this.promptContainer) {
      this.promptContainer.classList.remove('show');
      this.promptContainer.classList.remove('pulse');
    }
  }

  showFeedback(text, type = 'perfect') {
    this.feedbackEl.textContent = text;
    this.feedbackEl.className = `floating-feedback show ${type}`;

    clearTimeout(this.feedbackTimeout);
    this.feedbackTimeout = setTimeout(() => {
      this.feedbackEl.classList.remove('show');
    }, 650);
  }

  triggerDamageVfx() {
    this.damageVignette.style.opacity = '1';
    setTimeout(() => {
      this.damageVignette.style.opacity = '0';
    }, 300);
  }

  triggerHitFlash() {
    this.hitFlash.style.opacity = '0.9';
    setTimeout(() => {
      this.hitFlash.style.opacity = '0';
    }, 80);
  }

  updatePipTag(action) {
    if (this.pipActionTag) {
      this.pipActionTag.textContent = action;
    }
  }

  showModal(name) {
    this.calibrationModal.classList.add('hidden');
    this.pauseModal.classList.add('hidden');
    this.summaryModal.classList.add('hidden');
    if (this.tutorialModal) this.tutorialModal.classList.add('hidden');

    if (name === 'calibration') this.calibrationModal.classList.remove('hidden');
    if (name === 'pause') this.pauseModal.classList.remove('hidden');
    if (name === 'summary') this.summaryModal.classList.remove('hidden');
    if (name === 'tutorial') { if (this.tutorialModal) this.tutorialModal.classList.remove('hidden'); }
  }

  hideAllModals() {
    this.calibrationModal.classList.add('hidden');
    this.pauseModal.classList.add('hidden');
    this.summaryModal.classList.add('hidden');
    if (this.tutorialModal) this.tutorialModal.classList.add('hidden');
    this.hideActionPrompt();
  }

  showWorkoutSummary(stats) {
    this.showModal('summary');

    // Determine fitness performance grade
    let grade = 'B';
    let message = 'Good workout! Keep pushing your reflexes.';
    const totalReps = stats.reps.jumps + stats.reps.squats + stats.reps.punches + stats.reps.steps;

    if (totalReps >= 35 || stats.score > 4000) {
      grade = 'RANK S';
      message = 'ELITE ATHLETE! Outstanding agility, reaction time, and power!';
    } else if (totalReps >= 20 || stats.score > 2500) {
      grade = 'RANK A';
      message = 'Great session! High sweat rate and sharp reflexes.';
    }

    this.sumGrade.textContent = grade;
    this.sumMessage.textContent = message;
    this.sumCalories.textContent = stats.caloriesBurned.toFixed(1);
    this.sumDistance.textContent = `${Math.floor(stats.distance)}m`;
    this.sumMaxCombo.textContent = `x${stats.maxCombo}`;

    const mins = Math.floor(stats.elapsedSeconds / 60);
    const secs = Math.floor(stats.elapsedSeconds % 60);
    this.sumTime.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    this.sumJumps.textContent = stats.reps.jumps;
    this.sumSquats.textContent = stats.reps.squats;
    this.sumPunches.textContent = stats.reps.punches;
    this.sumSteps.textContent = stats.reps.steps;
  }
}
