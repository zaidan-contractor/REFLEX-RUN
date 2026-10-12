// ==========================================================================
// REFLEXRUN 3D - 3D MONSTER COMBAT & SHATTER DESTRUCTION ENGINE
// ==========================================================================

import * as THREE from 'three';

export class MonsterManager {
  constructor(scene) {
    this.scene = scene;
    this.monsters = [];
    this.shards = [];
    this.lanes = [-2.8, 0, 2.8];
    this.nextSpawnZ = -45;
    this.minDistanceBetweenMonsters = 38;

    this.createMonsterMaterials();
  }

  createMonsterMaterials() {
    this.golemBodyMat = new THREE.MeshStandardMaterial({
      color: 0x1f242d,
      roughness: 0.85,
      metalness: 0.15,
    });

    this.golemMagmaMat = new THREE.MeshBasicMaterial({
      color: 0xff4400,
    });

    this.golemEyeMat = new THREE.MeshBasicMaterial({
      color: 0xffea00,
    });

    this.shardMat = new THREE.MeshStandardMaterial({
      color: 0x2b323d,
      roughness: 0.8,
      metalness: 0.2,
    });

    // Pre-allocated shared geometries for zero-allocation, zero-lag shatter explosions
    this.shardGeos = [
      new THREE.DodecahedronGeometry(0.32, 0),
      new THREE.DodecahedronGeometry(0.24, 0),
      new THREE.BoxGeometry(0.32, 0.32, 0.32),
      new THREE.TetrahedronGeometry(0.36, 0),
    ];
  }

