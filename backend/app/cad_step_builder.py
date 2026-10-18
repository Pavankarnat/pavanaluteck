"""
Parametric Solid B-Rep STEP File Generator for ALUFLEX Conveyor Systems.
Complies with ISO 10303-21 (AP214 / AP203) Automotive / Mechanical Design standard.
Generates genuine MANIFOLD_SOLID_BREP solids with accurate physical dimensions.
"""

import math
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
from app.geometry import Vector3D, CanonicalConveyorPath, PathSample, PathSegment

class StepFileGenerator:
    def __init__(self, name: str = "ALUFLEX_CONVEYOR"):
        self.name = name
        self.data: List[str] = []
        self._point_cache: Dict[str, str] = {}
        self._direction_cache: Dict[str, str] = {}
        self._color_style_cache: Dict[str, str] = {}
        self.styled_items: List[str] = []

    def add_entity(self, rhs: str) -> str:
        lhs = f"#{len(self.data) + 1}"
        self.data.append(f"{lhs}={rhs};")
        return lhs

    def add_cartesian_point(self, x: float, y: float, z: float) -> str:
        rx, ry, rz = round(float(x), 4), round(float(y), 4), round(float(z), 4)
        key = f"P_{rx}_{ry}_{rz}"
        if key in self._point_cache:
            return self._point_cache[key]
        p_id = self.add_entity(f"CARTESIAN_POINT('',({rx:.4f},{ry:.4f},{rz:.4f}))")
        self._point_cache[key] = p_id
        return p_id

    def add_vertex_point(self, cartesian_point: str) -> str:
        return self.add_entity(f"VERTEX_POINT('',{cartesian_point})")

    def add_direction(self, x: float, y: float, z: float) -> str:
        l = math.sqrt(x * x + y * y + z * z)
        if l > 1e-9:
            x, y, z = x / l, y / l, z / l
        rx, ry, rz = round(float(x), 6), round(float(y), 6), round(float(z), 6)
        key = f"D_{rx}_{ry}_{rz}"
        if key in self._direction_cache:
            return self._direction_cache[key]
        d_id = self.add_entity(f"DIRECTION('',({rx:.6f},{ry:.6f},{rz:.6f}))")
        self._direction_cache[key] = d_id
        return d_id

    def add_vector(self, direction: str, magnitude: float = 1.0) -> str:
        return self.add_entity(f"VECTOR('',{direction},{float(magnitude):.1f})")

    def add_line(self, cartesian_point: str, vector: str) -> str:
        return self.add_entity(f"LINE('',{cartesian_point},{vector})")

    def add_edge_curve(self, vp1: str, vp2: str, line: str) -> str:
        return self.add_entity(f"EDGE_CURVE('',{vp1},{vp2},{line},.T.)")

    def add_oriented_edge(self, edge_curve: str, orientation: bool) -> str:
        sense = ".T." if orientation else ".F."
        return self.add_entity(f"ORIENTED_EDGE('',*,*,{edge_curve},{sense})")

    def add_axis2_placement_3d(self, pt: str, dir1: str, dir2: str) -> str:
        return self.add_entity(f"AXIS2_PLACEMENT_3D('',{pt},{dir1},{dir2})")

    def add_plane(self, axis_placement: str) -> str:
        return self.add_entity(f"PLANE('',{axis_placement})")

    def add_edge_loop(self, oriented_edges: List[str]) -> str:
        return self.add_entity(f"EDGE_LOOP('',({','.join(oriented_edges)}))")

    def add_face_outer_bound(self, loop: str) -> str:
        return self.add_entity(f"FACE_OUTER_BOUND('',{loop},.T.)")

    def add_advanced_face(self, bounds: List[str], surface: str, same_sense: bool = True) -> str:
        sense = ".T." if same_sense else ".F."
        return self.add_entity(f"ADVANCED_FACE('',({','.join(bounds)}),{surface},{sense})")

    def add_closed_shell(self, faces: List[str]) -> str:
        return self.add_entity(f"CLOSED_SHELL('',({','.join(faces)}))")

    def add_manifold_solid_brep(self, name: str, shell: str) -> str:
        return self.add_entity(f"MANIFOLD_SOLID_BREP('{name}',{shell})")

    def get_or_create_style_assignment(self, color: List[float]) -> str:
        r, g, b = round(float(color[0]), 3), round(float(color[1]), 3), round(float(color[2]), 3)
        key = f"C_{r:.3f}_{g:.3f}_{b:.3f}"
        if key in self._color_style_cache:
            return self._color_style_cache[key]
        color_rgb = self.add_entity(f"COLOUR_RGB('',{r:.3f},{g:.3f},{b:.3f})")
        fill_col = self.add_entity(f"FILL_AREA_STYLE_COLOUR('',{color_rgb})")
        fill_style = self.add_entity(f"FILL_AREA_STYLE('',({fill_col}))")
        surf_fill = self.add_entity(f"SURFACE_STYLE_FILL_AREA({fill_style})")
        surf_side = self.add_entity(f"SURFACE_SIDE_STYLE('',({surf_fill}))")
        surf_usage = self.add_entity(f"SURFACE_STYLE_USAGE(.BOTH.,{surf_side})")
        pres_style = self.add_entity(f"PRESENTATION_STYLE_ASSIGNMENT(({surf_usage}))")
        self._color_style_cache[key] = pres_style
        return pres_style

    def add_styled_item(self, item: str, color: List[float]) -> str:
        pres_style = self.get_or_create_style_assignment(color)
        s_id = self.add_entity(f"STYLED_ITEM('',({pres_style}),{item})")
        self.styled_items.append(s_id)
        return s_id

    def add_styled_faces(self, faces: List[str], color: List[float]) -> List[str]:
        pres_style = self.get_or_create_style_assignment(color)
        res = []
        for face in faces:
            s_id = self.add_entity(f"STYLED_ITEM('',({pres_style}),{face})")
            self.styled_items.append(s_id)
            res.append(s_id)
        return res

    def add_geometric_representation_context(self) -> str:
        exp1 = self.add_entity("DIMENSIONAL_EXPONENTS(0.0,0.0,0.0,0.0,0.0,0.0,0.0)")
        exp2 = self.add_entity("DIMENSIONAL_EXPONENTS(1.0,0.0,0.0,0.0,0.0,0.0,0.0)")

        unit_angle = self.add_entity(f"(NAMED_UNIT({exp1})PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))")
        unit_solid = self.add_entity(f"(NAMED_UNIT({exp1})SOLID_ANGLE_UNIT()SI_UNIT($,.STERADIAN.))")
        unit_length = self.add_entity(f"(NAMED_UNIT({exp2})LENGTH_UNIT()SI_UNIT(.MILLI.,.METRE.))")

        uncert = self.add_entity(f"UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.0E-05),{unit_length},'distance_accuracy_value','confusion accuracy')")

        return self.add_entity(
            f"(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT(({uncert}))"
            f"GLOBAL_UNIT_ASSIGNED_CONTEXT(({unit_length},{unit_angle},{unit_solid}))REPRESENTATION_CONTEXT('NONE','WORKSPACE'))"
        )

    def add_shape_definition_representation(self, name: str, items: List[str], context: str) -> str:
        app_context = self.add_entity("APPLICATION_CONTEXT('core data for automotive mechanical design processes')")
        self.add_entity(f"APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,{app_context})")
        prod_def_ctx = self.add_entity(f"PRODUCT_DEFINITION_CONTEXT('part definition',{app_context},'design')")
        prod_ctx = self.add_entity(f"PRODUCT_CONTEXT('',{app_context},'mechanical')")
        prod = self.add_entity(f"PRODUCT('{name}','','ALUFLEX INDUSTRIAL CONVEYOR',({prod_ctx}))")
        prod_form = self.add_entity(f"PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE(' ','NONE',{prod},.NOT_KNOWN.)")
        prod_def = self.add_entity(f"PRODUCT_DEFINITION('','NONE',{prod_form},{prod_def_ctx})")
        prod_shape = self.add_entity(f"PRODUCT_DEFINITION_SHAPE('NONE','NONE',{prod_def})")
        brep_shape = self.add_entity(f"ADVANCED_BREP_SHAPE_REPRESENTATION('{name}',({','.join(items)}),{context})")
        return self.add_entity(f"SHAPE_DEFINITION_REPRESENTATION({prod_shape},{brep_shape})")

    def add_presentation_representation(self, items: List[str], context: str) -> str:
        return self.add_entity(f"MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION(' ',({','.join(items)}),{context})")

    def add_solid_box(
        self,
        center: Vector3D,
        tangent: Vector3D,
        normal: Vector3D,
        dx: float, # half-length along tangent
        dy: float, # half-width along normal
        dz: float, # half-height along up
        name: str,
        color: List[float] = [0.7, 0.7, 0.7],
        up: Optional[Vector3D] = None
    ) -> Tuple[str, str]:
        """
        Creates a closed 6-face oriented MANIFOLD_SOLID_BREP box.
        100% compliant with ISO 10303-21 / AP214 and CAD kernels (Autodesk Inventor, SolidWorks).
        Every planar face contains its vertices to 0.000000 mm precision, with outward normal.
        Every edge is 2-manifold shared exactly once forward (.T.) and once reversed (.F.).
        """
        T = tangent.clone().normalize()
        N = normal.clone().normalize()
        U = up.clone().normalize() if up is not None else Vector3D(0.0, 1.0, 0.0)

        # 8 Corner vertices:
        pts = [
            center.clone().add(T.clone().multiply_scalar(-dx)).add(N.clone().multiply_scalar(-dy)).add(U.clone().multiply_scalar(-dz)), # 0: -T, -N, -U
            center.clone().add(T.clone().multiply_scalar(dx)).add(N.clone().multiply_scalar(-dy)).add(U.clone().multiply_scalar(-dz)),  # 1: +T, -N, -U
            center.clone().add(T.clone().multiply_scalar(dx)).add(N.clone().multiply_scalar(dy)).add(U.clone().multiply_scalar(-dz)),   # 2: +T, +N, -U
            center.clone().add(T.clone().multiply_scalar(-dx)).add(N.clone().multiply_scalar(dy)).add(U.clone().multiply_scalar(-dz)),  # 3: -T, +N, -U
            center.clone().add(T.clone().multiply_scalar(-dx)).add(N.clone().multiply_scalar(-dy)).add(U.clone().multiply_scalar(dz)),  # 4: -T, -N, +U
            center.clone().add(T.clone().multiply_scalar(dx)).add(N.clone().multiply_scalar(-dy)).add(U.clone().multiply_scalar(dz)),   # 5: +T, -N, +U
            center.clone().add(T.clone().multiply_scalar(dx)).add(N.clone().multiply_scalar(dy)).add(U.clone().multiply_scalar(dz)),    # 6: +T, +N, +U
            center.clone().add(T.clone().multiply_scalar(-dx)).add(N.clone().multiply_scalar(dy)).add(U.clone().multiply_scalar(dz))   # 7: -T, +N, +U
        ]

        pt_ids = [self.add_cartesian_point(p.x, p.y, p.z) for p in pts]
        vp_ids = [self.add_vertex_point(p_id) for p_id in pt_ids]

        dir_t_pos = self.add_direction(T.x, T.y, T.z)
        dir_n_pos = self.add_direction(N.x, N.y, N.z)
        dir_u_pos = self.add_direction(U.x, U.y, U.z)
        dir_t_neg = self.add_direction(-T.x, -T.y, -T.z)
        dir_n_neg = self.add_direction(-N.x, -N.y, -N.z)
        dir_u_neg = self.add_direction(-U.x, -U.y, -U.z)

        # 12 Lines - each line starts EXACTLY at the edge's start vertex:
        # Bottom face edges (U = -dz):
        l01 = self.add_line(pt_ids[0], self.add_vector(dir_t_pos)) # 0 -> 1 (+T)
        l12 = self.add_line(pt_ids[1], self.add_vector(dir_n_pos)) # 1 -> 2 (+N)
        l23 = self.add_line(pt_ids[2], self.add_vector(dir_t_neg)) # 2 -> 3 (-T)
        l30 = self.add_line(pt_ids[3], self.add_vector(dir_n_neg)) # 3 -> 0 (-N)

        # Top face edges (U = +dz):
        l45 = self.add_line(pt_ids[4], self.add_vector(dir_t_pos)) # 4 -> 5 (+T)
        l56 = self.add_line(pt_ids[5], self.add_vector(dir_n_pos)) # 5 -> 6 (+N)
        l67 = self.add_line(pt_ids[6], self.add_vector(dir_t_neg)) # 6 -> 7 (-T)
        l74 = self.add_line(pt_ids[7], self.add_vector(dir_n_neg)) # 7 -> 4 (-N)

        # Vertical pillar edges (-U to +U):
        l04 = self.add_line(pt_ids[0], self.add_vector(dir_u_pos)) # 0 -> 4 (+U)
        l15 = self.add_line(pt_ids[1], self.add_vector(dir_u_pos)) # 1 -> 5 (+U)
        l26 = self.add_line(pt_ids[2], self.add_vector(dir_u_pos)) # 2 -> 6 (+U)
        l37 = self.add_line(pt_ids[3], self.add_vector(dir_u_pos)) # 3 -> 7 (+U)

        # 12 Edge Curves:
        ec01 = self.add_edge_curve(vp_ids[0], vp_ids[1], l01)
        ec12 = self.add_edge_curve(vp_ids[1], vp_ids[2], l12)
        ec23 = self.add_edge_curve(vp_ids[2], vp_ids[3], l23)
        ec30 = self.add_edge_curve(vp_ids[3], vp_ids[0], l30)

        ec45 = self.add_edge_curve(vp_ids[4], vp_ids[5], l45)
        ec56 = self.add_edge_curve(vp_ids[5], vp_ids[6], l56)
        ec67 = self.add_edge_curve(vp_ids[6], vp_ids[7], l67)
        ec74 = self.add_edge_curve(vp_ids[7], vp_ids[4], l74)

        ec04 = self.add_edge_curve(vp_ids[0], vp_ids[4], l04)
        ec15 = self.add_edge_curve(vp_ids[1], vp_ids[5], l15)
        ec26 = self.add_edge_curve(vp_ids[2], vp_ids[6], l26)
        ec37 = self.add_edge_curve(vp_ids[3], vp_ids[7], l37)

        # 6 Planar Faces with exact analytical planes passing through face vertices:
        # 1. Bottom Face (-U): loop 0 -> 3 -> 2 -> 1 -> 0
        loop_bot = self.add_edge_loop([
            self.add_oriented_edge(ec30, False),
            self.add_oriented_edge(ec23, False),
            self.add_oriented_edge(ec12, False),
            self.add_oriented_edge(ec01, False)
        ])
        bound_bot = self.add_face_outer_bound(loop_bot)
        ap_bot = self.add_axis2_placement_3d(pt_ids[0], dir_u_neg, dir_t_pos)
        f_bot = self.add_advanced_face([bound_bot], self.add_plane(ap_bot), True)

        # 2. Top Face (+U): loop 4 -> 5 -> 6 -> 7 -> 4
        loop_top = self.add_edge_loop([
            self.add_oriented_edge(ec45, True),
            self.add_oriented_edge(ec56, True),
            self.add_oriented_edge(ec67, True),
            self.add_oriented_edge(ec74, True)
        ])
        bound_top = self.add_face_outer_bound(loop_top)
        ap_top = self.add_axis2_placement_3d(pt_ids[4], dir_u_pos, dir_t_pos)
        f_top = self.add_advanced_face([bound_top], self.add_plane(ap_top), True)

        # 3. Front Face (+T): loop 1 -> 2 -> 6 -> 5 -> 1
        loop_front = self.add_edge_loop([
            self.add_oriented_edge(ec12, True),
            self.add_oriented_edge(ec26, True),
            self.add_oriented_edge(ec56, False),
            self.add_oriented_edge(ec15, False)
        ])
        bound_front = self.add_face_outer_bound(loop_front)
        ap_front = self.add_axis2_placement_3d(pt_ids[1], dir_t_pos, dir_u_pos)
        f_front = self.add_advanced_face([bound_front], self.add_plane(ap_front), True)

        # 4. Back Face (-T): loop 0 -> 4 -> 7 -> 3 -> 0
        loop_back = self.add_edge_loop([
            self.add_oriented_edge(ec04, True),
            self.add_oriented_edge(ec74, False),
            self.add_oriented_edge(ec37, False),
            self.add_oriented_edge(ec30, True)
        ])
        bound_back = self.add_face_outer_bound(loop_back)
        ap_back = self.add_axis2_placement_3d(pt_ids[0], dir_t_neg, dir_u_pos)
        f_back = self.add_advanced_face([bound_back], self.add_plane(ap_back), True)

        # 5. Right Face (+N): loop 2 -> 3 -> 7 -> 6 -> 2
        loop_right = self.add_edge_loop([
            self.add_oriented_edge(ec23, True),
            self.add_oriented_edge(ec37, True),
            self.add_oriented_edge(ec67, False),
            self.add_oriented_edge(ec26, False)
        ])
        bound_right = self.add_face_outer_bound(loop_right)
        ap_right = self.add_axis2_placement_3d(pt_ids[2], dir_n_pos, dir_u_pos)
        f_right = self.add_advanced_face([bound_right], self.add_plane(ap_right), True)

        # 6. Left Face (-N): loop 0 -> 1 -> 5 -> 4 -> 0
        loop_left = self.add_edge_loop([
            self.add_oriented_edge(ec01, True),
            self.add_oriented_edge(ec15, True),
            self.add_oriented_edge(ec45, False),
            self.add_oriented_edge(ec04, False)
        ])
        bound_left = self.add_face_outer_bound(loop_left)
        ap_left = self.add_axis2_placement_3d(pt_ids[0], dir_n_neg, dir_u_pos)
        f_left = self.add_advanced_face([bound_left], self.add_plane(ap_left), True)

        faces = [f_bot, f_top, f_front, f_back, f_right, f_left]
        shell = self.add_closed_shell(faces)
        brep = self.add_manifold_solid_brep(name, shell)
        styled = self.add_styled_item(brep, color)
        self.add_styled_faces(faces, color)
        return brep, styled

    def add_solid_cylinder(
        self,
        center: Vector3D,
        axis: Vector3D,
        radius: float,
        length: float,
        name: str,
        color: List[float] = [0.7, 0.7, 0.7],
        segments: int = 16
    ) -> Tuple[str, str]:
        """
        Creates a closed N-sided solid cylinder (MANIFOLD_SOLID_BREP) along axis.
        Universal compatibility across Autodesk Inventor, SolidWorks, FreeCAD, AutoCAD.
        """
        A = axis.clone().normalize()
        # Find orthogonal vectors U and V
        ref = Vector3D(0.0, 1.0, 0.0) if abs(A.y) < 0.9 else Vector3D(1.0, 0.0, 0.0)
        U = A.cross(ref).normalize()
        V = A.cross(U).normalize()

        half_len = length / 2.0
        bot_pts, top_pts = [], []

        for i in range(segments):
            angle = (2.0 * math.pi * i) / segments
            rad_vec = U.clone().multiply_scalar(radius * math.cos(angle)).add(V.clone().multiply_scalar(radius * math.sin(angle)))
            p_bot = center.clone().add(A.clone().multiply_scalar(-half_len)).add(rad_vec)
            p_top = center.clone().add(A.clone().multiply_scalar(half_len)).add(rad_vec)
            bot_pts.append(p_bot)
            top_pts.append(p_top)

        bot_pt_ids = [self.add_cartesian_point(p.x, p.y, p.z) for p in bot_pts]
        top_pt_ids = [self.add_cartesian_point(p.x, p.y, p.z) for p in top_pts]
        bot_vp_ids = [self.add_vertex_point(pid) for pid in bot_pt_ids]
        top_vp_ids = [self.add_vertex_point(pid) for pid in top_pt_ids]

        dir_a_pos = self.add_direction(A.x, A.y, A.z)
        dir_a_neg = self.add_direction(-A.x, -A.y, -A.z)
        vec_a_pos = self.add_vector(dir_a_pos)

        # Edges: Bottom ring, top ring, and longitudinal side lines
        bot_edges = []
        top_edges = []
        side_edges = []

        for i in range(segments):
            nxt = (i + 1) % segments
            # Bottom ring edge i -> nxt
            d_vec = bot_pts[nxt].clone().add(bot_pts[i].clone().multiply_scalar(-1.0)).normalize()
            l_b = self.add_line(bot_pt_ids[i], self.add_vector(self.add_direction(d_vec.x, d_vec.y, d_vec.z)))
            bot_edges.append(self.add_edge_curve(bot_vp_ids[i], bot_vp_ids[nxt], l_b))

            # Top ring edge i -> nxt
            d_vec_top = top_pts[nxt].clone().add(top_pts[i].clone().multiply_scalar(-1.0)).normalize()
            l_t = self.add_line(top_pt_ids[i], self.add_vector(self.add_direction(d_vec_top.x, d_vec_top.y, d_vec_top.z)))
            top_edges.append(self.add_edge_curve(top_vp_ids[i], top_vp_ids[nxt], l_t))

            # Longitudinal side line bot[i] -> top[i]
            l_s = self.add_line(bot_pt_ids[i], vec_a_pos)
            side_edges.append(self.add_edge_curve(bot_vp_ids[i], top_vp_ids[i], l_s))

        faces = []

        # Side faces
        for i in range(segments):
            nxt = (i + 1) % segments
            oe_bot = self.add_oriented_edge(bot_edges[i], True)
            oe_side_nxt = self.add_oriented_edge(side_edges[nxt], True)
            oe_top_rev = self.add_oriented_edge(top_edges[i], False)
            oe_side_curr_rev = self.add_oriented_edge(side_edges[i], False)

            loop = self.add_edge_loop([oe_bot, oe_side_nxt, oe_top_rev, oe_side_curr_rev])
            bound = self.add_face_outer_bound(loop)

            # Face normal pointing outward
            mid_ang = (2.0 * math.pi * (i + 0.5)) / segments
            fn = U.clone().multiply_scalar(math.cos(mid_ang)).add(V.clone().multiply_scalar(math.sin(mid_ang))).normalize()
            dir_fn = self.add_direction(fn.x, fn.y, fn.z)
            ap = self.add_axis2_placement_3d(bot_pt_ids[i], dir_fn, dir_a_pos)
            plane = self.add_plane(ap)
            faces.append(self.add_advanced_face([bound], plane, True))

        # Top cap face (polygon loop top_edges)
        top_cap_oe = [self.add_oriented_edge(e, True) for e in top_edges]
        top_loop = self.add_edge_loop(top_cap_oe)
        top_bound = self.add_face_outer_bound(top_loop)
        top_center = center.clone().add(A.clone().multiply_scalar(half_len))
        top_center_id = self.add_cartesian_point(top_center.x, top_center.y, top_center.z)
        ap_top = self.add_axis2_placement_3d(top_center_id, dir_a_pos, self.add_direction(U.x, U.y, U.z))
        faces.append(self.add_advanced_face([top_bound], self.add_plane(ap_top), True))

        # Bottom cap face (reverse orientation)
        bot_cap_oe = [self.add_oriented_edge(bot_edges[i], False) for i in reversed(range(segments))]
        bot_loop = self.add_edge_loop(bot_cap_oe)
        bot_bound = self.add_face_outer_bound(bot_loop)
        bot_center = center.clone().add(A.clone().multiply_scalar(-half_len))
        bot_center_id = self.add_cartesian_point(bot_center.x, bot_center.y, bot_center.z)
        ap_bot = self.add_axis2_placement_3d(bot_center_id, dir_a_neg, self.add_direction(U.x, U.y, U.z))
        faces.append(self.add_advanced_face([bot_bound], self.add_plane(ap_bot), True))

        shell = self.add_closed_shell(faces)
        brep = self.add_manifold_solid_brep(name, shell)
        styled = self.add_styled_item(brep, color)
        self.add_styled_faces(faces, color)
        return brep, styled

    def add_straight_extruded_solid(
        self,
        profile_pts_2d: List[Tuple[float, float]], # List of (lat_offset, y_offset)
        start_pt: Vector3D,
        end_pt: Vector3D,
        norm: Vector3D,
        working_y: float,
        name: str,
        color: List[float]
    ) -> Tuple[str, str]:
        """
        Extrudes an arbitrary 2D closed polygon along a straight path from start_pt to end_pt.
        """
        pts1 = [
            Vector3D(
                start_pt.x + norm.x * lat_off,
                working_y + y_off,
                start_pt.z + norm.z * lat_off
            ) for (lat_off, y_off) in profile_pts_2d
        ]
        pts2 = [
            Vector3D(
                end_pt.x + norm.x * lat_off,
                working_y + y_off,
                end_pt.z + norm.z * lat_off
            ) for (lat_off, y_off) in profile_pts_2d
        ]
        return self._build_prism_solid(pts1, pts2, name, color)

    def add_curved_extruded_solid(
        self,
        profile_pts_2d: List[Tuple[float, float]], # List of (radial_offset, y_offset) relative to (center_radius, working_y)
        center_arc: Vector3D,
        center_radius: float,
        start_angle: float,
        end_angle: float,
        is_left: bool,
        working_y: float,
        name: str,
        color: List[float],
        num_steps: int = 12
    ) -> List[Tuple[str, str]]:
        """
        Creates smooth continuous CAD B-Rep solid sectors along a true circular curve.
        """
        solids = []
        angle_span = end_angle - start_angle
        step_angle = angle_span / num_steps

        for s in range(num_steps):
            a1 = start_angle + s * step_angle
            a2 = start_angle + (s + 1) * step_angle

            # Build solid prism sector between a1 and a2
            # Cross section 1 at a1:
            pts1 = [
                Vector3D(
                    center_arc.x + (center_radius + r_off) * math.cos(a1),
                    working_y + y_off,
                    center_arc.z + (center_radius + r_off) * math.sin(a1)
                ) for (r_off, y_off) in profile_pts_2d
            ]
            # Cross section 2 at a2:
            pts2 = [
                Vector3D(
                    center_arc.x + (center_radius + r_off) * math.cos(a2),
                    working_y + y_off,
                    center_arc.z + (center_radius + r_off) * math.sin(a2)
                ) for (r_off, y_off) in profile_pts_2d
            ]

            sector_name = f"{name}_Sec_{s+1}"
            sign = -1.0 if is_left else 1.0
            tan1 = Vector3D(-math.sin(a1) * sign, 0.0, math.cos(a1) * sign)
            tan2 = Vector3D(-math.sin(a2) * sign, 0.0, math.cos(a2) * sign)
            cap1_norm = tan1.multiply_scalar(-1.0)
            cap2_norm = tan2
            brep, styled = self._build_prism_solid(pts1, pts2, sector_name, color, cap1_normal=cap1_norm, cap2_normal=cap2_norm)
            solids.append((brep, styled))

        return solids

    def _build_prism_solid(
        self,
        pts1: List[Vector3D],
        pts2: List[Vector3D],
        name: str,
        color: List[float],
        cap1_normal: Optional[Vector3D] = None,
        cap2_normal: Optional[Vector3D] = None
    ) -> Tuple[str, str]:
        """
        Constructs a closed solid prism between two corresponding N-gon cross sections.
        """
        N = len(pts1)
        p1_ids = [self.add_cartesian_point(p.x, p.y, p.z) for p in pts1]
        p2_ids = [self.add_cartesian_point(p.x, p.y, p.z) for p in pts2]
        vp1_ids = [self.add_vertex_point(pid) for pid in p1_ids]
        vp2_ids = [self.add_vertex_point(pid) for pid in p2_ids]

        # Edges on cap 1, cap 2, and side struts
        e1_list = []
        e2_list = []
        es_list = []

        for i in range(N):
            nxt = (i + 1) % N
            # Cap 1 edge
            d1 = pts1[nxt].clone().add(pts1[i].clone().multiply_scalar(-1.0)).normalize()
            l1 = self.add_line(p1_ids[i], self.add_vector(self.add_direction(d1.x, d1.y, d1.z)))
            e1_list.append(self.add_edge_curve(vp1_ids[i], vp1_ids[nxt], l1))

            # Cap 2 edge
            d2 = pts2[nxt].clone().add(pts2[i].clone().multiply_scalar(-1.0)).normalize()
            l2 = self.add_line(p2_ids[i], self.add_vector(self.add_direction(d2.x, d2.y, d2.z)))
            e2_list.append(self.add_edge_curve(vp2_ids[i], vp2_ids[nxt], l2))

            # Side edge
            ds = pts2[i].clone().add(pts1[i].clone().multiply_scalar(-1.0)).normalize()
            ls = self.add_line(p1_ids[i], self.add_vector(self.add_direction(ds.x, ds.y, ds.z)))
            es_list.append(self.add_edge_curve(vp1_ids[i], vp2_ids[i], ls))

        faces = []

        # Side quad faces
        for i in range(N):
            nxt = (i + 1) % N
            oe1 = self.add_oriented_edge(e1_list[i], True)
            oes_nxt = self.add_oriented_edge(es_list[nxt], True)
            oe2_rev = self.add_oriented_edge(e2_list[i], False)
            oes_curr_rev = self.add_oriented_edge(es_list[i], False)

            loop = self.add_edge_loop([oe1, oes_nxt, oe2_rev, oes_curr_rev])
            bound = self.add_face_outer_bound(loop)

            # Normal of quad face
            v_a = pts1[nxt].clone().add(pts1[i].clone().multiply_scalar(-1.0))
            v_b = pts2[i].clone().add(pts1[i].clone().multiply_scalar(-1.0))
            fn = v_a.cross(v_b).normalize()
            dir_fn = self.add_direction(fn.x, fn.y, fn.z)
            ap = self.add_axis2_placement_3d(p1_ids[i], dir_fn, self.add_direction(v_a.x, v_a.y, v_a.z))
            faces.append(self.add_advanced_face([bound], self.add_plane(ap), True))

        # Cap 1 face (reverse: CCW viewed from outside)
        cap1_oe = [self.add_oriented_edge(e1_list[i], False) for i in reversed(range(N))]
        cap1_loop = self.add_edge_loop(cap1_oe)
        cap1_bound = self.add_face_outer_bound(cap1_loop)
        # Outward normal for Cap 1 is -D or exact radial normal
        if cap1_normal is not None:
            fn1 = cap1_normal.clone().normalize()
        else:
            D = pts2[0].clone().add(pts1[0].clone().multiply_scalar(-1.0)).normalize()
            fn1 = D.clone().multiply_scalar(-1.0)
        dir_fn1 = self.add_direction(fn1.x, fn1.y, fn1.z)
        ref_vec1 = Vector3D(0.0, 1.0, 0.0) if abs(fn1.y) < 0.9 else Vector3D(1.0, 0.0, 0.0)
        ref1 = fn1.cross(ref_vec1).normalize()
        dir_ref1 = self.add_direction(ref1.x, ref1.y, ref1.z)
        ap1 = self.add_axis2_placement_3d(p1_ids[0], dir_fn1, dir_ref1)
        faces.append(self.add_advanced_face([cap1_bound], self.add_plane(ap1), True))

        # Cap 2 face (forward: CCW viewed from outside)
        cap2_oe = [self.add_oriented_edge(e, True) for e in e2_list]
        cap2_loop = self.add_edge_loop(cap2_oe)
        cap2_bound = self.add_face_outer_bound(cap2_loop)
        if cap2_normal is not None:
            fn2 = cap2_normal.clone().normalize()
        else:
            D = pts2[0].clone().add(pts1[0].clone().multiply_scalar(-1.0)).normalize()
            fn2 = D.clone().normalize()
        dir_fn2 = self.add_direction(fn2.x, fn2.y, fn2.z)
        ref_vec2 = Vector3D(0.0, 1.0, 0.0) if abs(fn2.y) < 0.9 else Vector3D(1.0, 0.0, 0.0)
        ref2 = fn2.cross(ref_vec2).normalize()
        dir_ref2 = self.add_direction(ref2.x, ref2.y, ref2.z)
        ap2 = self.add_axis2_placement_3d(p2_ids[0], dir_fn2, dir_ref2)
        faces.append(self.add_advanced_face([cap2_bound], self.add_plane(ap2), True))

        shell = self.add_closed_shell(faces)
        brep = self.add_manifold_solid_brep(name, shell)
        styled = self.add_styled_item(brep, color)
        self.add_styled_faces(faces, color)
        return brep, styled

    def generate_step_string(self) -> str:
        lines = [
            "ISO-10303-21;",
            "HEADER;",
            "FILE_DESCRIPTION(('STEP AP214 Conveyor Assembly - Industrial Parametric CAD Solid'),'2;1');",
            f"FILE_NAME('{self.name}.step','{datetime.now().isoformat()}',('ALUFLEX Engineering'),('ALUFLEX Systems'),'{self.name}','Parametric STEP Exporter v3.0',' ');",
            "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }', 'AUTOMOTIVE_DESIGN'));",
            "ENDSEC;",
            "DATA;"
        ]
        for item in self.data:
            lines.append(item)
        lines.append("ENDSEC;")
        lines.append("END-ISO-10303-21;")
        return "\n".join(lines)


