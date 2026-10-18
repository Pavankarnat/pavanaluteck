import * as THREE from 'three';
import { ConveyorConfiguration, CurveConfiguration } from '../../types/conveyor';

export interface PathSample {
  point: THREE.Vector3;
  tangent: THREE.Vector3;    // Unit vector in forward travel direction
  normal: THREE.Vector3;     // Unit vector pointing to the RIGHT of travel direction
  leftNormal: THREE.Vector3; // Unit vector pointing to the LEFT of travel direction
  distance: number;          // Distance along conveyor from start in mm
  heading: number;           // Angle in radians in XZ plane (0 = +X, PI/2 = +Z, -PI/2 = -Z, PI = -X)
}

export type SegmentType = 'straight' | 'curve';

export interface StraightSegment {
  type: 'straight';
  startPoint: THREE.Vector3;
  endPoint: THREE.Vector3;
  direction: THREE.Vector3;
  heading: number;
  length: number;
  startDistance: number;
  endDistance: number;
}

export interface CurveSegment {
  type: 'curve';
  center: THREE.Vector3;
  radius: number;
  startAngle: number;
  endAngle: number;
  sweepAngle: number;
  direction: 'left' | 'right';
  startHeading: number;
  endHeading: number;
  startPoint: THREE.Vector3;
  endPoint: THREE.Vector3;
  startDistance: number;
  endDistance: number;
  arcLength: number;
  config: CurveConfiguration;
}

export type PathSegment = StraightSegment | CurveSegment;

/**
 * Adaptive visual width helper to ensure realistic proportions on 3D view
 * while keeping engineering dimensions 100% exact for BOM & specs.
 */
export function getVisualWidth(actualWidth: number): number {
  if (actualWidth <= 63) return 130;
  if (actualWidth <= 82.5) return 155;
  if (actualWidth <= 114.3) return 190;
  if (actualWidth <= 190.5) return 235;
  if (actualWidth <= 254) return 285;
  return 335;
}

/** Single source of truth for a curve's centre-line radius (explicit value, else a type/width based default). */
export function resolveCurveRadius(curve: CurveConfiguration, width: number): number {
  if (Number.isFinite(curve.radius) && curve.radius > 0) return curve.radius;
  return curve.curveType === 'wheelband' ? 200 : Math.max(500, width * 4.0);
}

