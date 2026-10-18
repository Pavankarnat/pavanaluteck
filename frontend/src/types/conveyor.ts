export type Language = 'cs' | 'en' | 'pl' | 'it';

export type ChainMaterial = 'plastic' | 'steel' | 'stainless-steel';

export type DrivePosition =
  | 'start-left'
  | 'start-right'
  | 'end-left'
  | 'end-right'
  | 'below-belt-start'
  | 'below-belt-end'
  | 'left'
  | 'right'
  | 'reductor-left'
  | 'reductor-right'
  | 'end'
  | 'beginning';

export type DriveMountType = 'fixed' | 'reductor';

export type MotorId = 'motor-001' | 'motor-002' | 'motor-003';

export interface MotorConfiguration {
  id: MotorId;
  name: string;
  powerKw: number;
  torqueNm: number;
  description: string;
}

export type DriveKind = 'normal' | 'reductor' | 'central';
export type EnginePosition = 'start-left' | 'start-right' | 'end-left' | 'end-right';
export type EngineAngle = 'up' | 'down' | 'beside-front' | 'beside-rear';

export type TravelDirection = 'forward' | 'reverse';

export type SupportType = 'fixed' | 'mechanically-adjustable' | 'electrically-adjustable' | 'without-support';

export type FootType =
  | 'anchor-angle'
  | 'adjustable'
  | 'fixed'
  | 'wheel-without-brake'
  | 'wheel-with-brake'
  | 'articulated-foot'
  | 'base-plate';

export type HeightMode = 'fixed' | 'adjustable' | 'oblique';

export interface WorkingHeightConfiguration {
  enabled: boolean;
  type: SupportType;
  height: number; // in mm
  heightMode?: HeightMode;
  footType?: FootType;
}

export type ConveyorShape = 'straight' | 'curved';

export type CurveType = 'friction' | 'wheelband'; // friction = Normal Curve Bend, wheelband = Wheel Bend
export type CurveDirection = 'left' | 'right';

export interface CurveConfiguration {
  id?: string;
  curveType: CurveType;
  angle: number; // in degrees (e.g. 30, 45, 90, 180)
  offset: number; // position along conveyor in mm (for Curve 1: from start)
  distanceFromPrevious?: number; // distance between curve 1 & 2, or 2 & 3
  direction: CurveDirection;
  radius: number; // explicit radius for each bend in mm
}

export type SideGuideType = '904516' | '904515';

export interface SideGuideConfiguration {
  id?: string;
  type: SideGuideType;
  widthBetweenGuides: number; // gap or dist between side guides in mm
  heightAboveChain: number; // in mm
  bottomClearanceGap?: number; // side gap between top of the chain to bottom of the guide in mm
}

export interface ConveyorConfiguration {
  language: Language;
  chainMaterial: ChainMaterial;
  width: number; // width of the chain in mm
  loadPerMeter: number; // in kg/m
  maxTotalLoad?: number; // max load on the conveyor in kg
  length: number; // conveyor axis to axis length in mm
  endHorizontalPathLength?: number; // length of the end horizontal path in mm
  driveKind?: DriveKind; // 'normal' | 'reductor' | 'central'
  enginePosition?: EnginePosition; // 'start-left' | 'start-right' | 'end-left' | 'end-right'
  engineAngle?: EngineAngle; // 'up' | 'down' | 'beside-front' | 'beside-rear'
  drivePosition: DrivePosition;
  driveMountType?: DriveMountType;
  motor?: MotorConfiguration;
  travelDirection?: TravelDirection;
  workingHeight: WorkingHeightConfiguration;
  shape: ConveyorShape;
  curves: CurveConfiguration[];
  sideGuides?: SideGuideConfiguration[];
  presetId?: string;
  isClientReferencePreset?: boolean;
}

export interface ValidationIssue {
  field?: string;
  message: string;
  level: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface BOMItem {
  item: string;
  quantity: number;
  unit: string;
}

export interface ConveyorSpecifications {
  total_path_length_mm: number;
  track_width_mm: number;
  chain_pitch_mm: number;
  working_height_mm: number;
  max_tensile_force_n: number;
  recommended_motor_power_kw: number;
  motor_model_name?: string;
  total_weight_kg_est: number;
  support_legs_count: number;
  support_max_spacing_mm: number;
}
