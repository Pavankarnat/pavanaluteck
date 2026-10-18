import * as THREE from 'three';
import { ConveyorConfiguration, MotorId } from '../../types/conveyor';
import { ConveyorPath, getVisualWidth } from './pathMath';
import { ConveyorMaterials } from './materials';

export class DriveGenerator {
  private materials: ConveyorMaterials;

  constructor() {
    this.materials = ConveyorMaterials.getInstance();
  }

  public generate(config: ConveyorConfiguration, path: ConveyorPath): THREE.Group {
    const driveGroup = new THREE.Group();
    driveGroup.name = 'ConveyorDriveUnit';

    const visualW = getVisualWidth(config.width);
    const workingY = config.workingHeight.enabled && config.workingHeight.type !== 'without-support'
      ? config.workingHeight.height
      : 850;

    const drivePos = config.drivePosition;
    const motorId: MotorId = config.motor?.id || 'motor-001';

    // 'start' or 'beginning' is at infeed distance ~40 mm, all others are at head terminal (totalLength - 40 mm)
    const isBeginning = drivePos === 'beginning' || drivePos === 'start-left' || drivePos === 'start-right' || drivePos === 'below-belt-start';
    const driveDist = isBeginning ? 40 : path.totalLength - 40;
    const sample = path.getSampleAtDistance(driveDist);

    // Determine lateral side (Left vs Right vs Below-Belt)
    const isLeft = drivePos === 'left' || drivePos === 'reductor-left' || drivePos === 'start-left' || drivePos === 'end-left';
    const isEnd = drivePos === 'end';
    const isBelowBelt = drivePos === 'below-belt-start' || drivePos === 'below-belt-end';
    const sideSign = isLeft ? 1 : -1;

    const isReductor = drivePos === 'reductor-left' || drivePos === 'reductor-right' || config.driveMountType === 'reductor' || config.driveKind === 'reductor';

    // Build the specific 3D motor assembly based on motorId & reductor style
    const motorAssembly = this.buildMotorModel(motorId, isReductor);

    // 1. DRIVE SPROCKET WHEEL & SHAFT (At drive terminal where belt turns)
    const sprocketGeom = new THREE.CylinderGeometry(58.5, 58.5, visualW - 10, 24);
    sprocketGeom.rotateZ(Math.PI / 2);
    const sprocket = new THREE.Mesh(sprocketGeom, this.materials.darkSprocket);
    sprocket.position.copy(sample.point);
    sprocket.position.y = workingY - 20;
    sprocket.rotation.y = -sample.heading;
    driveGroup.add(sprocket);

    const shaftLen3D = visualW + 32 + (isBelowBelt ? 0 : 25);
    const shaftOffset3D = isBelowBelt ? 0 : sideSign * 12.5;
    const shaftGeom = new THREE.CylinderGeometry(12.5, 12.5, shaftLen3D, 24);
    shaftGeom.rotateZ(Math.PI / 2);
    const driveShaft = new THREE.Mesh(shaftGeom, this.materials.zincHardware);
    driveShaft.position.copy(sprocket.position).add(sample.leftNormal.clone().multiplyScalar(shaftOffset3D));
    driveShaft.rotation.y = -sample.heading;
    driveGroup.add(driveShaft);

    // 2. WHITE UHMW CHEEK PLATES (At drive terminal flanking sprocket - Image 1, 2, 4)
    for (const cheekSign of [-1, 1]) {
      const cheekGroup = new THREE.Group();
      const cheekThick = 15;
      const cheekOffset = (visualW / 2 + 8) * cheekSign;

      // Contoured cheek body
      const cheekBodyGeom = new THREE.BoxGeometry(130, 80, cheekThick);
      const cheekBody = new THREE.Mesh(cheekBodyGeom, this.materials.whiteCheekPlate);
      cheekBody.position.set(10 * (isBeginning ? -1 : 1), 0, 0);
      cheekGroup.add(cheekBody);

      // Front rounded nose
      const cheekNoseGeom = new THREE.CylinderGeometry(40, 40, cheekThick, 24);
      cheekNoseGeom.rotateZ(Math.PI / 2);
      const cheekNose = new THREE.Mesh(cheekNoseGeom, this.materials.whiteCheekPlate);
      cheekNose.position.set(35 * (isBeginning ? -1 : 1), 0, 0);
      cheekGroup.add(cheekNose);

      cheekGroup.position.copy(sample.point).add(sample.leftNormal.clone().multiplyScalar(cheekOffset));
      cheekGroup.position.y = workingY - 20;
      cheekGroup.rotation.y = -sample.heading;
      driveGroup.add(cheekGroup);
    }

    // 3. MOTOR & GEARBOX POSITIONING
    if (isBelowBelt) {
      // Suspended directly below the conveyor belt centerline hanging vertically downwards (-Y) towards the floor
      motorAssembly.position.copy(sample.point);
      motorAssembly.position.y = workingY - 110;
      motorAssembly.rotation.y = -sample.heading;
      motorAssembly.rotation.x = 0; // CRITICAL: NEVER invert X - motor stator must hang DOWNWARDS towards the floor!

      // Subframe under-mount brackets holding drive below conveyor
      const underBracketGeom = new THREE.BoxGeometry(100, 45, 6);
      for (const sign of [-1, 1]) {
        const uBrk = new THREE.Mesh(underBracketGeom, this.materials.driveMountingPlateBlack);
        uBrk.position.copy(sample.point).add(sample.leftNormal.clone().multiplyScalar((visualW / 2 - 8) * sign));
        uBrk.position.y = workingY - 55;
        uBrk.rotation.y = -sample.heading;
        driveGroup.add(uBrk);
      }

      // Cross support bar holding gearbox
      const crossBarGeom = new THREE.BoxGeometry(30, 15, visualW + 10);
      const crossBar = new THREE.Mesh(crossBarGeom, this.materials.driveMountingPlateBlack);
      crossBar.position.copy(sample.point);
      crossBar.position.y = workingY - 75;
      crossBar.rotation.y = -sample.heading;
      driveGroup.add(crossBar);

    } else if (isEnd) {
      // Coaxial drive on discharge end
      motorAssembly.position.copy(sample.point).add(sample.tangent.clone().multiplyScalar(50));
      motorAssembly.position.y = workingY - 40;
      motorAssembly.rotation.y = -sample.heading;
    } else {
      const shaftOffset = (visualW / 2 + 35) * sideSign;
      motorAssembly.position.copy(sample.point).add(sample.leftNormal.clone().multiplyScalar(shaftOffset));
      motorAssembly.position.y = workingY - 50; // Underslung downwards below the conveyor profile
      motorAssembly.rotation.y = -sample.heading;

      // If on left side, rotate motor assembly to face outwards
      if (isLeft) {
        motorAssembly.rotation.y += Math.PI;
      }

      // AUTHENTIC DUAL CONTOURED BLACK DRIVE MOUNTING PLATES (Left & Right - strictly matching Motor Head 82.5.png)
      for (const sSign of [-1, 1]) {
        const plateGroup = new THREE.Group();
        const plateThick = 6;
        const plateOffset = (visualW / 2 + 16) * sSign;

        // Main mounting body plate
        const plateBodyGeom = new THREE.BoxGeometry(160, 105, plateThick);
        const plateBody = new THREE.Mesh(plateBodyGeom, this.materials.driveMountingPlateBlack);
        plateBody.position.set(0, -10, 0);
        plateBody.castShadow = true;
        plateGroup.add(plateBody);

        // Front semi-circular nose contour enclosing the drive shaft
        const noseGeom = new THREE.CylinderGeometry(52, 52, plateThick, 24);
        noseGeom.rotateZ(Math.PI / 2);
        const nose = new THREE.Mesh(noseGeom, this.materials.driveMountingPlateBlack);
        nose.position.set(25 * (isBeginning ? -1 : 1), 0, 0);
        plateGroup.add(nose);

        // Flanged Bearing Housing Boss on opposite side of motor (matching Motor Head 82.5.png)
        if (sSign === -sideSign) {
          const bossGeom = new THREE.CylinderGeometry(36, 36, 12, 20);
          bossGeom.rotateZ(Math.PI / 2);
          const boss = new THREE.Mesh(bossGeom, this.materials.darkSprocket);
          boss.position.set(nose.position.x, 0, (plateThick / 2 + 6) * sSign);
          plateGroup.add(boss);
        }

        // Button-head silver clamp bolts into aluminium profile
        const boltGeom = new THREE.CylinderGeometry(5, 5, 8, 12);
        boltGeom.rotateZ(Math.PI / 2);
        const boltPositions = [
          [-55, 25], [-55, -25], [-20, 25], [-20, -25],
          [40, 20], [40, -20], [15, 30], [15, -30]
        ];
        for (const [bx, by] of boltPositions) {
          const bolt = new THREE.Mesh(boltGeom, this.materials.zincHardware);
          bolt.position.set(bx, by, (plateThick / 2 + 3) * sSign);
          plateGroup.add(bolt);
        }

        plateGroup.position.copy(sample.point).add(sample.leftNormal.clone().multiplyScalar(plateOffset));
        plateGroup.position.y = workingY - 20;
        plateGroup.rotation.y = -sample.heading;
        driveGroup.add(plateGroup);
      }
    }

    driveGroup.add(motorAssembly);

    return driveGroup;
  }

