# ALUFLEX CONVEYOR CONFIGURATOR - Architecture & Engineering Log

This document serves as the master architectural log, engineering specification, and component reference for the **TEDES / ALUFLEX Parametric 3D Conveyor Configurator**.

---

## 1. Technical Stack Overview

### Frontend
- **Framework**: React 18, TypeScript, Vite
- **3D / CAD Visualizer**: Three.js (WebGL 2.0 PBR Rendering Engine)
- **Styling**: Vanilla Tailwind CSS + Custom CAD Design Tokens (`cad-*`)
- **State & Data Fetching**: React Context, TanStack React Query, Axios
- **Iconography**: Lucide React
- **Routing**: React Router DOM (v6)
- **Effects & UI**: Canvas-Confetti, Custom Scrollbars, OrbitControls

### Backend
- **Framework**: FastAPI (Python 3.11)
- **Calculations**: Parametric BOM & Mechanical Sizing Engine
- **Deployment**: Docker Compose Multi-Stage Orchestration

---

## 2. System Architecture & Information Flow

```text
USER INPUT (Tabs: Dimensions, Drive, Supports, Curves, Guides)
       ↓
CENTRAL CONFIGURATION STATE (ConveyorConfiguration)
       ↓
ENGINEERING VALIDATION (ValidationService)
       ↓
CONVEYOR PATH CALCULATION (pathMath.ts Spline & Lateral Sampling)
       ↓
PARAMETRIC 3D GEOMETRY GENERATORS (ConveyorScene & Generators)
       ↓
3D ASSEMBLY & PBR LIGHTING (Three.js WebGL Viewport)
       ↓
SYNCHRONIZED DYNAMIC BOM & SPECIFICATIONS TABLE
```

---

## 3. Project Directory Structure

```text
ALUFLEX-CONVEYOR-CONFIGURATOR/
├── docker-compose.yml
├── .env.example
├── .gitignore
├── gemini.md
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       └── main.py (FastAPI endpoints: materials, widths, calculate-bom)
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── tailwind.config.js (CAD design tokens mapped to CSS variables)
    ├── index.html (Theme-reactive root document)
    └── src/
        ├── main.tsx (Application entry point)
        ├── App.tsx (Root router wrapped with ThemeProvider)
        ├── index.css (CAD Theme Variables, explicit card rules, input/slider styles)
        ├── types.ts (Legacy application types)
        ├── types/
        │   └── conveyor.ts (Parametric configuration interfaces & domain types)
        ├── context/
        │   └── ThemeContext.tsx (Persistent Dark/Light mode provider with localStorage)
        ├── services/
        │   ├── configurationService.ts (Dynamic BOM calculation & defaults)
        │   └── validationService.ts (Engineering rules & dimension validation)
        ├── components/
        │   ├── Layout.tsx (Responsive app layout wrapper)
        │   ├── Navbar.tsx (Brand header with Sun/Moon theme toggle)
        │   ├── Footer.tsx (Industrial footer with high-contrast links)
        │   ├── configurator/
        │   │   └── ParametricControls.tsx (5-tab parametric engineering sidebar)
        │   └── 3d/
        │       ├── ConveyorCanvas.tsx (React Three.js viewport wrapper & HUD toolbar)
        │       ├── ConveyorScene.ts (WebGL scene, studio lights, 8-corner frustum camera)
        │       ├── ConveyorGenerator.ts (Master assembly orchestrator)
        │       ├── ChainGenerator.ts (Parametric modular chain links & POM slats)
        │       ├── FrameGenerator.ts (Extruded aluminum side channels & cross-ties)
        │       ├── DriveGenerator.ts (Geared motor, worm gearbox & sprocket head)
        │       ├── SupportGenerator.ts (Telescoping H-frame support leg assemblies)
        │       ├── CurveGenerator.ts (Friction bends, wheelband curves & arc paths)
        │       ├── SideGuideGenerator.ts (Type 904516 & 904515 continuous guide rails)
        │       ├── FlowIndicatorGenerator.ts (Dynamic pulsing product flow arrows)
        │       ├── ProductGenerator.ts (Procedural demo packages: boxes, bottles, totes)
        │       ├── materials.ts (PBR materials: Aluminum 6063, Steel, Stainless, Acetal)
        │       ├── pathMath.ts (Spline mathematics, tangent calculations & offsets)
        │       └── cadAssetLoader.ts (STEP/GLTF CAD asset fallback loaders)
        └── pages/
            ├── LandingPage.tsx (Product landing & hero entry)
            └── ConfiguratorPage.tsx (Main 2-column CAD workspace & synchronized BOM)
```

