import * as THREE from 'three';
import { ConveyorConfiguration } from '../../types/conveyor';
import { ConveyorPath, getVisualWidth } from './pathMath';
import { ConveyorMaterials } from './materials';

export class SideGuideGenerator {
  private materials: ConveyorMaterials;

  constructor() {
    this.materials = ConveyorMaterials.getInstance();
  }

  public generate(config: ConveyorConfiguration, path: ConveyorPath): THREE.Group {
    const guideGroup = new THREE.Group();
    guideGroup.name = 'ConveyorSideGuides';

    if (!config.sideGuides || config.sideGuides.length === 0) {
      return guideGroup;
    }

    const visualW = getVisualWidth(config.width);
    const sg = config.sideGuides[0];
    const widthRatio = visualW / config.width;
    const widthBetween = Math.max(visualW, sg.widthBetweenGuides * widthRatio);
    const halfWidthBetween = widthBetween / 2;
    const heightAbove = Math.max(10, sg.heightAboveChain);

    const workingY = config.workingHeight.enabled && config.workingHeight.type !== 'without-support'
      ? config.workingHeight.height
      : 850;

    const chainTopY = workingY + 42;
    const isDoubleRail = sg.type === '904515';
    const railHeight = isDoubleRail ? 35 : 22;
    const bottomGap = sg.bottomClearanceGap !== undefined ? sg.bottomClearanceGap : Math.max(5, heightAbove - railHeight);
    const guideY = chainTopY + bottomGap + railHeight / 2;
    this.buildGuideRail(path, halfWidthBetween, guideY, isDoubleRail, guideGroup, 'LeftGuideRail');
    this.buildGuideRail(path, -halfWidthBetween, guideY, isDoubleRail, guideGroup, 'RightGuideRail');

    // 2. Vertical Mounting Rods and Clamping Brackets
    this.buildMountingBrackets(path, visualW, halfWidthBetween, workingY, guideY, guideGroup);

    return guideGroup;
  }

  private buildGuideRail(
    path: ConveyorPath,
    lateralOffset: number,
    guideY: number,
    isDoubleRail: boolean,
    parentGroup: THREE.Group,
    name: string
  ): void {
    const samples = path.samples;
    if (samples.length < 2) return;

    const railThickness = 12; // mm
    const railHeight = isDoubleRail ? 35 : 22; // mm

    const geom = new THREE.BufferGeometry();
    const vertices: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const halfH = railHeight / 2;

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const center = s.point.clone().add(s.leftNormal.clone().multiplyScalar(lateralOffset));
      center.y = guideY;

      const norm = s.leftNormal;
      const sign = lateralOffset > 0 ? 1 : -1;

      // 4 corners of guide profile
      const pTopInner = center.clone().add(new THREE.Vector3(0, halfH, 0));
      const pTopOuter = pTopInner.clone().add(norm.clone().multiplyScalar(sign * railThickness));
      const pBotOuter = pTopOuter.clone().add(new THREE.Vector3(0, -railHeight, 0));
      const pBotInner = pTopInner.clone().add(new THREE.Vector3(0, -railHeight, 0));

      vertices.push(
        pTopInner.x, pTopInner.y, pTopInner.z,
        pTopOuter.x, pTopOuter.y, pTopOuter.z,
        pBotOuter.x, pBotOuter.y, pBotOuter.z,
        pBotInner.x, pBotInner.y, pBotInner.z
      );

      const u = s.distance / 100.0;
      uvs.push(u, 1, u, 0.7, u, 0.3, u, 0);
    }

    for (let i = 0; i < samples.length - 1; i++) {
      const c = i * 4;
      const n = (i + 1) * 4;

      indices.push(c + 0, c + 1, n + 1, c + 0, n + 1, n + 0);
      indices.push(c + 1, c + 2, n + 2, c + 1, n + 2, n + 1);
      indices.push(c + 2, c + 3, n + 3, c + 2, n + 3, n + 2);
      indices.push(c + 3, c + 0, n + 0, c + 3, n + 0, n + 3);
    }

    geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    const mesh = new THREE.Mesh(geom, this.materials.sideGuidePlastic);
    mesh.name = name;
    mesh.castShadow = true;
    parentGroup.add(mesh);
  }

  private buildMountingBrackets(
    path: ConveyorPath,
    visualWidth: number,
    guideHalfWidth: number,
    workingY: number,
    guideY: number,
    parentGroup: THREE.Group
  ): void {
    const bracketSpacing = 500; // mm
    const numBrackets = Math.max(2, Math.floor(path.totalLength / bracketSpacing));

    const rodRadius = 5;
    const rodHeight = guideY - workingY + 40;

    const rodGeom = new THREE.CylinderGeometry(rodRadius, rodRadius, rodHeight, 12);
    const clampGeom = new THREE.BoxGeometry(22, 22, 22);

    const frameHalfWidth = visualWidth / 2 + 24;

    for (let i = 0; i <= numBrackets; i++) {
      const dist = Math.min(path.totalLength - 40, Math.max(40, (i / numBrackets) * path.totalLength));
      const sample = path.getSampleAtDistance(dist);

      // Left Bracket and Right Bracket
      [1, -1].forEach((side) => {
        const bracketGroup = new THREE.Group();

        // Vertical mounting rod from frame profile up to guide
        const rod = new THREE.Mesh(rodGeom, this.materials.sideGuideBracket);
        const rodOffset = (frameHalfWidth + 12) * side;
        rod.position.set(0, workingY + rodHeight / 2 - 10, rodOffset);
        rod.castShadow = true;
        bracketGroup.add(rod);

        // Frame profile clamping block
        const baseClamp = new THREE.Mesh(clampGeom, this.materials.sideGuideBracket);
        baseClamp.position.set(0, workingY, rodOffset);
        bracketGroup.add(baseClamp);

        // Upper guide rail cross clamp
        const upperClamp = new THREE.Mesh(clampGeom, this.materials.sideGuideBracket);
        upperClamp.position.set(0, guideY, (guideHalfWidth + 10) * side);
        bracketGroup.add(upperClamp);

        // Horizontal connecting cross-rod
        const armLength = Math.abs(rodOffset - (guideHalfWidth + 10) * side);
        const armGeom = new THREE.CylinderGeometry(4, 4, armLength + 10, 8);
        armGeom.rotateX(Math.PI / 2);
        const arm = new THREE.Mesh(armGeom, this.materials.sideGuideBracket);
        arm.position.set(0, guideY, (rodOffset + (guideHalfWidth + 10) * side) / 2);
        bracketGroup.add(arm);

        bracketGroup.position.copy(sample.point);
        bracketGroup.rotation.y = -sample.heading;

        parentGroup.add(bracketGroup);
      });
    }
  }
}
