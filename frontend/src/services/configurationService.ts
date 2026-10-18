import { ConveyorPath, resolveCurveRadius } from '../components/3d/pathMath';
import {
  ConveyorConfiguration,
  BOMItem,
  ConveyorSpecifications,
  ChainMaterial,
  MotorConfiguration,
  DrivePosition,
  FootType,
  SupportType
} from '../types/conveyor';

export const AVAILABLE_MOTORS: MotorConfiguration[] = [
  {
    id: 'motor-001',
    name: 'Standard Geared Motor (0.37 kW)',
    powerKw: 0.37,
    torqueNm: 35,
    description: 'Compact worm-gearmotor for standard conveyor drive.'
  }
];

export class ConfigurationService {
  public static getChainPitch(width: number): number {
    return width <= 63.0 ? 25.4 : (width >= 190.5 ? 50.8 : 38.1);
  }

  public static formatDrivePosition(pos: DrivePosition): string {
    switch (pos) {
      case 'start-left': return 'Infeed • Left';
      case 'start-right': return 'Infeed • Right';
      case 'end-left': return 'Discharge • Left';
      case 'end-right': return 'Discharge • Right';
      case 'left': return 'Head • Left';
      case 'right': return 'Head • Right';
      case 'reductor-left': return 'Reductor • Left';
      case 'reductor-right': return 'Reductor • Right';
      case 'below-belt-start': return 'Underslung • Start';
      case 'below-belt-end': return 'Underslung • End';
      case 'end': return 'Discharge End';
      case 'beginning': return 'Infeed Head';
      default: return String(pos).replace(/-/g, ' ').toUpperCase();
    }
  }

  public static formatFootType(footType?: FootType): string {
    switch (footType) {
      case 'wheel-with-brake': return 'Braked Wheels';
      case 'wheel-without-brake': return 'Caster Wheels';
      case 'base-plate': return 'Base Plate';
      case 'anchor-angle': return 'Anchor Angle';
      case 'fixed': return 'Fixed Foot';
      case 'adjustable': return 'Leveling Foot';
      case 'articulated-foot':
      default: return 'Articulated Foot';
    }
  }

  public static formatSupportType(type: SupportType): string {
    switch (type) {
      case 'without-support': return 'Gantry Base Mount';
      case 'fixed': return 'Fixed Support Stand';
      case 'mechanically-adjustable': return 'Telescopic Stand';
      case 'electrically-adjustable': return 'Linear Actuator Stand';
      default: return 'Support Leg Assembly';
    }
  }
  /** The app opens on (and Reset returns to) the client's reference conveyor, DD82,5-400+ZP90+500. */
  public static getDefaultConfiguration(): ConveyorConfiguration {
    return this.getTargetReferenceConfiguration();
  }

  /** A plain generic conveyor (not the client's reference). */
  public static getGenericConfiguration(): ConveyorConfiguration {
    return {
      language: 'en',
      chainMaterial: 'plastic',
      width: 82.5,
      loadPerMeter: 50,
      length: 3000,
      drivePosition: 'left',
      motor: AVAILABLE_MOTORS[0], // Motor 1 (0.37 kW)
      travelDirection: 'forward',
      workingHeight: {
        enabled: true,
        type: 'fixed',
        height: 850
      },
      shape: 'straight',
      curves: [],
      sideGuides: [
        {
          id: 'sg-1',
          type: '904516',
          widthBetweenGuides: 100,
          heightAboveChain: 60
        }
      ]
    };
  }

  public static getTargetReferenceConfiguration(): ConveyorConfiguration {
    return {
      language: 'en',
      chainMaterial: 'plastic',
      width: 82.5,
      loadPerMeter: 50,
      length: 1700,
      drivePosition: 'left',
      motor: {
        id: 'motor-001',
        name: 'VF49F1P63BN63B6 (0.12 kW, 50 Nm)',
        powerKw: 0.12,
        torqueNm: 50,
        description: 'Bonfiglioli worm gear motor with intermediate flange'
      },
      travelDirection: 'forward',
      workingHeight: {
        enabled: true,
        type: 'electrically-adjustable',
        height: 1100,
        footType: 'wheel-with-brake',
        heightMode: 'adjustable'
      },
      shape: 'curved',
      curves: [
        {
          id: 'curve-zp90',
          curveType: 'wheelband',
          angle: 90,
          radius: 400,
          offset: 400,
          direction: 'left'
        }
      ],
      endHorizontalPathLength: 500,
      sideGuides: [
        {
          id: 'sg-1',
          type: '904516',
          widthBetweenGuides: 100,
          heightAboveChain: 60
        }
      ],
      presetId: 'DD82_5_ZP90_400_500',
      isClientReferencePreset: true
    };
  }

