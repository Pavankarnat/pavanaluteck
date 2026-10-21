from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional, Literal
import math
import io
import os
import threading

from app.cad_step_builder import build_cad_conveyor_step
from app.step_validator import StepValidator
from app.bom import calculate as calculate_bom_and_specs, curve_radius
from app.step_compose import build_layout, family_params

app = FastAPI(
    title="TEDES / ALUFLEX Conveyor Configurator API",
    description="Backend API supporting the TEDES 3D Parametric Conveyor Configurator",
    version="2.0.0"
)

# CORS: restrict to known frontends (override with CORS_ORIGINS="https://a.com,https://b.com").
# By default only the local Vite dev server (5173, or the next free port when 5173 is taken) is allowed.
_cors_env = os.environ.get("CORS_ORIGINS", "").strip()
ALLOWED_ORIGINS = [o.strip() for o in _cors_env.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=None if ALLOWED_ORIGINS else r"^http://(localhost|127\.0\.0\.1):51[7-9]\d$",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
    expose_headers=["X-Cad-Mode", "X-Cad-Reasons", "Content-Disposition"],
)

# Materials Database
MATERIALS = [
    {
        "id": "steel",
        "name": "Steel Chain",
        "icon": "Shield",
        "description": "Designed for heavy-duty, high-temperature, and abrasive industrial environments. Maximum durability and load capacity.",
        "status": "available"
    },
    {
        "id": "stainless-steel",
        "name": "Stainless Steel Chain",
        "icon": "Sparkles",
        "description": "Corrosion-resistant AISI 304/316 construction for food, pharmaceutical, and washdown chemical environments.",
        "status": "available"
    },
    {
        "id": "plastic",
        "name": "Plastic Chain (POM)",
        "icon": "Layers",
        "description": "Low-friction, lightweight engineering polyacetal for high-speed container handling, cleanrooms, and smooth transport.",
        "status": "available"
    }
]

# Standard Widths Per Material Catalog
WIDTHS = {
    "steel": [
        {"id": "63", "width": 63.0, "unit": "mm", "max_load": 150, "max_speed": 50, "description": "Compact track for lightweight, precision part handling.", "price_factor": 1.0},
        {"id": "82.5", "width": 82.5, "unit": "mm", "max_load": 220, "max_speed": 45, "description": "Standard industrial width option for general components.", "price_factor": 1.2},
        {"id": "114.3", "width": 114.3, "unit": "mm", "max_load": 350, "max_speed": 40, "description": "Wide track design for bulk materials and heavy assemblies.", "price_factor": 1.5},
        {"id": "190.5", "width": 190.5, "unit": "mm", "max_load": 500, "max_speed": 30, "description": "Heavy-duty width for large palettes and extreme weights.", "price_factor": 2.1}
    ],
    "stainless-steel": [
        {"id": "63", "width": 63.0, "unit": "mm", "max_load": 140, "max_speed": 50, "description": "Hygienic compact track for pharmaceutical/food vials.", "price_factor": 1.4},
        {"id": "82.5", "width": 82.5, "unit": "mm", "max_load": 200, "max_speed": 45, "description": "Standard stainless width for bottling and food packaging.", "price_factor": 1.6},
        {"id": "114.3", "width": 114.3, "unit": "mm", "max_load": 320, "max_speed": 40, "description": "Wide stainless track for washdown food trays.", "price_factor": 2.0},
        {"id": "190.5", "width": 190.5, "unit": "mm", "max_load": 460, "max_speed": 30, "description": "Heavy-duty stainless track for chemical drums and crates.", "price_factor": 2.8}
    ],
    "plastic": [
        {"id": "63", "width": 63.0, "unit": "mm", "max_load": 100, "max_speed": 60, "description": "Lightweight, ultra-quiet compact conveyor track.", "price_factor": 0.85},
        {"id": "82.5", "width": 82.5, "unit": "mm", "max_load": 150, "max_speed": 55, "description": "Standard low-friction track for cartons and cans.", "price_factor": 1.0},
        {"id": "114.3", "width": 114.3, "unit": "mm", "max_load": 220, "max_speed": 50, "description": "Wide modular plastic chain track.", "price_factor": 1.3},
        {"id": "190.5", "width": 190.5, "unit": "mm", "max_load": 320, "max_speed": 45, "description": "Heavy-duty plastic modular belt.", "price_factor": 1.7},
        {"id": "254", "width": 254.0, "unit": "mm", "max_load": 400, "max_speed": 40, "description": "Extra-wide plastic belt for multi-lane accumulation.", "price_factor": 2.3},
        {"id": "304.8", "width": 304.8, "unit": "mm", "max_load": 480, "max_speed": 35, "description": "Maximum width plastic conveyor for totes and boxes.", "price_factor": 2.9}
    ]
}

