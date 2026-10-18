export interface ProductAsset {
  id: string;
  name: string;
  category: 'motor' | 'chain' | 'sprocket' | 'support' | 'frame' | 'guide' | 'control' | 'hardware';
  primaryImage: string;
  views?: { label: string; image: string }[];
  specs?: { [key: string]: string | number };
  description?: string;
}

export const PRODUCT_ASSETS = {
  motors: {
    'motor-001': {
      id: 'motor-001',
      name: 'Motor 1 (0.37 kW)',
      model: 'ALU-M037-W',
      powerKw: 0.37,
      torqueNm: 35,
      ratio: '1:15',
      primaryImage: '/images/conveyor-motor-gearbox.png',
      views: [
        { label: 'Drive Unit', image: '/images/conveyor-motor-gearbox.png' },
        { label: 'Mounted Drive', image: '/images/conveyor-drive-unit-1.png' },
        { label: 'Reverse Side', image: '/images/conveyor-drive-unit-2.png' }
      ],
      description: 'Compact worm-gearmotor for standard component handling.'
    },
    'motor-002': {
      id: 'motor-002',
      name: 'Motor 2 (0.55 kW)',
      model: 'ALU-M055-HB',
      powerKw: 0.55,
      torqueNm: 62,
      ratio: '1:20',
      primaryImage: '/images/conveyor-drive-unit-1.png',
      views: [
        { label: 'Drive Assembly', image: '/images/conveyor-drive-unit-1.png' },
        { label: 'Motor Detail', image: '/images/conveyor-motor-gearbox.png' },
        { label: 'Side Assembly', image: '/images/conveyor-drive-mounted.png' }
      ],
      description: 'Medium industrial helical-bevel gearmotor for continuous packaging.'
    },
    'motor-003': {
      id: 'motor-003',
      name: 'Motor 3 (0.75 kW)',
      model: 'ALU-M075-HD',
      powerKw: 0.75,
      torqueNm: 98,
      ratio: '1:25',
      primaryImage: '/images/conveyor-drive-mounted.png',
      views: [
        { label: 'Heavy Drive', image: '/images/conveyor-drive-mounted.png' },
        { label: 'Flanged Motor', image: '/images/conveyor-motor-gearbox.png' },
        { label: 'Reverse Side', image: '/images/conveyor-drive-unit-2.png' }
      ],
      description: 'Heavy-duty high-torque drive for maximum weight accumulation.'
    }
  },

  chains: {
    steel: {
      id: 'steel',
      name: 'Carbon Steel Chain',
      material: 'Hardened Carbon Steel',
      primaryImage: '/images/conveyor-modular-chain-link.png',
      pitchMm: 38.1,
      maxTensileForceN: 4200,
      description: 'High-wear steel link system for abrasive and heavy mechanical components.'
    },
    'stainless-steel': {
      id: 'stainless-steel',
      name: 'Stainless Steel Chain',
      material: 'AISI 304 / 316 Stainless',
      primaryImage: '/images/conveyor-modular-chain-link.png',
      pitchMm: 38.1,
      maxTensileForceN: 3800,
      description: 'Corrosion-resistant washdown chain for chemical, pharmaceutical and food transfer.'
    },
    plastic: {
      id: 'plastic',
      name: 'POM Thermoplastic Chain',
      material: 'Polyacetal (POM) Low Friction',
      primaryImage: '/images/conveyor-modular-chain-link.png',
      pitchMm: 38.1,
      maxTensileForceN: 1850,
      description: 'Ultra-low friction modular chain engineered for high speed, low noise and clean environments.'
    }
  },

  sprockets: {
    drive: {
      id: 'sprocket-drive',
      name: 'Drive Sprocket Wheel',
      primaryImage: '/images/conveyor-drive-unit-1.png',
      description: 'Machined driven sprocket teeth ensuring positive engagement with modular links.'
    },
    idler: {
      id: 'sprocket-idler',
      name: 'Return Idler Sprocket',
      primaryImage: '/images/conveyor-idler-end-sprocket.png',
      description: 'Internal guide return sprocket assembly ensuring smooth chain return loop.'
    },
    bracket: {
      id: 'idler-bracket',
      name: 'Idler Shaft Bracket',
      primaryImage: '/images/conveyor-idler-end-bracket.png',
      description: 'High-rigidity return end bracket housing with steel driven shaft.'
    }
  },

  supports: {
    fixed: {
      id: 'fixed',
      name: 'Fixed T-Base Support Leg',
      primaryImage: '/images/conveyor-support-leg-assembly.png',
      views: [
        { label: 'Assembly', image: '/images/conveyor-support-leg-assembly.png' },
        { label: 'Column Post', image: '/images/conveyor-column-post.png' },
        { label: 'Leveling Foot', image: '/images/conveyor-leveling-foot-detail.png' }
      ],
      description: 'Rigid aluminium structural post anchored with dual articulated leveling pads.'
    },
    'mechanically-adjustable': {
      id: 'mechanically-adjustable',
      name: 'Telescoping Adjustable Stand',
      primaryImage: '/images/conveyor-support-stand.png',
      views: [
        { label: 'Stand Column', image: '/images/conveyor-support-stand.png' },
        { label: 'Leveling Base', image: '/images/conveyor-leveling-foot-base.png' },
        { label: 'Mounting Plate', image: '/images/conveyor-mounting-plate.png' }
      ],
      description: 'Slotted vertical extrusion column allowing manual height adjustment ±50 mm.'
    },
    'electrically-adjustable': {
      id: 'electrically-adjustable',
      name: 'Linear Actuator Support',
      primaryImage: '/images/conveyor-sensor-column-1.png',
      views: [
        { label: 'Actuator Column', image: '/images/conveyor-sensor-column-1.png' },
        { label: 'Power Module', image: '/images/conveyor-power-junction-box.png' }
      ],
      description: 'Automated height-adjustment column with integrated lead and cable interface.'
    },
    'without-support': {
      id: 'without-support',
      name: 'Direct Gantry Integration',
      primaryImage: '/images/conveyor-mounting-plate.png',
      views: [
        { label: 'Mounting Plate', image: '/images/conveyor-mounting-plate.png' }
      ],
      description: 'Framework supplied with base mounting plates for direct integration into machine structures.'
    },
    levelingFoot: {
      id: 'leveling-foot',
      name: 'Articulated Leveling Foot',
      primaryImage: '/images/conveyor-leveling-foot-detail.png',
      baseImage: '/images/conveyor-leveling-foot-base.png',
      description: 'Heavy-duty vulcanized rubber anti-vibration base with zinc-plated M16 threaded stud.'
    },
    mountingPlate: {
      id: 'mounting-plate',
      name: '3-Hole Structural Mounting Plate',
      primaryImage: '/images/conveyor-mounting-plate.png',
      description: 'CNC-machined structural base plate with counterbored T-slot fastening positions.'
    }
  },

  frames: {
    straight: {
      id: 'frame-straight',
      name: 'Straight Extruded Aluminium Beam',
      primaryImage: '/images/conveyor-straight-section.png',
      description: 'Heavy structural profile with dual T-slots and integrated wear strip channels.'
    },
    curve: {
      id: 'frame-curve',
      name: 'Curved Extruded Track Profile',
      primaryImage: '/images/conveyor-curve-track.png',
      description: 'Precision-bent extruded aluminium track with low-friction polymer guide wear strips.'
    }
  },

  electrical: {
    junctionBox: {
      id: 'power-box',
      name: 'Industrial Power / Control Box',
      primaryImage: '/images/conveyor-power-junction-box.png',
      description: 'Ruggedized power supply module with standard industrial 24V DC / AC terminal ports.'
    },
    sensorColumn: {
      id: 'sensor-column',
      name: 'Optical Sensor Bracket Column',
      primaryImage: '/images/conveyor-sensor-column-2.png',
      description: 'Height-adjustable column bracket for photoelectric sensors and product counters.'
    }
  },

  conveyors: {
    overview: '/images/conveyor-overview.png',
    loop: '/images/conveyor-loop.png',
    incline: '/images/conveyor-incline.png',
    station: '/images/conveyor-section-side.png'
  }
};

