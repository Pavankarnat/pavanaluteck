# ALUTEK – ALUFLEX Conveyor Configurator

Parametric 3D configurator for Alutec modular aluminium conveyors. Configure width, chain, length, drive,
supports, curves and side guides; see a live Three.js model, a bill of materials and engineering specs; export
the result as JSON or a CAD STEP file.

See [gemini.md](gemini.md) for the architecture and engineering log.

## Stack
- **Frontend:** React 18, TypeScript, Vite, Tailwind, Three.js, React Query
- **Backend:** FastAPI (Python 3.11+), pydantic

## Run locally
```bash
# backend  (http://localhost:8000, docs at /docs)
cd backend
pip install -r requirements.txt
python main.py

# frontend (http://localhost:5173)
cd frontend
npm install
npm run dev
```
Or run both with `docker compose up --build`.

## Configuration
| Variable | Where | Purpose |
|---|---|---|
| `VITE_API_URL` | frontend | API base URL. Defaults to `http://localhost:8000` in dev and same-origin in production builds. |
| `CORS_ORIGINS` | backend | Comma-separated allowed origins. Defaults to the local Vite dev server (ports 5170-5199). |

## Tests
```bash
cd backend
pip install pytest httpx
python -m pytest
```
The tests generate STEP files and compare them with the reference model in
`frontend/public/reference-model/`. Comparison reports are written to `reports/` (git-ignored).

## Layout
```
backend/app/        API, STEP builders, geometry comparison/validation
(no golden files: the tests re-import the composed STEP and check the parts)
frontend/src/       pages, 3D generators, services (validation, BOM, STEP export)
frontend/public/    images, reference STEP model, product reference images
```

## Client CAD parts (exact model)
The client's reference conveyor `frontend/public/reference-model/804-125.stp` (DD82,5-400+ZP90+500) is the
source of truth. Both the 3D view and the exported STEP are composed from **its own parts**; nothing is re-modelled:

* straight conveyors and conveyors with any number of 90 degree ZP90 wheel bends (left / right; a 180 degree bend is two),
* any length of every straight section (frame profile, guide rails and strips are lengthened inside their extrusion,
  guide-rod posts and electric stands are repeated where the section gets long),
* working height 700-2000 mm (the Linak column tube is lengthened / shortened),
* side-guide height 20-300 mm (rails and posts move together).

How: `backend/app/step_compose.py` edits the client's assembly and writes the STEP; `POST /api/v1/conveyor/layout`
returns the same edits and the 3D view applies them to the converted model (`frontend/public/aluflex_target_exact.glb`).
Straight conveyors use straight prisms cut from the client's own bent strips / guide rails
(`python tools/make_straight_bars.py`, needs `pip install cadquery-ocp`; output is committed).

Options the client's file has no parts for (other chain widths or materials, other bends or radii, other drives, other
guide spacing, other stands) fall back to a generated approximation; the badge in the viewer and the export message say so.

Run the extra kernel validation with `RUN_CAD_KERNEL_TESTS=1 python -m pytest` (needs `pip install cadquery-ocp`).
