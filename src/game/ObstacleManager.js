// ==========================================================================
// REFLEXRUN 3D - PROCEDURAL OBSTACLE SYSTEM (JUMP, SLIDE, SIDE-STEP)
// ==========================================================================

import * as THREE from 'three';

export class ObstacleManager {
  constructor(scene) {
    this.scene = scene;
    this.obstacles = [];
    this.lanes = [-2.8, 0, 2.8]; // Left, Center, Right lanes
    this.spawnDistanceAhead = 65; // Spawn 65m ahead
    this.nextSpawnZ = -30;
    this.minDistanceBetweenObstacles = 24;

    this.createSharedMaterials();
  }

  createSharedMaterials() {
    this.spikedWoodMat = new THREE.MeshStandardMaterial({
      color: 0x5c3a21,
      roughness: 0.9,
    });

    this.ironSpikeMat = new THREE.MeshStandardMaterial({
      color: 0x99aab5,
      metalness: 0.8,
      roughness: 0.3,
    });

    this.dangerGlowMat = new THREE.MeshBasicMaterial({
      color: 0xff3300,
    });

    this.bladeMat = new THREE.MeshStandardMaterial({
      color: 0xdde5ed,
      metalness: 0.95,
      roughness: 0.15,
    });

    this.stonePillarMat = new THREE.MeshStandardMaterial({
      color: 0x3d4552,
      roughness: 0.85,
    });
  }

  // 1. Spiked Hurdle Log (Requires JUMP)
  createSpikeHurdle(z, laneIdx = null) {
    const group = new THREE.Group();
    group.obstacleType = 'JUMP';
    group.z = z;
    group.resolved = false;
    group.scored = false;

    // Span all 3 lanes or a specific lane
    const isFullWidth = (laneIdx === null);
    group.isFullWidth = isFullWidth;
    group.lane = laneIdx !== null ? this.lanes[laneIdx] : 0;
    const width = isFullWidth ? 9.2 : 2.7;

    // Main horizontal log
    const logGeo = new THREE.CylinderGeometry(0.3, 0.3, width, 12);
    const log = new THREE.Mesh(logGeo, this.spikedWoodMat);
    log.rotation.z = Math.PI / 2;
    log.position.y = 0.45;
    log.castShadow = true;
    group.add(log);
    group.rotatingLog = log;

    // Danger Spikes on log
    const spikeCount = isFullWidth ? 14 : 5;
    const spacing = width / (spikeCount + 1);
    for (let i = 1; i <= spikeCount; i++) {
      const spikeGeo = new THREE.ConeGeometry(0.12, 0.45, 6);
      const spike = new THREE.Mesh(spikeGeo, this.ironSpikeMat);
      const posX = -width / 2 + i * spacing;
      spike.position.set(posX, 0.45, 0);
      spike.rotation.x = (i % 2 === 0 ? 0.4 : -0.4);
      group.add(spike);
    }

    // Danger warning strip under hurdle
    const stripGeo = new THREE.PlaneGeometry(width, 0.4);
    const strip = new THREE.Mesh(stripGeo, this.dangerGlowMat);
    strip.rotation.x = -Math.PI / 2;
    strip.position.y = 0.02;
    group.add(strip);

    group.position.set(group.lane, 0, z);
    this.scene.add(group);
    return group;
  }

  // 2. Hanging Guillotine / Blade Arch (Requires SLIDE / SQUAT)
  createHangingBlade(z) {
    const group = new THREE.Group();
    group.obstacleType = 'SLIDE';
    group.z = z;
    group.resolved = false;
    group.scored = false;
    group.isFullWidth = true;
    group.lane = 0;

    // Overhead iron support bar
    const barGeo = new THREE.BoxGeometry(9.6, 0.3, 0.4);
    const bar = new THREE.Mesh(barGeo, this.ironSpikeMat);
    bar.position.y = 4.8;
    group.add(bar);

    // Hanging swinging blade pivot
    const pendulumGroup = new THREE.Group();
    pendulumGroup.position.set(0, 4.8, 0);

    // Support rod
    const rodGeo = new THREE.CylinderGeometry(0.06, 0.06, 3.2);
    const rod = new THREE.Mesh(rodGeo, this.ironSpikeMat);
    rod.position.y = -1.6;
    pendulumGroup.add(rod);

    // Giant curved crescent axe blade
    const bladeGeo = new THREE.BoxGeometry(4.5, 0.8, 0.1);
    const blade = new THREE.Mesh(bladeGeo, this.bladeMat);
    blade.position.y = -3.2;
    blade.castShadow = true;
    pendulumGroup.add(blade);

    // Glowing laser danger barrier below the blade (from y=1.2 to 2.4m)
    const laserGeo = new THREE.BoxGeometry(9.2, 1.2, 0.1);
    const laserMat = new THREE.MeshBasicMaterial({
      color: 0xff1744,
      transparent: true,
      opacity: 0.65,
    });
    const laser = new THREE.Mesh(laserGeo, laserMat);
    laser.position.y = 1.9;
    group.add(laser);

    group.add(pendulumGroup);
    group.pendulum = pendulumGroup;

    group.position.set(0, 0, z);
    this.scene.add(group);
    return group;
  }