# Standard Conveyor Reference Specs
CONVEYORS = {
    "63": {
        "width": 63.0,
        "pitch": 25.4,
        "material": "steel",
        "min_radius": 150,
        "max_tensile_strength": 1200,
        "cad_model_placeholder": "TEDES_ST_63_PARAMETRIC",
        "bom_preview": [
            {"item": "Steel Chain Link 63mm", "quantity": 80, "unit": "pcs"},
            {"item": "Drive Sprocket 63mm", "quantity": 2, "unit": "pcs"},
            {"item": "Aluminium Profile Frame 63mm", "quantity": 4, "unit": "m"},
            {"item": "Slide Rail (PE-UHMW)", "quantity": 8, "unit": "m"}
        ]
    },
    "82.5": {
        "width": 82.5,
        "pitch": 38.1,
        "material": "steel",
        "min_radius": 200,
        "max_tensile_strength": 2000,
        "cad_model_placeholder": "TEDES_ST_82_PARAMETRIC",
        "bom_preview": [
            {"item": "Steel Chain Link 82.5mm", "quantity": 80, "unit": "pcs"},
            {"item": "Drive Sprocket 82.5mm", "quantity": 2, "unit": "pcs"},
            {"item": "Aluminium Profile Frame 82.5mm", "quantity": 4, "unit": "m"},
            {"item": "Slide Rail (PE-UHMW)", "quantity": 8, "unit": "m"}
        ]
    },
    "114.3": {
        "width": 114.3,
        "pitch": 38.1,
        "material": "steel",
        "min_radius": 250,
        "max_tensile_strength": 3000,
        "cad_model_placeholder": "TEDES_ST_114_PARAMETRIC",
        "bom_preview": [
            {"item": "Steel Chain Link 114.3mm", "quantity": 80, "unit": "pcs"},
            {"item": "Drive Sprocket 114.3mm", "quantity": 2, "unit": "pcs"},
            {"item": "Aluminium Profile Frame 114.3mm", "quantity": 4, "unit": "m"},
            {"item": "Slide Rail (PE-UHMW)", "quantity": 8, "unit": "m"}
        ]
    },
    "190.5": {
        "width": 190.5,
        "pitch": 50.8,
        "material": "steel",
        "min_radius": 350,
        "max_tensile_strength": 4500,
        "cad_model_placeholder": "TEDES_ST_190_PARAMETRIC",
        "bom_preview": [
            {"item": "Steel Chain Link 190.5mm", "quantity": 80, "unit": "pcs"},
            {"item": "Drive Sprocket 190.5mm", "quantity": 2, "unit": "pcs"},
            {"item": "Aluminium Profile Frame 190.5mm", "quantity": 4, "unit": "m"},
            {"item": "Slide Rail (PE-UHMW)", "quantity": 8, "unit": "m"}
        ]
    },
    "254": {
        "width": 254.0,
        "pitch": 50.8,
        "material": "plastic",
        "min_radius": 400,
        "max_tensile_strength": 5000,
        "cad_model_placeholder": "TEDES_PL_254_PARAMETRIC",
        "bom_preview": [
            {"item": "Plastic Chain Module 254mm", "quantity": 80, "unit": "pcs"},
            {"item": "Drive Sprocket 254mm", "quantity": 3, "unit": "pcs"},
            {"item": "Aluminium Profile Frame 254mm", "quantity": 4, "unit": "m"},
            {"item": "Slide Rail (PE-UHMW)", "quantity": 8, "unit": "m"}
        ]
    },
    "304.8": {
        "width": 304.8,
        "pitch": 50.8,
        "material": "plastic",
        "min_radius": 500,
        "max_tensile_strength": 6000,
        "cad_model_placeholder": "TEDES_PL_304_PARAMETRIC",
        "bom_preview": [
            {"item": "Plastic Chain Module 304.8mm", "quantity": 80, "unit": "pcs"},
            {"item": "Drive Sprocket 304.8mm", "quantity": 4, "unit": "pcs"},
            {"item": "Aluminium Profile Frame 304.8mm", "quantity": 4, "unit": "m"},
            {"item": "Slide Rail (PE-UHMW)", "quantity": 8, "unit": "m"}
        ]
    }
}

# --- Pydantic Data Models ---
class WorkingHeightConfig(BaseModel):
    enabled: bool = True
    type: str = "fixed"  # fixed, mechanically-adjustable, electrically-adjustable, without-support
    height: float = Field(850.0, ge=0, le=5000)
    heightMode: Optional[str] = "fixed"
    footType: Optional[str] = "adjustable"

