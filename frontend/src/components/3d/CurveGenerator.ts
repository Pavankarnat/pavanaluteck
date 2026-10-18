import * as THREE from 'three';
import { ConveyorConfiguration, CurveConfiguration } from '../../types/conveyor';
import { ConveyorPath, CurveSegment, getVisualWidth } from './pathMath';
import { ConveyorMaterials } from './materials';

export class CurveGenerator {
  private materials: ConveyorMaterials;

  constructor() {
    this.materials = ConveyorMaterials.getInstance();
  }

  public generate(config: ConveyorConfiguration, path: ConveyorPath): THREE.Group {
    const curveGroup = new THREE.Group();
    curveGroup.name = 'ConveyorCurveModules';

    if (config.shape !== 'curved' || !config.curves || config.curves.length === 0) {
      return curveGroup;
    }

    const visualW = getVisualWidth(config.width);
    const workingY = config.workingHeight.enabled && config.workingHeight.type !== 'without-support'
      ? config.workingHeight.height
      : 850;

    path.segments.forEach((segment) => {
      if (segment.type === 'curve') {
        this.buildCurveDetails(segment, visualW, workingY, curveGroup);
      }
    });

    return curveGroup;
  }

  private buildCurveDetails(
    seg: CurveSegment,
    width: number,
    workingY: number,
    parentGroup: THREE.Group
  ): void {
    const isWheelband = seg.config.curveType === 'wheelband';
    const isRight = seg.direction === 'right';

    const innerRadius = seg.radius - width / 2;
    const outerRadius = seg.radius + width / 2;

    if (isWheelband) {
      // Build Wheelband roller disc array along the inner curve radius
      this.buildWheelbandRollers(seg, innerRadius, workingY + 40, parentGroup);
    } else {
      // Build Friction Curve reinforced inner wear bend track
      this.buildFrictionWearTrack(seg, innerRadius, outerRadius, workingY + 40, parentGroup);
    }

    // Curve structural center tie plate
    this.buildCurveTiePlate(seg, innerRadius, outerRadius, workingY - 20, parentGroup);
  }

  private buildWheelbandRollers(
    seg: CurveSegment,
    innerRadius: number,
    yPos: number,
    parentGroup: THREE.Group
  ): void {
    // 1. Authentic Alutec ZP90 Central Bearing Hub (AC645086 center)
    const hubGeom = new THREE.CylinderGeometry(40, 40, 45, 32);
    const hub = new THREE.Mesh(hubGeom, this.materials.aluminumProfile);
    hub.position.set(seg.center.x, yPos - 25, seg.center.z);
    hub.castShadow = true;
    parentGroup.add(hub);

    // Center mounting bolt
    const hubBoltGeom = new THREE.CylinderGeometry(8, 8, 12, 16);
    const hubBolt = new THREE.Mesh(hubBoltGeom, this.materials.zincHardware);
    hubBolt.position.set(seg.center.x, yPos + 2, seg.center.z);
    parentGroup.add(hubBolt);

    // 2. Large Inner Rotating Wheel Bend Disc (AC645086-1 & AC645086-2)
    const discRadius = Math.max(100, innerRadius - 8);
    const discThickness = 12;
    const discGeom = new THREE.CylinderGeometry(discRadius, discRadius, discThickness, 48);
    const disc = new THREE.Mesh(discGeom, this.materials.whiteCheekPlate);
    disc.position.set(seg.center.x, yPos - 6, seg.center.z);
    disc.castShadow = true;
    parentGroup.add(disc);

    // Top Retention Disc Ring
    const topRingGeom = new THREE.CylinderGeometry(discRadius * 0.95, discRadius * 0.95, 4, 48);
    const topRing = new THREE.Mesh(topRingGeom, this.materials.aluminumProfile);
    topRing.position.set(seg.center.x, yPos + 2, seg.center.z);
    parentGroup.add(topRing);

    // 3. Frame Splice Connection Plates at Infeed and Outfeed of the curve
    const spliceGeom = new THREE.BoxGeometry(100, 60, 6);
    const boltGeom = new THREE.CylinderGeometry(3.5, 3.5, 10, 10);
    boltGeom.rotateX(Math.PI / 2);

    for (const [pt, hd] of [[seg.startPoint, seg.startHeading], [seg.endPoint, seg.endHeading]] as [THREE.Vector3, number][]) {
      for (const sideSign of [-1, 1]) {
        const spliceGroup = new THREE.Group();
        const plate = new THREE.Mesh(spliceGeom, this.materials.zincHardware);
        spliceGroup.add(plate);

        // 4 Clamping Bolts on each splice plate
        for (const bx of [-30, 30]) {
          for (const by of [-15, 15]) {
            const b = new THREE.Mesh(boltGeom, this.materials.zincHardware);
            b.position.set(bx, by, 4);
            spliceGroup.add(b);
          }
        }

        // Place one plate on each side of the frame (lateral offset from the centre line).
        const lateral = sideSign * ((seg.radius - innerRadius) + 3);
        spliceGroup.position.set(
          pt.x - Math.sin(hd) * lateral,
          yPos - 20,
          pt.z + Math.cos(hd) * lateral
        );
        spliceGroup.rotation.y = -hd;
        parentGroup.add(spliceGroup);
      }
    }
  }

  private buildFrictionWearTrack(
    seg: CurveSegment,
    innerRadius: number,
    outerRadius: number,
    yPos: number,
    parentGroup: THREE.Group
  ): void {
    const numSteps = Math.max(16, Math.round((seg.sweepAngle / Math.PI) * 32));
    const geom = new THREE.BufferGeometry();
    const vertices: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= numSteps; i++) {
      const frac = i / numSteps;
      const angle = seg.startAngle + (seg.endAngle - seg.startAngle) * frac;

      const inX = seg.center.x + innerRadius * Math.cos(angle);
      const inZ = seg.center.z + innerRadius * Math.sin(angle);
      const outX = seg.center.x + outerRadius * Math.cos(angle);
      const outZ = seg.center.z + outerRadius * Math.sin(angle);

      vertices.push(
        inX, yPos, inZ,
        outX, yPos, outZ,
        outX, yPos - 6, outZ,
        inX, yPos - 6, inZ
      );
    }

    for (let i = 0; i < numSteps; i++) {
      const c = i * 4;
      const n = (i + 1) * 4;
      indices.push(c, c + 1, n + 1, c, n + 1, n);
      indices.push(c + 1, c + 2, n + 2, c + 1, n + 2, n + 1);
      indices.push(c + 2, c + 3, n + 3, c + 2, n + 3, n + 2);
      indices.push(c + 3, c, n, c + 3, n, n + 3);
    }

    geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    const mesh = new THREE.Mesh(geom, this.materials.peUhmwWearStrip);
    parentGroup.add(mesh);
  }

  private buildCurveTiePlate(
    seg: CurveSegment,
    innerRadius: number,
    outerRadius: number,
    yPos: number,
    parentGroup: THREE.Group
  ): void {
    const midAngle = (seg.startAngle + seg.endAngle) / 2;
    const midRadius = (innerRadius + outerRadius) / 2;

    const posX = seg.center.x + midRadius * Math.cos(midAngle);
    const posZ = seg.center.z + midRadius * Math.sin(midAngle);

    const plateGeom = new THREE.BoxGeometry(40, 8, outerRadius - innerRadius + 20);
    const plate = new THREE.Mesh(plateGeom, this.materials.aluminumProfileDark);
    plate.position.set(posX, yPos, posZ);
    plate.rotation.y = Math.PI / 2 - midAngle; // box depth (local z) must point radially
    parentGroup.add(plate);
  }
}