  /** True when the configuration is exactly the client's reference conveyor (804-125), ignoring preset flags. */
  public static isReferencePreset(config: ConveyorConfiguration): boolean {
    const strip = (c: ConveyorConfiguration) => {
      const { presetId, isClientReferencePreset, ...rest } = c;
      return JSON.stringify(rest);
    };
    return strip(config) === strip(this.getTargetReferenceConfiguration());
  }

  public static getAvailableWidths(material: ChainMaterial): number[] {
    if (material === 'plastic') {
      return [63, 82.5, 114.3, 190.5, 254, 304.8];
    }
    // steel and stainless-steel are limited to <= 190.5 mm
    return [63, 82.5, 114.3, 190.5];
  }

  /** Total centre-line length, taken from the same path the 3D model and STEP export are built on. */
  public static calculateEffectivePathLength(config: ConveyorConfiguration): number {
    return Math.round(new ConveyorPath(config).totalLength * 10) / 10;
  }

  /** Inset stands for one straight run (distance of run start along the path, run length). */
  private static standsForStraight(
    start: number,
    len: number,
    insetStart: number,
    insetEnd: number,
    maxSpan: number
  ): number[] {
    const a = start + insetStart;
    const b = start + len - insetEnd;
    if (b - a < 300) return [start + len / 2];
    const out = [a];
    const span = b - a;
    if (span > maxSpan) {
      const numInter = Math.floor(span / maxSpan);
      const step = span / (numInter + 1);
      for (let k = 1; k <= numInter; k++) out.push(a + k * step);
    }
    out.push(b);
    return out;
  }

  public static calculateSupportLegPositions(config: ConveyorConfiguration): number[] {
    if (!config.workingHeight.enabled || config.workingHeight.type === 'without-support') {
      return [];
    }

    const maxSpan = 2000;
    const positions: number[] = [];

    if (config.shape !== 'curved' || !config.curves || config.curves.length === 0) {
      const totalLen = config.length;
      if (totalLen <= 600) {
        return [Math.round(totalLen / 2)];
      }
      const infeedPos = Math.min(250, totalLen * 0.2);
      const drivePos = Math.max(infeedPos + 300, totalLen - 280);
      const middleSpan = drivePos - infeedPos;
      positions.push(infeedPos);
      if (middleSpan > maxSpan) {
        const numInter = Math.floor(middleSpan / maxSpan);
        const step = middleSpan / (numInter + 1);
        for (let k = 1; k <= numInter; k++) {
          positions.push(infeedPos + k * step);
        }
      }
      positions.push(drivePos);
      return positions.map((d) => Math.round(d));
    }

    // Curved conveyor: stands are placed on the straight runs of the real path
    // (lead-ins before each bend, then the exit run); bends carry no stands.
    const segments = new ConveyorPath(config).segments;
    const lastIdx = segments.length - 1;
    segments.forEach((seg, idx) => {
      if (seg.type !== 'straight') return;
      const isExit = idx === lastIdx;
      const leadIn = seg.length;
      if (isExit) {
        positions.push(...this.standsForStraight(seg.startDistance, leadIn, Math.min(120, leadIn * 0.15), Math.min(280, leadIn * 0.25), maxSpan));
      } else {
        positions.push(...this.standsForStraight(seg.startDistance, leadIn, Math.min(250, leadIn * 0.25), Math.min(120, leadIn * 0.15), maxSpan));
      }
    });

    positions.sort((a, b) => a - b);
    const filtered: number[] = [];
    for (const pos of positions) {
      if (filtered.length === 0 || pos - filtered[filtered.length - 1] >= 200) {
        filtered.push(Math.round(pos));
      }
    }
    return filtered;
  }