class CurveConfig(BaseModel):
    id: Optional[str] = None
    curveType: Literal["friction", "wheelband"] = "friction"
    angle: float = Field(90.0, gt=0, le=360)
    radius: Optional[float] = Field(None, gt=0, le=10000)  # None -> default by curve type / width
    offset: float = Field(1500.0, ge=0, le=100000)
    direction: Literal["left", "right"] = "left"
    distanceFromPrevious: Optional[float] = None

class SideGuideConfig(BaseModel):
    type: str = "904516"  # 904516, 904515
    widthBetweenGuides: float = Field(100.0, gt=0, le=1000)
    heightAboveChain: float = Field(60.0, ge=0, le=1000)
    bottomClearanceGap: Optional[float] = Field(15.0, ge=0, le=300)

class MotorConfig(BaseModel):
    id: str = "motor-001"
    name: str = "Motor 1 (0.37 kW)"
    powerKw: float = 0.37
    torqueNm: float = 35.0
    description: Optional[str] = None

class ConveyorConfigurationModel(BaseModel):
    language: str = "en"
    chainMaterial: Literal["plastic", "steel", "stainless-steel"] = "steel"
    width: float = Field(82.5, gt=0, le=1000)
    loadPerMeter: float = Field(50.0, ge=0, le=1000)
    length: float = Field(3000.0, gt=0, le=50000)
    drivePosition: str = "left"  # start-left, start-right, end-left, end-right, left, right
    driveKind: Optional[str] = "normal"  # normal, reductor, central
    engineAngle: Optional[str] = "down"  # up, down, beside-front, beside-rear
    driveMountType: Optional[str] = "fixed"
    endHorizontalPathLength: Optional[float] = Field(None, ge=0, le=50000)  # None -> 35 % of length (min 400)
    travelDirection: Optional[str] = "forward"
    motor: Optional[MotorConfig] = Field(default_factory=MotorConfig)
    workingHeight: WorkingHeightConfig = Field(default_factory=WorkingHeightConfig)
    shape: Literal["straight", "curved"] = "straight"
    curves: List[CurveConfig] = Field(default_factory=list, max_length=10)
    sideGuides: Optional[List[SideGuideConfig]] = Field(default=None, max_length=10)
    presetId: Optional[str] = None
    isClientReferencePreset: Optional[bool] = False

@app.get("/")
def read_root():
    return {
        "service": "TEDES Parametric 3D Conveyor Configurator API",
        "version": "2.0.0",
        "status": "operational"
    }

@app.get("/api/v1/materials")
def get_materials():
    return MATERIALS

@app.get("/api/v1/materials/{material}/widths")
def get_widths(material: str):
    if material not in WIDTHS:
        raise HTTPException(status_code=404, detail="Material not found")
    return WIDTHS[material]

@app.get("/api/v1/conveyor/reference-match-report")
def get_reference_match_report():
    import shutil
    import tempfile
    from app.geometry_comparator import StepGeometryComparator
    from app.step_compose import REFERENCE_STEP
    # Reports go to a writable temp folder (the container user cannot write next to the code); the "generated"
    # reference-match model is the reference file itself.
    out_dir = os.path.join(tempfile.gettempdir(), "aluflex_reports")
    os.makedirs(out_dir, exist_ok=True)
    ref_path = REFERENCE_STEP
    match_path = os.path.join(out_dir, "ALUFLEX_CONVEYOR_REFERENCE_MATCH.step")
    if not os.path.exists(match_path):
        shutil.copyfile(ref_path, match_path)
    workspace_dir = out_dir

    comparator = StepGeometryComparator(ref_path, match_path)
    reports = comparator.generate_reports(out_dir)
    def _public(summary):
        return {k: v for k, v in summary.items() if k != "filepath"}

    return {
        "status": "success",
        "note": "The generated reference-match model is the reference STEP itself, so this report is a file-integrity check, not an independent geometry comparison.",
        "reference_summary": _public(comparator.ref_data),
        "match_summary": _public(comparator.gen_data),
        "reports": {k: os.path.basename(v) for k, v in reports.items()}
    }

@app.get("/api/v1/conveyor/{width}")
def get_conveyor_details(width: str):
    # Support both integer/float string match
    matched = CONVEYORS.get(width)
    if not matched:
        # Try finding closest width
        try:
            w_float = float(width)
            for k, v in CONVEYORS.items():
                if abs(float(k) - w_float) < 0.5:
                    matched = v
                    break
        except ValueError:
            pass
    if not matched:
        raise HTTPException(status_code=404, detail="Conveyor specifications not found for this width")
    return matched

