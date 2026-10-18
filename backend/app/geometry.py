"""
Canonical Engineering Geometry and Path Calculations for ALUFLEX Conveyor Systems.
Units: Millimeters (mm), Radians internally for math, Degrees for user-facing API.
Coordinate System:
  +X: Primary travel direction (longitudinal)
  +Y: Vertical elevation (0 = floor, workingHeight = top of belt)
  +Z: Lateral right relative to initial travel heading
  -Z: Lateral left relative to initial travel heading
"""

import math
from typing import List, Dict, Any, Optional, Tuple

def _get_val(obj: Any, key: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)

class Vector3D:
    def __init__(self, x: float = 0.0, y: float = 0.0, z: float = 0.0):
        self.x = float(x)
        self.y = float(y)
        self.z = float(z)

    def clone(self) -> 'Vector3D':
        return Vector3D(self.x, self.y, self.z)

    def add(self, v: 'Vector3D') -> 'Vector3D':
        self.x += v.x
        self.y += v.y
        self.z += v.z
        return self

    def multiply_scalar(self, s: float) -> 'Vector3D':
        self.x *= s
        self.y *= s
        self.z *= s
        return self

    def length(self) -> float:
        return math.sqrt(self.x * self.x + self.y * self.y + self.z * self.z)

    def normalize(self) -> 'Vector3D':
        l = self.length()
        if l > 1e-9:
            self.x /= l
            self.y /= l
            self.z /= l
        return self

    def dot(self, v: 'Vector3D') -> float:
        return self.x * v.x + self.y * v.y + self.z * v.z

    def cross(self, v: 'Vector3D') -> 'Vector3D':
        return Vector3D(
            self.y * v.z - self.z * v.y,
            self.z * v.x - self.x * v.z,
            self.x * v.y - self.y * v.x
        )

    def to_tuple(self) -> Tuple[float, float, float]:
        return (self.x, self.y, self.z)

class PathSample:
    def __init__(
        self,
        point: Vector3D,
        tangent: Vector3D,
        normal: Vector3D,        # Points to the RIGHT of travel heading
        left_normal: Vector3D,   # Points to the LEFT of travel heading
        distance: float,
        heading: float,
        segment_index: int = 0
    ):
        self.point = point
        self.tangent = tangent
        self.normal = normal
        self.left_normal = left_normal
        self.distance = distance
        self.heading = heading
        self.segment_index = segment_index

class PathSegment:
    def __init__(
        self,
        seg_type: str, # 'straight' | 'curve'
        start_point: Vector3D,
        end_point: Vector3D,
        start_distance: float,
        end_distance: float,
        length: float,
        start_heading: float,
        end_heading: float,
        center: Optional[Vector3D] = None,
        radius: Optional[float] = None,
        start_angle: Optional[float] = None,
        end_angle: Optional[float] = None,
        sweep_angle: Optional[float] = None,
        direction: Optional[str] = None # 'left' | 'right'
    ):
        self.seg_type = seg_type
        self.start_point = start_point
        self.end_point = end_point
        self.start_distance = start_distance
        self.end_distance = end_distance
        self.length = length
        self.start_heading = start_heading
        self.end_heading = end_heading
        self.center = center
        self.radius = radius
        self.start_angle = start_angle
        self.end_angle = end_angle
        self.sweep_angle = sweep_angle
        self.direction = direction

