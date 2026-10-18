export interface Material {
  id: string;
  name: string;
  icon: string;
  description: string;
  status: 'available' | 'upcoming';
}

export interface WidthOption {
  id: string;
  width: number;
  unit: string;
  max_load: number;
  max_speed: number;
  description: string;
  price_factor: number;
}

export interface BOMItem {
  item: string;
  quantity: number;
  unit: string;
}

export interface ConveyorDetail {
  width: number;
  pitch: number;
  material: string;
  min_radius: number;
  max_tensile_strength: number;
  cad_model_placeholder: string;
  bom_preview: BOMItem[];
}
