import * as THREE from 'three';
import { ConveyorConfiguration, SupportType, FootType } from '../../types/conveyor';
import { ConveyorPath, getVisualWidth } from './pathMath';
import { ConveyorMaterials } from './materials';
import { ConfigurationService } from '../../services/configurationService';

export class SupportGenerator {
  private materials: ConveyorMaterials;

  constructor() {
    this.materials = ConveyorMaterials.getInstance();
  }

  public generate(config: ConveyorConfiguration, path: ConveyorPath): THREE.Group {
    const supportGroup = new THREE.Group();
    supportGroup.name = 'ConveyorSupports';

    const visualW = getVisualWidth(config.width);
    const workingY = config.workingHeight.enabled && config.workingHeight.type !== 'without-support'
      ? config.workingHeight.height
      : 850;
    const legType = config.workingHeight.type;
    const footType = config.workingHeight.footType || 'adjustable';

    // Calculate dynamic leg positions along the path (spacing <= 2000 mm on any straight section)
    const legDistances = SupportGenerator.calculateSupportLegDistances(path, 2000);

    if (!config.workingHeight.enabled || config.workingHeight.type === 'without-support') {
      // Direct Machine Integration: mount 3-hole structural base plates directly to the frame underside
      legDistances.forEach((dist) => {
        const sample = path.getSampleAtDistance(dist);
        const gantryMount = this.buildDirectGantryMount(visualW, 850);
        gantryMount.position.copy(sample.point);
        gantryMount.rotation.y = -sample.heading;
        supportGroup.add(gantryMount);
      });
      return supportGroup;
    }

    legDistances.forEach((dist, idx) => {
      const sample = path.getSampleAtDistance(dist);
      const legAssembly = this.buildLegSet(visualW, workingY, legType, footType, idx === 0, idx === legDistances.length - 1);

      legAssembly.position.copy(sample.point);
      legAssembly.rotation.y = -sample.heading;

      supportGroup.add(legAssembly);
    });

    return supportGroup;
  }

  /**
   * Industrial parametric support leg distribution.
   * Dynamically adds intermediate support legs as conveyor length increases
   * ensuring no straight span exceeds maxSpan (default 2000 mm).
   */
  public static calculateSupportLegDistances(path: ConveyorPath, maxSpan: number = 2000): number[] {
    const curveSegs = path.segments.filter((s) => s.type === 'curve');
    const positions: number[] = [];

    if (curveSegs.length === 0) {
      // Linear straight conveyor
      const totalLen = path.totalLength;
      if (totalLen <= 600) {
        return [totalLen / 2];
      }
      const infeedPos = Math.min(250, totalLen * 0.2);
      const drivePos = Math.max(infeedPos + 300, totalLen - 280);
      const middleSpan = drivePos - infeedPos;

      positions.push(infeedPos);
      if (middleSpan > maxSpan) {
        const numIntermediate = Math.floor(middleSpan / maxSpan);
        const step = middleSpan / (numIntermediate + 1);
        for (let k = 1; k <= numIntermediate; k++) {
          positions.push(infeedPos + k * step);
        }
      }
      positions.push(drivePos);
      return positions.map((d) => Math.round(d));
    }

    // Multi-segment curved conveyor
    for (let sIdx = 0; sIdx < path.segments.length; sIdx++) {
      const seg = path.segments[sIdx];
      const isFirst = sIdx === 0;
      const isLast = sIdx === path.segments.length - 1;

      if (seg.type === 'straight') {
        const segLen = seg.length;
        let startStand: number;
        let endStand: number;

        if (isFirst) {
          startStand = seg.startDistance + Math.min(250, segLen * 0.25);
          endStand = seg.endDistance - Math.min(120, segLen * 0.15);
        } else if (isLast) {
          startStand = seg.startDistance + Math.min(120, segLen * 0.15);
          endStand = seg.endDistance - Math.min(280, segLen * 0.25);
        } else {
          startStand = seg.startDistance + Math.min(120, segLen * 0.15);
          endStand = seg.endDistance - Math.min(120, segLen * 0.15);
        }

        if (endStand - startStand >= 300) {
          positions.push(startStand);
          const span = endStand - startStand;
          if (span > maxSpan) {
            const numInter = Math.floor(span / maxSpan);
            const step = span / (numInter + 1);
            for (let k = 1; k <= numInter; k++) {
              positions.push(startStand + k * step);
            }
          }
          positions.push(endStand);
        } else {
          positions.push((seg.startDistance + seg.endDistance) / 2);
        }
      }
    }

    positions.sort((a, b) => a - b);
    const filtered: number[] = [];
    for (const pos of positions) {
      if (filtered.length === 0 || pos - filtered[filtered.length - 1] >= 200) {
        filtered.push(Math.round(pos));
      }
    }
    return filtered.map((d) => Math.max(40, Math.min(path.totalLength - 40, d)));
  }