class CanonicalConveyorPath:
    """
    Canonical parametric centerline path for ALUFLEX conveyor.
    Identical mathematical formulation between Three.js visualizer and CAD STEP exporter.
    """
    def __init__(self, config: Any):
        self.segments: List[PathSegment] = []
        self.total_length: float = 0.0
        self.samples: List[PathSample] = []
        self._build_path(config)

    def _build_path(self, config: Any):
        self.segments = []
        current_distance = 0.0
        current_pos = Vector3D(0.0, 0.0, 0.0)
        current_heading = 0.0  # 0 radians = along +X axis

        shape = _get_val(config, 'shape', 'straight')
        curves_raw = _get_val(config, 'curves', [])
        total_config_length = float(_get_val(config, 'length', 3000.0))
        end_horiz = _get_val(config, 'endHorizontalPathLength', None)
        track_width = float(_get_val(config, 'width', 82.5))

        if shape == 'straight' or not curves_raw:
            length = total_config_length
            dir_vec = Vector3D(math.cos(current_heading), 0.0, math.sin(current_heading))
            end_pos = current_pos.clone().add(dir_vec.clone().multiply_scalar(length))

            seg = PathSegment(
                seg_type='straight',
                start_point=current_pos.clone(),
                end_point=end_pos.clone(),
                start_distance=current_distance,
                end_distance=current_distance + length,
                length=length,
                start_heading=current_heading,
                end_heading=current_heading
            )
            self.segments.append(seg)
            self.total_length = length
        else:
            curves = list(curves_raw)
            curves.sort(key=lambda c: float(_get_val(c, 'offset', 0.0)))

            last_offset = 0.0
            for i, curve in enumerate(curves):
                c_offset = float(_get_val(curve, 'offset', 1500.0))
                c_angle = float(_get_val(curve, 'angle', 90.0))
                c_radius = _get_val(curve, 'radius', None)
                c_type = _get_val(curve, 'curveType', 'friction')
                c_dir = _get_val(curve, 'direction', 'left')
                c_dist_prev = _get_val(curve, 'distanceFromPrevious', None)

                # Radius definition
                if c_radius and float(c_radius) > 0:
                    radius = float(c_radius)
                elif c_type == 'wheelband':
                    radius = 200.0
                else:
                    radius = max(500.0, track_width * 4.0)

                sweep_rad = math.radians(c_angle)
                arc_len = radius * sweep_rad

                # 1. Straight lead-in section before this curve
                if i == 0:
                    lead_in_len = max(150.0, c_offset if c_offset > 0 else 1500.0)
                else:
                    lead_in_len = max(150.0, float(c_dist_prev) if c_dist_prev is not None else max(200.0, c_offset - last_offset))

                if lead_in_len > 0:
                    dir_vec = Vector3D(math.cos(current_heading), 0.0, math.sin(current_heading))
                    straight_end = current_pos.clone().add(dir_vec.clone().multiply_scalar(lead_in_len))
                    self.segments.append(PathSegment(
                        seg_type='straight',
                        start_point=current_pos.clone(),
                        end_point=straight_end.clone(),
                        start_distance=current_distance,
                        end_distance=current_distance + lead_in_len,
                        length=lead_in_len,
                        start_heading=current_heading,
                        end_heading=current_heading
                    ))
                    current_distance += lead_in_len
                    current_pos = straight_end

                # 2. Curve Segment
                is_left = (c_dir == 'left')
                if is_left:
                    # Turn LEFT relative to current travel heading:
                    left_normal = Vector3D(math.sin(current_heading), 0.0, -math.cos(current_heading))
                    center = current_pos.clone().add(left_normal.multiply_scalar(radius))
                    start_angle = current_heading + math.pi / 2.0
                    end_angle = start_angle - sweep_rad
                    end_heading = current_heading - sweep_rad
                else:
                    # Turn RIGHT relative to current travel heading:
                    right_normal = Vector3D(-math.sin(current_heading), 0.0, math.cos(current_heading))
                    center = current_pos.clone().add(right_normal.multiply_scalar(radius))
                    start_angle = current_heading - math.pi / 2.0
                    end_angle = start_angle + sweep_rad
                    end_heading = current_heading + sweep_rad

                curve_end = Vector3D(
                    center.x + radius * math.cos(end_angle),
                    0.0,
                    center.z + radius * math.sin(end_angle)
                )

                self.segments.append(PathSegment(
                    seg_type='curve',
                    start_point=current_pos.clone(),
                    end_point=curve_end.clone(),
                    start_distance=current_distance,
                    end_distance=current_distance + arc_len,
                    length=arc_len,
                    start_heading=current_heading,
                    end_heading=end_heading,
                    center=center,
                    radius=radius,
                    start_angle=start_angle,
                    end_angle=end_angle,
                    sweep_angle=sweep_rad,
                    direction=c_dir
                ))

                current_distance += arc_len
                current_pos = curve_end
                current_heading = end_heading
                last_offset = c_offset + arc_len

            # 3. Final straight exit section
            # Same rule as the frontend path: explicit length (min 200 mm), else 35 % of the length (min 400 mm).
            if end_horiz is not None:
                remaining_len = max(200.0, float(end_horiz))
            else:
                remaining_len = max(400.0, total_config_length * 0.35)

            exit_dir = Vector3D(math.cos(current_heading), 0.0, math.sin(current_heading))
            final_end = current_pos.clone().add(exit_dir.clone().multiply_scalar(remaining_len))
            self.segments.append(PathSegment(
                seg_type='straight',
                start_point=current_pos.clone(),
                end_point=final_end.clone(),
                start_distance=current_distance,
                end_distance=current_distance + remaining_len,
                length=remaining_len,
                start_heading=current_heading,
                end_heading=current_heading
            ))
            current_distance += remaining_len
            self.total_length = current_distance

        # Pre-generate fine path samples along centerline
        self._generate_samples(step_size=20.0)

    def _generate_samples(self, step_size: float = 20.0):
        self.samples = []
        num_steps = max(20, math.ceil(self.total_length / step_size))
        for i in range(num_steps + 1):
            dist = (i / num_steps) * self.total_length
            sample = self.get_sample_at_distance(dist)
            self.samples.append(sample)

    def get_sample_at_distance(self, distance: float) -> PathSample:
        clamped_dist = max(0.0, min(self.total_length, distance))

        seg_idx = 0
        seg = self.segments[0]
        for idx, s in enumerate(self.segments):
            if s.start_distance <= clamped_dist <= s.end_distance:
                seg = s
                seg_idx = idx
                break

        if seg.seg_type == 'straight':
            frac = (clamped_dist - seg.start_distance) / seg.length if seg.length > 0 else 0.0
            point = Vector3D(
                seg.start_point.x + (seg.end_point.x - seg.start_point.x) * frac,
                0.0,
                seg.start_point.z + (seg.end_point.z - seg.start_point.z) * frac
            )
            heading = seg.start_heading
            tangent = Vector3D(math.cos(heading), 0.0, math.sin(heading)).normalize()
            normal = Vector3D(-math.sin(heading), 0.0, math.cos(heading)).normalize()
            left_normal = Vector3D(math.sin(heading), 0.0, -math.cos(heading)).normalize()
        else:
            frac = (clamped_dist - seg.start_distance) / seg.length if seg.length > 0 else 0.0
            cur_angle = seg.start_angle + (seg.end_angle - seg.start_angle) * frac
            cur_heading = seg.start_heading + (seg.end_heading - seg.start_heading) * frac
            point = Vector3D(
                seg.center.x + seg.radius * math.cos(cur_angle),
                0.0,
                seg.center.z + seg.radius * math.sin(cur_angle)
            )
            heading = cur_heading
            tangent = Vector3D(math.cos(heading), 0.0, math.sin(heading)).normalize()
            normal = Vector3D(-math.sin(heading), 0.0, math.cos(heading)).normalize()
            left_normal = Vector3D(math.sin(heading), 0.0, -math.cos(heading)).normalize()

        return PathSample(
            point=point,
            tangent=tangent,
            normal=normal,
            left_normal=left_normal,
            distance=clamped_dist,
            heading=heading,
            segment_index=seg_idx
        )