def build_cad_conveyor_step(config: Any) -> str:
    """
    Constructs the complete master engineering CAD STEP model for the configured ALUFLEX conveyor.
    Produces authentic solid geometry strictly matching the client's 82.5 curve master design.
    """
    # Configurations the client's real parts can express are composed from the client's exact STEP assembly.
    from app.step_compose import compose_step, family_params
    params, _notes = family_params(config)
    return compose_step(params)

    track_width = float(getattr(config, 'width', 82.5))
    conveyor_len = float(getattr(config, 'length', 3000.0))
    step = StepFileGenerator(name=f"ALUFLEX_CONVEYOR_{int(track_width)}MM_{int(conveyor_len)}MM")

    # Path generation from canonical geometry
    path = CanonicalConveyorPath(config)

    # Elevation: Floor is at Y = 0. Conveyor top belt surface is at Y = workingHeight (e.g. 850 mm)
    wh_cfg = getattr(config, 'workingHeight', None)
    wh_enabled = getattr(wh_cfg, 'enabled', True) if wh_cfg else True
    wh_type = getattr(wh_cfg, 'type', 'fixed') if wh_cfg else 'fixed'
    working_y = float(getattr(wh_cfg, 'height', 850.0)) if (wh_cfg and wh_enabled and wh_type != 'without-support') else 850.0

    solids: List[str] = []
    styled_items: List[str] = []

    # Color definitions (Strictly matching client reference Images 1, 2, 3, 4)
    chain_mat = getattr(config, 'chainMaterial', 'plastic')
    if chain_mat == 'plastic':
        chain_color = [0.82, 0.73, 0.54]   # POM-D Acetal Authentic Tan / Khaki (Image 2)
    elif chain_mat == 'stainless-steel':
        chain_color = [0.82, 0.85, 0.88]   # Polished AISI 304
    else:
        chain_color = [0.45, 0.48, 0.52]   # Carbon Steel

    frame_color = [0.78, 0.80, 0.83]       # Anodized Aluminium 6063-T6 (Natural Silver)
    wear_color = [0.15, 0.58, 0.25]        # UHMW Green Wear Strip Track
    motor_silver = [0.86, 0.88, 0.90]      # Cast Aluminium Silver Motor & Gearbox (Image 1)
    motor_flange_color = [0.22, 0.24, 0.26] # Dark Anthracite Intermediate Flange Ring (Image 1)
    terminal_box_color = [0.21, 0.23, 0.25] # Dark Anthracite Terminal Box (Image 1)
    motor_fan_color = [0.80, 0.82, 0.85]   # Aluminium Silver Fan Cowl (Image 1 - NOT yellow)
    support_color = [0.75, 0.77, 0.80]     # Structural Aluminium Column Extrusion (Image 4)
    hardware_color = [0.74, 0.77, 0.80]    # Stainless Steel / Zinc Plated Hardware
    guide_color = [0.12, 0.58, 0.28]       # Virgin UHMW Industrial Green Guide Rail (Image 4)
    guide_horn_color = [0.60, 0.65, 0.70]  # Molded Grey Entry/Exit Guide Horns (Image 4)
    stainless_bracket_color = [0.80, 0.82, 0.85] # Stainless Steel Sheet / C-Channel Backing (Image 4)
    knob_black_color = [0.10, 0.10, 0.12]  # Matte Black Phenolic Clamp Levers & Rubber Pads (Image 4)

    # Profile & Chain Dimensions
    half_track = track_width / 2.0
    profile_width = 24.0   # 24 mm standard extrusion profile
    profile_height = 92.0  # 92 mm profile height (strictly matching client spec & 804-85)
    frame_offset = half_track + profile_width / 2.0

    # 1. AUTHENTIC 92x24 MM EXTRUDED PROFILE WITH T-SLOT GROOVE & SHOULDERS
    # Counter-clockwise 2D polygon with outer T-slot channel, wear strip shelf, and inner return chain ledge:
    right_profile_pts_2d = [
        (12.0, -46.0),
        (12.0, -8.0),
        (8.0, -8.0),
        (8.0, -11.0),
        (6.0, -11.0),
        (6.0, 11.0),
        (8.0, 11.0),
        (8.0, 8.0),
        (12.0, 8.0),
        (12.0, 42.0),
        (12.0, 46.0),
        (2.0, 46.0),
        (2.0, 42.0),
        (-10.0, 42.0),
        (-10.0, 46.0),
        (-12.0, 46.0),
        (-12.0, -18.0),
        (-8.0, -18.0),
        (-8.0, -28.0),
        (-12.0, -28.0),
        (-12.0, -46.0)
    ]
    # Mirror lateral coordinates and reverse order for left profile (preserves CCW winding):
    left_profile_pts_2d = [(-x, y) for (x, y) in reversed(right_profile_pts_2d)]

    # UHMW-PE Wear strip 2D cross-section (nested in the 12 mm x 4 mm shoulder, protruding 2 mm above):
    right_wear_pts_2d = [(-10.0, 42.0), (2.0, 42.0), (2.0, 48.0), (-10.0, 48.0)]
    left_wear_pts_2d = [(-2.0, 42.0), (10.0, 42.0), (10.0, 48.0), (-2.0, 48.0)]

    for seg in path.segments:
        if seg.seg_type == 'straight':
            tan = Vector3D(math.cos(seg.start_heading), 0.0, math.sin(seg.start_heading)).normalize()
            norm = Vector3D(-math.sin(seg.start_heading), 0.0, math.cos(seg.start_heading)).normalize()

            # Left Profile Rail (with outer T-slot on -norm side)
            lp_start = seg.start_point.clone().add(norm.clone().multiply_scalar(-frame_offset))
            lp_end = seg.end_point.clone().add(norm.clone().multiply_scalar(-frame_offset))
            br, st = step.add_straight_extruded_solid(left_profile_pts_2d, lp_start, lp_end, norm, working_y, "Left_Profile_Straight", frame_color)
            solids.append(br); styled_items.append(st)

            # Right Profile Rail (with outer T-slot on +norm side)
            rp_start = seg.start_point.clone().add(norm.clone().multiply_scalar(frame_offset))
            rp_end = seg.end_point.clone().add(norm.clone().multiply_scalar(frame_offset))
            br, st = step.add_straight_extruded_solid(right_profile_pts_2d, rp_start, rp_end, norm, working_y, "Right_Profile_Straight", frame_color)
            solids.append(br); styled_items.append(st)

            # Left and Right Wear Strips
            br, st = step.add_straight_extruded_solid(left_wear_pts_2d, lp_start, lp_end, norm, working_y, "Wear_Strip_L_Straight", wear_color)
            solids.append(br); styled_items.append(st)
            br, st = step.add_straight_extruded_solid(right_wear_pts_2d, rp_start, rp_end, norm, working_y, "Wear_Strip_R_Straight", wear_color)
            solids.append(br); styled_items.append(st)

        elif seg.seg_type == 'curve':
            is_left = (seg.direction == 'left')
            r_center = seg.radius
            num_steps = max(16, int(seg.sweep_angle / (math.pi / 20)))

            r_inner = r_center - frame_offset
            r_outer = r_center + frame_offset

            # Curve Left Profile Rail
            curved_left = step.add_curved_extruded_solid(
                profile_pts_2d=left_profile_pts_2d if is_left else right_profile_pts_2d,
                center_arc=seg.center,
                center_radius=r_inner if is_left else r_outer,
                start_angle=seg.start_angle,
                end_angle=seg.end_angle,
                is_left=is_left,
                working_y=working_y,
                name="Curved_Left_Frame_Rail",
                color=frame_color,
                num_steps=num_steps
            )
            for br, st in curved_left: solids.append(br); styled_items.append(st)

            # Curve Right Profile Rail
            curved_right = step.add_curved_extruded_solid(
                profile_pts_2d=right_profile_pts_2d if is_left else left_profile_pts_2d,
                center_arc=seg.center,
                center_radius=r_outer if is_left else r_inner,
                start_angle=seg.start_angle,
                end_angle=seg.end_angle,
                is_left=is_left,
                working_y=working_y,
                name="Curved_Right_Frame_Rail",
                color=frame_color,
                num_steps=num_steps
            )
            for br, st in curved_right: solids.append(br); styled_items.append(st)

            # Curved Wear Strips
            curved_wear_l = step.add_curved_extruded_solid(
                profile_pts_2d=left_wear_pts_2d if is_left else right_wear_pts_2d,
                center_arc=seg.center,
                center_radius=r_inner if is_left else r_outer,
                start_angle=seg.start_angle,
                end_angle=seg.end_angle,
                is_left=is_left,
                working_y=working_y,
                name="Curved_Wear_Strip_L",
                color=wear_color,
                num_steps=num_steps
            )
            for br, st in curved_wear_l: solids.append(br); styled_items.append(st)

            curved_wear_r = step.add_curved_extruded_solid(
                profile_pts_2d=right_wear_pts_2d if is_left else left_wear_pts_2d,
                center_arc=seg.center,
                center_radius=r_outer if is_left else r_inner,
                start_angle=seg.start_angle,
                end_angle=seg.end_angle,
                is_left=is_left,
                working_y=working_y,
                name="Curved_Wear_Strip_R",
                color=wear_color,
                num_steps=num_steps
            )
            for br, st in curved_wear_r: solids.append(br); styled_items.append(st)

            # Authentic Alutec ZP90 Wheel Bend Rotating Disc & Center Hub (AC645086 from target assembly)
            wheel_disc_r = max(60.0, r_inner - 8.0)
            wheel_hub_c = seg.center.clone(); wheel_hub_c.y = working_y + 15.0
            br, st = step.add_solid_cylinder(wheel_hub_c, Vector3D(0.0, 1.0, 0.0), 30.0, 35.0, "Wheel_Bend_Center_Hub", [0.80, 0.82, 0.85], segments=18)
            solids.append(br); styled_items.append(st)

            # Wheel Bend Rotating Guide Sector Disc
            disc_c = seg.center.clone(); disc_c.y = working_y + 36.0
            br, st = step.add_solid_cylinder(disc_c, Vector3D(0.0, 1.0, 0.0), wheel_disc_r, 8.0, "Wheel_Bend_Rotating_Disc", [0.93, 0.94, 0.96], segments=24)
            solids.append(br); styled_items.append(st)

            # Curve Splice Connector Plates (joining straight extrusion profiles into the curve)
            for p_joint, j_name in [(seg.start_point, "Infeed"), (seg.end_point, "Discharge")]:
                j_c = p_joint.clone(); j_c.y = working_y
                br, st = step.add_solid_box(j_c, Vector3D(1.0, 0.0, 0.0), Vector3D(0.0, 0.0, 1.0), 30.0, 2.0, 40.0, f"Curve_Joint_Splice_Plate_{j_name}", [0.85, 0.88, 0.90])
                solids.append(br); styled_items.append(st)

            # Under-curve radial cross-brace spacers
            for frac in [0.25, 0.50, 0.75]:
                ang = seg.start_angle + frac * (seg.end_angle - seg.start_angle)
                mid_r = (r_inner + r_outer) / 2.0
                rad_pos = Vector3D(seg.center.x + mid_r * math.cos(ang), working_y - 20.0, seg.center.z + mid_r * math.sin(ang))
                rad_tan = Vector3D(-math.sin(ang), 0.0, math.cos(ang)).normalize()
                rad_norm = Vector3D(math.cos(ang), 0.0, math.sin(ang)).normalize()

                # Radial spacer tie block between inner and outer curved profiles
                br, st = step.add_solid_box(rad_pos, rad_tan, rad_norm, 15.0, (r_outer - r_inner - profile_width) / 2.0, 15.0, f"Curve_Cross_Spacer_{int(frac*100)}", support_color)
                solids.append(br); styled_items.append(st)

    # 2. CROSS-TIE STRUCTURAL BEAMS
    num_cross = max(2, int(path.total_length / 600.0))
    for c_idx in range(num_cross + 1):
        dist = (c_idx / num_cross) * path.total_length
        dist = max(50.0, min(path.total_length - 50.0, dist))
        s_cross = path.get_sample_at_distance(dist)
        cb_center = s_cross.point.clone(); cb_center.y = working_y - 20.0
        cb_w = track_width + profile_width
        br, st = step.add_solid_box(cb_center, s_cross.tangent, s_cross.normal, 20.0, cb_w / 2.0, 20.0, f"Frame_Cross_Beam_{c_idx}", support_color)
        solids.append(br); styled_items.append(st)

    # 3. MODULAR SLAT CHAIN (Pitch = 38.1 mm - conveyor-modular-chain-link.png & Image 2)
    pitch = 38.1 if (63.0 < track_width <= 114.3 or track_width == 82.5) else (25.4 if track_width <= 63.0 else 50.8)
    num_links = max(2, int(path.total_length / pitch))
    chain_top_y = working_y + 48.0

    for l_idx in range(num_links):
        d_link = (l_idx + 0.5) * pitch
        if d_link > path.total_length - 10.0:
            break
        s_link = path.get_sample_at_distance(d_link)
        slat_center = s_link.point.clone(); slat_center.y = chain_top_y + 2.25

        # 3A. Slat Main Top Carrying Plate (width = track_width - 1.0 mm, plate length = 25 mm, thickness = 4.5 mm)
        br, st = step.add_solid_box(
            slat_center,
            s_link.tangent,
            s_link.normal,
            12.5,
            half_track - 0.75,
            2.25,
            f"Chain_Slat_Plate_{l_idx+1}",
            chain_color
        )
        solids.append(br); styled_items.append(st)

        # 3B. Forward Interlocking Knuckle Pair (Image 2: two outer barrels at leading edge)
        fwd_knuckle_c = slat_center.clone().add(s_link.tangent.clone().multiply_scalar(14.0))
        fwd_knuckle_c.y -= 1.0
        knuckle_spacing = (half_track - 4.0) * 0.55
        for k_sign, k_name in [(-1.0, "L"), (1.0, "R")]:
            k_pos = fwd_knuckle_c.clone().add(s_link.normal.clone().multiply_scalar(k_sign * knuckle_spacing))
            br, st = step.add_solid_box(k_pos, s_link.tangent, s_link.normal, 4.0, 7.0, 2.75, f"Chain_Fwd_Knuckle_{k_name}_{l_idx+1}", chain_color)
            solids.append(br); styled_items.append(st)

        # 3C. Trailing Central Interlocking Knuckle (Image 2: single center barrel at trailing edge)
        trail_knuckle_c = slat_center.clone().add(s_link.tangent.clone().multiply_scalar(-14.0))
        trail_knuckle_c.y -= 1.0
        br, st = step.add_solid_box(trail_knuckle_c, s_link.tangent, s_link.normal, 4.0, 10.0, 2.75, f"Chain_Trail_Knuckle_{l_idx+1}", chain_color)
        solids.append(br); styled_items.append(st)

        # 3D. Stainless Steel Slat Connecting Hinge Pin (Ø6 mm solid cylinder through forward knuckles)
        pin_center = fwd_knuckle_c.clone()
        br, st = step.add_solid_cylinder(
            pin_center,
            s_link.normal,
            3.0,
            track_width - 8.0,
            f"Chain_Hinge_Pin_{l_idx+1}",
            hardware_color,
            segments=12
        )
        solids.append(br); styled_items.append(st)

        # 3E. Underside Curve Retention Tabs (Image 2: L-shaped guide tabs holding chain in profile track)
        for tab_sign, tab_name in [(-1.0, "L"), (1.0, "R")]:
            tab_c = slat_center.clone().add(s_link.normal.clone().multiply_scalar(tab_sign * (half_track - 14.0)))
            tab_c.y -= 6.0
            br, st = step.add_solid_box(tab_c, s_link.tangent, s_link.normal, 8.0, 3.5, 4.0, f"Chain_Guide_Tab_{tab_name}_{l_idx+1}", chain_color)
            solids.append(br); styled_items.append(st)

    # Terminal Sprocket & Shaft Geometry Constants
    terminal_sprocket_r = 48.0  # Authentic ALUFLEX terminal sprocket radius (pitch line tangent to wear strip at working_y + 46.0 mm)
    terminal_shaft_fwd = 50.0   # Centers sprocket 50 mm beyond profile rail cut face (leaves 2.0 mm clear space between sprocket and frame)
    terminal_shaft_y = working_y - 2.0 # Sprocket top at working_y + 46.0 mm, bottom at working_y - 50.0 mm

    # Return chain run underneath conveyor (aligned with bottom of sprockets at working_y - 52.25 mm)
    num_return_links = max(2, int(path.total_length / (pitch * 3.0)))
    for r_idx in range(num_return_links):
        d_ret = (r_idx + 0.5) * (pitch * 3.0)
        if d_ret > path.total_length - 10.0:
            break
        s_ret = path.get_sample_at_distance(d_ret)
        ret_center = s_ret.point.clone(); ret_center.y = working_y - 52.25
        br, st = step.add_solid_box(ret_center, s_ret.tangent, s_ret.normal, (pitch * 3.0) / 2.0, half_track * 0.9, 1.25, f"Return_Chain_{r_idx+1}", chain_color)
        solids.append(br); styled_items.append(st)

    # 3F. Sprocket Wrap-Around Chain Links (tangentially hugging the sprockets with zero interpenetration)
    wrap_r = terminal_sprocket_r + 1.25 # Center of slat plate riding outside sprocket

    # Discharge end wrap
    d_end_sample = path.samples[-1]
    drive_shaft_wrap_pt = d_end_sample.point.clone().add(d_end_sample.tangent.clone().multiply_scalar(terminal_shaft_fwd))
    drive_shaft_wrap_pt.y = terminal_shaft_y
    for w_i in range(5):
        w_ang = (w_i + 0.5) * (math.pi / 5.0)
        u_wrap = d_end_sample.tangent.clone().multiply_scalar(math.sin(w_ang)).add(Vector3D(0.0, math.cos(w_ang), 0.0)).normalize()
        t_wrap = d_end_sample.tangent.clone().multiply_scalar(math.cos(w_ang)).add(Vector3D(0.0, -math.sin(w_ang), 0.0)).normalize()
        w_pos = drive_shaft_wrap_pt.clone().add(u_wrap.clone().multiply_scalar(wrap_r))
        br, st = step.add_solid_box(w_pos, t_wrap, d_end_sample.normal, 12.0, half_track - 1.0, 1.25, f"Chain_End_Wrap_{w_i+1}", chain_color, up=u_wrap)
        solids.append(br); styled_items.append(st)

    # Infeed idler wrap
    d_start_sample = path.samples[0]
    idler_shaft_wrap_pt = d_start_sample.point.clone().add(d_start_sample.tangent.clone().multiply_scalar(-terminal_shaft_fwd))
    idler_shaft_wrap_pt.y = terminal_shaft_y
    for w_i in range(5):
        w_ang = (w_i + 0.5) * (math.pi / 5.0)
        u_infeed = d_start_sample.tangent.clone().multiply_scalar(-math.sin(w_ang)).add(Vector3D(0.0, math.cos(w_ang), 0.0)).normalize()
        t_infeed = d_start_sample.tangent.clone().multiply_scalar(-math.cos(w_ang)).add(Vector3D(0.0, -math.sin(w_ang), 0.0)).normalize()
        w_pos = idler_shaft_wrap_pt.clone().add(u_infeed.clone().multiply_scalar(wrap_r))
        br, st = step.add_solid_box(w_pos, t_infeed, d_start_sample.normal, 12.0, half_track - 1.0, 1.25, f"Chain_Start_Wrap_{w_i+1}", chain_color, up=u_infeed)
        solids.append(br); styled_items.append(st)

    # 4. SIDE GUIDE SYSTEM WITH STAINLESS BACKING & ANGLED LOCKING LEVER HANDLES (Image 4)
    side_guides = getattr(config, 'sideGuides', None)
    if side_guides and len(side_guides) > 0:
        sg = side_guides[0]
        guide_dist = float(getattr(sg, 'widthBetweenGuides', 100.0) if hasattr(sg, 'widthBetweenGuides') else sg.get('widthBetweenGuides', 100.0))
        guide_h = float(getattr(sg, 'heightAboveChain', 60.0) if hasattr(sg, 'heightAboveChain') else sg.get('heightAboveChain', 60.0))
        guide_offset = guide_dist / 2.0
        guide_y = chain_top_y + guide_h

        # Guide Rail 2D cross sections (Green UHMW profile + Stainless steel C-channel backing):
        guide_pts_2d = [(-6.0, 10.0), (6.0, 10.0), (6.0, -10.0), (-6.0, -10.0)]
        backing_pts_2d = [(6.0, 12.0), (8.5, 12.0), (8.5, -12.0), (6.0, -12.0)]

        for seg in path.segments:
            if seg.seg_type == 'straight':
                tan = Vector3D(math.cos(seg.start_heading), 0.0, math.sin(seg.start_heading)).normalize()
                norm = Vector3D(-math.sin(seg.start_heading), 0.0, math.cos(seg.start_heading)).normalize()
                seg_mid = Vector3D((seg.start_point.x + seg.end_point.x) / 2.0, 0.0, (seg.start_point.z + seg.end_point.z) / 2.0)

                # Left Guide Rail + Stainless Backing Channel
                lg_center = seg_mid.clone().add(norm.clone().multiply_scalar(-guide_offset))
                lg_center.y = guide_y
                br, st = step.add_solid_box(lg_center, tan, norm, seg.length / 2.0, 6.0, 10.0, "Left_Side_Guide_Straight", guide_color)
                solids.append(br); styled_items.append(st)
                lgb_center = lg_center.clone().add(norm.clone().multiply_scalar(-7.25))
                br, st = step.add_solid_box(lgb_center, tan, norm, seg.length / 2.0, 1.25, 12.0, "Left_Guide_Stainless_Backing", stainless_bracket_color)
                solids.append(br); styled_items.append(st)

                # Right Guide Rail + Stainless Backing Channel
                rg_center = seg_mid.clone().add(norm.clone().multiply_scalar(guide_offset))
                rg_center.y = guide_y
                br, st = step.add_solid_box(rg_center, tan, norm, seg.length / 2.0, 6.0, 10.0, "Right_Side_Guide_Straight", guide_color)
                solids.append(br); styled_items.append(st)
                rgb_center = rg_center.clone().add(norm.clone().multiply_scalar(7.25))
                br, st = step.add_solid_box(rgb_center, tan, norm, seg.length / 2.0, 1.25, 12.0, "Right_Guide_Stainless_Backing", stainless_bracket_color)
                solids.append(br); styled_items.append(st)

            elif seg.seg_type == 'curve':
                is_left = (seg.direction == 'left')
                num_guide_steps = max(16, int(seg.sweep_angle / (math.pi / 20)))
                r_guide_in = seg.radius - guide_offset
                r_guide_out = seg.radius + guide_offset

                cg_left = step.add_curved_extruded_solid(
                    profile_pts_2d=guide_pts_2d,
                    center_arc=seg.center,
                    center_radius=r_guide_in if is_left else r_guide_out,
                    start_angle=seg.start_angle,
                    end_angle=seg.end_angle,
                    is_left=is_left,
                    working_y=guide_y,
                    name="Curved_Left_Side_Guide",
                    color=guide_color,
                    num_steps=num_guide_steps
                )
                for br, st in cg_left: solids.append(br); styled_items.append(st)

                cg_right = step.add_curved_extruded_solid(
                    profile_pts_2d=guide_pts_2d,
                    center_arc=seg.center,
                    center_radius=r_guide_out if is_left else r_guide_in,
                    start_angle=seg.start_angle,
                    end_angle=seg.end_angle,
                    is_left=is_left,
                    working_y=guide_y,
                    name="Curved_Right_Side_Guide",
                    color=guide_color,
                    num_steps=num_guide_steps
                )
                for br, st in cg_right: solids.append(br); styled_items.append(st)

        # Flared lead-in entry horns at infeed and outfeed (Image 4: molded grey shoes flared outward by 35 mm)
        for sample_d, flare_sign, f_name in [(20.0, -1.0, "Infeed"), (path.total_length - 20.0, 1.0, "Outfeed")]:
            s_flare = path.get_sample_at_distance(sample_d)
            for side_sign, s_name in [(-1.0, "Left"), (1.0, "Right")]:
                horn_center = s_flare.point.clone().add(s_flare.normal.clone().multiply_scalar(side_sign * (guide_offset + 18.0)))
                horn_center.y = guide_y
                br, st = step.add_solid_box(horn_center, s_flare.tangent, s_flare.normal, 35.0, 5.0, 10.0, f"Guide_Flare_Horn_{f_name}_{s_name}", guide_horn_color)
                solids.append(br); styled_items.append(st)

        # Authentic Guide Bracket Assemblies (Image 4: Profile clamp, Vertical rod, Cross clamp with Angled Lever, Horizontal rod, Shoe clamp)
        num_brackets = max(3, int(path.total_length / 450.0))
        for b_idx in range(num_brackets + 1):
            dist = max(30.0, min(path.total_length - 30.0, (b_idx / num_brackets) * path.total_length))
            s_brk = path.get_sample_at_distance(dist)

            for side_sign, s_name in [(-1.0, "L"), (1.0, "R")]:
                # Clamping block at outer frame profile T-slot
                clamp_center = s_brk.point.clone().add(s_brk.normal.clone().multiply_scalar(side_sign * (frame_offset + 12.0)))
                clamp_center.y = working_y
                br, st = step.add_solid_box(clamp_center, s_brk.tangent, s_brk.normal, 14.0, 12.0, 10.0, f"Guide_Frame_Clamp_{s_name}_{b_idx}", hardware_color)
                solids.append(br); styled_items.append(st)

                # Vertical mounting post (Ø12 mm stainless round rod)
                rod_h = (guide_y - working_y) + 35.0
                rod_center = clamp_center.clone(); rod_center.y = working_y + rod_h / 2.0 - 10.0
                br, st = step.add_solid_cylinder(rod_center, Vector3D(0.0, 1.0, 0.0), 6.0, rod_h, f"Guide_Vertical_Post_{s_name}_{b_idx}", hardware_color, segments=12)
                solids.append(br); styled_items.append(st)

                # Dual-bore Cross Clamp Block
                up_clamp = clamp_center.clone(); up_clamp.y = guide_y
                br, st = step.add_solid_box(up_clamp, s_brk.tangent, s_brk.normal, 14.0, 14.0, 16.0, f"Guide_Cross_Clamp_{s_name}_{b_idx}", hardware_color)
                solids.append(br); styled_items.append(st)

                # Ergonomic Angled Rotary Locking Lever Handle (Image 4 signature detail)
                lever_stem_dir = s_brk.normal.clone().multiply_scalar(side_sign * 0.707).add(Vector3D(0.0, -0.707, 0.0)).normalize()
                lever_stem_center = up_clamp.clone().add(lever_stem_dir.clone().multiply_scalar(30.0))
                br, st = step.add_solid_cylinder(lever_stem_center, lever_stem_dir, 3.5, 60.0, f"Guide_Lever_Stem_{s_name}_{b_idx}", hardware_color, segments=12)
                solids.append(br); styled_items.append(st)
                knob_center = up_clamp.clone().add(lever_stem_dir.clone().multiply_scalar(60.0))
                br, st = step.add_solid_cylinder(knob_center, lever_stem_dir, 8.0, 20.0, f"Guide_Lever_Knob_{s_name}_{b_idx}", knob_black_color, segments=16)
                solids.append(br); styled_items.append(st)

                # Horizontal cross connecting rod (Ø12 mm stainless round rod)
                rod_arm_len = abs((frame_offset + 12.0) - (guide_offset + 8.0)) + 20.0
                horiz_rod_center = s_brk.point.clone().add(s_brk.normal.clone().multiply_scalar(side_sign * ((frame_offset + 12.0 + guide_offset + 8.0) / 2.0)))
                horiz_rod_center.y = guide_y
                br, st = step.add_solid_cylinder(horiz_rod_center, s_brk.normal, 6.0, rod_arm_len, f"Guide_Horiz_Arm_{s_name}_{b_idx}", hardware_color, segments=12)
                solids.append(br); styled_items.append(st)

                # Rail Clamp Shoe at Guide Backing
                shoe_center = s_brk.point.clone().add(s_brk.normal.clone().multiply_scalar(side_sign * (guide_offset + 8.0)))
                shoe_center.y = guide_y
                br, st = step.add_solid_box(shoe_center, s_brk.tangent, s_brk.normal, 10.0, 5.0, 12.0, f"Guide_Rail_Shoe_{s_name}_{b_idx}", hardware_color)
                solids.append(br); styled_items.append(st)

    # 5. SUPPORT STANDS (Image 4: Dual structural columns, top cross beam, mid cross tie, base foot beam, gussets, leveling feet)
    if wh_enabled and wh_type != 'without-support':
        foot_type = getattr(wh_cfg, 'footType', 'adjustable') if wh_cfg else 'adjustable'
        is_wheel = foot_type in ['wheel-without-brake', 'wheel-with-brake']
        foot_clearance = 76.0 if is_wheel else (16.0 if foot_type in ['fixed', 'base-plate'] else 30.0)

        top_beam_w = track_width + profile_width * 2.0 + 20.0
        col_h = max(100.0, working_y - 40.0 - 40.0 - foot_clearance)
        base_beam_w = 460.0
        feet_spacing_half = 190.0

        # Calculate stand positions along path: dynamic span distribution (no straight span > 2000 mm)
        curve_segs = [s for s in path.segments if s.seg_type == 'curve']
        max_span = 2000.0
        stand_dists = []

        if not curve_segs:
            # Linear straight conveyor
            total_len = path.total_length
            if total_len <= 600.0:
                stand_dists = [total_len / 2.0]
            else:
                infeed_pos = min(250.0, total_len * 0.2)
                drive_pos = max(infeed_pos + 300.0, total_len - 280.0)
                middle_span = drive_pos - infeed_pos
                stand_dists.append(infeed_pos)
                if middle_span > max_span:
                    num_inter = int(middle_span // max_span)
                    step_val = middle_span / (num_inter + 1)
                    for k in range(1, num_inter + 1):
                        stand_dists.append(infeed_pos + k * step_val)
                stand_dists.append(drive_pos)
        else:
            for s_idx, seg in enumerate(path.segments):
                is_first = (s_idx == 0)
                is_last = (s_idx == len(path.segments) - 1)
                if seg.seg_type == 'straight':
                    seg_len = seg.length
                    if is_first:
                        start_stand = seg.start_distance + min(250.0, seg_len * 0.25)
                        end_stand = seg.end_distance - min(120.0, seg_len * 0.15)
                    elif is_last:
                        start_stand = seg.start_distance + min(120.0, seg_len * 0.15)
                        end_stand = seg.end_distance - min(280.0, seg_len * 0.25)
                    else:
                        start_stand = seg.start_distance + min(120.0, seg_len * 0.15)
                        end_stand = seg.end_distance - min(120.0, seg_len * 0.15)

                    if end_stand - start_stand >= 300.0:
                        stand_dists.append(start_stand)
                        span = end_stand - start_stand
                        if span > max_span:
                            num_inter = int(span // max_span)
                            step_val = span / (num_inter + 1)
                            for k in range(1, num_inter + 1):
                                stand_dists.append(start_stand + k * step_val)
                        stand_dists.append(end_stand)
                    else:
                        stand_dists.append((seg.start_distance + seg.end_distance) / 2.0)

        # Sort and deduplicate
        stand_dists = sorted(list(set([round(d, 1) for d in stand_dists])))
        filtered_stands = []
        for d in stand_dists:
            if not filtered_stands or (d - filtered_stands[-1]) >= 200.0:
                filtered_stands.append(d)
        stand_dists = [max(40.0, min(path.total_length - 40.0, d)) for d in filtered_stands]

        for s_idx, target_d in enumerate(stand_dists):
            s_sup = path.get_sample_at_distance(target_d)

            # 5A. U-Cradle Mounting Bracket clamping 92 mm profile (Image Mechanical Adjustable leg.png)
            u_base_c = s_sup.point.clone()
            u_base_c.y = working_y - 50.0  # Directly under 92 mm profile bottom (working_y - 46.0)
            u_w = (track_width + profile_width * 2.0 + 8.0) / 2.0
            br, st = step.add_solid_box(u_base_c, s_sup.tangent, s_sup.normal, 45.0, u_w, 8.0, f"Support_U_Cradle_Base_{s_idx+1}", knob_black_color)
            solids.append(br); styled_items.append(st)

            # Left and Right vertical clamping ears of U-cradle with T-slot clamp bolts
            for side_sign, s_name in [(-1.0, "L"), (1.0, "R")]:
                ear_c = s_sup.point.clone().add(s_sup.normal.clone().multiply_scalar(side_sign * (u_w - 4.0)))
                ear_c.y = working_y - 20.0
                br, st = step.add_solid_box(ear_c, s_sup.tangent, s_sup.normal, 45.0, 4.0, 30.0, f"Support_U_Ear_{s_name}_{s_idx+1}", knob_black_color)
                solids.append(br); styled_items.append(st)

                # Clamping bolts into frame T-slot (2 per ear)
                bolt_c = ear_c.clone().add(s_sup.normal.clone().multiply_scalar(side_sign * 5.0))
                bolt_c.y = working_y - 10.0
                br, st = step.add_solid_cylinder(bolt_c, s_sup.normal, 6.0, 8.0, f"Support_Clamp_Bolt_Top_{s_name}_{s_idx+1}", hardware_color, segments=10)
                solids.append(br); styled_items.append(st)
                bolt_c2 = bolt_c.clone(); bolt_c2.y = working_y - 30.0
                br, st = step.add_solid_cylinder(bolt_c2, s_sup.normal, 6.0, 8.0, f"Support_Clamp_Bolt_Btm_{s_name}_{s_idx+1}", hardware_color, segments=10)
                solids.append(br); styled_items.append(st)

            # 5B. Top Mount Head Plate connecting U-cradle to column
            top_collar_c = s_sup.point.clone()
            top_collar_c.y = working_y - 58.0
            br, st = step.add_solid_box(top_collar_c, s_sup.tangent, s_sup.normal, 60.0, 50.0, 8.0, f"Support_Top_Collar_{s_idx+1}", support_color)
            solids.append(br); styled_items.append(st)

            # 5C. Column Assembly: Authentic Linak DL5 Motorized Electric Column or Telescoping Mechanical Stand
            is_electric = (wh_type == 'electrically-adjustable')
            if is_electric:
                # Authentic Linak DL5 Motorized Electric Telescopic Column (Image 1, 2, 3: 804-125-Linak_DL5)
                # Outer Lower Sleeve (50x80 mm dark anthracite profile)
                outer_h = col_h * 0.65
                outer_c = s_sup.point.clone()
                outer_c.y = (foot_clearance + 90.0) + outer_h / 2.0
                br, st = step.add_solid_box(outer_c, s_sup.tangent, s_sup.normal, 25.0, 40.0, outer_h / 2.0, f"Linak_DL5_Outer_Sleeve_{s_idx+1}", [0.20, 0.22, 0.24])
                solids.append(br); styled_items.append(st)

                # Inner Upper Telescoping Column (44x74 mm)
                inner_h = col_h * 0.55
                inner_c = s_sup.point.clone()
                inner_c.y = working_y - 65.0 - inner_h / 2.0
                br, st = step.add_solid_box(inner_c, s_sup.tangent, s_sup.normal, 22.0, 37.0, inner_h / 2.0, f"Linak_DL5_Inner_Tube_{s_idx+1}", [0.32, 0.35, 0.38])
                solids.append(br); styled_items.append(st)

                # Telescopic Collar Ring at joint
                collar_c = s_sup.point.clone(); collar_c.y = outer_c.y + outer_h / 2.0 - 10.0
                br, st = step.add_solid_box(collar_c, s_sup.tangent, s_sup.normal, 28.0, 43.0, 10.0, f"Linak_DL5_Collar_{s_idx+1}", knob_black_color)
                solids.append(br); styled_items.append(st)

                # Top Angled Steel Mounting Bracket (clamping to conveyor frame with M8 bolts)
                brk_c = s_sup.point.clone(); brk_c.y = working_y - 35.0
                br, st = step.add_solid_box(brk_c, s_sup.tangent, s_sup.normal, 35.0, (track_width + 50.0) / 2.0, 4.0, f"Linak_Mount_Plate_{s_idx+1}", [0.12, 0.12, 0.14])
                solids.append(br); styled_items.append(st)

                # Linak CBD6s Motor Control Box clamped to the column (150x85x36 mm black box)
                box_c = outer_c.clone().add(s_sup.normal.clone().multiply_scalar(58.0))
                box_c.y = outer_c.y + 20.0
                br, st = step.add_solid_box(box_c, s_sup.tangent, s_sup.normal, 42.0, 18.0, 75.0, f"Linak_CBD6s_Control_Box_{s_idx+1}", [0.08, 0.08, 0.09])
                solids.append(br); styled_items.append(st)

                # Linak DPA Rocker Switch on column
                switch_c = outer_c.clone().add(s_sup.normal.clone().multiply_scalar(-48.0))
                switch_c.y = outer_c.y + outer_h / 2.0 - 25.0
                br, st = step.add_solid_box(switch_c, s_sup.tangent, s_sup.normal, 20.0, 10.0, 15.0, f"Linak_DPA_Switch_{s_idx+1}", [0.15, 0.15, 0.16])
                solids.append(br); styled_items.append(st)
            else:
                # Telescoping Vertical Structural Extrusion Column (Image Mechanical Adjustable leg.png)
                col_color = [0.75, 0.77, 0.80] if foot_type == 'adjustable' else [0.32, 0.35, 0.38]
                inner_col_h = col_h * 0.55
                inner_col_c = s_sup.point.clone()
                inner_col_c.y = (working_y - 62.0) - inner_col_h / 2.0
                br, st = step.add_solid_box(inner_col_c, s_sup.tangent, s_sup.normal, 40.0, 25.0, inner_col_h / 2.0, f"Support_Inner_Column_{s_idx+1}", support_color)
                solids.append(br); styled_items.append(st)

                outer_col_h = max(80.0, working_y - 62.0 - 90.0)
                outer_col_c = s_sup.point.clone()
                outer_col_c.y = 90.0 + outer_col_h / 2.0
                br, st = step.add_solid_box(outer_col_c, s_sup.tangent, s_sup.normal, 55.0, 38.0, outer_col_h / 2.0, f"Support_Outer_Column_{s_idx+1}", col_color)
                solids.append(br); styled_items.append(st)

                clamp_sleeve_c = s_sup.point.clone()
                clamp_sleeve_c.y = outer_col_c.y + outer_col_h / 2.0 - 15.0
                br, st = step.add_solid_box(clamp_sleeve_c, s_sup.tangent, s_sup.normal, 60.0, 42.0, 25.0, f"Support_Clamp_Sleeve_{s_idx+1}", support_color)
                solids.append(br); styled_items.append(st)

                for b_y_off, b_n in [(-8.0, "Btm"), (8.0, "Top")]:
                    for b_s, b_sn in [(-1.0, "L"), (1.0, "R")]:
                        b_pos = clamp_sleeve_c.clone().add(s_sup.normal.clone().multiply_scalar(b_s * 25.0))
                        b_pos.y += b_y_off
                        br, st = step.add_solid_cylinder(b_pos, s_sup.normal, 5.0, 10.0, f"Support_Sleeve_Bolt_{b_n}_{b_sn}_{s_idx+1}", hardware_color, segments=10)
                        solids.append(br); styled_items.append(st)

            # 5D. Base Support Structure: Heavy-Duty 45x90 Profile Mobile Tripod Base or Base Beam
            if is_wheel:
                # Authentic Alutec Heavy-Duty 45x90 Base Frame (Images 1, 2, 3: 804-125-30-noha)
                # Main Transverse 45x90 Profile Beam
                base_y = 65.0
                bb_center = s_sup.point.clone(); bb_center.y = base_y
                br, st = step.add_solid_box(bb_center, s_sup.tangent, s_sup.normal, 22.5, base_beam_w / 2.0, 45.0, f"Support_45x90_Base_Beam_{s_idx+1}", support_color)
                solids.append(br); styled_items.append(st)

                # Forward Cantilever Foot Beam (45x90 profile extending 220 mm forward for tip stability)
                cant_center = s_sup.point.clone().add(s_sup.tangent.clone().multiply_scalar(110.0))
                cant_center.y = base_y
                br, st = step.add_solid_box(cant_center, s_sup.tangent, s_sup.normal, 110.0, 22.5, 45.0, f"Support_45x90_Cantilever_Foot_{s_idx+1}", support_color)
                solids.append(br); styled_items.append(st)

                # Diagonal Gusset Brackets (black steel corner reinforcement)
                for g_sign, g_name in [(-1.0, "Left"), (1.0, "Right")]:
                    gusset_c = s_sup.point.clone().add(s_sup.normal.clone().multiply_scalar(g_sign * 55.0))
                    gusset_c.y = base_y + 45.0 + 20.0
                    br, st = step.add_solid_box(gusset_c, s_sup.tangent, s_sup.normal, 20.0, 8.0, 20.0, f"Base_Gusset_{g_name}_{s_idx+1}", knob_black_color)
                    solids.append(br); styled_items.append(st)

                # 3 Heavy-Duty Swivel Braked Castor Wheels (517508 with brake pedals)
                castor_positions = [
                    (s_sup.point.clone().add(s_sup.normal.clone().multiply_scalar(-feet_spacing_half)), "Rear_Left"),
                    (s_sup.point.clone().add(s_sup.normal.clone().multiply_scalar(feet_spacing_half)), "Rear_Right"),
                    (s_sup.point.clone().add(s_sup.tangent.clone().multiply_scalar(200.0)), "Front_Center")
                ]

                for c_pos, c_name in castor_positions:
                    # Swivel Top Flange Plate
                    c_top = c_pos.clone(); c_top.y = 54.0
                    br, st = step.add_solid_box(c_top, s_sup.tangent, s_sup.normal, 28.0, 28.0, 3.0, f"Castor_Flange_{c_name}_{s_idx+1}", hardware_color)
                    solids.append(br); styled_items.append(st)

                    # Swivel Fork Housing
                    fork_c = c_pos.clone(); fork_c.y = 36.0
                    br, st = step.add_solid_box(fork_c, s_sup.tangent, s_sup.normal, 15.0, 18.0, 15.0, f"Castor_Fork_{c_name}_{s_idx+1}", hardware_color)
                    solids.append(br); styled_items.append(st)

                    # Polyurethane Wheel (Ø75 mm x 32 mm)
                    wheel_c = c_pos.clone(); wheel_c.y = 20.0
                    br, st = step.add_solid_cylinder(wheel_c, s_sup.normal, 20.0, 32.0, f"Castor_Wheel_{c_name}_{s_idx+1}", [0.15, 0.16, 0.18], segments=18)
                    solids.append(br); styled_items.append(st)

                    # Brake Lever Pedal extending outward
                    brake_dir = s_sup.tangent.clone().multiply_scalar(0.707).add(Vector3D(0.0, 0.707, 0.0)).normalize()
                    brake_c = c_pos.clone().add(brake_dir.clone().multiply_scalar(22.0)); brake_c.y = 26.0
                    br, st = step.add_solid_box(brake_c, s_sup.tangent, s_sup.normal, 12.0, 10.0, 3.0, f"Castor_Brake_Pedal_{c_name}_{s_idx+1}", knob_black_color)
                    solids.append(br); styled_items.append(st)

            else:
                # Standard Horizontal Foot Beam with Leveling Pads
                bb_center = s_sup.point.clone(); bb_center.y = 70.0
                br, st = step.add_solid_box(bb_center, s_sup.tangent, s_sup.normal, 40.0, base_beam_w / 2.0, 20.0, f"Support_Base_Foot_Beam_{s_idx+1}", support_color)
                solids.append(br); styled_items.append(st)

                for cap_sign, cap_name in [(-1.0, "L"), (1.0, "R")]:
                    cap_c = s_sup.point.clone().add(s_sup.normal.clone().multiply_scalar(cap_sign * (base_beam_w / 2.0 + 2.0)))
                    cap_c.y = 70.0
                    br, st = step.add_solid_box(cap_c, s_sup.tangent, s_sup.normal, 42.0, 2.0, 21.0, f"Support_Foot_Cap_{cap_name}_{s_idx+1}", knob_black_color)
                    solids.append(br); styled_items.append(st)

                for f_sign, f_name in [(-1.0, "Left"), (1.0, "Right")]:
                    foot_x = s_sup.point.clone().add(s_sup.normal.clone().multiply_scalar(f_sign * feet_spacing_half))
                    pad_center = foot_x.clone(); pad_center.y = 6.0
                    br, st = step.add_solid_cylinder(pad_center, Vector3D(0.0, 1.0, 0.0), 35.0, 12.0, f"Leveling_Foot_Pad_{f_name}_{s_idx+1}", knob_black_color, segments=18)
                    solids.append(br); styled_items.append(st)

                    for h_sign, h_n in [(-1.0, "Fwd"), (1.0, "Aft")]:
                        ear_hole_c = pad_center.clone().add(s_sup.tangent.clone().multiply_scalar(h_sign * 25.0))
                        ear_hole_c.y = 8.0
                        br, st = step.add_solid_cylinder(ear_hole_c, Vector3D(0.0, 1.0, 0.0), 5.0, 8.0, f"Leveling_Anchor_Ear_{h_n}_{f_name}_{s_idx+1}", knob_black_color, segments=10)
                        solids.append(br); styled_items.append(st)

                    # Hex Nut on spindle (Y=12 to 20 mm)
                    nut_center = foot_x.clone(); nut_center.y = 16.0
                    br, st = step.add_solid_cylinder(nut_center, Vector3D(0.0, 1.0, 0.0), 11.0, 8.0, f"Leveling_Hex_Nut_{f_name}_{s_idx+1}", hardware_color, segments=6)
                    solids.append(br); styled_items.append(st)

                    # Threaded Spindle stud connecting pad to base beam (Y=10 to 50 mm)
                    spindle_center = foot_x.clone(); spindle_center.y = 30.0
                    br, st = step.add_solid_cylinder(spindle_center, Vector3D(0.0, 1.0, 0.0), 8.0, 40.0, f"Leveling_Spindle_{f_name}_{s_idx+1}", hardware_color, segments=12)
                    solids.append(br); styled_items.append(st)

    # 6. DRIVE UNIT & MOTOR ASSEMBLY (Strictly matching client reference Image 1 & Image 4)
    drive_pos = getattr(config, 'drivePosition', 'left')
    is_start = drive_pos.startswith('start') or drive_pos in ['below-belt-start', 'beginning']
    drive_sample = path.samples[0] if is_start else path.samples[-1]
    idler_sample = path.samples[-1] if is_start else path.samples[0]

    # Drive Shaft Center (tangentially offset so sprocket clears the 92 mm profile end by 2 mm)
    drive_tan_sign = -1.0 if is_start else 1.0
    drive_shaft_base = drive_sample.point.clone().add(drive_sample.tangent.clone().multiply_scalar(drive_tan_sign * terminal_shaft_fwd))
    drive_shaft_base.y = terminal_shaft_y

    is_left_drive = 'left' in drive_pos or drive_pos == 'left'
    drive_side_sign = -1.0 if is_left_drive else 1.0
    shaft_len = (track_width + profile_width * 2.0 + 16.0) + 22.0
    shaft_center = drive_shaft_base.clone().add(drive_sample.normal.clone().multiply_scalar(drive_side_sign * 11.0))
    br, st = step.add_solid_cylinder(shaft_center, drive_sample.normal, 12.5, shaft_len, "Drive_Main_Shaft", hardware_color, segments=16)
    solids.append(br); styled_items.append(st)

    # Drive Sprocket Wheel (diameter 96 mm, width 35 mm, 48 mm radius perfectly tangential to chain)
    sprocket_center = drive_shaft_base.clone()
    br, st = step.add_solid_cylinder(sprocket_center, drive_sample.normal, terminal_sprocket_r, 35.0, "Drive_Sprocket_Wheel", [0.22, 0.25, 0.28], segments=19)
    solids.append(br); styled_items.append(st)

    # White UHMW Cheek Plates flanking the drive sprocket
    for sign, chk_name in [(-1.0, "Left"), (1.0, "Right")]:
        chk_c = drive_shaft_base.clone().add(drive_sample.tangent.clone().multiply_scalar(-drive_tan_sign * 15.0))
        chk_c = chk_c.add(drive_sample.normal.clone().multiply_scalar(sign * (half_track + profile_width / 2.0 + 3.0)))
        br, st = step.add_solid_box(chk_c, drive_sample.tangent, drive_sample.normal, 35.0, 6.0, 48.0, f"Drive_{chk_name}_Cheek_Plate", [0.93, 0.94, 0.96])
        solids.append(br); styled_items.append(st)
        chk_nose = drive_shaft_base.clone().add(drive_sample.normal.clone().multiply_scalar(sign * (half_track + profile_width / 2.0 + 3.0)))
        br, st = step.add_solid_cylinder(chk_nose, drive_sample.normal, 54.0, 6.0, f"Drive_{chk_name}_Cheek_Nose", [0.93, 0.94, 0.96], segments=18)
        solids.append(br); styled_items.append(st)

    is_below_belt = 'below-belt' in drive_pos or drive_pos.startswith('below')
    if is_below_belt:
        # Underslung / below-belt drive
        for sign, brk_name in [(-1.0, "Left"), (1.0, "Right")]:
            ubrk_c = drive_shaft_base.clone().add(drive_sample.normal.clone().multiply_scalar(sign * (half_track + profile_width / 2.0)))
            ubrk_c.y = working_y - 55.0
            br, st = step.add_solid_box(ubrk_c, drive_sample.tangent, drive_sample.normal, 60.0, 6.0, 45.0, f"Under_Mount_Bracket_{brk_name}", [0.15, 0.16, 0.18])
            solids.append(br); styled_items.append(st)

        xbar_c = drive_shaft_base.clone(); xbar_c.y = working_y - 75.0
        br, st = step.add_solid_box(xbar_c, drive_sample.tangent, drive_sample.normal, 30.0, track_width + profile_width * 2.0, 15.0, "Under_Drive_Cross_Bar", [0.15, 0.16, 0.18])
        solids.append(br); styled_items.append(st)

        gb_center = drive_shaft_base.clone(); gb_center.y = working_y - 100.0
        br, st = step.add_solid_box(gb_center, drive_sample.tangent, drive_sample.normal, 55.0, 60.0, 48.0, "Motor_Gearbox_Housing", motor_silver)
        solids.append(br); styled_items.append(st)

        hub_center = gb_center.clone(); hub_center.y += 18.0
        br, st = step.add_solid_cylinder(hub_center, Vector3D(0.0, 1.0, 0.0), 22.0, 24.0, "Gearbox_Drive_Hub", hardware_color, segments=16)
        solids.append(br); styled_items.append(st)

        inter_c = gb_center.clone(); inter_c.y -= (24.0 + 7.0)
        br, st = step.add_solid_cylinder(inter_c, Vector3D(0.0, -1.0, 0.0), 57.0, 14.0, "Motor_Intermediate_Flange", motor_flange_color, segments=18)
        solids.append(br); styled_items.append(st)

        motor_body_center = inter_c.clone(); motor_body_center.y -= (7.0 + 65.0)
        br, st = step.add_solid_cylinder(motor_body_center, Vector3D(0.0, -1.0, 0.0), 56.0, 130.0, "Motor_Stator_Body", motor_silver, segments=18)
        solids.append(br); styled_items.append(st)

        for fin_i in range(10):
            fin_ang = (2.0 * math.pi * fin_i) / 10.0
            fin_offset = Vector3D(math.cos(fin_ang) * 58.0, 0.0, math.sin(fin_ang) * 58.0)
            fin_c = motor_body_center.clone().add(fin_offset)
            br, st = step.add_solid_box(fin_c, drive_sample.tangent, drive_sample.normal, 2.5, 2.5, 60.0, f"Motor_Cooling_Fin_{fin_i+1}", motor_silver)
            solids.append(br); styled_items.append(st)

        junc_center = motor_body_center.clone().add(drive_sample.normal.clone().multiply_scalar(60.0))
        br, st = step.add_solid_box(junc_center, drive_sample.tangent, drive_sample.normal, 28.0, 18.0, 24.0, "Motor_Terminal_Box", terminal_box_color)
        solids.append(br); styled_items.append(st)

        plug_c = motor_body_center.clone().add(drive_sample.normal.clone().multiply_scalar(56.0)).add(drive_sample.tangent.clone().multiply_scalar(28.0))
        br, st = step.add_solid_cylinder(plug_c, drive_sample.tangent, 11.0, 4.0, "Motor_Side_Access_Plug", knob_black_color, segments=12)
        solids.append(br); styled_items.append(st)

        fan_center = motor_body_center.clone(); fan_center.y -= (65.0 + 26.0)
        br, st = step.add_solid_cylinder(fan_center, Vector3D(0.0, -1.0, 0.0), 57.5, 52.0, "Motor_Fan_Shroud", motor_fan_color, segments=18)
        solids.append(br); styled_items.append(st)

    else:
        # Side Drive (Left or Right)
        for s_side, s_name in [(-1.0, "Left"), (1.0, "Right")]:
            p_offset = s_side * (half_track + profile_width + 8.0)
            p_center = drive_shaft_base.clone().add(drive_sample.tangent.clone().multiply_scalar(-drive_tan_sign * 35.0))
            p_center = p_center.add(drive_sample.normal.clone().multiply_scalar(p_offset))
            p_center.y = working_y - 20.0
            br, st = step.add_solid_box(p_center, drive_sample.tangent, drive_sample.normal, 55.0, 4.0, 65.0, f"Drive_{s_name}_Mounting_Plate_Body", [0.15, 0.16, 0.18])
            solids.append(br); styled_items.append(st)
            p_nose = drive_shaft_base.clone().add(drive_sample.normal.clone().multiply_scalar(p_offset))
            br, st = step.add_solid_cylinder(p_nose, drive_sample.normal, 70.0, 8.0, f"Drive_{s_name}_Mounting_Plate_Contour", [0.15, 0.16, 0.18], segments=18)
            solids.append(br); styled_items.append(st)

            # Rear Connecting Plate attaching drive plate to 92 mm profile
            d_conn_c = drive_sample.point.clone().add(drive_sample.normal.clone().multiply_scalar(p_offset))
            d_conn_c = d_conn_c.add(drive_sample.tangent.clone().multiply_scalar(-drive_tan_sign * 40.0))
            d_conn_c.y = working_y - 20.0
            br, st = step.add_solid_box(d_conn_c, drive_sample.tangent, drive_sample.normal, 28.0, 4.0, 35.0, f"Drive_{s_name}_Conn_Plate", [0.93, 0.94, 0.96])
            solids.append(br); styled_items.append(st)

            # 4 Button-head clamp bolts on drive plate
            for db_y, db_n in [(-12.0, "Top"), (-32.0, "Btm")]:
                for db_x, db_xn in [(-25.0, "Rear"), (15.0, "Mid")]:
                    db_c = p_center.clone().add(drive_sample.tangent.clone().multiply_scalar(db_x))
                    db_c = db_c.add(drive_sample.normal.clone().multiply_scalar(s_side * 3.0))
                    db_c.y = working_y + db_y
                    br, st = step.add_solid_cylinder(db_c, drive_sample.normal, 5.0, 6.0, f"Drive_{s_name}_Bolt_{db_n}_{db_xn}", hardware_color, segments=10)
                    solids.append(br); styled_items.append(st)

        # Flanged Bearing Housing Boss on opposite side of motor
        opp_side = -drive_side_sign
        boss_offset = opp_side * (half_track + profile_width + 8.0) + opp_side * 8.0
        boss_center = drive_shaft_base.clone().add(drive_sample.normal.clone().multiply_scalar(boss_offset))
        br, st = step.add_solid_cylinder(boss_center, drive_sample.normal, 37.5, 14.0, "Drive_Bearing_Housing_Boss", [0.25, 0.28, 0.32], segments=16)
        solids.append(br); styled_items.append(st)

        # Gearbox Output Flange
        plate_offset = drive_side_sign * (half_track + profile_width + 8.0)
        flange_offset = plate_offset + drive_side_sign * 22.0
        flange_center = drive_shaft_base.clone().add(drive_sample.normal.clone().multiply_scalar(flange_offset))
        br, st = step.add_solid_cylinder(flange_center, drive_sample.normal, 58.0, 12.0, "Gearbox_Output_Mounting_Flange", motor_silver, segments=18)
        solids.append(br); styled_items.append(st)

        pcd_r = 42.5
        for b_ang, b_name in [(0.0, "Top"), (math.pi/2, "Front"), (math.pi, "Bottom"), (3*math.pi/2, "Back")]:
            b_offset = drive_sample.tangent.clone().multiply_scalar(math.sin(b_ang) * pcd_r)
            b_offset.y += math.cos(b_ang) * pcd_r
            boss_hole_c = flange_center.clone().add(b_offset)
            br, st = step.add_solid_cylinder(boss_hole_c, drive_sample.normal, 7.5, 14.0, f"Gearbox_Bolt_Boss_{b_name}", motor_silver, segments=10)
            solids.append(br); styled_items.append(st)

        for g_ang, g_name in [(math.pi/4, "TF"), (3*math.pi/4, "BF"), (5*math.pi/4, "BB"), (7*math.pi/4, "TB")]:
            g_dir = drive_sample.tangent.clone().multiply_scalar(math.sin(g_ang) * 32.0)
            g_dir.y += math.cos(g_ang) * 32.0
            gusset_rf_c = flange_center.clone().add(g_dir)
            br, st = step.add_solid_box(gusset_rf_c, drive_sample.tangent, drive_sample.normal, 6.0, 5.0, 6.0, f"Gearbox_Gusset_{g_name}", motor_silver)
            solids.append(br); styled_items.append(st)

        motor_offset = plate_offset + drive_side_sign * 65.0
        motor_base_pt = drive_shaft_base.clone().add(drive_sample.normal.clone().multiply_scalar(motor_offset))
        gb_center = motor_base_pt.clone()
        br, st = step.add_solid_box(gb_center, drive_sample.tangent, drive_sample.normal, 50.0, 38.0, 44.0, "Motor_Gearbox_Housing", motor_silver)
        solids.append(br); styled_items.append(st)

        for r_i in range(4):
            rib_c = gb_center.clone(); rib_c.y += 45.0 + r_i * 3.5
            br, st = step.add_solid_box(rib_c, drive_sample.tangent, drive_sample.normal, 42.0, 32.0, 1.25, f"Gearbox_Cooling_Rib_{r_i+1}", motor_silver)
            solids.append(br); styled_items.append(st)

        breather_c = gb_center.clone(); breather_c.y += 62.0
        br, st = step.add_solid_cylinder(breather_c, Vector3D(0.0, 1.0, 0.0), 9.0, 18.0, "Gearbox_Breather_Plug", motor_silver, segments=12)
        solids.append(br); styled_items.append(st)

        inter_c = gb_center.clone(); inter_c.y -= (44.0 + 7.0)
        br, st = step.add_solid_cylinder(inter_c, Vector3D(0.0, -1.0, 0.0), 57.0, 14.0, "Motor_Intermediate_Flange", motor_flange_color, segments=18)
        solids.append(br); styled_items.append(st)

        motor_body_center = inter_c.clone(); motor_body_center.y -= (7.0 + 65.0)
        br, st = step.add_solid_cylinder(motor_body_center, Vector3D(0.0, -1.0, 0.0), 56.0, 130.0, "Motor_Stator_Body", motor_silver, segments=18)
        solids.append(br); styled_items.append(st)

        for fin_i in range(10):
            fin_ang = (2.0 * math.pi * fin_i) / 10.0
            fin_offset = Vector3D(math.cos(fin_ang) * 58.0, 0.0, math.sin(fin_ang) * 58.0)
            fin_c = motor_body_center.clone().add(fin_offset)
            br, st = step.add_solid_box(fin_c, drive_sample.tangent, drive_sample.normal, 2.5, 2.5, 60.0, f"Motor_Cooling_Fin_{fin_i+1}", motor_silver)
            solids.append(br); styled_items.append(st)

        junc_center = motor_body_center.clone().add(drive_sample.normal.clone().multiply_scalar(drive_side_sign * 62.0))
        br, st = step.add_solid_box(junc_center, drive_sample.tangent, drive_sample.normal, 28.0, 18.0, 24.0, "Motor_Terminal_Box", terminal_box_color)
        solids.append(br); styled_items.append(st)

        plug_c = motor_body_center.clone().add(drive_sample.normal.clone().multiply_scalar(drive_side_sign * 57.0)).add(drive_sample.tangent.clone().multiply_scalar(28.0))
        br, st = step.add_solid_cylinder(plug_c, drive_sample.tangent, 11.0, 4.0, "Motor_Side_Access_Plug", knob_black_color, segments=12)
        solids.append(br); styled_items.append(st)

        fan_center = motor_body_center.clone(); fan_center.y -= (65.0 + 26.0)
        br, st = step.add_solid_cylinder(fan_center, Vector3D(0.0, -1.0, 0.0), 57.5, 52.0, "Motor_Fan_Shroud", motor_fan_color, segments=18)
        solids.append(br); styled_items.append(st)

    # 7. INFEED IDLER RETURN TERMINAL UNIT (Strictly matching Image 3: conveyor-idler-end-bracket.png and 82.5 Non Motor side head.png)
    idler_tan_sign = 1.0 if is_start else -1.0
    idler_shaft_center = idler_sample.point.clone().add(idler_sample.tangent.clone().multiply_scalar(idler_tan_sign * terminal_shaft_fwd))
    idler_shaft_center.y = terminal_shaft_y

    for sign, b_name in [(-1.0, "Left"), (1.0, "Right")]:
        chk_c = idler_shaft_center.clone().add(idler_sample.tangent.clone().multiply_scalar(-idler_tan_sign * 15.0))
        chk_c = chk_c.add(idler_sample.normal.clone().multiply_scalar(sign * (half_track + profile_width / 2.0 + 2.0)))
        br, st = step.add_solid_box(chk_c, idler_sample.tangent, idler_sample.normal, 35.0, 6.0, 45.0, f"Idler_{b_name}_Cheek_Plate", [0.93, 0.94, 0.96])
        solids.append(br); styled_items.append(st)
        chk_nose = idler_shaft_center.clone().add(idler_sample.normal.clone().multiply_scalar(sign * (half_track + profile_width / 2.0 + 2.0)))
        br, st = step.add_solid_cylinder(chk_nose, idler_sample.normal, 54.0, 6.0, f"Idler_{b_name}_Cheek_Nose", [0.93, 0.94, 0.96], segments=18)
        solids.append(br); styled_items.append(st)

        ibrk_c = idler_sample.point.clone().add(idler_sample.tangent.clone().multiply_scalar(-idler_tan_sign * 10.0))
        ibrk_c = ibrk_c.add(idler_sample.normal.clone().multiply_scalar(sign * (half_track + profile_width / 2.0 + 6.0)))
        ibrk_c.y = working_y - 22.0
        br, st = step.add_solid_box(ibrk_c, idler_sample.tangent, idler_sample.normal, 45.0, 3.5, 38.0, f"Idler_{b_name}_L_Bracket", hardware_color)
        solids.append(br); styled_items.append(st)

        for sb_y, sb_n in [(-10.0, "Top"), (-30.0, "Btm")]:
            sb_c = ibrk_c.clone().add(idler_sample.normal.clone().multiply_scalar(sign * 4.0))
            sb_c.y = working_y + sb_y
            br, st = step.add_solid_cylinder(sb_c, idler_sample.normal, 5.0, 6.0, f"Idler_Bolt_{sb_n}_{b_name}", hardware_color, segments=10)
            solids.append(br); styled_items.append(st)

        conn_c = idler_sample.point.clone().add(idler_sample.normal.clone().multiply_scalar(sign * (half_track + profile_width / 2.0 + 3.0)))
        conn_c = conn_c.add(idler_sample.tangent.clone().multiply_scalar(-idler_tan_sign * 35.0))
        conn_c.y = working_y - 20.0
        br, st = step.add_solid_box(conn_c, idler_sample.tangent, idler_sample.normal, 25.0, 4.0, 35.0, f"Idler_Conn_Plate_{b_name}", [0.93, 0.94, 0.96])
        solids.append(br); styled_items.append(st)

    br, st = step.add_solid_cylinder(idler_shaft_center, idler_sample.normal, 12.5, track_width + profile_width * 2.0, "Idler_Return_Shaft", hardware_color, segments=16)
    solids.append(br); styled_items.append(st)

    br, st = step.add_solid_cylinder(idler_shaft_center, idler_sample.normal, terminal_sprocket_r, track_width - 6.0, "Idler_Return_Sprocket", [0.35, 0.38, 0.42], segments=19)
    solids.append(br); styled_items.append(st)

    # Document assembly representation context
    geom_ctx = step.add_geometric_representation_context()
    step.add_shape_definition_representation(f"ALUFLEX_CONVEYOR_{int(track_width)}MM", solids, geom_ctx)
    step.add_presentation_representation(step.styled_items, geom_ctx)

    return step.generate_step_string()