  /**
   * Authentic ALUFLEX Heavy-Duty Support Stand (Strictly matching client reference Image 4 & Image 5)
   * Features:
   * - Black T-slot side clamping brackets with button-head Allen bolts
   * - Top cross-beam under conveyor profile
   * - Heavy-duty dark anodized 80x40/80x80 structural columns
   * - Mid-height rigid cross-tie beam
   * - Transverse 80x40 base foot beam resting on floor with black end caps
   * - Base die-cast gusset flange plates with mounting bolts
   * - Heavy-duty articulated vulcanized rubber leveling feet with M16 threaded spindles
   */
  private buildLegSet(
    width: number,
    workingY: number,
    type: SupportType,
    footType: FootType,
    _isFirst: boolean,
    _isLast: boolean
  ): THREE.Group {
    const setGroup = new THREE.Group();

    const isWheel = footType === 'wheel-without-brake' || footType === 'wheel-with-brake';
    const footClearance = isWheel ? 76 : (footType === 'fixed' || footType === 'base-plate' ? 16 : 30);
    const frameOffset = width / 2 + 12;

    const topBeamW = width + 48;
    const baseBeamW = Math.max(380, width + 220);
    const feetSpacingHalf = baseBeamW / 2 - 30;

    const colH = Math.max(100, workingY - 40 - 40 - footClearance);

    // 1. AUTHENTIC U-CRADLE MOUNTING BRACKET (Strictly matching Mechanical Adjustable leg.png)
    const uWidth = width + 48 + 8;
    const uBaseGeom = new THREE.BoxGeometry(45, 8, uWidth);
    const uBase = new THREE.Mesh(uBaseGeom, this.materials.driveMountingPlateBlack);
    uBase.position.set(0, workingY - 50, 0);
    uBase.castShadow = true;
    setGroup.add(uBase);

    // Left and Right vertical clamping ears of U-cradle with T-slot clamp bolts
    for (const sideSign of [-1, 1]) {
      const earGroup = new THREE.Group();
      const earGeom = new THREE.BoxGeometry(45, 30, 4);
      const earMesh = new THREE.Mesh(earGeom, this.materials.driveMountingPlateBlack);
      earMesh.castShadow = true;
      earGroup.add(earMesh);

      // Clamping bolts into frame T-slot (2 per ear)
      const boltGeom = new THREE.CylinderGeometry(3.5, 3.5, 8, 12);
      boltGeom.rotateX(Math.PI / 2);
      for (const by of [-10, 10]) {
        const bolt = new THREE.Mesh(boltGeom, this.materials.zincHardware);
        bolt.position.set(0, by, 3 * sideSign);
        earGroup.add(bolt);
      }
      earGroup.position.set(0, workingY - 20, sideSign * (uWidth / 2 - 2));
      setGroup.add(earGroup);
    }

    // 2. TOP MOUNT HEAD COLLAR PLATE (Connecting U-cradle to column)
    const topCollarGeom = new THREE.BoxGeometry(60, 8, 50);
    const topCollar = new THREE.Mesh(topCollarGeom, this.materials.aluminumProfile);
    topCollar.position.set(0, workingY - 58, 0);
    topCollar.castShadow = true;
    setGroup.add(topCollar);

    // 3. CENTRAL STRUCTURAL COLUMN (Authentic Linak DL5 Motorized Column or Telescoping Stand)
    if (type === 'electrically-adjustable' || isWheel) {
      this.buildLinakDL5ActuatorColumn(0, colH, footClearance + 45, workingY, setGroup);
    } else {
      this.buildTelescopingLeg(0, colH, 90, workingY, setGroup);
    }

    // 4. BASE STRUCTURE (Authentic Alutec 45x90 Profile Tripod Base with 3 Braked Castors or Foot Beam)
    if (isWheel) {
      // Authentic Alutec 45x90 Heavy-Duty Base Frame (matching Photos 4 & 5: 804-125-30-noha)
      const baseBeamW = Math.max(460, width + 280);
      const baseBeamGeom = new THREE.BoxGeometry(45, 90, baseBeamW);
      const baseBeam = new THREE.Mesh(baseBeamGeom, this.materials.aluminumProfile);
      baseBeam.position.set(0, 65, 0);
      baseBeam.castShadow = true;
      baseBeam.receiveShadow = true;
      setGroup.add(baseBeam);

      // Forward Cantilever Foot Beam (45x90 profile extending 220 mm forward for tip stability)
      const cantGeom = new THREE.BoxGeometry(220, 45, 90);
      const cantBeam = new THREE.Mesh(cantGeom, this.materials.aluminumProfile);
      cantBeam.position.set(110, 42, 0);
      cantBeam.castShadow = true;
      cantBeam.receiveShadow = true;
      setGroup.add(cantBeam);

      // Black Corner Gussets at cantilever joint
      for (const gSign of [-1, 1]) {
        const gussetGeom = new THREE.BoxGeometry(40, 40, 12);
        const gusset = new THREE.Mesh(gussetGeom, this.materials.driveMountingPlateBlack);
        gusset.position.set(50, 42, gSign * 52);
        gusset.castShadow = true;
        setGroup.add(gusset);
      }

      // Black Plastic End Caps on profile ends
      const capGeom = new THREE.BoxGeometry(47, 92, 4);
      for (const capSign of [-1, 1]) {
        const cap = new THREE.Mesh(capGeom, this.materials.driveMountingPlateBlack);
        cap.position.set(0, 65, capSign * (baseBeamW / 2 + 2));
        setGroup.add(cap);
      }
      const cantCapGeom = new THREE.BoxGeometry(4, 47, 92);
      const cantCap = new THREE.Mesh(cantCapGeom, this.materials.driveMountingPlateBlack);
      cantCap.position.set(222, 42, 0);
      setGroup.add(cantCap);

      // 3 Heavy-Duty Swivel Braked Castor Wheels (517508 with real brake pedals)
      const rearSpacing = baseBeamW / 2 - 40;
      setGroup.add(this.buildCasterWheelWithPedal(new THREE.Vector3(0, 0, -rearSpacing), true));
      setGroup.add(this.buildCasterWheelWithPedal(new THREE.Vector3(0, 0, rearSpacing), true));
      setGroup.add(this.buildCasterWheelWithPedal(new THREE.Vector3(200, 0, 0), true));

    } else {
      // Horizontal Foot Profile Beam with Leveling Pads
      const baseBeamGeom = new THREE.BoxGeometry(80, 40, baseBeamW);
      const baseBeam = new THREE.Mesh(baseBeamGeom, this.materials.aluminumProfile);
      baseBeam.position.set(0, 70, 0);
      baseBeam.castShadow = true;
      baseBeam.receiveShadow = true;
      setGroup.add(baseBeam);

      // Black Plastic End Caps
      const capGeom = new THREE.BoxGeometry(82, 42, 4);
      for (const capSign of [-1, 1]) {
        const cap = new THREE.Mesh(capGeom, this.materials.driveMountingPlateBlack);
        cap.position.set(0, 70, capSign * (baseBeamW / 2 + 2));
        setGroup.add(cap);
      }

      // Leveling Feet
      for (const fSign of [-1, 1]) {
        const footZ = fSign * feetSpacingHalf;
        setGroup.add(this.buildArticulatedLevelingFoot(footZ, footClearance));
      }
    }

    return setGroup;
  }

