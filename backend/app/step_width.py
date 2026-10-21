"""
Chain-width changes: the client's CAD only has the 82.5 mm family, so wider / narrower conveyors are made by widening
the client's own parts, the same way lengths are changed.

For a width change dw = width - 82.5 every part is moved sideways by h = dw / 2 (right-hand parts to the right,
left-hand parts to the left):

  * a part entirely on one side of the centre line moves rigidly (straight sections: along the lateral axis;
    in the bend: along the radius at the part's position),
  * a long part that crosses the centre line (shafts, stand cross-members, the chain) is lengthened at the centre
    line (every point on one side shifts by +h, the other by -h),
  * long curved parts of the bend (plates, strips, guide rails) are widened radially: inner points move towards the
    bend centre, outer points away from it (the radii of the circles / cylinders / tori change by the same amount),
  * small parts centred on the centre line (sprockets, bolts on the axis) stay.

All of this is expressed in reference-world coordinates, before the part is placed in the new layout.
"""
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

SIDE_TOL = 5.0           # mm: a part this close to the centre line counts as centred
SMALL = 130.0            # mm: smaller parts that straddle the centre line stay put
BEND_BAR_LENGTH = 150.0  # mm: curved parts longer than this are warped, shorter ones move rigidly


class WidthModel:
    """Geometry of the reference conveyor needed to tell left from right: three regions around the bend."""

    def __init__(self, ref: Any):
        self.ref = ref
        self.D1, self.D2 = ref.D1, ref.D2
        # bend centre (the curved bars and plates are concentric about it) and the lead / exit lane positions
        self.C_s1, self.C_s2 = 170.0, 466.5
        self.lane = ref.lane                  # lead centre line: s2 = lane
        self.exit_lane = ref.X_s1             # exit centre line: s1 = exit_lane
        self.R_centre = self.C_s2 - self.lane # centre-line radius of the bend (about 458 mm)

    # --- coordinates ------------------------------------------------------------------------------------------------
    def s(self, p: np.ndarray) -> Tuple[float, float]:
        return float(p @ self.D1), float(p @ self.D2)

    def region(self, s1: float, s2: float) -> str:
        if s1 <= self.C_s1:
            return "lead"
        if s2 >= self.C_s2:
            return "exit"
        return "bend"

    def right_vector(self, s1: float, s2: float) -> np.ndarray:
        """Unit vector pointing to the RIGHT (the inner side of the bend) at a position, in the plan."""
        reg = self.region(s1, s2)
        if reg == "lead":
            return self.D2.copy()
        if reg == "exit":
            return -self.D1
        v = (self.C_s1 - s1) * self.D1 + (self.C_s2 - s2) * self.D2    # towards the bend centre
        n = np.linalg.norm(v)
        return v / n if n > 1e-9 else self.D2.copy()

    def lateral(self, s1: float, s2: float) -> float:
        """Signed distance from the centre line: positive to the right."""
        reg = self.region(s1, s2)
        if reg == "lead":
            return s2 - self.lane
        if reg == "exit":
            return -(s1 - self.exit_lane)
        r = float(np.hypot(s1 - self.C_s1, s2 - self.C_s2))
        return self.R_centre - r

    def region_array(self, S1: np.ndarray, S2: np.ndarray) -> np.ndarray:
        """0 = lead, 1 = bend, 2 = exit for arrays of (s1, s2)."""
        out = np.ones(len(S1), dtype=int)
        out[S1 <= self.C_s1] = 0
        out[(S1 > self.C_s1) & (S2 >= self.C_s2)] = 2
        return out

    def lateral_array(self, S1: np.ndarray, S2: np.ndarray) -> np.ndarray:
        reg = self.region_array(S1, S2)
        r = np.hypot(S1 - self.C_s1, S2 - self.C_s2)
        return np.where(reg == 0, S2 - self.lane, np.where(reg == 2, -(S1 - self.exit_lane), self.R_centre - r))

    # --- classification of a bounding box ----------------------------------------------------------------------------
    def lateral_range(self, b: Tuple[float, ...]) -> Tuple[float, float, str]:
        """(min, max) lateral coordinate of a part with bounds (s1min, s1max, s2min, s2max, ...) and its region."""
        s1c, s2c = (b[0] + b[1]) / 2, (b[2] + b[3]) / 2
        reg = self.region(s1c, s2c)
        if reg == "lead":
            return b[2] - self.lane, b[3] - self.lane, reg
        if reg == "exit":
            return -(b[1] - self.exit_lane), -(b[0] - self.exit_lane), reg
        corners = [(b[0], b[2]), (b[0], b[3]), (b[1], b[2]), (b[1], b[3])]
        rs = [float(np.hypot(c[0] - self.C_s1, c[1] - self.C_s2)) for c in corners]
        # the bounding box of an arc includes the corner farthest from the centre only if the arc reaches it;
        # the extreme radii of the box are a safe outer bound
        r_lo = 0.0 if (b[0] <= self.C_s1 <= b[1] and b[2] <= self.C_s2 <= b[3]) else min(rs)
        return self.R_centre - max(rs), self.R_centre - r_lo, reg

    def classify(self, b: Tuple[float, ...]) -> Tuple[str, int, str]:
        """('side' | 'centre' | 'straddle', sigma, region): sigma +1 = right, -1 = left."""
        lo, hi, reg = self.lateral_range(b)
        if hi <= SIDE_TOL:
            return "side", -1, reg
        if lo >= -SIDE_TOL:
            return "side", +1, reg
        extent = max(b[1] - b[0], b[3] - b[2])
        if extent < SMALL and abs((lo + hi) / 2) < 60.0:
            return "centre", 0, reg
        return "straddle", 0, reg

    def shift_matrix(self, sigma: int, h: float, b: Tuple[float, ...], reg: str) -> np.ndarray:
        """Rigid sideways move of a whole part: sigma * h along the right vector at its centre."""
        s1c, s2c = (b[0] + b[1]) / 2, (b[2] + b[3]) / 2
        v = sigma * h * self.right_vector(s1c, s2c)
        m = np.eye(4)
        m[:3, 3] = v
        return m

    def straddle_cuts(self, b: Tuple[float, ...], h: float, reg: str) -> List[Dict[str, Any]]:
        """Lengthen a part that crosses the centre line: right of it +h, left of it -h (planar cut at the centre line)."""
        if reg == "lead":
            n = self.D2
            c = float(self.lane)            # points with s2 > lane are on the right
        else:                               # exit: right = -D1
            n = -self.D1
            c = float(-self.exit_lane)      # (-s1) > -exit_lane  <=>  s1 < exit_lane
        r = [round(float(x), 6) for x in n]
        l = [round(float(-x), 6) for x in n]
        return [{"n": r, "c": c, "d": [round(float(x * h), 6) for x in n]},
                {"n": l, "c": -c, "d": [round(float(-x * h), 6) for x in n]}]

    def warp_spec(self, sigma: int, h: float, centre: Optional[np.ndarray] = None) -> Dict[str, Any]:
        """Radial / lateral warp for a long curved part (fields continue across lead -> bend -> exit)."""
        c = centre if centre is not None else self.ref.xy(self.C_s1, self.C_s2)
        return {"c": [round(float(x), 6) for x in c], "d1": [round(float(x), 9) for x in self.D1],
                "d2": [round(float(x), 9) for x in self.D2], "sigma": int(sigma), "h": round(float(h), 6)}


def warp_displacement(spec: Dict[str, Any], p: np.ndarray) -> np.ndarray:
    """Displacement of a point (world mm) under a warp spec."""
    c, d1, d2 = np.array(spec["c"]), np.array(spec["d1"]), np.array(spec["d2"])
    sigma, h = spec["sigma"], spec["h"]
    v = p - c
    vh = np.array([v[0], v[1], 0.0])
    n = np.linalg.norm(vh)
    if n < 1.0:
        return np.zeros(3)          # on the bend axis (centres of the arcs and cylinders): stays
    a, b = float(v @ d1), float(v @ d2)
    if a <= 0.0:
        return sigma * h * d2
    if b >= 0.0:
        return -sigma * h * d1
    return -sigma * h * vh / n