  private buildMotorModel(motorId: MotorId, isReductor: boolean): THREE.Group {
    const assembly = new THREE.Group();

    switch (motorId) {
      case 'motor-003':
        // Motor 3: Large 0.75 kW Heavy-Duty High-Torque Motor
        this.buildLargeMotor(assembly, isReductor);
        break;
      case 'motor-002':
        // Motor 2: Medium 0.55 kW Industrial Geared Motor
        this.buildMediumMotor(assembly, isReductor);
        break;
      case 'motor-001':
      default:
        // Motor 1: Compact 0.37 kW Gearmotor
        this.buildCompactMotor(assembly, isReductor);
        break;
    }

    return assembly;
  }

  /**
   * Motor 1: 0.37 kW Compact Worm-Gearmotor (Image 1)
   */
  private buildCompactMotor(assembly: THREE.Group, isReductor: boolean): void {
    // 1. Worm Gearbox Housing in Cast Aluminium Silver (Image 1)
    const gbGeom = new THREE.BoxGeometry(75, 80, 70);
    const gb = new THREE.Mesh(gbGeom, this.materials.gearboxHousing);
    gb.position.set(0, -10, 0);
    gb.castShadow = true;
    assembly.add(gb);

    // Gearbox top breather / filler plug
    const breatherGeom = new THREE.CylinderGeometry(8, 8, 16, 12);
    const breather = new THREE.Mesh(breatherGeom, this.materials.gearboxHousing);
    breather.position.set(0, 38, 0);
    assembly.add(breather);

    // Circular Output Mounting Flange with central bore & 4 bolt holes (Image 1)
    const flangeGeom = new THREE.CylinderGeometry(52, 52, 10, 20);
    flangeGeom.rotateZ(Math.PI / 2);
    const flange = new THREE.Mesh(flangeGeom, this.materials.gearboxHousing);
    flange.position.set(-42, -10, 0);
    assembly.add(flange);

    // 4 Bolt bosses on PCD Ø75 mm
    for (let b = 0; b < 4; b++) {
      const ang = (b * Math.PI) / 2;
      const boltGeom = new THREE.CylinderGeometry(6, 6, 12, 10);
      boltGeom.rotateZ(Math.PI / 2);
      const bolt = new THREE.Mesh(boltGeom, this.materials.zincHardware);
      bolt.position.set(-42, -10 + Math.cos(ang) * 36, Math.sin(ang) * 36);
      assembly.add(bolt);
    }

    // 2. Dark Intermediate Transition Ring (Image 1)
    const interGeom = new THREE.CylinderGeometry(36, 36, 12, 20);
    const interRing = new THREE.Mesh(interGeom, this.materials.yellowAccent); // dark anthracite
    interRing.position.set(0, -56, 0);
    assembly.add(interRing);

    // 3. Compact Motor Body hanging vertically downward (-Y) in Silver (Image 1)
    const motorRadius = 34;
    const motorLength = isReductor ? 130 : 110;
    const motorGeom = new THREE.CylinderGeometry(motorRadius, motorRadius, motorLength, 20);
    const motor = new THREE.Mesh(motorGeom, this.materials.motorBody);
    motor.position.set(0, -62 - motorLength / 2, 0);
    motor.castShadow = true;
    assembly.add(motor);

    // 8 Longitudinal vertical cooling fins (Image 1)
    for (let f = 0; f < 8; f++) {
      const ang = (f * Math.PI) / 4;
      const finGeom = new THREE.BoxGeometry(2.5, motorLength - 10, 5);
      const fin = new THREE.Mesh(finGeom, this.materials.motorBody);
      fin.position.set(Math.cos(ang) * (motorRadius + 1), motor.position.y, Math.sin(ang) * (motorRadius + 1));
      fin.rotation.y = -ang;
      assembly.add(fin);
    }

    // 4. Dark Anthracite Terminal Box on outward face (Image 1)
    const boxGeom = new THREE.BoxGeometry(32, 42, 26);
    const box = new THREE.Mesh(boxGeom, this.materials.yellowAccent);
    box.position.set(0, motor.position.y + 10, motorRadius + 13);
    assembly.add(box);

    // Circular black side plug
    const plugGeom = new THREE.CylinderGeometry(7, 7, 4, 12);
    plugGeom.rotateX(Math.PI / 2);
    const plug = new THREE.Mesh(plugGeom, this.materials.yellowAccent);
    plug.position.set(18, box.position.y - 10, box.position.z + 13);
    assembly.add(plug);

    // 5. Silver Fan Cowl at bottom of motor (Image 1 - NOT yellow!)
    const fanGeom = new THREE.CylinderGeometry(motorRadius + 0.5, motorRadius - 2, 38, 20);
    const fan = new THREE.Mesh(fanGeom, this.materials.motorFan);
    fan.position.set(0, motor.position.y - motorLength / 2 - 19, 0);
    assembly.add(fan);
  }