  /**
   * Authentic ALUFLEX Articulated Vulcanized Rubber Leveling Foot (Image 3 & 804-85-30-n.png)
   */
  private buildArticulatedLevelingFoot(offsetZ: number, _clearance: number): THREE.Group {
    const footGroup = new THREE.Group();

    // 0. Mounting Plate clamped to underside of base beam (Y=44 to 50 mm)
    const fplateGeom = new THREE.BoxGeometry(50, 6, 30);
    const fplate = new THREE.Mesh(fplateGeom, this.materials.aluminumProfile);
    fplate.position.set(0, 47, offsetZ);
    fplate.castShadow = true;
    footGroup.add(fplate);

    // 1. Vulcanized Rubber Circular Pad on floor (Ø70 mm x 12 mm, Y=0 to 12 mm)
    const padGeom = new THREE.CylinderGeometry(35, 35, 12, 24);
    const pad = new THREE.Mesh(padGeom, this.materials.driveMountingPlateBlack);
    pad.position.set(0, 6, offsetZ);
    pad.castShadow = true;
    pad.receiveShadow = true;
    footGroup.add(pad);

    // 2. Stainless Steel Hex Locknut (Y=12 to 20 mm)
    const nutGeom = new THREE.CylinderGeometry(11, 11, 8, 6);
    const nut = new THREE.Mesh(nutGeom, this.materials.zincHardware);
    nut.position.set(0, 16, offsetZ);
    footGroup.add(nut);

    // 3. Threaded Spindle M16 Stud extending from pad to beam (Y=10 to 50 mm)
    const spindleGeom = new THREE.CylinderGeometry(8, 8, 40, 16);
    const spindle = new THREE.Mesh(spindleGeom, this.materials.zincHardware);
    spindle.position.set(0, 30, offsetZ);
    footGroup.add(spindle);

    return footGroup;
  }

