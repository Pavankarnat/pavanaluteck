# ALUFLEX configurator - audit report

Scope: whole website (React/Vite frontend, FastAPI backend, Docker setup, CAD/STEP pipeline). Measured on 2026-10-19
with the project running in Docker (frontend :5173, backend :8000).

## 1. What was checked and the result

| Area | Check | Result |
|---|---|---|
| Frontend | TypeScript (`tsc --noEmit`) | clean |
| Frontend | Production build | OK, 44 s; JS 1.10 MB (302 KB gzip), CSS 41 KB |
| Frontend | Browser console, desktop + 390 px mobile | no errors; no horizontal overflow on mobile |
| Backend | pytest | 9 passed, 1 skipped (CAD-kernel test, opt-in) |
| CAD | Exports re-imported with a real CAD kernel (OCP) | reference, straight, 1-bend, 2-bend (L+R) all valid: 0 invalid solids (715 / 1006 / 1047 / 1720 solids) |
| CAD | Dangling references / orphan solids in exported STEP | 0 / 0 |
| API | `/layout` | 25-35 ms |
| API | `/step` (22 MB file) | 1.7 - 2.9 s; bad input -> 422; max 2 concurrent builds, then 429 |
| API | CORS | local dev ports only by default, `CORS_ORIGINS` for production |
| Security | `npm audit --omit=dev` | 2 moderate (react-router SSR hydration advisory; the app is client-only, practical risk low) |

## 2. Bugs found

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | High | Exported straight conveyor showed stray green arcs in Autodesk Inventor: the parts removed from the assembly left their solids and colour entries in the file (the kernel ignores them, Inventor draws them at the origin). | **Fixed** - dropped parts are now removed completely |
| 2 | High | Raising the guide height detached the guide posts from the frame (whole post moved). | **Fixed** - post stem lengthens, frame clamps stay, rod/clamp move up |
| 3 | High | Any customisation outside the reference (length, curves, guides, height, motor, feet) dropped to the old generated model. | **Fixed** - viewer and STEP always use the client's parts; options with no client part are listed in a "NOT IN CLIENT CAD" chip and in the export message |
| 4 | Medium | Motor right / bottom did not move. | **Fixed** - right = motor + shaft turned to the other side, bottom = motor under the unit (approximation, flagged) |
| 5 | Medium | Camera re-zoomed / jumped on every control change. | **Fixed** - framed once; afterwards it stays put. "Fit View" and the view buttons still move it. Component auto-zoom from the controls is off. |
| 6 | Medium | `/reference-match-report` returned 500 in Docker (wrote to a read-only root folder). | **Fixed** - writes to a temp folder |
| 7 | Medium | Docker backend lacked `numpy` and could not see the reference STEP. | **Fixed** |
| 8 | Low | `ConveyorCanvas`/scene leaked GPU resources on every rebuild. | **Fixed earlier** |

## 3. Known limits (by design of the client's CAD file)

The client's `804-125.stp` contains one chain width (82.5 mm), one bend (ZP90, R400, 90 degrees), one drive (left motor
head), one guide profile (904516, ~100 mm spacing), one stand type (electric Linak, braked castors). For other choices
the client's part is used and the option is listed as "not in client CAD":

- chain widths other than 82.5 mm (e.g. 304.8), steel/stainless chain, reductor drive, motor on the right via a
  mirrored part (the right position is the same motor turned round), 904515 guide profile, guide spacing, fixed /
  mechanical stands, anchor / fixed / adjustable feet, bend radius other than 400 mm, bend angles other than 90/180.
- Working height 700-2000 mm (stand tube lengthens freely, shortens by about 420 mm), guide height 20-300 mm, straight
  conveyor 700 mm-12 m, up to 8 bends.
- Motor "bottom" is an approximation (client motor moved under the drive unit).

## 4. Risks and recommendations

1. **BOM is not built from the real model.** The BOM / "Calculated legs" text still comes from the old generic
   calculator (generic names such as "Slide Rail PE-UHMW"), only the stand count follows the model. Recommended:
   build the BOM from the exported assembly's real part numbers (the STEP has them).
2. **Offline fallback is the old approximate generator** (`stepGenerator.ts`, 1,600 lines, runs on the main thread).
   If the backend is down the STEP export refuses for client-parts configurations, but the viewer falls back to the old
   model. Consider removing the fallback or showing a clear "backend offline" state.
3. **Static asset weight:** `frontend/public` is 83 MB (reference STEP 21 MB, `main/` 20 MB, product reference
   images 18 MB, images 16 MB) and is copied into every build. `main/*.stp` and `product-reference-images/` look unused by
   the code - confirm and move out of `public/`.
4. **Single 1.1 MB JS chunk** (three.js + app). Split with dynamic import / `manualChunks`.
5. **No frontend tests, no ESLint config** (the `lint` script has nothing to run). Add Vitest for `ValidationService`,
   `ConfigurationService`, `cadAssetLoader.buildFromLayout`, and an ESLint config.
6. **Accessibility:** 17 `<img>` tags without `alt`, 40 buttons but only 1 `aria-label` (icon-only buttons in the 3D
   toolbar). Add labels and keyboard focus styles.
7. **Dependency hygiene:** Python requirements are unpinned (`>=`); pin versions (or a lock file). Update
   `react-router-dom` when convenient.
8. **Large files:** `stepGenerator.ts` (1,603), `cad_step_builder.py` (1,524), `ParametricControls.tsx` (1,443),
   `step_compose.py` (1,253) - split into modules. `cad_step_builder.py` / `stepGenerator.ts` are now only legacy fallback.
9. **Validation/UI mismatches:** the UI still offers options that have no client part (widths, feet, stands); consider
   greying them out with a tooltip instead of only the chip.
10. **Verification gap:** STEP validity is verified with the OCP kernel; Autodesk Inventor itself could not be run here.
    After this fix please re-open one straight and one two-bend export in Inventor.
11. **Production CORS / API exposure:** `/docs` is public and there is no rate limit besides the 2-slot STEP limiter;
    set `CORS_ORIGINS` and put the API behind the same origin or a gateway.

## 5. Performance snapshot

- First load: JS 302 KB gzip, GLB model 9.3 MB, layout 25-35 ms, model swap about 1-2 s in software-rendered test
  browsers (faster with a GPU).
- STEP export: 1.7-2.9 s server time, 20-22 MB download (consider gzip transfer encoding for `/step`).

## Update: chain width, feet, double guide

- **Chain width (63 - 304.8 mm):** the client's own parts are stretched / moved / warped instead of being reported as "not in client CAD".
  Side parts move out with the side, centre-crossing prisms (chain, crossbars, plates) are stretched at the centre line, the bend's
  plates and rails are widened radially. Stands are handled in their own frame, so crossbars, end caps, castors and rails stay joined.
  Verified with a geometry kernel (OCP): 0 invalid solids for straight, one-bend, two-bend and right-bend cases.
- **Feet:** braked castors (client) / castors without brake lever / no castors (anchor and adjustable feet have no client part; noted in the UI).
- **Guides:** end caps follow the guide height; the double-rail profile (904515) repeats the client's rail one pitch higher.
- **Straight conveyor:** grey guide rails now end where the green guide ends; the controller sits beside the drive-end stand.
- Docker: if the backend container is down the UI silently falls back to the generated model (tooltip says "backend not reachable").