  /**
   * Motor 2: 0.55 kW Medium Helical-Bevel Industrial Motor (Image 1)
   */
  private buildMediumMotor(assembly: THREE.Group, isReductor: boolean): void {
    // 1. Medium Worm Gearbox with reinforced ribs (Image 1)
    const gbGeom = new THREE.BoxGeometry(85, 95, 80);
    const gb = new THREE.Mesh(gbGeom, this.materials.gearboxHousing);
    gb.position.set(0, -12, 0);
    gb.castShadow = true;
    assembly.add(gb);

    // Top breather plug
    const breatherGeom = new THREE.CylinderGeometry(9, 9, 18, 12);
    const breather = new THREE.Mesh(breatherGeom, this.materials.gearboxHousing);
    breather.position.set(0, 42, 0);
    assembly.add(breather);

    // Circular Output Mounting Flange (Image 1)
    const flangeGeom = new THREE.CylinderGeometry(58, 58, 12, 20);
    flangeGeom.rotateZ(Math.PI / 2);
    const flange = new THREE.Mesh(flangeGeom, this.materials.gearboxHousing);
    flange.position.set(-48, -12, 0);
    assembly.add(flange);

    // 4 Bolt bosses on PCD Ø85 mm
    for (let b = 0; b < 4; b++) {
      const ang = (b * Math.PI) / 2;
      const boltGeom = new THREE.CylinderGeometry(7, 7, 14, 10);
      boltGeom.rotateZ(Math.PI / 2);
      const bolt = new THREE.Mesh(boltGeom, this.materials.zincHardware);
      bolt.position.set(-48, -12 + Math.cos(ang) * 42, Math.sin(ang) * 42);
      assembly.add(bolt);
    }

    // 2. Dark Intermediate Transition Ring (Image 1)
    const interGeom = new THREE.CylinderGeometry(42, 42, 14, 20);
    const interRing = new THREE.Mesh(interGeom, this.materials.yellowAccent);
    interRing.position.set(0, -66, 0);
    assembly.add(interRing);

    // 3. Medium Motor Body hanging vertically downward (-Y) in Silver (Image 1)
    const motorRadius = 38;
    const motorLength = isReductor ? 155 : 135;
    const motorGeom = new THREE.CylinderGeometry(motorRadius, motorRadius, motorLength, 20);
    const motor = new THREE.Mesh(motorGeom, this.materials.motorBody);
    motor.position.set(0, -73 - motorLength / 2, 0);
    motor.castShadow = true;
    assembly.add(motor);

    // 10 Longitudinal cooling fins
    for (let f = 0; f < 10; f++) {
      const ang = (f * Math.PI) / 5;
      const finGeom = new THREE.BoxGeometry(2.5, motorLength - 12, 5);
      const fin = new THREE.Mesh(finGeom, this.materials.motorBody);
      fin.position.set(Math.cos(ang) * (motorRadius + 1), motor.position.y, Math.sin(ang) * (motorRadius + 1));
      fin.rotation.y = -ang;
      assembly.add(fin);
    }

    // 4. Dark Anthracite Terminal Box (Image 1)
    const boxGeom = new THREE.BoxGeometry(36, 46, 28);
    const box = new THREE.Mesh(boxGeom, this.materials.yellowAccent);
    box.position.set(0, motor.position.y + 12, motorRadius + 14);
    assembly.add(box);

    // Black side access plug
    const plugGeom = new THREE.CylinderGeometry(8, 8, 5, 12);
    plugGeom.rotateX(Math.PI / 2);
    const plug = new THREE.Mesh(plugGeom, this.materials.yellowAccent);
    plug.position.set(20, box.position.y - 12, box.position.z + 14);
    assembly.add(plug);

    // 5. Silver Fan Cowl at bottom (Image 1 - NOT yellow!)
    const fanGeom = new THREE.CylinderGeometry(motorRadius + 0.5, motorRadius - 3, 44, 20);
    const fan = new THREE.Mesh(fanGeom, this.materials.motorFan);
    fan.position.set(0, motor.position.y - motorLength / 2 - 22, 0);
    assembly.add(fan);
  }