  private buildTelescopingLeg(offsetZ: number, legHeight: number, bottomY: number, _workingY: number, parentGroup: THREE.Group): void {
    const outerHeight = legHeight * 0.65;
    const innerHeight = legHeight * 0.55;

    // Outer lower profile sleeve (55x38 mm)
    const outerGeom = new THREE.BoxGeometry(55, outerHeight, 38);
    const outer = new THREE.Mesh(outerGeom, this.materials.aluminumProfileDark);
    outer.position.set(0, bottomY + outerHeight / 2, offsetZ);
    outer.castShadow = true;
    parentGroup.add(outer);

    // Inner upper profile column (40x25 mm)
    const innerGeom = new THREE.BoxGeometry(40, innerHeight, 25);
    const inner = new THREE.Mesh(innerGeom, this.materials.aluminumProfile);
    inner.position.set(0, bottomY + legHeight - innerHeight / 2, offsetZ);
    inner.castShadow = true;
    parentGroup.add(inner);

    // Heavy-duty clamp collar sleeve with 4 clamping bolts (Image Mechanical Adjustable leg.png)
    const collarGeom = new THREE.BoxGeometry(60, 25, 42);
    const collar = new THREE.Mesh(collarGeom, this.materials.aluminumProfile);
    collar.position.set(0, bottomY + outerHeight - 12, offsetZ);
    parentGroup.add(collar);

    const boltGeom = new THREE.CylinderGeometry(2.5, 2.5, 6, 10);
    boltGeom.rotateX(Math.PI / 2);
    for (const by of [-8, 8]) {
      for (const bz of [-14, 14]) {
        const b = new THREE.Mesh(boltGeom, this.materials.zincHardware);
        b.position.set(0, bottomY + outerHeight - 12 + by, offsetZ + bz);
        parentGroup.add(b);
      }
    }
  }

  private buildLinakDL5ActuatorColumn(offsetZ: number, legHeight: number, bottomY: number, workingY: number, parentGroup: THREE.Group): void {
    const actH = legHeight - 20;
    const outerH = actH * 0.65;
    const innerH = actH * 0.55;

    // Outer Lower Sleeve: 50x80 mm dark anthracite profile (Images 4 & 5: Linak DL5)
    const outerGeom = new THREE.BoxGeometry(50, outerH, 80);
    const outer = new THREE.Mesh(outerGeom, this.materials.aluminumProfileDark);
    outer.position.set(0, bottomY + outerH / 2, offsetZ);
    outer.castShadow = true;
    parentGroup.add(outer);

    // Inner Upper Telescoping Column: 44x74 mm
    const innerGeom = new THREE.BoxGeometry(44, innerH, 74);
    const inner = new THREE.Mesh(innerGeom, this.materials.aluminumProfile);
    inner.position.set(0, workingY - 65 - innerH / 2, offsetZ);
    inner.castShadow = true;
    parentGroup.add(inner);

    // Telescopic Collar Ring at joint
    const collarGeom = new THREE.BoxGeometry(54, 20, 84);
    const collar = new THREE.Mesh(collarGeom, this.materials.driveMountingPlateBlack);
    collar.position.set(0, bottomY + outerH - 10, offsetZ);
    collar.castShadow = true;
    parentGroup.add(collar);

    // Top Angled Steel Mounting Bracket (clamping to conveyor frame with M8 bolts)
    const brkGeom = new THREE.BoxGeometry(70, 8, 100);
    const brk = new THREE.Mesh(brkGeom, this.materials.driveMountingPlateBlack);
    brk.position.set(0, workingY - 35, offsetZ);
    brk.castShadow = true;
    parentGroup.add(brk);

    // Linak CBD6s Motor Control Box clamped to column (150x85x36 mm black box)
    const boxGeom = new THREE.BoxGeometry(85, 150, 36);
    const box = new THREE.Mesh(boxGeom, this.materials.driveMountingPlateBlack);
    box.position.set(0, bottomY + outerH * 0.5, offsetZ + 58);
    box.castShadow = true;
    parentGroup.add(box);

    // Linak DPA Rocker Switch on column
    const switchGeom = new THREE.BoxGeometry(40, 25, 30);
    const sw = new THREE.Mesh(switchGeom, this.materials.driveMountingPlateBlack);
    sw.position.set(0, bottomY + outerH - 30, offsetZ - 48);
    sw.castShadow = true;
    parentGroup.add(sw);
  }