/**
 * Returns a thumbnail for a given BOM line item description
 */
export function getBOMItemThumbnail(itemName: string): string {
  const lower = itemName.toLowerCase();
  if (lower.includes('motor') || lower.includes('gearmotor') || lower.includes('drive unit')) {
    return '/images/conveyor-motor-gearbox.png';
  }
  if (lower.includes('chain') || lower.includes('belt') || lower.includes('pom') || lower.includes('steel link')) {
    return '/images/conveyor-modular-chain-link.png';
  }
  if (lower.includes('sprocket') || lower.includes('driven')) {
    return '/images/conveyor-idler-end-sprocket.png';
  }
  if (lower.includes('bracket') || lower.includes('idler shaft')) {
    return '/images/conveyor-idler-end-bracket.png';
  }
  if (lower.includes('support') || lower.includes('leg') || lower.includes('stand')) {
    return '/images/conveyor-support-leg-assembly.png';
  }
  if (lower.includes('foot') || lower.includes('feet') || lower.includes('pad')) {
    return '/images/conveyor-leveling-foot-detail.png';
  }
  if (lower.includes('curve') || lower.includes('track') || lower.includes('bend')) {
    return '/images/conveyor-curve-track.png';
  }
  if (lower.includes('guide')) {
    return '/images/conveyor-sensor-column-1.png';
  }
  if (lower.includes('profile') || lower.includes('beam') || lower.includes('extrusion') || lower.includes('frame')) {
    return '/images/conveyor-straight-section.png';
  }
  if (lower.includes('rail')) {
    return '/images/conveyor-sensor-column-1.png';
  }
  if (lower.includes('plate') || lower.includes('hardware')) {
    return '/images/conveyor-mounting-plate.png';
  }
  return '/images/conveyor-section-side.png';
}
