"""
Bill-of-materials and engineering-spec calculation.

Mirrors frontend/src/services/configurationService.ts so the server-side numbers agree with the UI.
Path length and curve radii come from CanonicalConveyorPath, the same path the STEP export is built on.
"""

import math
from typing import Any, Dict, List

from app.geometry import CanonicalConveyorPath

MAX_SPAN_MM = 2000.0


def _round2(x: float) -> float:
    # Match JavaScript Math.round (half up) so server and UI agree to the last digit.
    return math.floor(x * 100 + 0.5) / 100


def chain_pitch(width: float) -> float:
    return 25.4 if width <= 63.0 else (50.8 if width >= 190.5 else 38.1)


def max_tensile_force(width: float, chain_material: str) -> int:
    value = 1200 if width <= 63 else (2000 if width <= 82.5 else (3000 if width <= 114.3 else 4500))
    if chain_material == "stainless-steel":
        return round(value * 0.95)
    if chain_material == "plastic":
        return round(value * 0.8)
    return value


def curve_radius(curve: Any, width: float) -> float:
    radius = getattr(curve, "radius", None)
    if radius and radius > 0:
        return float(radius)
    return 200.0 if curve.curveType == "wheelband" else max(500.0, width * 4.0)


def _stands_for_straight(start: float, length: float, inset_start: float, inset_end: float) -> List[float]:
    a = start + inset_start
    b = start + length - inset_end
    if b - a < 300:
        return [start + length / 2]
    out = [a]
    span = b - a
    if span > MAX_SPAN_MM:
        num_inter = int(span // MAX_SPAN_MM)
        step = span / (num_inter + 1)
        out.extend(a + k * step for k in range(1, num_inter + 1))
    out.append(b)
    return out


def support_leg_positions(config: Any, path: CanonicalConveyorPath) -> List[int]:
    wh = config.workingHeight
    if not wh.enabled or wh.type == "without-support":
        return []

    if config.shape != "curved" or not config.curves:
        total = config.length
        if total <= 600:
            return [round(total / 2)]
        infeed = min(250.0, total * 0.2)
        drive = max(infeed + 300.0, total - 280.0)
        middle = drive - infeed
        positions = [infeed]
        if middle > MAX_SPAN_MM:
            num_inter = int(middle // MAX_SPAN_MM)
            step = middle / (num_inter + 1)
            positions.extend(infeed + k * step for k in range(1, num_inter + 1))
        positions.append(drive)
        return [round(p) for p in positions]

    positions: List[float] = []
    last_idx = len(path.segments) - 1
    for idx, seg in enumerate(path.segments):
        if seg.seg_type != "straight":
            continue
        if idx == last_idx:
            positions += _stands_for_straight(seg.start_distance, seg.length, min(120.0, seg.length * 0.15), min(280.0, seg.length * 0.25))
        else:
            positions += _stands_for_straight(seg.start_distance, seg.length, min(250.0, seg.length * 0.25), min(120.0, seg.length * 0.15))

    positions.sort()
    filtered: List[int] = []
    for pos in positions:
        if not filtered or pos - filtered[-1] >= 200:
            filtered.append(round(pos))
    return filtered


_DRIVE_POSITIONS = {
    "start-left": "Infeed • Left", "start-right": "Infeed • Right",
    "end-left": "Discharge • Left", "end-right": "Discharge • Right",
    "left": "Head • Left", "right": "Head • Right",
    "reductor-left": "Reductor • Left", "reductor-right": "Reductor • Right",
    "below-belt-start": "Underslung • Start", "below-belt-end": "Underslung • End",
    "end": "Discharge End", "beginning": "Infeed Head",
}

_FOOT_TYPES = {
    "wheel-with-brake": "Braked Wheels", "wheel-without-brake": "Caster Wheels",
    "base-plate": "Base Plate", "anchor-angle": "Anchor Angle",
    "fixed": "Fixed Foot", "adjustable": "Leveling Foot",
}


def format_drive_position(pos: str) -> str:
    return _DRIVE_POSITIONS.get(pos, pos.replace("-", " ").upper())


def foot_description(foot_type: Any) -> str:
    return f"with {_FOOT_TYPES.get(foot_type, 'Articulated Foot')}"


def calculate(config: Any) -> Dict[str, Any]:
    path = CanonicalConveyorPath(config)
    path_length = path.total_length
    legs = support_leg_positions(config, path)
    num_legs = len(legs)

    # Built from the client's exact CAD parts: the stand count follows the real model
    from app.step_compose import build_layout, family_params
    exact_params, _ = family_params(config)
    exact_layout = build_layout(exact_params)
    num_legs = exact_layout.legs

    pitch = chain_pitch(config.width)
    chain_links = math.ceil((path_length * 2) / pitch) + 12

    mat_names = {
        "steel": "Steel Chain Link",
        "stainless-steel": "Stainless Steel (AISI 304) Chain Link",
        "plastic": "Plastic Modular (POM) Chain Link",
    }
    chain_label = f"{mat_names.get(config.chainMaterial, 'Chain Link')} {config.width}mm"
    sprockets = 2 if config.width < 200 else (3 if config.width < 300 else 4)
    profile_meters = _round2((path_length * 2 / 1000.0) + (config.width / 1000.0 * (num_legs + 2)))
    slide_rail_meters = _round2(path_length * 4 / 1000.0)

    pos = format_drive_position(config.drivePosition)
    if config.driveKind == "reductor":
        drive_name = f"Reductor Drive Unit ({pos})"
    elif config.driveKind == "normal":
        drive_name = f"Direct Motor Head ({pos})"
    else:
        drive_name = f"Geared Motor: {config.motor.name if config.motor else 'Motor 1'} ({pos})"

    bom: List[Dict[str, Any]] = [
        {"item": chain_label, "quantity": chain_links, "unit": "pcs"},
        {"item": f"Drive Sprocket {config.width}mm (Z=16)", "quantity": sprockets, "unit": "pcs"},
        {"item": f"Idler Sprocket Set {config.width}mm", "quantity": sprockets, "unit": "pcs"},
        {"item": f"Anodized Aluminium Profile Frame {config.width}mm", "quantity": profile_meters, "unit": "m"},
        {"item": "Slide Rail PE-UHMW Low-Friction", "quantity": slide_rail_meters, "unit": "m"},
        {"item": drive_name, "quantity": 1, "unit": "set"},
    ]

    if num_legs > 0:
        wh = config.workingHeight
        leg_base = (
            "Adjustable Support Leg Assembly"
            if (wh.heightMode == "adjustable" or wh.type == "mechanically-adjustable")
            else "Fixed Support Leg Assembly"
        )
        bom.append({
            "item": f"{leg_base} {foot_description(wh.footType)} ({int(wh.height)}mm)",
            "quantity": num_legs,
            "unit": "sets",
        })

    if config.sideGuides:
        sg = config.sideGuides[0]
        bom.append({"item": f"Side Guide Profile (Type {sg.type})", "quantity": _round2(path_length * 2 / 1000.0), "unit": "m"})
        bom.append({"item": f"Side Guide Clamping Brackets (Type {sg.type})", "quantity": max(4, math.ceil(path_length / 600.0) * 2), "unit": "pcs"})

    if config.shape == "curved" and config.curves:
        for curve in config.curves:
            label = "Wheel Bend" if curve.curveType == "wheelband" else "Normal Curve Bend"
            bom.append({
                "item": f"{label} {round(curve.angle)}° (R={round(curve_radius(curve, config.width))}mm, {curve.direction.upper()})",
                "quantity": 1,
                "unit": "unit",
            })

    motor_kw = config.motor.powerKw if (config.motor and config.motor.powerKw) else 0.37
    max_spacing = round(exact_layout.max_span, 1) if num_legs else 0.0

    specs = {
        "total_path_length_mm": round(path_length, 1),
        "track_width_mm": config.width,
        "chain_pitch_mm": pitch,
        "working_height_mm": config.workingHeight.height if (config.workingHeight.enabled and config.workingHeight.type != "without-support") else 0,
        "max_tensile_force_n": max_tensile_force(config.width, config.chainMaterial),
        "recommended_motor_power_kw": motor_kw,
        "total_weight_kg_est": round(25 + (path_length / 1000.0) * (8 + config.width * 0.04) + num_legs * 6 + (motor_kw * 12), 1),
        "support_legs_count": num_legs,
        "support_max_spacing_mm": max_spacing,
    }
    return {"bom": bom, "specifications": specs}