  private buildCasterWheelWithPedal(pos: THREE.Vector3, withBrake: boolean): THREE.Group {
    const casterGroup = new THREE.Group();
    casterGroup.position.copy(pos);

    // Swivel Top Plate (80x80 mm steel with 4 mounting bolts)
    const topPlateGeom = new THREE.BoxGeometry(60, 4, 60);
    const topPlate = new THREE.Mesh(topPlateGeom, this.materials.zincHardware);
    topPlate.position.set(0, 52, 0);
    casterGroup.add(topPlate);

    // 4 Corner Bolts
    const boltGeom = new THREE.CylinderGeometry(2.5, 2.5, 6, 8);
    for (const bx of [-22, 22]) {
      for (const bz of [-22, 22]) {
        const b = new THREE.Mesh(boltGeom, this.materials.zincHardware);
        b.position.set(bx, 55, bz);
        casterGroup.add(b);
      }
    }

    // Stamped steel swivel fork housing
    const forkGeom = new THREE.BoxGeometry(22, 34, 42);
    const fork = new THREE.Mesh(forkGeom, this.materials.zincHardware);
    fork.position.set(0, 35, 0);
    fork.castShadow = true;
    casterGroup.add(fork);

    // Industrial Solid Polyurethane Wheel Tyre (Ø75 mm x 32 mm)
    const wheelGeom = new THREE.CylinderGeometry(37.5, 37.5, 32, 24);
    wheelGeom.rotateX(Math.PI / 2);
    const wheel = new THREE.Mesh(wheelGeom, this.materials.driveMountingPlateBlack);
    wheel.position.set(0, 20, 0);
    wheel.castShadow = true;
    casterGroup.add(wheel);

    // Real Castor Brake Pedal extending at 45 deg angle with lock mechanism
    if (withBrake) {
      const pedalGeom = new THREE.BoxGeometry(28, 8, 16);
      const pedal = new THREE.Mesh(pedalGeom, this.materials.driveMountingPlateBlack);
      pedal.position.set(22, 26, 0);
      pedal.rotation.z = -Math.PI / 4;
      pedal.castShadow = true;
      casterGroup.add(pedal);
    }

    return casterGroup;
  }

  private buildAnchorAngle(offsetZ: number): THREE.Group {
    const angleGroup = new THREE.Group();
    const angleGeom = new THREE.BoxGeometry(40, 30, 40);
    const angle = new THREE.Mesh(angleGeom, this.materials.aluminumProfile);
    angle.position.set(0, 15, offsetZ);
    angleGroup.add(angle);
    return angleGroup;
  }

  private buildFixedFoot(offsetZ: number): THREE.Group {
    const footGroup = new THREE.Group();
    const padGeom = new THREE.BoxGeometry(40, 12, 40);
    const pad = new THREE.Mesh(padGeom, this.materials.driveMountingPlateBlack);
    pad.position.set(0, 6, offsetZ);
    footGroup.add(pad);
    return footGroup;
  }

  private buildBasePlate(offsetZ: number): THREE.Group {
    const plateGroup = new THREE.Group();
    const plateGeom = new THREE.BoxGeometry(60, 12, 120);
    const plate = new THREE.Mesh(plateGeom, this.materials.aluminumProfile);
    plate.position.set(0, 6, offsetZ);
    plateGroup.add(plate);
    return plateGroup;
  }

  private buildDirectGantryMount(width: number, workingY: number): THREE.Group {
    const mountGroup = new THREE.Group();
    const mountPlateGeom = new THREE.BoxGeometry(60, 12, width + 40);
    const mountPlate = new THREE.Mesh(mountPlateGeom, this.materials.aluminumProfile);
    mountPlate.position.set(0, workingY - 20, 0);
    mountGroup.add(mountPlate);
    return mountGroup;
  }
}
