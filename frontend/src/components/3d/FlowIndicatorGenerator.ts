import * as THREE from 'three';
import { ConveyorConfiguration, TravelDirection } from '../../types/conveyor';
import { ConveyorPath, getVisualWidth } from './pathMath';
import { ConveyorMaterials } from './materials';

export class FlowIndicatorGenerator {
  private materials: ConveyorMaterials;
  private path: ConveyorPath | null = null;
  private arrowsGroup: THREE.Group;
  private rootGroup: THREE.Group;
  private arrowMeshes: { mesh: THREE.Mesh; baseOffset: number }[] = [];
  private workingY: number = 850;
  private flowSpeedMmPerSec: number = 320; // 320 mm/s flow speed
  private isVisible: boolean = true;

  constructor() {
    this.materials = ConveyorMaterials.getInstance();
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'ConveyorFlowIndicators';
    this.arrowsGroup = new THREE.Group();
    this.arrowsGroup.name = 'FlowArrows';
    this.rootGroup.add(this.arrowsGroup);
  }

  public generate(config: ConveyorConfiguration, path: ConveyorPath): THREE.Group {
    this.path = path;
    this.arrowMeshes = [];
    // Drop markers from the previous build; the root group persists across rebuilds.
    this.rootGroup.clear();
    this.arrowsGroup.clear();
    this.rootGroup.add(this.arrowsGroup);

    const visualW = getVisualWidth(config.width);
    this.workingY = config.workingHeight.enabled && config.workingHeight.type !== 'without-support'
      ? config.workingHeight.height
      : 850;

    const arrowSpacing = Math.max(250, Math.min(450, path.totalLength / Math.max(3, Math.floor(path.totalLength / 350))));
    const numArrows = Math.max(3, Math.floor(path.totalLength / arrowSpacing));

    // Shared arrow chevron geometry
    const arrowGeom = this.createChevronGeometry(visualW);
    const arrowMat = new THREE.MeshStandardMaterial({
      color: 0x00d4ff, // Electric Cyan
      emissive: 0x0077b6,
      emissiveIntensity: 0.6,
      roughness: 0.3,
      metalness: 0.7,
      transparent: true,
      opacity: 0.88
    });

    for (let i = 0; i < numArrows; i++) {
      const baseOffset = (i / numArrows) * path.totalLength;
      const arrowMesh = new THREE.Mesh(arrowGeom, arrowMat);
      arrowMesh.castShadow = false;
      arrowMesh.receiveShadow = false;

      const sample = path.getSampleAtDistance(baseOffset);
      arrowMesh.position.copy(sample.point);
      arrowMesh.position.y = this.workingY + 46;
      arrowMesh.rotation.y = -sample.heading;

      this.arrowsGroup.add(arrowMesh);
      this.arrowMeshes.push({ mesh: arrowMesh, baseOffset });
    }

    // Infeed & Discharge flow badges
    this.buildTerminalBadges(path, visualW, this.workingY);

    return this.rootGroup;
  }

  private createChevronGeometry(visualWidth: number): THREE.BufferGeometry {
    // Elegant low-profile 3D chevron arrow
    const chevronWidth = Math.min(48, Math.max(24, visualWidth * 0.35));
    const chevronLength = 32;
    const chevronThickness = 2.5;

    const shape = new THREE.Shape();
    const hw = chevronWidth / 2;
    const hl = chevronLength / 2;

    // Chevron outline (pointing forward along -Z in local shape, extruded along Y)
    shape.moveTo(0, hl);               // Front tip
    shape.lineTo(hw, -hl * 0.4);       // Right outer corner
    shape.lineTo(hw * 0.5, -hl);       // Right inner corner
    shape.lineTo(0, -hl * 0.3);        // Center notch
    shape.lineTo(-hw * 0.5, -hl);      // Left inner corner
    shape.lineTo(-hw, -hl * 0.4);      // Left outer corner
    shape.closePath();

    const extrudeSettings = {
      steps: 1,
      depth: chevronThickness,
      bevelEnabled: true,
      bevelThickness: 0.8,
      bevelSize: 0.8,
      bevelSegments: 2
    };

    const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    // Rotate so shape lies horizontally on XZ plane and points forward along tangent
    geom.rotateX(Math.PI / 2);
    geom.rotateY(Math.PI / 2);

    return geom;
  }

  private buildTerminalBadges(path: ConveyorPath, visualWidth: number, workingY: number): void {
    // Infeed badge at distance ~70 mm
    const infeedSample = path.getSampleAtDistance(Math.min(70, path.totalLength * 0.05));
    const infeedGroup = new THREE.Group();
    infeedGroup.name = 'InfeedMarker';

    const ringGeom = new THREE.RingGeometry(8, 14, 16);
    ringGeom.rotateX(-Math.PI / 2);
    const infeedRing = new THREE.Mesh(
      ringGeom,
      new THREE.MeshBasicMaterial({ color: 0x18b981, side: THREE.DoubleSide })
    );
    infeedGroup.add(infeedRing);

    infeedGroup.position.copy(infeedSample.point);
    infeedGroup.position.y = workingY + 45;
    infeedGroup.rotation.y = -infeedSample.heading;
    this.rootGroup.add(infeedGroup);

    // Discharge badge at distance ~ totalLength - 70 mm
    const dischargeSample = path.getSampleAtDistance(Math.max(0, path.totalLength - 70));
    const dischargeGroup = new THREE.Group();
    dischargeGroup.name = 'DischargeMarker';

    const discGeom = new THREE.RingGeometry(8, 14, 16);
    discGeom.rotateX(-Math.PI / 2);
    const dischargeDisc = new THREE.Mesh(
      discGeom,
      new THREE.MeshBasicMaterial({ color: 0x1683e8, side: THREE.DoubleSide })
    );
    dischargeGroup.add(dischargeDisc);

    dischargeGroup.position.copy(dischargeSample.point);
    dischargeGroup.position.y = workingY + 45;
    dischargeGroup.rotation.y = -dischargeSample.heading;
    this.rootGroup.add(dischargeGroup);
  }

  /**
   * Called on every animation frame by ConveyorScene to glide arrows forward/reverse
   */
  public update(elapsedSeconds: number, travelDirection: TravelDirection = 'forward'): void {
    if (!this.path || this.arrowMeshes.length === 0 || !this.isVisible) return;

    const totalLen = this.path.totalLength;
    if (totalLen <= 0) return;

    const isReverse = travelDirection === 'reverse';
    const dirSign = isReverse ? -1 : 1;
    const distanceShift = (elapsedSeconds * this.flowSpeedMmPerSec * dirSign) % totalLen;

    for (let i = 0; i < this.arrowMeshes.length; i++) {
      const item = this.arrowMeshes[i];
      let currentDist = (item.baseOffset + distanceShift) % totalLen;
      if (currentDist < 0) currentDist += totalLen;

      const sample = this.path.getSampleAtDistance(currentDist);

      item.mesh.position.copy(sample.point);
      item.mesh.position.y = this.workingY + 46;

      // Orient tangent forward or reverse
      if (isReverse) {
        item.mesh.rotation.y = -sample.heading + Math.PI;
      } else {
        item.mesh.rotation.y = -sample.heading;
      }
    }
  }

  public setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.rootGroup.visible = visible;
  }

  public getVisible(): boolean {
    return this.isVisible;
  }
}