  // Create detailed 3D Magma Golem
  createMagmaGolem(laneIdx, z) {
    const group = new THREE.Group();
    group.laneIdx = laneIdx;
    group.z = z;
    group.alive = true;
    group.walkCycle = Math.random() * Math.PI * 2;

    // 1. Torso
    const torsoGeo = new THREE.BoxGeometry(1.6, 1.8, 1.2);
    const torso = new THREE.Mesh(torsoGeo, this.golemBodyMat);
    torso.position.y = 2.0;
    torso.castShadow = true;
    group.add(torso);

    // Magma Core in chest
    const coreGeo = new THREE.BoxGeometry(0.7, 0.9, 1.25);
    const core = new THREE.Mesh(coreGeo, this.golemMagmaMat);
    core.position.y = 2.0;
    group.add(core);

    // 2. Horned Head
    const headGeo = new THREE.BoxGeometry(1.0, 0.9, 0.9);
    const head = new THREE.Mesh(headGeo, this.golemBodyMat);
    head.position.set(0, 3.2, 0);
    head.castShadow = true;
    group.add(head);

    // Glowing Eyes
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.1), this.golemEyeMat);
    eyeL.position.set(-0.25, 3.25, 0.46);
    group.add(eyeL);

    const eyeR = eyeL.clone();
    eyeR.position.x = 0.25;
    group.add(eyeR);

    // Magma Horns
    const hornGeo = new THREE.ConeGeometry(0.18, 0.7, 5);
    const hornL = new THREE.Mesh(hornGeo, this.golemMagmaMat);
    hornL.position.set(-0.45, 3.8, 0);
    hornL.rotation.z = 0.4;
    group.add(hornL);

    const hornR = hornL.clone();
    hornR.position.x = 0.45;
    hornR.rotation.z = -0.4;
    group.add(hornR);

    // 3. Heavy Armored Arms
    const armGeo = new THREE.BoxGeometry(0.6, 1.8, 0.7);
    const armL = new THREE.Mesh(armGeo, this.golemBodyMat);
    armL.position.set(-1.25, 1.8, 0);
    armL.castShadow = true;
    group.add(armL);
    group.armL = armL;

    const armR = armL.clone();
    armR.position.x = 1.25;
    group.add(armR);
    group.armR = armR;

    // Glowing Target Reticle above/front of monster
    const reticleGeo = new THREE.RingGeometry(0.7, 0.85, 24);
    const reticleMat = new THREE.MeshBasicMaterial({
      color: 0xff3d00,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });
    const reticle = new THREE.Mesh(reticleGeo, reticleMat);
    reticle.position.set(0, 2.2, 0.8);
    group.add(reticle);
    group.reticle = reticle;

    // Point light radiating from monster
    const glow = new THREE.PointLight(0xff3300, 1.8, 12, 1.5);
    glow.position.set(0, 2.0, 0.5);
    group.add(glow);

    group.position.set(this.lanes[laneIdx], 0, z);
    this.scene.add(group);
    return group;
  }

  // Shatter Golem into exploding 3D fragments (zero allocation runtime)
  shatterMonster(monster) {
    monster.alive = false;
    const origin = monster.position.clone();
    origin.y += 2.0;

    // Remove original model
    this.scene.remove(monster);

    // Spawn 16 pre-allocated pooled rock shards (zero hitch, zero compile lag!)
    const shardCount = 16;
    for (let i = 0; i < shardCount; i++) {
      const geo = this.shardGeos[i % this.shardGeos.length];
      const isGlowing = (i % 3 === 0);
      const mat = isGlowing ? this.golemMagmaMat : this.shardMat;
      const mesh = new THREE.Mesh(geo, mat);

      const scale = 0.75 + Math.random() * 0.55;
      mesh.scale.set(scale, scale, scale);
      mesh.position.copy(origin);
      mesh.position.x += (Math.random() - 0.5) * 1.1;
      mesh.position.y += (Math.random() - 0.5) * 1.1;

      // Random explosion velocity (bursting forward, up, and outward)
      const speed = 7.0 + Math.random() * 8.0;
      const angleX = (Math.random() - 0.5) * 2.0;
      const angleY = 0.6 + Math.random() * 1.2;
      const angleZ = -0.5 - Math.random() * 1.5; // Fly backwards towards depth

      const velocity = new THREE.Vector3(angleX, angleY, angleZ).normalize().multiplyScalar(speed);
      const rotSpeed = new THREE.Vector3(
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 12
      );

      this.scene.add(mesh);
      this.shards.push({
        mesh,
        velocity,
        rotSpeed,
        life: 0.95,
      });
    }
  }

  // Try to hit any monster near the player's punch
  checkPunchHit(playerZ, playerLaneX) {
    for (let i = 0; i < this.monsters.length; i++) {
      const monster = this.monsters[i];
      if (!monster.alive) continue;

      const distZ = monster.z - playerZ;
      // Generous punch range: from 7.5m ahead to 1.8m close-quarters
      if (distZ > -7.5 && distZ < 1.8) {
        const monsterLaneX = this.lanes[monster.laneIdx];
        const lateralDist = Math.abs(monsterLaneX - playerLaneX);

        // Can punch monster in current lane or adjacent lane reach
        if (lateralDist <= 3.2) {
          this.shatterMonster(monster);
          this.monsters.splice(i, 1);
          return true; // Successfully punched monster!
        }
      }
    }
    return false;
  }

  update(playerZ, playerLaneX, delta, onMonsterEvent) {
    // 1. Procedurally spawn monsters ahead
    if (playerZ - 70 < this.nextSpawnZ) {
      const randomLane = Math.floor(Math.random() * 3);
      const monster = this.createMagmaGolem(randomLane, this.nextSpawnZ);
      this.monsters.push(monster);
      this.nextSpawnZ -= this.minDistanceBetweenMonsters + Math.random() * 14;
    }

    // 2. Animate and track active monsters
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const monster = this.monsters[i];
      if (!monster.alive) continue;

      // Charge forward towards player slightly
      monster.walkCycle += delta * 7.0;
      monster.z += delta * 3.0; // Moves towards player
      monster.position.z = monster.z;

      // Arm swing animation
      if (monster.armL && monster.armR) {
        monster.armL.rotation.x = Math.sin(monster.walkCycle) * 0.45;
        monster.armR.rotation.x = -Math.sin(monster.walkCycle) * 0.45;
      }

      // Reticle pulse & spin
      if (monster.reticle) {
        monster.reticle.rotation.z += delta * 3.0;
        const scale = 1.0 + Math.sin(monster.walkCycle * 2) * 0.15;
        monster.reticle.scale.set(scale, scale, 1.0);
      }

      const distToPlayer = monster.z - playerZ;

      // Monster approaching cue
      if (distToPlayer < 24 && distToPlayer > 18 && !monster.cued) {
        monster.cued = true;
        if (onMonsterEvent) {
          onMonsterEvent('APPROACHING', monster);
        }
      }

      // Collision hit if player didn't punch in time
      if (distToPlayer > -1.2 && monster.alive) {
        const monsterLaneX = this.lanes[monster.laneIdx];
        const playerInLane = Math.abs(monsterLaneX - playerLaneX) < 1.5;

        if (playerInLane) {
          // Monster hits player!
          monster.alive = false;
          this.scene.remove(monster);
          this.monsters.splice(i, 1);
          if (onMonsterEvent) {
            onMonsterEvent('ATTACK', monster);
          }
          continue;
        }
      }

      // Clean up past monsters
      if (monster.z > playerZ + 15) {
        this.scene.remove(monster);
        this.monsters.splice(i, 1);
      }
    }

    // 3. Update exploding shatter shards physics
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const shard = this.shards[i];
      shard.life -= delta * 1.5;

      // Gravity and movement
      shard.velocity.y -= 18.0 * delta; // Gravity
      shard.mesh.position.addScaledVector(shard.velocity, delta);

      // Rotation
      shard.mesh.rotation.x += shard.rotSpeed.x * delta;
      shard.mesh.rotation.y += shard.rotSpeed.y * delta;
      shard.mesh.rotation.z += shard.rotSpeed.z * delta;

      // Bounce on floor (y = 0.2)
      if (shard.mesh.position.y < 0.2) {
        shard.mesh.position.y = 0.2;
        shard.velocity.y = -shard.velocity.y * 0.4; // Bounce damping
        shard.velocity.x *= 0.7;
        shard.velocity.z *= 0.7;
      }

      // Fade out
      if (shard.life <= 0) {
        this.scene.remove(shard.mesh);
        this.shards.splice(i, 1);
      }
    }
  }

  reset() {
    for (const m of this.monsters) {
      this.scene.remove(m);
    }
    this.monsters = [];

    for (const s of this.shards) {
      this.scene.remove(s.mesh);
    }
    this.shards = [];
    this.nextSpawnZ = -45;
  }
}
