import * as THREE from 'three';
import { ConveyorConfiguration } from '../../types/conveyor';
import { ConveyorPath, getVisualWidth } from './pathMath';
import { ConveyorMaterials } from './materials';

export class FrameGenerator {
  private materials: ConveyorMaterials;

  constructor() {
    this.materials = ConveyorMaterials.getInstance();
  }

  public generate(config: ConveyorConfiguration, path: ConveyorPath): THREE.Group {
    const frameGroup = new THREE.Group();
    frameGroup.name = 'ConveyorFrame';

    const visualW = getVisualWidth(config.width);
    const halfWidth = visualW / 2;
    const profileWidth = 24; // mm
    const profileHeight = 92; // mm (strictly 92 profile size)
    const workingY = config.workingHeight.enabled && config.workingHeight.type !== 'without-support'
      ? config.workingHeight.height
      : 850;

    // 1. Left Profile Rail (Offset along +leftNormal)
    const leftRailOffset = halfWidth + profileWidth / 2;
    this.buildExtrudedRail(path, leftRailOffset, profileWidth, profileHeight, workingY, frameGroup, 'LeftProfile');

    // 2. Right Profile Rail (Offset along -leftNormal / +rightNormal)
    const rightRailOffset = -(halfWidth + profileWidth / 2);
    this.buildExtrudedRail(path, rightRailOffset, profileWidth, profileHeight, workingY, frameGroup, 'RightProfile');

    // 3. Low-Friction PE-UHMW Wear Strips along both rails
    const wearStripWidth = profileWidth * 0.8;
    const wearStripHeight = 4;
    this.buildWearStrips(path, halfWidth + profileWidth / 2, wearStripWidth, wearStripHeight, workingY + profileHeight / 2 + 2, frameGroup);

    // 4. Cross-Tie Structural Beams every ~500 mm
    this.buildCrossBeams(path, visualW, workingY - profileHeight / 4, frameGroup);

    // 5. Infeed and Discharge Terminal End Plates
    this.buildEndPlates(path, visualW + profileWidth * 2, profileHeight, workingY, frameGroup);

    return frameGroup;
  }

  private buildExtrudedRail(
    path: ConveyorPath,
    lateralOffset: number,
    profWidth: number,
    profHeight: number,
    workingY: number,
    parentGroup: THREE.Group,
    name: string
  ): void {
    const samples = path.samples;
    if (samples.length < 2) return;

    const geom = new THREE.BufferGeometry();
    const vertices: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const halfW = profWidth / 2;
    const halfH = profHeight / 2;

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      // Offset center along leftNormal
      const center = s.point.clone().add(s.leftNormal.clone().multiplyScalar(lateralOffset));
      center.y = workingY;

      const norm = s.leftNormal;

      // 4 cross-section vertices:
      // 0: Outer-Top (+norm * halfW, +Y halfH)
      // 1: Inner-Top (-norm * halfW, +Y halfH)
      // 2: Inner-Bottom (-norm * halfW, -Y halfH)
      // 3: Outer-Bottom (+norm * halfW, -Y halfH)
      const p0 = center.clone().add(norm.clone().multiplyScalar(halfW)).add(new THREE.Vector3(0, halfH, 0));
      const p1 = center.clone().add(norm.clone().multiplyScalar(-halfW)).add(new THREE.Vector3(0, halfH, 0));
      const p2 = center.clone().add(norm.clone().multiplyScalar(-halfW)).add(new THREE.Vector3(0, -halfH, 0));
      const p3 = center.clone().add(norm.clone().multiplyScalar(halfW)).add(new THREE.Vector3(0, -halfH, 0));

      vertices.push(
        p0.x, p0.y, p0.z,
        p1.x, p1.y, p1.z,
        p2.x, p2.y, p2.z,
        p3.x, p3.y, p3.z
      );

      const u = s.distance / 100.0;
      uvs.push(
        u, 1,
        u, 0.75,
        u, 0.25,
        u, 0
      );
    }