  // 3. Ancient Monolith / Blockade (Requires SIDE STEP)
  createPillarBlockade(z, blockedLanes) {
    const group = new THREE.Group();
    group.obstacleType = 'STEP';
    group.z = z;
    group.resolved = false;
    group.scored = false;
    group.blockedLanes = blockedLanes; // Array of lane indices, e.g. [0, 1] (blocks Left and Center)

    for (const laneIdx of blockedLanes) {
      const laneX = this.lanes[laneIdx];
      // Tall crumbling stone obelisk
      const pillarGeo = new THREE.BoxGeometry(2.2, 5.0, 1.8);
      const pillar = new THREE.Mesh(pillarGeo, this.stonePillarMat);
      pillar.position.set(laneX, 2.5, 0);
      pillar.castShadow = true;
      group.add(pillar);

      // Glowing danger cracks
      const crackGeo = new THREE.BoxGeometry(0.1, 3.5, 1.85);
      const crack = new THREE.Mesh(crackGeo, this.dangerGlowMat);
      crack.position.set(laneX, 2.5, 0);
      group.add(crack);
    }

    group.position.set(0, 0, z);
    this.scene.add(group);
    return group;
  }

  update(playerZ, playerLaneX, isJumping, isSquatting, delta, onObstacleEvent) {
    // 1. Procedurally spawn obstacles ahead
    if (playerZ - this.spawnDistanceAhead < this.nextSpawnZ) {
      this.spawnNextObstacle(this.nextSpawnZ);
      this.nextSpawnZ -= this.minDistanceBetweenObstacles + Math.random() * 8;
    }

    // 2. Animate and check collisions for all active obstacles
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obs = this.obstacles[i];

      // Obstacle specific animations
      if (obs.rotatingLog) {
        obs.rotatingLog.rotation.x += delta * 6.0;
      }
      if (obs.pendulum) {
        obs.pendulum.rotation.z = Math.sin(Date.now() * 0.0035) * 0.45;
      }

      // Check collision window (|obs.z - playerZ| <= 1.2m)
      const distToPlayer = obs.z - playerZ;

      // When obstacle is in front approaching, trigger cue notification
      if (distToPlayer < 28 && distToPlayer > 18 && !obs.cued) {
        obs.cued = true;
        if (onObstacleEvent) {
          onObstacleEvent('APPROACHING', obs.obstacleType, obs);
        }
      }

      // Collision trigger zone
      if (Math.abs(distToPlayer) < 1.1 && !obs.resolved) {
        let isHit = false;

        if (obs.obstacleType === 'JUMP') {
          // Player must be jumping
          if (!isJumping) {
            isHit = true;
          } else {
            obs.scored = true;
          }
        } else if (obs.obstacleType === 'SLIDE') {
          // Player must be squatting/sliding
          if (!isSquatting) {
            isHit = true;
          } else {
            obs.scored = true;
          }
        } else if (obs.obstacleType === 'STEP') {
          // Check if player is in one of the blocked lanes
          const playerLaneIdx = this.getClosestLaneIndex(playerLaneX);
          if (obs.blockedLanes.includes(playerLaneIdx)) {
            isHit = true;
          } else {
            obs.scored = true;
          }
        }

        obs.resolved = true;
        if (onObstacleEvent) {
          if (isHit) {
            onObstacleEvent('HIT', obs.obstacleType, obs);
          } else {
            onObstacleEvent('SUCCESS', obs.obstacleType, obs);
          }
        }
      }

      // Clean up obstacles far behind player (more than 15m behind)
      if (obs.z > playerZ + 15) {
        this.scene.remove(obs);
        this.obstacles.splice(i, 1);
      }
    }
  }

  getClosestLaneIndex(x) {
    let closestIdx = 1;
    let minDist = 999;
    for (let i = 0; i < this.lanes.length; i++) {
      const dist = Math.abs(x - this.lanes[i]);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = i;
      }
    }
    return closestIdx;
  }

  spawnNextObstacle(z) {
    // Choose random obstacle type
    const roll = Math.random();
    let obs = null;

    if (roll < 0.35) {
      // JUMP Hurdle
      obs = this.createSpikeHurdle(z);
    } else if (roll < 0.70) {
      // SLIDE Guillotine
      obs = this.createHangingBlade(z);
    } else {
      // SIDE STEP (blocks 1 or 2 lanes, leaving at least 1 lane open)
      const blockPattern = Math.random();
      let blocked = [];
      if (blockPattern < 0.33) {
        blocked = [0, 1]; // Only Right lane open
      } else if (blockPattern < 0.66) {
        blocked = [1, 2]; // Only Left lane open
      } else {
        blocked = [0, 2]; // Only Center lane open
      }
      obs = this.createPillarBlockade(z, blocked);
    }

    this.obstacles.push(obs);
  }

  reset() {
    for (const obs of this.obstacles) {
      this.scene.remove(obs);
    }
    this.obstacles = [];
    this.nextSpawnZ = -30;
  }
}
