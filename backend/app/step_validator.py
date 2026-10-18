"""
CAD STEP Re-import & Engineering Validation Engine.
Re-imports the generated STEP AP214 file, parses the entity structure,
reconstructs the geometry and bounding box, and validates physical dimensions.
"""

import re
import math
from typing import Dict, Any, List, Tuple, Optional

from app.geometry import CanonicalConveyorPath, _get_val


class StepValidator:
    """
    Parses and geometrically validates a generated STEP file.
    """
    def __init__(self, step_content: str):
        self.step_content = step_content
        self.entities: Dict[str, Tuple[str, str]] = {} # id -> (type, params)
        self.points: List[Tuple[float, float, float]] = []
        self.solids: List[str] = []
        self.shells: List[str] = []
        self.faces: List[str] = []
        self._parse()

    def _parse(self):
        # Match entities like #123=TYPE(params);
        pattern = re.compile(r"#(\d+)\s*=\s*([A-Z0-9_]+)\s*\((.*)\);", re.DOTALL)
        lines = self.step_content.splitlines()

        current_entry = ""
        for line in lines:
            trimmed = line.strip()
            if not trimmed or trimmed.startswith("ISO") or trimmed in ["HEADER;", "ENDSEC;", "DATA;", "END-ISO-10303-21;"]:
                continue
            current_entry += trimmed
            if trimmed.endswith(";"):
                m = pattern.match(current_entry)
                if m:
                    eid = f"#{m.group(1)}"
                    etype = m.group(2)
                    eparams = m.group(3)
                    self.entities[eid] = (etype, eparams)
                    if etype == "CARTESIAN_POINT":
                        pt_match = re.search(r"\(\s*([-\d\.\+eE]+)\s*,\s*([-\d\.\+eE]+)\s*,\s*([-\d\.\+eE]+)\s*\)", eparams)
                        if pt_match:
                            try:
                                x = float(pt_match.group(1))
                                y = float(pt_match.group(2))
                                z = float(pt_match.group(3))
                                self.points.append((x, y, z))
                            except ValueError:
                                pass
                    elif etype == "MANIFOLD_SOLID_BREP":
                        self.solids.append(eid)
                    elif etype == "CLOSED_SHELL":
                        self.shells.append(eid)
                    elif etype == "ADVANCED_FACE":
                        self.faces.append(eid)
                current_entry = ""

    def get_solid_count(self) -> int:
        return len(self.solids)

    def get_face_count(self) -> int:
        return len(self.faces)

    def get_shell_count(self) -> int:
        return len(self.shells)

    def calculate_bounding_box(self) -> Dict[str, float]:
        if not self.points:
            return {"min_x": 0, "max_x": 0, "min_y": 0, "max_y": 0, "min_z": 0, "max_z": 0, "dx": 0, "dy": 0, "dz": 0}

        min_x = min(p[0] for p in self.points)
        max_x = max(p[0] for p in self.points)
        min_y = min(p[1] for p in self.points)
        max_y = max(p[1] for p in self.points)
        min_z = min(p[2] for p in self.points)
        max_z = max(p[2] for p in self.points)

        return {
            "min_x": round(min_x, 2),
            "max_x": round(max_x, 2),
            "min_y": round(min_y, 2),
            "max_y": round(max_y, 2),
            "min_z": round(min_z, 2),
            "max_z": round(max_z, 2),
            "dx": round(max_x - min_x, 2),
            "dy": round(max_y - min_y, 2),
            "dz": round(max_z - min_z, 2)
        }

    def validate_against_config(self, config: Any, tolerance_mm: float = 2.0) -> Dict[str, Any]:
        """
        Validates the re-imported STEP file against the configuration parameters.
        """
        bbox = self.calculate_bounding_box()
        solid_count = self.get_solid_count()
        errors = []
        passed_checks = []

        # 1. Solid count check
        if solid_count < 10:
            errors.append(f"Insufficient CAD solid bodies: found {solid_count}, expected >= 10.")
        else:
            passed_checks.append(f"Solid Bodies: {solid_count} manifold solids verified.")

        # 2. Shell closure check
        if len(self.shells) != solid_count:
            errors.append(f"Shell count mismatch: {len(self.shells)} shells vs {solid_count} solids.")
        else:
            passed_checks.append(f"Shell Integrity: {len(self.shells)} closed shells valid.")

        # 3. Working Height check
        wh = _get_val(config, 'workingHeight', None)
        wh_enabled = bool(_get_val(wh, 'enabled', True)) and _get_val(wh, 'type', 'fixed') != 'without-support'
        # Without supports the STEP builder uses its default 850 mm belt height.
        expected_h = float(_get_val(wh, 'height', 850.0)) if (wh and wh_enabled) else 850.0
        sg_list = _get_val(config, 'sideGuides', None) or []
        guide_extra = float(_get_val(sg_list[0], 'heightAboveChain', 60.0)) if sg_list else 0.0
        max_allowed_y = expected_h + 42.0 + guide_extra + 40.0 # 42mm chain + guide height + rod extension

        if bbox["min_y"] < -5.0:
            errors.append(f"Conveyor penetrates floor: min Y = {bbox['min_y']} mm.")
        else:
            passed_checks.append(f"Floor Boundary: min Y = {bbox['min_y']} mm >= 0.")

        if bbox["max_y"] < expected_h - 10.0 or bbox["max_y"] > max_allowed_y + 30.0:
            errors.append(f"Conveyor maximum elevation out of range: max Y = {bbox['max_y']} mm vs expected range [{expected_h}, {max_allowed_y}].")
        else:
            passed_checks.append(f"Elevation: max Y = {bbox['max_y']} mm matches working height + components.")

        # 4. Width check
        track_w = float(_get_val(config, 'width', 82.5))
        if bbox["dz"] < track_w - 5.0:
            errors.append(f"Bounding box width is smaller than track width: {bbox['dz']} mm < {track_w} mm.")
        else:
            passed_checks.append(f"Track Width Clearance: verified >= {track_w} mm.")

        # 5. Curve validation (if curved)
        shape = _get_val(config, 'shape', 'straight')
        curves = _get_val(config, 'curves', None) or []
        if shape == 'curved' and curves:
            # The model must cover at least the lateral span of the canonical centre-line path.
            path = CanonicalConveyorPath(config)
            zs = [s.point.z for s in path.samples]
            path_dz = (max(zs) - min(zs)) if zs else 0.0
            if bbox["dz"] < path_dz * 0.9:
                errors.append(f"Curved conveyor lateral span {bbox['dz']} mm is smaller than its path span {path_dz:.0f} mm.")
            else:
                passed_checks.append(f"Curve Geometry: lateral span in Z = {bbox['dz']} mm covers path span {path_dz:.0f} mm.")

        return {
            "valid": (len(errors) == 0),
            "solid_count": solid_count,
            "shell_count": len(self.shells),
            "face_count": len(self.faces),
            "bounding_box": bbox,
            "passed_checks": passed_checks,
            "errors": errors
        }