    for (let i = 0; i < samples.length - 1; i++) {
      const c = i * 4;
      const n = (i + 1) * 4;

      // Top Face
      indices.push(c + 0, c + 1, n + 1);
      indices.push(c + 0, n + 1, n + 0);

      // Inner Face
      indices.push(c + 1, c + 2, n + 2);
      indices.push(c + 1, n + 2, n + 1);

      // Bottom Face
      indices.push(c + 2, c + 3, n + 3);
      indices.push(c + 2, n + 3, n + 2);

      // Outer Face
      indices.push(c + 3, c + 0, n + 0);
      indices.push(c + 3, n + 0, n + 3);
    }

    geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    const mesh = new THREE.Mesh(geom, this.materials.aluminumProfile);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parentGroup.add(mesh);
  }

  private buildWearStrips(
    path: ConveyorPath,
    offsetDist: number,
    wearW: number,
    wearH: number,
    yPos: number,
    parentGroup: THREE.Group
  ): void {
    const leftPoints = path.getOffsetPoints(offsetDist, 20);
    const rightPoints = path.getOffsetPoints(-offsetDist, 20);

    const buildStrip = (pts: THREE.Vector3[]) => {
      if (pts.length < 2) return;
      const curve = new THREE.CatmullRomCurve3(pts);
      const geom = new THREE.TubeGeometry(curve, pts.length * 2, wearH, 6, false);
      const wearMesh = new THREE.Mesh(geom, this.materials.peUhmwWearStrip);
      wearMesh.position.y = yPos;
      parentGroup.add(wearMesh);
    };

    buildStrip(leftPoints);
    buildStrip(rightPoints);
  }

  private buildCrossBeams(
    path: ConveyorPath,
    trackWidth: number,
    yPos: number,
    parentGroup: THREE.Group
  ): void {
    const beamSpacing = 500; // mm
    const count = Math.max(2, Math.floor(path.totalLength / beamSpacing));
    const stepDist = path.totalLength / count;

    const beamGeom = new THREE.BoxGeometry(30, 25, trackWidth + 10);
    const boltGeom = new THREE.CylinderGeometry(5, 5, 8, 12);
    boltGeom.rotateX(Math.PI / 2);

    for (let i = 0; i <= count; i++) {
      const dist = i * stepDist;
      const s = path.getSampleAtDistance(dist);

      const beam = new THREE.Mesh(beamGeom, this.materials.aluminumProfileDark);
      beam.position.copy(s.point);
      beam.position.y = yPos;
      beam.rotation.y = -s.heading;
      beam.castShadow = true;
      parentGroup.add(beam);

      // Left & Right securing brackets & bolts
      const halfW = trackWidth / 2;
      const boltL = new THREE.Mesh(boltGeom, this.materials.zincHardware);
      boltL.position.copy(s.point).add(s.leftNormal.clone().multiplyScalar(halfW + 8));
      boltL.position.y = yPos;
      boltL.rotation.y = -s.heading;
      parentGroup.add(boltL);

      const boltR = new THREE.Mesh(boltGeom, this.materials.zincHardware);
      boltR.position.copy(s.point).add(s.leftNormal.clone().multiplyScalar(-halfW - 8));
      boltR.position.y = yPos;
      boltR.rotation.y = -s.heading;
      parentGroup.add(boltR);
    }
  }

  private buildEndPlates(
    path: ConveyorPath,
    fullWidth: number,
    profHeight: number,
    workingY: number,
    parentGroup: THREE.Group
  ): void {
    // 5. AUTHENTIC IDLER RETURN TERMINAL UNIT (Strictly matching Image 3: conveyor-idler-end-bracket.png)
    const startSample = path.getSampleAtDistance(0);
    const endSample = path.getSampleAtDistance(path.totalLength);
    const halfW = fullWidth / 2;

    [startSample, endSample].forEach((sample, idx) => {
      const isStart = idx === 0;
      const endGroup = new THREE.Group();

      // Left and Right White UHMW Cheek Plates with rounded nose contour
      for (const sign of [-1, 1]) {
        const cheekGroup = new THREE.Group();
        const cheekThick = 15;
        const cheekOffset = (halfW - 8) * sign;

        // Main cheek body plate
        const cheekBodyGeom = new THREE.BoxGeometry(110, profHeight, cheekThick);
        const cheekBody = new THREE.Mesh(cheekBodyGeom, this.materials.whiteCheekPlate);
        cheekBody.position.set(20 * (isStart ? -1 : 1), 0, 0);
        cheekBody.castShadow = true;
        cheekGroup.add(cheekBody);

        // Front rounded nose where chain wraps around
        const cheekNoseGeom = new THREE.CylinderGeometry(profHeight / 2, profHeight / 2, cheekThick, 24);
        cheekNoseGeom.rotateZ(Math.PI / 2);
        const cheekNose = new THREE.Mesh(cheekNoseGeom, this.materials.whiteCheekPlate);
        cheekNose.position.set(45 * (isStart ? -1 : 1), 0, 0);
        cheekNose.castShadow = true;
        cheekGroup.add(cheekNose);

        // L-shaped aluminium mounting bracket on outside of cheek plate (Image 3)
        const lBracketGroup = new THREE.Group();
        const lVertGeom = new THREE.BoxGeometry(32, 65, 5);
        const lVert = new THREE.Mesh(lVertGeom, this.materials.aluminumProfile);
        lVert.position.set(0, -10, 0);
        lBracketGroup.add(lVert);

        const lHorizGeom = new THREE.BoxGeometry(55, 30, 5);
        const lHoriz = new THREE.Mesh(lHorizGeom, this.materials.aluminumProfile);
        lHoriz.position.set(12 * (isStart ? -1 : 1), -27, 0);
        lBracketGroup.add(lHoriz);

        // 4 Button-head bolts on L-bracket (2 into profile, 2 into cheek plate - Image 3)
        const boltGeom = new THREE.CylinderGeometry(5, 5, 8, 12);
        boltGeom.rotateZ(Math.PI / 2);
        const bPos = [
          [0, 10], [0, -10],
          [20 * (isStart ? -1 : 1), -27], [35 * (isStart ? -1 : 1), -27]
        ];
        for (const [bx, by] of bPos) {
          const bolt = new THREE.Mesh(boltGeom, this.materials.zincHardware);
          bolt.position.set(bx, by, 3 * sign);
          lBracketGroup.add(bolt);
        }

        lBracketGroup.position.set(0, 0, (cheekThick / 2 + 3) * sign);
        cheekGroup.add(lBracketGroup);

        cheekGroup.position.copy(sample.point).add(sample.leftNormal.clone().multiplyScalar(cheekOffset));
        cheekGroup.position.y = workingY;
        cheekGroup.rotation.y = -sample.heading;
        endGroup.add(cheekGroup);
      }

      // Bottom Transition Guide Ramp Wedge (Dark Anthracite - Image 3)
      const wedgeGeom = new THREE.BoxGeometry(70, 30, fullWidth - 10);
      const wedge = new THREE.Mesh(wedgeGeom, this.materials.darkRampWedge);
      wedge.position.copy(sample.point).add(sample.tangent.clone().multiplyScalar(15 * (isStart ? -1 : 1)));
      wedge.position.y = workingY - profHeight / 2 - 12;
      wedge.rotation.y = -sample.heading;
      wedge.rotation.z = 0.25 * (isStart ? 1 : -1);
      endGroup.add(wedge);

      // Return Sprocket Wheel between cheeks (Image 3)
      const sprocketGeom = new THREE.CylinderGeometry(48, 48, fullWidth - 40, 20);
      sprocketGeom.rotateZ(Math.PI / 2);
      const spr = new THREE.Mesh(sprocketGeom, this.materials.darkSprocket);
      spr.position.copy(sample.point).add(sample.tangent.clone().multiplyScalar(35 * (isStart ? -1 : 1)));
      spr.position.y = workingY;
      spr.rotation.y = -sample.heading;
      endGroup.add(spr);

      parentGroup.add(endGroup);
    });
  }
}