  public static calculateDynamicBOM(config: ConveyorConfiguration, exact?: { legs: number }): BOMItem[] {
    const pathLength = this.calculateEffectivePathLength(config);
    const legPositions = this.calculateSupportLegPositions(config);
    // Built from the client's exact CAD parts: the stand count follows the real model
    const numLegSets = exact ? exact.legs : legPositions.length;

    // Pitch determination
    const pitch = this.getChainPitch(config.width);
    const chainLinks = Math.ceil((pathLength * 2) / pitch) + 12;

    const matNames: Record<ChainMaterial, string> = {
      steel: 'Steel Chain Link',
      'stainless-steel': 'Stainless Steel (AISI 304) Chain Link',
      plastic: 'Plastic Modular (POM) Chain Link'
    };

    const chainLabel = `${matNames[config.chainMaterial] || 'Chain Link'} ${config.width}mm`;
    const sprocketsQty = config.width < 200 ? 2 : (config.width < 300 ? 3 : 4);
    const profileMeters = Math.round(((pathLength * 2 / 1000.0) + (config.width / 1000.0 * (numLegSets + 2))) * 100) / 100;
    const slideRailMeters = Math.round((pathLength * 4 / 1000.0) * 100) / 100;

    const motorObj = config.motor || AVAILABLE_MOTORS[0];
    const driveName = config.driveKind === 'reductor'
      ? `Reductor Drive Unit (${this.formatDrivePosition(config.drivePosition)})`
      : (config.driveKind === 'normal'
         ? `Direct Motor Head (${this.formatDrivePosition(config.drivePosition)})`
         : `Geared Motor: ${motorObj.name} (${this.formatDrivePosition(config.drivePosition)})`);

    const bom: BOMItem[] = [
      { item: chainLabel, quantity: chainLinks, unit: 'pcs' },
      { item: `Drive Sprocket ${config.width}mm (Z=16)`, quantity: sprocketsQty, unit: 'pcs' },
      { item: `Idler Sprocket Set ${config.width}mm`, quantity: sprocketsQty, unit: 'pcs' },
      { item: `Anodized Aluminium Profile Frame ${config.width}mm`, quantity: profileMeters, unit: 'm' },
      { item: 'Slide Rail PE-UHMW Low-Friction', quantity: slideRailMeters, unit: 'm' },
      { item: driveName, quantity: 1, unit: 'set' }
    ];

    if (numLegSets > 0) {
      const footDesc = `with ${this.formatFootType(config.workingHeight.footType)}`;
      const legBaseName = config.workingHeight.heightMode === 'adjustable' || config.workingHeight.type === 'mechanically-adjustable'
        ? 'Adjustable Support Leg Assembly'
        : 'Fixed Support Leg Assembly';

      bom.push({
        item: `${legBaseName} ${footDesc} (${Math.round(config.workingHeight.height)}mm)`,
        quantity: numLegSets,
        unit: 'sets'
      });
    }

    if (config.sideGuides && config.sideGuides.length > 0) {
      const sg = config.sideGuides[0];
      const guideMeters = Math.round((pathLength * 2 / 1000.0) * 100) / 100;
      const bracketCount = Math.max(4, Math.ceil(pathLength / 600.0) * 2);
      bom.push({ item: `Side Guide Profile (Type ${sg.type})`, quantity: guideMeters, unit: 'm' });
      bom.push({ item: `Side Guide Clamping Brackets (Type ${sg.type})`, quantity: bracketCount, unit: 'pcs' });
    }

    if (config.shape === 'curved' && config.curves) {
      config.curves.forEach((curve) => {
        const rad = Math.round(resolveCurveRadius(curve, config.width));
        const curveLabel = curve.curveType === 'wheelband' ? 'Wheel Bend' : 'Normal Curve Bend';
        bom.push({
          item: `${curveLabel} ${Math.round(curve.angle)}° (R=${rad}mm, ${curve.direction.toUpperCase()})`,
          quantity: 1,
          unit: 'unit'
        });
      });
    }

    return bom;
  }

  public static calculateDynamicSpecifications(config: ConveyorConfiguration, exact?: { legs: number; maxSpan: number }): ConveyorSpecifications {
    const pathLength = this.calculateEffectivePathLength(config);
    const legPositions = this.calculateSupportLegPositions(config);
    const numLegSets = exact ? exact.legs : legPositions.length;

    const pitch = this.getChainPitch(config.width);
    let maxTensile = config.width <= 63 ? 1200 : (config.width <= 82.5 ? 2000 : (config.width <= 114.3 ? 3000 : 4500));
    if (config.chainMaterial === 'stainless-steel') {
      maxTensile = Math.round(maxTensile * 0.95);
    } else if (config.chainMaterial === 'plastic') {
      maxTensile = Math.round(maxTensile * 0.8);
    }

    const motorObj = config.motor || AVAILABLE_MOTORS[0];
    const totalWeight = Math.round((25 + (pathLength / 1000.0) * (8 + config.width * 0.04) + numLegSets * 6 + (motorObj.powerKw * 12)) * 10) / 10;
    let maxSpacing = pathLength;
    if (exact) {
      maxSpacing = Math.round(exact.maxSpan);
    } else if (numLegSets > 1) {
      maxSpacing = 0;
      for (let i = 1; i < legPositions.length; i++) {
        maxSpacing = Math.max(maxSpacing, legPositions[i] - legPositions[i - 1]);
      }
    }

    return {
      total_path_length_mm: pathLength,
      track_width_mm: config.width,
      chain_pitch_mm: pitch,
      working_height_mm: config.workingHeight.enabled && config.workingHeight.type !== 'without-support' ? config.workingHeight.height : 0,
      max_tensile_force_n: maxTensile,
      recommended_motor_power_kw: motorObj.powerKw,
      motor_model_name: motorObj.name,
      total_weight_kg_est: totalWeight,
      support_legs_count: numLegSets,
      support_max_spacing_mm: maxSpacing
    };
  }
}
