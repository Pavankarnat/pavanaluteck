import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ConveyorConfiguration } from '../../types/conveyor';
import { ConveyorPath, getVisualWidth } from './pathMath';
import { ConveyorMaterials } from './materials';

export class ChainGenerator {
  private materials: ConveyorMaterials;

  constructor() {
    this.materials = ConveyorMaterials.getInstance();
  }

  public generate(config: ConveyorConfiguration, path: ConveyorPath): THREE.Group {
    const chainGroup = new THREE.Group();
    chainGroup.name = 'ConveyorChain';

    const visualW = getVisualWidth(config.width);
    const workingY = config.workingHeight.enabled && config.workingHeight.type !== 'without-support'
      ? config.workingHeight.height
      : 850;

    const chainMat = this.materials.getChainMaterial(config.chainMaterial);
    const pitch = configPitch(config.width);

    // 1. Build authentic 3D modular chain links (Top run, end wraps, and return run - strictly matching Image 2)
    this.buildModularChain(path, visualW, workingY, pitch, chainMat, chainGroup);

    // 2. Drive & Idler Sprockets at terminals
    this.buildSprockets(path, visualW, config.width, workingY, chainGroup);

    return chainGroup;
  }

  /**
   * Constructs the authentic ALUFLEX Modular Knuckle Chain (Strictly matching client reference Image 2)
   * Geometry per link:
   * - Flat carrying top plate with chamfered edges (width = track_width - 1.5 mm, length = pitch * 0.72 mm)
   * - Forward interlocking knuckle pair (2 outer barrels at leading edge)
   * - Trailing central interlocking knuckle (1 center barrel at trailing edge)
   * - Connecting hinge pin
   * - Underside track guide tabs
   */
  private buildModularChain(
    path: ConveyorPath,
    width: number,
    workingY: number,
    pitch: number,
    mat: THREE.Material,
    parentGroup: THREE.Group
  ): void {
    const linkGeom = this.createModularLinkGeometry(width, pitch);
    if (!linkGeom) return;

    const chainTopY = workingY + 44.0;
    const chainBottomY = workingY - 35.0;

    // Calculate instance positions
    const topCount = Math.max(2, Math.floor((path.totalLength - 50) / pitch));
    const wrapCount = 6; // 6 links per 180-degree wrap around sprockets
    const returnPitch = pitch * 1.5;
    const returnCount = Math.max(2, Math.floor((path.totalLength - 50) / returnPitch));

    const totalInstances = topCount + wrapCount * 2 + returnCount;
    const instancedMesh = new THREE.InstancedMesh(linkGeom, mat, totalInstances);
    instancedMesh.name = 'ModularChainLinks';
    instancedMesh.castShadow = true;
    instancedMesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    let instanceIdx = 0;

    // A. TOP CARRYING CHAIN RUN (Directly on top of wear strips)
    for (let i = 0; i < topCount; i++) {
      const dist = 25 + (i + 0.5) * pitch;
      if (dist > path.totalLength - 25) break;

      const sample = path.getSampleAtDistance(dist);
      dummy.position.set(sample.point.x, chainTopY, sample.point.z);
      dummy.rotation.set(0, -sample.heading, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();

      instancedMesh.setMatrixAt(instanceIdx++, dummy.matrix);
    }

    // B. DISCHARGE HEAD END 180° WRAP-AROUND (Curving around drive sprocket)
    const endSample = path.getSampleAtDistance(path.totalLength - 20);
    const endTan = endSample.tangent.clone().normalize();
    const endSpCenterY = (chainTopY + chainBottomY) / 2;
    const spRadius = (chainTopY - chainBottomY) / 2;

    for (let w = 0; w < wrapCount; w++) {
      const frac = (w + 0.5) / wrapCount;
      const ang = frac * Math.PI; // 0 (top) to PI (bottom)

      const arcPos = endSample.point.clone().add(endTan.clone().multiplyScalar(Math.sin(ang) * spRadius));
      arcPos.y = endSpCenterY + Math.cos(ang) * spRadius;

      dummy.position.copy(arcPos);
      dummy.rotation.set(0, -endSample.heading, 0);
      dummy.rotateZ(-ang);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();

      instancedMesh.setMatrixAt(instanceIdx++, dummy.matrix);
    }

    // C. RETURN CHAIN RUN (Returning underneath conveyor profile)
    for (let j = 0; j < returnCount; j++) {
      const dist = (path.totalLength - 25) - (j + 0.5) * returnPitch;
      if (dist < 25) break;

      const sample = path.getSampleAtDistance(dist);
      dummy.position.set(sample.point.x, chainBottomY, sample.point.z);
      dummy.rotation.set(Math.PI, -sample.heading, 0); // Inverted upside down on return run
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();

      instancedMesh.setMatrixAt(instanceIdx++, dummy.matrix);
    }

    // D. INFEED IDLER END 180° WRAP-AROUND (Curving around idler sprocket from bottom to top)
    const startSample = path.getSampleAtDistance(20);
    const startTan = startSample.tangent.clone().normalize();

    for (let w = 0; w < wrapCount; w++) {
      const frac = (w + 0.5) / wrapCount;
      const ang = Math.PI + frac * Math.PI; // PI (bottom) to 2*PI (top)

      const arcPos = startSample.point.clone().add(startTan.clone().multiplyScalar(Math.sin(ang) * spRadius));
      arcPos.y = endSpCenterY + Math.cos(ang) * spRadius;

      dummy.position.copy(arcPos);
      dummy.rotation.set(0, -startSample.heading, 0);
      dummy.rotateZ(-ang);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();

      instancedMesh.setMatrixAt(instanceIdx++, dummy.matrix);
    }

    instancedMesh.count = instanceIdx;
    instancedMesh.instanceMatrix.needsUpdate = true;
    parentGroup.add(instancedMesh);
  }

  /**
   * Generates a single detailed 3D modular chain link (Image 2)
   */
  private createModularLinkGeometry(width: number, pitch: number): THREE.BufferGeometry {
    const halfW = width / 2;
    const linkLength = pitch * 0.72; // ~27.5 mm
    const linkThick = 4.5; // mm

    // 1. Slat Main Top Carrying Plate (width = track_width - 1.5 mm)
    const plateGeom = new THREE.BoxGeometry(linkLength, linkThick, width - 2);

    // 2. Forward Interlocking Knuckles (2 outer barrels at leading edge)
    const fwdKnuckleW = (width - 4) * 0.24;
    const fwdKnuckleSpacing = (width - 4) * 0.28;
    const knuckleGeom = new THREE.CylinderGeometry(3.5, 3.5, fwdKnuckleW, 12);
    knuckleGeom.rotateX(Math.PI / 2);

    const k1 = knuckleGeom.clone();
    k1.translate(linkLength / 2 + 1.5, -linkThick / 2, fwdKnuckleSpacing);

    const k2 = knuckleGeom.clone();
    k2.translate(linkLength / 2 + 1.5, -linkThick / 2, -fwdKnuckleSpacing);

    // 3. Trailing Central Interlocking Knuckle (1 center barrel at trailing edge)
    const trailKnuckleW = (width - 4) * 0.32;
    const trailKnuckleGeom = new THREE.CylinderGeometry(3.5, 3.5, trailKnuckleW, 12);
    trailKnuckleGeom.rotateX(Math.PI / 2);
    trailKnuckleGeom.translate(-(linkLength / 2 + 1.5), -linkThick / 2, 0);

    // 4. Underside Track Guide Tabs (holding chain in wear strip track)
    const tabGeom = new THREE.BoxGeometry(linkLength * 0.6, 6, 4);
    const tab1 = tabGeom.clone();
    tab1.translate(0, -linkThick - 2, halfW - 14);

    const tab2 = tabGeom.clone();
    tab2.translate(0, -linkThick - 2, -(halfW - 14));

    const merged = BufferGeometryUtils.mergeGeometries([plateGeom, k1, k2, trailKnuckleGeom, tab1, tab2]);
    return merged;
  }

  private buildSprockets(path: ConveyorPath, width: number, actualWidth: number, workingY: number, parentGroup: THREE.Group): void {
    const startSample = path.getSampleAtDistance(25);
    const endSample = path.getSampleAtDistance(path.totalLength - 25);

    const sprocketRadius = 38; // mm (Z=16)
    const sprocketWidth = 14;

    // Count follows the real chain width so the 3D model matches the BOM (visual width only drives spacing).
    const sprocketsCount = actualWidth < 200 ? 2 : (actualWidth < 300 ? 3 : 4);
    const spacing = (width - 30) / Math.max(1, sprocketsCount - 1);

    [startSample, endSample].forEach((sample) => {
      for (let k = 0; k < sprocketsCount; k++) {
        const offsetLeft = -(width - 30) / 2 + k * spacing;

        const sprocketGroup = new THREE.Group();

        // Sprocket hub
        const hubGeom = new THREE.CylinderGeometry(sprocketRadius, sprocketRadius, sprocketWidth, 16);
        hubGeom.rotateZ(Math.PI / 2);
        const hub = new THREE.Mesh(hubGeom, this.materials.darkSprocket);
        sprocketGroup.add(hub);

        // Teeth on sprocket circumference (16 teeth)
        const toothGeom = new THREE.BoxGeometry(sprocketWidth + 2, 8, 6);
        for (let t = 0; t < 16; t++) {
          const angle = (t / 16) * Math.PI * 2;
          const tooth = new THREE.Mesh(toothGeom, this.materials.darkSprocket);
          tooth.position.set(0, Math.sin(angle) * (sprocketRadius + 2), Math.cos(angle) * (sprocketRadius + 2));
          tooth.rotation.x = angle;
          sprocketGroup.add(tooth);
        }

        sprocketGroup.position.copy(sample.point).add(sample.leftNormal.clone().multiplyScalar(offsetLeft));
        sprocketGroup.position.y = workingY + 4;
        sprocketGroup.rotation.y = -sample.heading;

        parentGroup.add(sprocketGroup);
      }

      // Drive / Idler Shaft through sprockets
      const shaftGeom = new THREE.CylinderGeometry(10, 10, width + 50, 16);
      shaftGeom.rotateZ(Math.PI / 2);
      const shaft = new THREE.Mesh(shaftGeom, this.materials.zincHardware);
      shaft.position.copy(sample.point);
      shaft.position.y = workingY + 4;
      shaft.rotation.y = -sample.heading;
      parentGroup.add(shaft);
    });
  }
}

function configPitch(width: number): number {
  return width <= 63 ? 25.4 : (width >= 190.5 ? 50.8 : 38.1);
}