---

## 4. 3D Parametric CAD Engine

### 8-Corner Frustum Camera Fitting
The visualizer utilizes closed-form projection math in `ConveyorScene.fitToView()` to guarantee that the conveyor model is **never clipped** on any side, regardless of length (600 mm – 12000 mm), curve bend angles (20° – 180°), or aspect ratio:
1. Calculates the exact axis-aligned bounding box (AABB) of the entire 3D hierarchy.
2. Projects all 8 bounding box corners onto the camera's local right, up, and view axes.
3. Computes the maximum required camera distance based on both horizontal and vertical fields of view with an 18% engineering safety margin.
4. Centers camera target at the exact geometric centroid of the model.

### Procedural Demo Products Simulation (`ProductGenerator.ts`)
- Accessible via the **`[ Products ]`** toolbar button in the 3D HUD.
- Procedurally instantiates 3 realistic industrial cargo types:
  1. **Kraft Corrugated Boxes**: Textured carton board with sealing tape and shipping labels.
  2. **Pharmaceutical Bottle Clusters**: Translucent amber and white bottles in trays.
  3. **Heavy Logistics Totes**: Reinforced polypropylene industrial handling crates.
- Packages automatically calculate trajectory along the parametric spline path in real time.

---

## 5. Dual-Theme CAD System

The application features two complete, dedicated theme profiles:

### Color Token Palette

| Token | Dark Mode (Default) | Light Mode |
| :--- | :--- | :--- |
| **Page Background** | `#0A1018` (Uniform, no page grid) | `#F3F5F7` (Uniform, no page grid) |
| **3D CAD Viewport** | `#121C27` + Three.js CAD Grid | `#E5E9ED` + Three.js CAD Grid |
| **Cards & Panels** | `#151F2B` (Solid opaque) | `#FFFFFF` (Solid opaque) |
| **Card Borders** | `1px solid #263445` | `1px solid #D5DCE3` |
| **Primary Text** | `#E8EEF5` | `#18212B` |
| **Secondary Text** | `#91A0B3` | `#596777` |
| **Primary Accent** | `#1683E8` | `#0B75D1` |
| **Success** | `#18B981` | `#159A68` |
| **Warning** | `#F0B429` | `#B77900` |
| **Row Dividing Lines** | `rgba(38, 52, 69, 0.6)` | `1px solid #D5DCE3` |
| **Slider Tracks** | `#243546` (8px bar with `#3B4D63` border) | `#D5DCE3` (8px bar with `#CBD5E1` border) |

### 3D Viewport Theme Invariance
Switching themes dynamically adjusts Three.js scene background color, exponential fog, studio lights, ground shadow opacity, and floor grid colors via `ConveyorScene.setTheme(theme)`. Physical conveyor geometry, materials, dimensions, and BOM calculations **never reset or reload**.

---

## 6. Dynamic Engineering Sizing & BOM Engine

`ConfigurationService` provides instant client-side calculation synchronized with parametric controls:

1. **Path Length**: Computes exact linear + arc centerline lengths based on straight segments and curves.
2. **Support Legs Rule**: Places double-leg H-frame supports at $\le 2500\text{ mm}$ maximum span intervals.
3. **Chain Pitch & Sizing**: Computes total chain link count based on standard $38.1\text{ mm}$ pitch.
4. **Drive Motor Sizing**: Evaluates load per meter ($5 - 125\text{ kg/m}$) and track length to recommend motor kilowatt rating ($0.25 - 0.75\text{ kW}$) and torque.
5. **Bill of Materials Breakdown**:
   - Modular Chain Links (PCS)
   - Drive & Idler Sprocket Sets (PCS)
   - Extruded Anodized Aluminum Frame Profiles (Meters)
   - PE-UHMW Low-Friction Slide Rails (Meters)
   - Geared Motor Drive Assembly (SET)
   - Telescoping Support Leg Assemblies (SETS)
   - Side Guide Continuous Profiles & Clamping Brackets (Meters / PCS)

---

## 7. Action Bar & Output Workflows

- **Export Configuration**: Generates a full parametric JSON configuration bundle.
- **Export CAD (.STEP)**: Queries the backend to dynamically construct and download a valid ISO-10303-21 `.step` file containing parametric shapes (cylinders for drive/idler drums, box for aluminum frame profile) based on the configured length, width, and material.
- **Copy Summary**: Formats an engineering summary string to clipboard.
- **Print / Quotation**: Triggers clean print-ready stylesheet output.
- **Reset**: Reverts all parameters to factory standard defaults.

