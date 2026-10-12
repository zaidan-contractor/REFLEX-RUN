// ==========================================================================
// REFLEXRUN 3D - FIRST-PERSON 3D BOXING GLOVES & PUNCH ANIMATIONS
// ==========================================================================

import * as THREE from 'three';

export class PlayerHands {
  constructor(camera) {
    this.camera = camera;
    this.handsGroup = new THREE.Group();
    this.camera.add(this.handsGroup);

    // Punch state
    this.punchProgressLeft = 0;
    this.punchProgressRight = 0;
    this.isPunchingLeft = false;
    this.isPunchingRight = false;
    this.idleBobTimer = 0;

    this.createGloves();
  }

  createGloves() {
    // Athletic Boxing Glove Material
    const gloveMat = new THREE.MeshStandardMaterial({
      color: 0xd82b2b, // Punchy crimson red
      roughness: 0.4,
      metalness: 0.1,
    });

    const wrapMat = new THREE.MeshStandardMaterial({
      color: 0x11161f, // Tactical matte black wrap
      roughness: 0.8,
    });

    const knuckleMat = new THREE.MeshStandardMaterial({
      color: 0xff8800, // Reinforced glowing knuckles
      roughness: 0.3,
      metalness: 0.6,
    });

    // Left Fist Group
    this.leftHand = new THREE.Group();
    this.basePosLeft = new THREE.Vector3(-0.48, -0.42, -0.85);
    this.leftHand.position.copy(this.basePosLeft);

    // Right Fist Group
    this.rightHand = new THREE.Group();
    this.basePosRight = new THREE.Vector3(0.48, -0.42, -0.85);
    this.rightHand.position.copy(this.basePosRight);

    // Helper to build 3D fist geometry
    const buildGlove = (handGroup, isLeft) => {
      // Main Glove body (rounded box)
      const mainGeo = new THREE.BoxGeometry(0.24, 0.28, 0.36);
      const mainMesh = new THREE.Mesh(mainGeo, gloveMat);
      mainMesh.castShadow = true;
      handGroup.add(mainMesh);

      // Knuckle guard
      const knuckleGeo = new THREE.BoxGeometry(0.25, 0.12, 0.12);
      const knuckleMesh = new THREE.Mesh(knuckleGeo, knuckleMat);
      knuckleMesh.position.set(0, 0.08, -0.15);
      handGroup.add(knuckleMesh);

      // Thumb
      const thumbGeo = new THREE.BoxGeometry(0.1, 0.18, 0.18);
      const thumb = new THREE.Mesh(thumbGeo, gloveMat);
      thumb.position.set(isLeft ? 0.13 : -0.13, -0.05, -0.05);
      handGroup.add(thumb);

      // Wrist Forearm Wrap
      const wristGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.4, 12);
      const wrist = new THREE.Mesh(wristGeo, wrapMat);
      wrist.rotation.x = Math.PI / 2;
      wrist.position.set(0, -0.02, 0.32);
      handGroup.add(wrist);
    };

    buildGlove(this.leftHand, true);
    buildGlove(this.rightHand, false);

    // Initial guard tilt
    this.leftHand.rotation.set(0.2, 0.35, -0.15);
    this.rightHand.rotation.set(0.2, -0.35, 0.15);

    this.handsGroup.add(this.leftHand);
    this.handsGroup.add(this.rightHand);
  }

  triggerPunch(side = 'right') {
    if (side === 'left') {
      this.isPunchingLeft = true;
      this.punchProgressLeft = 0.01;
    } else {
      this.isPunchingRight = true;
      this.punchProgressRight = 0.01;
    }
  }

  update(runSpeed, delta) {
    this.idleBobTimer += delta * runSpeed * 0.4;
    const idleBobY = Math.sin(this.idleBobTimer * 2.0) * 0.025;
    const idleBobX = Math.cos(this.idleBobTimer) * 0.015;

    // 1. Left Hand Punch Animation
    if (this.isPunchingLeft) {
      this.punchProgressLeft += delta * 7.5; // Fast punch snap
      if (this.punchProgressLeft >= 1.0) {
        this.punchProgressLeft = 0;
        this.isPunchingLeft = false;
      }
      // Sinusoidal extension and retraction curve
      const extend = Math.sin(this.punchProgressLeft * Math.PI);
      this.leftHand.position.set(
        this.basePosLeft.x + extend * 0.25,
        this.basePosLeft.y + extend * 0.15,
        this.basePosLeft.z - extend * 0.85 // Snaps forward towards center
      );
      this.leftHand.rotation.z = -0.15 - extend * 0.5;
    } else {
      // Natural guard idle
      this.leftHand.position.set(
        this.basePosLeft.x + idleBobX,
        this.basePosLeft.y + idleBobY,
        this.basePosLeft.z
      );
      this.leftHand.rotation.set(0.2, 0.35, -0.15);
    }

    // 2. Right Hand Punch Animation
    if (this.isPunchingRight) {
      this.punchProgressRight += delta * 7.5;
      if (this.punchProgressRight >= 1.0) {
        this.punchProgressRight = 0;
        this.isPunchingRight = false;
      }
      const extend = Math.sin(this.punchProgressRight * Math.PI);
      this.rightHand.position.set(
        this.basePosRight.x - extend * 0.25,
        this.basePosRight.y + extend * 0.15,
        this.basePosRight.z - extend * 0.85
      );
      this.rightHand.rotation.z = 0.15 + extend * 0.5;
    } else {
      this.rightHand.position.set(
        this.basePosRight.x - idleBobX,
        this.basePosRight.y + idleBobY,
        this.basePosRight.z
      );
      this.rightHand.rotation.set(0.2, -0.35, 0.15);
    }
  }
}