/** Guards the path maths against cleared / NaN inputs coming from number fields. */
function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export class ConveyorPath {
  public segments: PathSegment[] = [];
  public totalLength: number = 0;
  public samples: PathSample[] = [];

  constructor(config: ConveyorConfiguration) {
    this.buildPath(config);
  }

  /**
   * Builds tangent-continuous centerline path.
   * LEFT and RIGHT are strictly interpreted relative to the CURRENT travel heading.
   *
   * Coordinate Convention:
   * +X: Initial travel direction (East)
   * +Y: Vertical height (Up)
   * +Z: Lateral right (South)
   * -Z: Lateral left (North)
   */
  private buildPath(config: ConveyorConfiguration): void {
    this.segments = [];
    let currentDistance = 0;

    let currentPos = new THREE.Vector3(0, 0, 0);
    let currentHeading = 0; // 0 radians = pointing in +X direction

    if (config.shape === 'straight' || !config.curves || config.curves.length === 0) {
      // Linear straight path
      const length = Math.max(1, finiteOr(config.length, 600));
      const dirVec = new THREE.Vector3(Math.cos(currentHeading), 0, Math.sin(currentHeading));
      const endPos = currentPos.clone().add(dirVec.clone().multiplyScalar(length));

      this.segments.push({
        type: 'straight',
        startPoint: currentPos.clone(),
        endPoint: endPos.clone(),
        direction: dirVec,
        heading: currentHeading,
        length: length,
        startDistance: currentDistance,
        endDistance: currentDistance + length
      });
      this.totalLength = length;
    } else {
      // Parametric multi-curve path (1 to 5 sequential curves)
      const totalConfigLength = Math.max(1, finiteOr(config.length, 600));
      const curves = [...config.curves];

      // Sort curves by offset along the path
      curves.sort((a, b) => a.offset - b.offset);

      let lastOffset = 0;

      for (let i = 0; i < curves.length; i++) {
        const curve = curves[i];
        // Explicit radius or standard based on curve type: Wheel Bend (compact R180-200) vs Normal Bend (R500-1000)
        const radius = resolveCurveRadius(curve, config.width);
        const sweepRad = (Math.max(0, finiteOr(curve.angle, 0)) * Math.PI) / 180;
        const arcLen = radius * sweepRad;

        // 1. Straight lead-in section before this curve
        // Curve 1: position offset from start (e.g. 1500 mm)
        // Curve 2, 3: distance between curve 1 & 2 / 2 & 3
        const leadInLength = i === 0
          ? Math.max(150, curve.offset || 1500)
          : Math.max(150, curve.distanceFromPrevious ?? Math.max(200, curve.offset - lastOffset));

        if (leadInLength > 0) {
          const dirVec = new THREE.Vector3(Math.cos(currentHeading), 0, Math.sin(currentHeading));
          const straightEnd = currentPos.clone().add(dirVec.clone().multiplyScalar(leadInLength));

          this.segments.push({
            type: 'straight',
            startPoint: currentPos.clone(),
            endPoint: straightEnd.clone(),
            direction: dirVec,
            heading: currentHeading,
            length: leadInLength,
            startDistance: currentDistance,
            endDistance: currentDistance + leadInLength
          });

          currentDistance += leadInLength;
          currentPos = straightEnd;
        }

        // 2. Relative Curve Segment
        const isLeft = curve.direction === 'left';

        let center: THREE.Vector3;
        let startAngle: number;
        let endAngle: number;
        let endHeading: number;

        if (isLeft) {
          // TURN LEFT relative to current travel direction:
          const leftNormal = new THREE.Vector3(Math.sin(currentHeading), 0, -Math.cos(currentHeading));
          center = currentPos.clone().add(leftNormal.multiplyScalar(radius));
          startAngle = currentHeading + Math.PI / 2;
          endAngle = startAngle - sweepRad;
          endHeading = currentHeading - sweepRad;
        } else {
          // TURN RIGHT relative to current travel direction:
          const rightNormal = new THREE.Vector3(-Math.sin(currentHeading), 0, Math.cos(currentHeading));
          center = currentPos.clone().add(rightNormal.multiplyScalar(radius));
          startAngle = currentHeading - Math.PI / 2;
          endAngle = startAngle + sweepRad;
          endHeading = currentHeading + sweepRad;
        }

        const curveEnd = new THREE.Vector3(
          center.x + radius * Math.cos(endAngle),
          0,
          center.z + radius * Math.sin(endAngle)
        );

        this.segments.push({
          type: 'curve',
          center: center,
          radius: radius,
          startAngle: startAngle,
          endAngle: endAngle,
          sweepAngle: sweepRad,
          direction: curve.direction,
          startHeading: currentHeading,
          endHeading: endHeading,
          startPoint: currentPos.clone(),
          endPoint: curveEnd.clone(),
          startDistance: currentDistance,
          endDistance: currentDistance + arcLen,
          arcLength: arcLen,
          config: curve
        });

        currentDistance += arcLen;
        currentPos = curveEnd;
        currentHeading = endHeading;
        lastOffset = curve.offset + arcLen;
      }

      // 3. Final straight exit section: Length of the end horizontal path
      const remainingLength = Math.max(200, config.endHorizontalPathLength ?? Math.max(400, totalConfigLength * 0.35));
      const exitDir = new THREE.Vector3(Math.cos(currentHeading), 0, Math.sin(currentHeading));
      const finalEnd = currentPos.clone().add(exitDir.clone().multiplyScalar(remainingLength));

      this.segments.push({
        type: 'straight',
        startPoint: currentPos.clone(),
        endPoint: finalEnd.clone(),
        direction: exitDir,
        heading: currentHeading,
        length: remainingLength,
        startDistance: currentDistance,
        endDistance: currentDistance + remainingLength
      });

      currentDistance += remainingLength;
      this.totalLength = currentDistance;
    }

    // Pre-calculate fine samples along the path
    this.generateSamples(15);
  }

  private generateSamples(stepSize: number): void {
    this.samples = [];
    const numSteps = Math.max(20, Math.ceil(this.totalLength / stepSize));

    for (let i = 0; i <= numSteps; i++) {
      const dist = (i / numSteps) * this.totalLength;
      const sample = this.getSampleAtDistance(dist);
      this.samples.push(sample);
    }
  }

  public getSampleAtDistance(distance: number): PathSample {
    const clampedDist = Math.max(0, Math.min(this.totalLength, distance));

    // Find the corresponding segment
    let segment = this.segments[0];
    for (const seg of this.segments) {
      if (clampedDist >= seg.startDistance && clampedDist <= seg.endDistance) {
        segment = seg;
        break;
      }
    }

    if (segment.type === 'straight') {
      const segFraction = segment.length > 0 ? (clampedDist - segment.startDistance) / segment.length : 0;
      const point = segment.startPoint.clone().lerp(segment.endPoint, segFraction);
      const tangent = segment.direction.clone().normalize();
      const heading = segment.heading;

      // Right normal is (-sin(H), 0, cos(H))
      const rightNormal = new THREE.Vector3(-Math.sin(heading), 0, Math.cos(heading)).normalize();
      // Left normal is (sin(H), 0, -cos(H))
      const leftNormal = new THREE.Vector3(Math.sin(heading), 0, -Math.cos(heading)).normalize();

      return {
        point,
        tangent,
        normal: rightNormal,
        leftNormal,
        distance: clampedDist,
        heading
      };
    } else {
      // Curve segment
      const segFraction = segment.arcLength > 0 ? (clampedDist - segment.startDistance) / segment.arcLength : 0;
      const currentAngle = segment.startAngle + (segment.endAngle - segment.startAngle) * segFraction;
      const currentHeading = segment.startHeading + (segment.endHeading - segment.startHeading) * segFraction;

      const point = new THREE.Vector3(
        segment.center.x + segment.radius * Math.cos(currentAngle),
        0,
        segment.center.z + segment.radius * Math.sin(currentAngle)
      );

      const tangent = new THREE.Vector3(Math.cos(currentHeading), 0, Math.sin(currentHeading)).normalize();
      const rightNormal = new THREE.Vector3(-Math.sin(currentHeading), 0, Math.cos(currentHeading)).normalize();
      const leftNormal = new THREE.Vector3(Math.sin(currentHeading), 0, -Math.cos(currentHeading)).normalize();

      return {
        point,
        tangent,
        normal: rightNormal,
        leftNormal,
        distance: clampedDist,
        heading: currentHeading
      };
    }
  }

  /**
   * Generates a 3D line offset laterally:
   * lateralOffset > 0 -> offsets to the LEFT of travel direction
   * lateralOffset < 0 -> offsets to the RIGHT of travel direction
   */
  public getOffsetPoints(lateralOffset: number, stepSize: number = 20): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    const numSteps = Math.max(10, Math.ceil(this.totalLength / stepSize));

    for (let i = 0; i <= numSteps; i++) {
      const dist = (i / numSteps) * this.totalLength;
      const sample = this.getSampleAtDistance(dist);
      const offsetPoint = sample.point.clone().add(sample.leftNormal.clone().multiplyScalar(lateralOffset));
      points.push(offsetPoint);
    }
    return points;
  }
}