  /**
   * Motor 3: 0.75 kW Heavy-Duty High-Torque Multi-Stage Motor (Image 1)
   */
  private buildLargeMotor(assembly: THREE.Group, isReductor: boolean): void {
    // 1. Heavy Gearbox Housing in Silver (Image 1)
    const gbGeom = new THREE.BoxGeometry(95, 110, 90);
    const gb = new THREE.Mesh(gbGeom, this.materials.gearboxHousing);
    gb.position.set(0, -15, 0);
    gb.castShadow = true;
    assembly.add(gb);

    // Top breather plug
    const breatherGeom = new THREE.CylinderGeometry(10, 10, 20, 12);
    const breather = new THREE.Mesh(breatherGeom, this.materials.gearboxHousing);
    breather.position.set(0, 48, 0);
    assembly.add(breather);

    // Circular Output Mounting Flange (Image 1)
    const flangeGeom = new THREE.CylinderGeometry(64, 64, 14, 20);
    flangeGeom.rotateZ(Math.PI / 2);
    const flange = new THREE.Mesh(flangeGeom, this.materials.gearboxHousing);
    flange.position.set(-54, -15, 0);
    assembly.add(flange);

    // 4 Bolt bosses on PCD Ø95 mm
    for (let b = 0; b < 4; b++) {
      const ang = (b * Math.PI) / 2;
      const boltGeom = new THREE.CylinderGeometry(8, 8, 16, 10);
      boltGeom.rotateZ(Math.PI / 2);
      const bolt = new THREE.Mesh(boltGeom, this.materials.zincHardware);
      bolt.position.set(-54, -15 + Math.cos(ang) * 48, Math.sin(ang) * 48);
      assembly.add(bolt);
    }

    // 2. Dark Intermediate Transition Ring (Image 1)
    const interGeom = new THREE.CylinderGeometry(46, 46, 16, 20);
    const interRing = new THREE.Mesh(interGeom, this.materials.yellowAccent);
    interRing.position.set(0, -78, 0);
    assembly.add(interRing);

    // 3. Large Motor Body hanging vertically downward (-Y) in Silver (Image 1)
    const motorRadius = 42;
    const motorLength = isReductor ? 180 : 160;
    const motorGeom = new THREE.CylinderGeometry(motorRadius, motorRadius, motorLength, 24);
    const motor = new THREE.Mesh(motorGeom, this.materials.motorBody);
    motor.position.set(0, -86 - motorLength / 2, 0);
    motor.castShadow = true;
    assembly.add(motor);

    // 12 Longitudinal vertical cooling fins
    for (let f = 0; f < 12; f++) {
      const ang = (f * Math.PI) / 6;
      const finGeom = new THREE.BoxGeometry(2.5, motorLength - 14, 5.5);
      const fin = new THREE.Mesh(finGeom, this.materials.motorBody);
      fin.position.set(Math.cos(ang) * (motorRadius + 1), motor.position.y, Math.sin(ang) * (motorRadius + 1));
      fin.rotation.y = -ang;
      assembly.add(fin);
    }

    // 4. Dark Anthracite Terminal Box (Image 1)
    const boxGeom = new THREE.BoxGeometry(42, 52, 32);
    const box = new THREE.Mesh(boxGeom, this.materials.yellowAccent);
    box.position.set(0, motor.position.y + 15, motorRadius + 16);
    assembly.add(box);

    // Black side access plug
    const plugGeom = new THREE.CylinderGeometry(9, 9, 6, 12);
    plugGeom.rotateX(Math.PI / 2);
    const plug = new THREE.Mesh(plugGeom, this.materials.yellowAccent);
    plug.position.set(24, box.position.y - 14, box.position.z + 16);
    assembly.add(plug);

    // 5. Silver Fan Cowl at bottom (Image 1 - NOT yellow!)
    const fanGeom = new THREE.CylinderGeometry(motorRadius + 0.5, motorRadius - 3.5, 50, 24);
    const fan = new THREE.Mesh(fanGeom, this.materials.motorFan);
    fan.position.set(0, motor.position.y - motorLength / 2 - 25, 0);
    assembly.add(fan);
  }
}
