import * as THREE from 'three';
import { ChainMaterial } from '../../types/conveyor';

export class ConveyorMaterials {
  private static instance: ConveyorMaterials;

  // Aluminum Frame Materials
  public aluminumProfile: THREE.MeshStandardMaterial;
  public aluminumProfileDark: THREE.MeshStandardMaterial;
  public aluminumProfileWireframe: THREE.MeshBasicMaterial;

  // Chain Materials
  public steelChain: THREE.MeshStandardMaterial;
  public stainlessSteelChain: THREE.MeshStandardMaterial;
  public plasticPomChain: THREE.MeshStandardMaterial;
  public plasticPomBlueChain: THREE.MeshStandardMaterial;

  // Drive & Hardware Materials
  public motorBody: THREE.MeshStandardMaterial;
  public motorFan: THREE.MeshStandardMaterial;
  public gearboxHousing: THREE.MeshStandardMaterial;
  public sprocketSteel: THREE.MeshStandardMaterial;
  public zincHardware: THREE.MeshStandardMaterial;
  public yellowAccent: THREE.MeshStandardMaterial;

  // Rails & Plastic Components
  public peUhmwWearStrip: THREE.MeshStandardMaterial;
  public peUhmwGreen: THREE.MeshStandardMaterial;
  public sideGuidePlastic: THREE.MeshStandardMaterial;
  public sideGuideBracket: THREE.MeshStandardMaterial;
  public whiteCheekPlate: THREE.MeshStandardMaterial;
  public driveMountingPlateBlack: THREE.MeshStandardMaterial;
  public darkRampWedge: THREE.MeshStandardMaterial;
  public darkSprocket: THREE.MeshStandardMaterial;

  // Support Legs Materials
  public legProfile: THREE.MeshStandardMaterial;
  public legFootRubber: THREE.MeshStandardMaterial;
  public legSteelBracket: THREE.MeshStandardMaterial;
  public electricActuatorSilver: THREE.MeshStandardMaterial;

  // Dimension & CAD Visuals
  public dimensionLine: THREE.LineBasicMaterial;
  public dimensionTextBg: THREE.MeshBasicMaterial;