@app.post("/api/v1/conveyor/validate")
def validate_conveyor(config: ConveyorConfigurationModel):
    errors: List[str] = []
    warnings: List[str] = []

    # 1. Length validation (600 - 12000 mm)
    if config.length < 600:
        errors.append(f"Conveyor length ({config.length} mm) is below the minimum engineering limit of 600 mm.")
    elif config.length > 12000:
        errors.append(f"Conveyor length ({config.length} mm) exceeds the maximum structural limit of 12000 mm.")

    # 2. Load validation (<= 125 kg/m)
    if config.loadPerMeter > 125:
        errors.append(f"Load per meter ({config.loadPerMeter} kg/m) exceeds maximum allowable limit of 125 kg/m.")
    elif config.loadPerMeter > 90:
        warnings.append("High load configuration (>90 kg/m). Consider reinforced drive torque and heavy-duty wear rails.")

    # 3. Material & Width compatibility
    if config.chainMaterial in ["steel", "stainless-steel"] and config.width > 190.5:
        errors.append(f"{config.chainMaterial.title()} chain is not supported for widths above 190.5 mm. Select Plastic POM chain for widths >= 254 mm.")

    # 4. Curves validation
    if config.shape == "curved":
        if not config.curves or len(config.curves) == 0:
            warnings.append("Curved shape selected, but no curves are defined. Falling back to straight path.")
        elif len(config.curves) > 5:
            errors.append("Maximum 5 curves supported in standard modular configuration.")

        for i, curve in enumerate(config.curves):
            if curve.curveType == "friction":
                if curve.angle < 20 or curve.angle > 180:
                    errors.append(f"Curve {i+1} angle ({curve.angle}°) must be between 20° and 180° for friction curves.")
            min_radius = config.width / 2 + 25
            if curve_radius(curve, config.width) < min_radius:
                errors.append(f"Curve {i+1} radius ({curve_radius(curve, config.width):.0f} mm) is too small for a {config.width} mm chain. Minimum is {min_radius:.0f} mm.")

            if curve.curveType == "wheelband":
                if curve.angle not in [90.0, 180.0]:
                    errors.append(f"Curve {i+1} Wheelband type only supports standard 90° or 180° angles (centre radius 200 mm).")

    # 5. Working height validation
    if config.workingHeight.enabled and config.workingHeight.type != "without-support":
        if config.workingHeight.height < 400:
            errors.append(f"Working height ({config.workingHeight.height} mm) is below the minimum 400 mm ground clearance.")
        elif config.workingHeight.height > 2000:
            errors.append(f"Working height ({config.workingHeight.height} mm) exceeds standard support height limit of 2000 mm.")

    # 6. Side guides validation
    if config.sideGuides:
        for i, sg in enumerate(config.sideGuides):
            if sg.widthBetweenGuides < config.width:
                warnings.append(f"Side guide width ({sg.widthBetweenGuides} mm) is narrower than conveyor track width ({config.width} mm).")

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings
    }

@app.post("/api/v1/conveyor/calculate-bom")
def calculate_bom(config: ConveyorConfigurationModel):
    return calculate_bom_and_specs(config)


@app.post("/api/v1/conveyor/layout")
def get_conveyor_layout(config: ConveyorConfigurationModel):
    """How the client's exact CAD parts are arranged for this configuration (the 3D view applies the same edits
    that the STEP export applies). `exact` is false when the real parts cannot express the configuration."""
    params, notes = family_params(config)
    return {"exact": True, "reasons": notes, "notes": notes, "layout": build_layout(params).to_json()}


# STEP generation is CPU-heavy: validate first and cap concurrent builds.
_STEP_SLOTS = threading.BoundedSemaphore(2)


@app.post("/api/v1/conveyor/step")
def get_conveyor_step(config: ConveyorConfigurationModel):
    check = validate_conveyor(config)
    if not check["valid"]:
        raise HTTPException(status_code=422, detail=check["errors"])

    if not _STEP_SLOTS.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="STEP generator is busy, please retry shortly.")
    try:
        # Canonical CAD Solid BREP STEP generation with high-fidelity assembly components
        step_content = build_cad_conveyor_step(config)
        _params, reasons = family_params(config)
    finally:
        _STEP_SLOTS.release()

    filename = f"ALUFLEX_CONVEYOR_{config.chainMaterial}_{config.width:g}mm_{int(config.length)}mm.step"
    raw_bytes = step_content.encode("latin-1", errors="replace")

    return Response(
        content=raw_bytes,
        media_type="application/step",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Cad-Mode": "exact",
            "X-Cad-Reasons": "; ".join(reasons).encode("ascii", "replace").decode(),
            "Content-Length": str(len(raw_bytes))
        }
    )