  private constructor() {
    const loader = new THREE.TextureLoader();

    // 1. Modular Chain Link Texture (ALUTEC KK Real CAD Asset)
    const chainTexture = loader.load('/images/conveyor-modular-chain-link.png');
    chainTexture.wrapS = THREE.RepeatWrapping;
    chainTexture.wrapT = THREE.RepeatWrapping;
    chainTexture.repeat.set(1, 1);
    chainTexture.colorSpace = THREE.SRGBColorSpace;

    // 2. Extruded Aluminium Profile Texture (ALUTEC KK Real CAD Asset)
    const profileTexture = loader.load('/images/conveyor-straight-section.png');
    profileTexture.wrapS = THREE.RepeatWrapping;
    profileTexture.wrapT = THREE.ClampToEdgeWrapping;
    profileTexture.repeat.set(1, 1);
    profileTexture.colorSpace = THREE.SRGBColorSpace;

    // 3. Column Extrusion Post Texture (ALUTEC KK Real CAD Asset)
    const colTexture = loader.load('/images/conveyor-column-post.png');
    colTexture.wrapS = THREE.RepeatWrapping;
    colTexture.wrapT = THREE.RepeatWrapping;
    colTexture.repeat.set(1, 4);
    colTexture.colorSpace = THREE.SRGBColorSpace;

    // 4. Bracket Texture (ALUTEC KK Real CAD Asset)
    const bracketTexture = loader.load('/images/conveyor-idler-end-bracket.png');
    bracketTexture.colorSpace = THREE.SRGBColorSpace;

    // 5. Sprocket Texture (ALUTEC KK Real CAD Asset)
    const sprocketTexture = loader.load('/images/conveyor-idler-end-sprocket.png');
    sprocketTexture.colorSpace = THREE.SRGBColorSpace;

    // 6. Leveling Foot Texture (ALUTEC KK Real CAD Asset)
    const footTexture = loader.load('/images/conveyor-leveling-foot-detail.png');
    footTexture.colorSpace = THREE.SRGBColorSpace;

    // 7. Base Plate Texture (ALUTEC KK Real CAD Asset)
    const plateTexture = loader.load('/images/conveyor-mounting-plate.png');
    plateTexture.colorSpace = THREE.SRGBColorSpace;

    // 1. Aluminum Frame
    this.aluminumProfile = new THREE.MeshStandardMaterial({
      map: profileTexture,
      color: 0xf1f5f9, // Clean Anodized Structural Aluminum
      metalness: 0.65,
      roughness: 0.35,
      name: 'Aluminum_Anodized'
    });

    this.aluminumProfileDark = new THREE.MeshStandardMaterial({
      map: profileTexture,
      color: 0x94a3b8,
      metalness: 0.65,
      roughness: 0.4,
      name: 'Aluminum_Dark'
    });

    this.aluminumProfileWireframe = new THREE.MeshBasicMaterial({
      color: 0x00d4ff,
      wireframe: true,
      name: 'CAD_Wireframe'
    });

    // 2. Chains - Textured with Real ALUTEC KK Modular Chain Link
    this.steelChain = new THREE.MeshStandardMaterial({
      map: chainTexture,
      color: 0x94a3b8, // Refined Carbon Steel with clear metallic specular
      metalness: 0.85,
      roughness: 0.28,
      name: 'Chain_Carbon_Steel'
    });

    this.stainlessSteelChain = new THREE.MeshStandardMaterial({
      map: chainTexture,
      color: 0xffffff, // Brushed AISI 304 Stainless Steel
      metalness: 0.94,
      roughness: 0.18,
      name: 'Chain_Stainless_Steel'
    });

    this.plasticPomChain = new THREE.MeshStandardMaterial({
      map: chainTexture,
      color: 0xd2bb94, // Authentic ALUFLEX Tan / Khaki POM-D (Image 2)
      metalness: 0.05,
      roughness: 0.35,
      name: 'Chain_Plastic_POM_Tan'
    });

    this.plasticPomBlueChain = new THREE.MeshStandardMaterial({
      map: chainTexture,
      color: 0x38bdf8, // FDA Blue Acetal
      metalness: 0.05,
      roughness: 0.38,
      name: 'Chain_Plastic_POM_Blue'
    });

    // 3. Drive & Mechanics (Image 1: Cast Aluminium Silver Motor & Gearbox)
    this.motorBody = new THREE.MeshStandardMaterial({
      color: 0xd8dce0, // Cast Aluminium Silver (Image 1)
      metalness: 0.72,
      roughness: 0.32,
      name: 'Motor_Body_Silver'
    });

    this.motorFan = new THREE.MeshStandardMaterial({
      color: 0xc8ccd2, // Cast Aluminium Silver Fan Cowl (Image 1)
      metalness: 0.7,
      roughness: 0.35,
      name: 'Motor_Fan_Silver'
    });

    this.gearboxHousing = new THREE.MeshStandardMaterial({
      color: 0xd8dce0, // Cast Aluminium Silver Worm Gearbox (Image 1)
      metalness: 0.75,
      roughness: 0.3,
      name: 'Gearbox_Cast_Aluminium'
    });

    this.sprocketSteel = new THREE.MeshStandardMaterial({
      map: sprocketTexture,
      color: 0xb0bec5,
      metalness: 0.88,
      roughness: 0.25,
      name: 'Sprocket_Machined_Steel'
    });

    this.zincHardware = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.75,
      roughness: 0.3,
      name: 'Zinc_Bolts'
    });

    this.yellowAccent = new THREE.MeshStandardMaterial({
      color: 0x334155, // Dark Anthracite Terminal Box (Image 1)
      metalness: 0.2,
      roughness: 0.5,
      name: 'Terminal_Box_Dark'
    });

    // 4. Slide Rails & Guides
    this.peUhmwWearStrip = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.0,
      roughness: 0.3,
      transparent: true,
      opacity: 0.9,
      name: 'PE_UHMW_Natural'
    });

    this.peUhmwGreen = new THREE.MeshStandardMaterial({
      color: 0x15803d, // Virgin UHMW Industrial Green (Image 4)
      metalness: 0.0,
      roughness: 0.35,
      name: 'PE_UHMW_Green'
    });

    this.sideGuidePlastic = new THREE.MeshStandardMaterial({
      color: 0x15803d, // Virgin UHMW Industrial Green Guide Rail (Image 4)
      metalness: 0.05,
      roughness: 0.35,
      name: 'Side_Guide_UHMW_Green'
    });

    this.sideGuideBracket = new THREE.MeshStandardMaterial({
      map: bracketTexture,
      color: 0xcbd5e1,
      metalness: 0.85,
      roughness: 0.25,
      name: 'Side_Guide_Stainless_Bracket'
    });

    this.whiteCheekPlate = new THREE.MeshStandardMaterial({
      color: 0xf3f4f6, // Off-white UHMW-PE (Image 1, 2, 3, 4)
      metalness: 0.05,
      roughness: 0.25,
      name: 'UHMW_White_Cheek'
    });

    this.driveMountingPlateBlack = new THREE.MeshStandardMaterial({
      color: 0x1e2229, // Matte Black Steel Drive Plate (Image 1, 2, 4)
      metalness: 0.85,
      roughness: 0.45,
      name: 'Drive_Plate_Black'
    });

    this.darkRampWedge = new THREE.MeshStandardMaterial({
      color: 0x1e293b, // Dark Anthracite Ramp Wedge (Image 3)
      metalness: 0.2,
      roughness: 0.6,
      name: 'Ramp_Wedge_Dark'
    });

    this.darkSprocket = new THREE.MeshStandardMaterial({
      color: 0x334155, // Dark Machined Sprocket (Image 3, 4)
      metalness: 0.8,
      roughness: 0.35,
      name: 'Sprocket_Dark'
    });

    // 5. Supports
    this.legProfile = new THREE.MeshStandardMaterial({
      map: colTexture,
      color: 0xe2e8f0,
      metalness: 0.8,
      roughness: 0.3,
      name: 'Leg_Aluminum_Profile'
    });

    this.legFootRubber = new THREE.MeshStandardMaterial({
      map: footTexture,
      color: 0x64748b,
      metalness: 0.1,
      roughness: 0.85,
      name: 'Leg_Leveling_Foot_Rubber'
    });

    this.legSteelBracket = new THREE.MeshStandardMaterial({
      map: bracketTexture,
      color: 0xcfd8dc,
      metalness: 0.8,
      roughness: 0.3,
      name: 'Leg_Steel_Footplate'
    });

    this.electricActuatorSilver = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.92,
      roughness: 0.18,
      name: 'Electric_Actuator_Cylinder'
    });

    // 6. Dimensions
    this.dimensionLine = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      linewidth: 1
    });

    this.dimensionTextBg = new THREE.MeshBasicMaterial({
      color: 0x0f172a,
      transparent: true,
      opacity: 0.85
    });
  }

  public static getInstance(): ConveyorMaterials {
    if (!ConveyorMaterials.instance) {
      ConveyorMaterials.instance = new ConveyorMaterials();
    }
    return ConveyorMaterials.instance;
  }

  /** All long-lived materials owned by this singleton; generators must never dispose these. */
  public getSharedMaterials(): Set<THREE.Material> {
    const shared = new Set<THREE.Material>();
    Object.values(this).forEach((v) => {
      if (v instanceof THREE.Material) shared.add(v);
    });
    return shared;
  }

  public getChainMaterial(material: ChainMaterial): THREE.MeshStandardMaterial {
    switch (material) {
      case 'stainless-steel':
        return this.stainlessSteelChain;
      case 'plastic':
        return this.plasticPomChain;
      case 'steel':
      default:
        return this.steelChain;
    }
  }
}
