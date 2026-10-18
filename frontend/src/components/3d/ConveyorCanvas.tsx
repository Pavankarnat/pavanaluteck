import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Ruler,
  Compass,
  Play,
  Pause,
  Maximize2,
  Minimize2,
  Route,
  Package,
  Zap,
  ArrowUpDown,
  Layers,
  CornerDownRight,
  Eye,
  EyeOff,
  RotateCcw
} from 'lucide-react';
import { ConveyorConfiguration } from '../../types/conveyor';
import { ConveyorScene, CameraPreset, FocusTarget, CadStatus } from './ConveyorScene';
import { CadLayoutResult } from '../../services/cadLayoutService';
import { useTheme } from '../../context/ThemeContext';
import { PRODUCT_ASSETS } from '../../services/productAssetService';
import { ConfigurationService } from '../../services/configurationService';

interface ConveyorCanvasProps {
  configuration: ConveyorConfiguration;
  /** How the client's exact CAD parts are arranged for `configuration` (from the backend). */
  cadLayout?: CadLayoutResult | null;
  className?: string;
  focusedComponent?: FocusTarget;
  onResetFocus?: () => void;
}

export const ConveyorCanvas: React.FC<ConveyorCanvasProps> = ({
  configuration,
  cadLayout = null,
  className = '',
  focusedComponent = 'overview',
  onResetFocus
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ConveyorScene | null>(null);
  const { theme } = useTheme();

  const [wireframe, setWireframe] = useState<boolean>(false);
  const [autoRotate, setAutoRotate] = useState<boolean>(false);
  const [showDimensions, setShowDimensions] = useState<boolean>(true);
  const [showPathDebug, setShowPathDebug] = useState<boolean>(false);
  const [showFlow, setShowFlow] = useState<boolean>(true);
  const [showProducts, setShowProducts] = useState<boolean>(false);
  const [activePreset, setActivePreset] = useState<CameraPreset>('isometric');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showInspector, setShowInspector] = useState<boolean>(true);
  const [cadStatus, setCadStatus] = useState<CadStatus>({ state: 'loading', reasons: [] });

  // Initialize Three.js Scene with current theme
  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new ConveyorScene(containerRef.current, theme);
    sceneRef.current = scene;
    hasBuiltRef.current = false;
    scene.onCadStatus(setCadStatus);
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__aluflexScene = scene; // dev-only: end-to-end checks

    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Update 3D viewport environment when theme changes
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.setTheme(theme);
    }
  }, [theme]);

  // Update 3D model whenever configuration changes
  // The first build is immediate; later edits are debounced so slider drags don't rebuild thousands of meshes per tick.
  const hasBuiltRef = useRef(false);
  useEffect(() => {
    if (!sceneRef.current) return;
    if (!hasBuiltRef.current) {
      hasBuiltRef.current = true;
      sceneRef.current.updateConfiguration(configuration);
      return;
    }
    const timer = setTimeout(() => sceneRef.current?.updateConfiguration(configuration), 80);
    return () => clearTimeout(timer);
  }, [configuration]);

  // The client's exact CAD parts, arranged by the backend for this configuration
  useEffect(() => {
    sceneRef.current?.setCadLayout(cadLayout);
  }, [cadLayout]);

  // Smoothly move camera when focused component changes
  useEffect(() => {
    if (sceneRef.current && focusedComponent) {
      sceneRef.current.focusComponent(focusedComponent);
    }
  }, [focusedComponent]);

  const handleFitToView = () => {
    sceneRef.current?.fitToView();
    onResetFocus?.();
  };

  const handleFocusComponent = (comp: FocusTarget) => {
    sceneRef.current?.focusComponent(comp);
  };

  const handleViewPreset = (preset: CameraPreset) => {
    setActivePreset(preset);
    sceneRef.current?.setViewPreset(preset);
  };

  const handleToggleWireframe = () => {
    if (sceneRef.current) {
      const state = sceneRef.current.toggleWireframe();
      setWireframe(state);
    }
  };

  const handleToggleAutoRotate = () => {
    if (sceneRef.current) {
      const state = sceneRef.current.toggleAutoRotate();
      setAutoRotate(state);
    }
  };

  const handleToggleDimensions = () => {
    if (sceneRef.current) {
      const state = sceneRef.current.toggleDimensions();
      setShowDimensions(state);
    }
  };

  const handleTogglePathDebug = () => {
    if (sceneRef.current) {
      const state = sceneRef.current.togglePathDebug();
      setShowPathDebug(state);
    }
  };

  const handleToggleFlow = () => {
    if (sceneRef.current) {
      const state = sceneRef.current.toggleFlow();
      setShowFlow(state);
    }
  };

  const handleToggleProducts = () => {
    if (sceneRef.current) {
      const state = sceneRef.current.toggleProducts();
      setShowProducts(state);
    }
  };

  const handleToggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.parentElement?.requestFullscreen().catch((err) => {
        console.error('Fullscreen error:', err);
      });
    } else {
      document.exitFullscreen();
    }
  };

  // Keep the icon in sync when fullscreen is left via Esc.
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Dynamic Calculations for CAD HUD & Hardware Badges
  const effectiveLength = ConfigurationService.calculateEffectivePathLength(configuration);
  const supportPositions = ConfigurationService.calculateSupportLegPositions(configuration);
  const legCount = supportPositions.length;
  const isReverse = configuration.travelDirection === 'reverse';
  const isCurved = configuration.shape === 'curved';
  const dynamicPitch = ConfigurationService.getChainPitch(configuration.width);

  // Dynamic Motor/Drive
  const isReductor =
    configuration.driveKind === 'reductor' ||
    configuration.drivePosition.startsWith('reductor-') ||
    configuration.driveMountType === 'reductor';
  const motorObj = configuration.motor || {
    id: 'motor-001',
    name: 'Standard Geared Motor',
    powerKw: 0.37,
    torqueNm: 35,
    description: ''
  };
  const motorPower = motorObj.powerKw || 0.37;
  const motorTitle = isReductor
    ? 'Reductor Gearbox Drive'
    : configuration.driveKind === 'normal'
    ? 'Direct Motor Head'
    : motorObj.name || 'Geared Motor';
  const drivePosLabel = ConfigurationService.formatDrivePosition(configuration.drivePosition);
  const motorImage = isReductor
    ? '/images/conveyor-motor-gearbox.png'
    : (motorObj.id && PRODUCT_ASSETS.motors[motorObj.id]?.primaryImage) || PRODUCT_ASSETS.motors['motor-001'].primaryImage;

  // Dynamic Chain
  const chainMaterialName =
    configuration.chainMaterial === 'plastic'
      ? 'POM Plastic Chain'
      : configuration.chainMaterial === 'stainless-steel'
      ? 'Stainless Steel Chain'
      : 'Carbon Steel Chain';
  const chainImage =
    PRODUCT_ASSETS.chains[configuration.chainMaterial]?.primaryImage || PRODUCT_ASSETS.chains.plastic.primaryImage;

  // Dynamic Support & Footing
  const supportTypeTitle = ConfigurationService.formatSupportType(configuration.workingHeight.type);
  const footTypeLabel = ConfigurationService.formatFootType(configuration.workingHeight.footType);
  const supportSubtitle =
    configuration.workingHeight.enabled && configuration.workingHeight.type !== 'without-support'
      ? `${legCount} Sets • ${configuration.workingHeight.height}mm • ${footTypeLabel}`
      : 'Direct Gantry Integration';
  const supportImage =
    configuration.workingHeight.type === 'without-support'
      ? PRODUCT_ASSETS.supports.mountingPlate.primaryImage
      : configuration.workingHeight.footType === 'base-plate'
      ? PRODUCT_ASSETS.supports.mountingPlate.primaryImage
      : configuration.workingHeight.footType === 'wheel-with-brake' ||
        configuration.workingHeight.footType === 'wheel-without-brake'
      ? PRODUCT_ASSETS.supports.levelingFoot.baseImage
      : (PRODUCT_ASSETS.supports as any)[configuration.workingHeight.type]?.primaryImage ||
        PRODUCT_ASSETS.supports.fixed.primaryImage;

  // Dynamic Curves (when curved)
  const curveCount = configuration.curves?.length || 0;
  const firstCurve = configuration.curves?.[0];
  const curveTitle =
    curveCount > 1
      ? `${curveCount} Curved Bends`
      : firstCurve
      ? `${firstCurve.angle}° ${firstCurve.curveType === 'wheelband' ? 'Wheel Bend' : 'Normal Curve'}`
      : 'Curved Arc Track';
  const curveSubtitle = firstCurve
    ? `R=${firstCurve.radius || (firstCurve.curveType === 'wheelband' ? 200 : 800)}mm • ${firstCurve.direction.toUpperCase()}`
    : 'Curved Track Profile';

  return (
    <div className={`relative w-full h-full min-h-[520px] bg-cad-viewport rounded-xl overflow-hidden border border-cad-border shadow-lg flex flex-col group ${className}`}>
      {/* Top Header HUD Bar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex justify-between items-center bg-cad-bgSub/85 dark:bg-[#0c141f]/90 backdrop-blur-md border-b border-cad-border/70 px-3 sm:px-4 py-2 font-mono text-xs select-none shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center justify-center">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="absolute w-4 h-4 rounded-full bg-emerald-500/20 animate-ping" />
          </div>
          <span className="text-cad-textPrimary font-bold tracking-wider uppercase text-[11px] flex items-center gap-1.5">
            ALUFLEX 3D CAD
            <span className="text-cad-textMuted font-normal">&bull;</span>
            <span className="text-cad-accent">
              {isCurved ? `PARAMETRIC CURVED (${curveCount} ${curveCount === 1 ? 'BEND' : 'BENDS'})` : 'PARAMETRIC STRAIGHT'}
            </span>
          </span>
          {/* Which model is shown: the client's exact CAD parts, or the generated approximation */}
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border shadow-2xs ${
              cadStatus.state === 'exact'
                ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-600 dark:text-emerald-400'
                : cadStatus.state === 'generated'
                  ? 'bg-amber-500/15 border-amber-500/50 text-amber-600 dark:text-amber-400'
                  : 'bg-cad-panel/90 border-cad-border/80 text-cad-textSecondary'
            }`}
            title={
              cadStatus.state === 'exact'
                ? `Built from the client's exact CAD parts (804-125.stp) - ${cadStatus.legs ?? 2} stands. The STEP export contains the same parts.` +
                  (cadStatus.reasons.length ? `\n\nNot in the client's CAD (client part shown instead):\n- ${cadStatus.reasons.join('\n- ')}` : '')
                : cadStatus.state === 'generated'
                  ? `Approximate generated model. The client's real parts cannot express: ${cadStatus.reasons.join('; ')}.`
                  : 'Loading the client CAD parts...'
            }
          >
            {cadStatus.state === 'exact' ? 'CLIENT CAD · EXACT PARTS' : cadStatus.state === 'generated' ? 'GENERATED MODEL' : 'LOADING CAD…'}
          </span>
          {cadStatus.state === 'exact' && cadStatus.reasons.length > 0 && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border bg-amber-500/15 border-amber-500/50 text-amber-600 dark:text-amber-400 shadow-2xs cursor-help"
              title={`These options have no part in the client's CAD, so the client's part is shown:\n- ${cadStatus.reasons.join('\n- ')}`}
            >
              {cadStatus.reasons.length} NOT IN CLIENT CAD
            </span>
          )}
          {/* Flow Direction Indicator Badge */}
          <span className="hidden sm:inline-flex items-center gap-1 bg-cad-panel/90 border border-cad-border/80 px-2 py-0.5 rounded-md text-[10px] text-cad-accent font-bold shadow-2xs">
            FLOW: {isReverse ? '◀ REVERSE' : 'FORWARD ➔'}
          </span>
        </div>

        {/* HUD Dimension Summary + Inspector Toggle */}
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <div className="hidden sm:flex items-center gap-1.5 text-cad-textSecondary">
            <span className="bg-cad-panel/90 border border-cad-border/80 px-2 py-0.5 rounded-md text-cad-textPrimary font-semibold shadow-2xs" title={isCurved ? `Total Effective Path Length: ${effectiveLength} mm` : undefined}>
              L: {configuration.length} mm{isCurved ? ` (${effectiveLength}mm)` : ''}
            </span>
            <span className="bg-cad-panel/90 border border-cad-border/80 px-2 py-0.5 rounded-md text-cad-textPrimary font-semibold shadow-2xs">
              W: {configuration.width} mm
            </span>
            <span className="bg-cad-panel/90 border border-cad-border/80 px-2 py-0.5 rounded-md text-cad-textPrimary font-semibold shadow-2xs">
              H: {configuration.workingHeight.enabled && configuration.workingHeight.type !== 'without-support' ? `${configuration.workingHeight.height} mm` : 'Mount'}
            </span>
            <span className="bg-cad-panel/90 border border-cad-border/80 px-2 py-0.5 rounded-md text-cad-textPrimary font-semibold shadow-2xs">
              P: {dynamicPitch} mm
            </span>
          </div>

          <button
            onClick={() => setShowInspector(!showInspector)}
            title={showInspector ? 'Hide hardware inspector cards' : 'Show hardware inspector cards'}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md border text-[10px] font-bold transition-all ${
              showInspector
                ? 'bg-cad-accent/15 border-cad-accent/40 text-cad-accent shadow-2xs'
                : 'bg-cad-panel/90 border-cad-border text-cad-textMuted hover:text-cad-textPrimary'
            }`}
          >
            {showInspector ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            <span className="hidden md:inline">INSPECTOR</span>
          </button>
        </div>
      </div>

      {/* 3D WebGL Canvas Container */}
      <div ref={containerRef} className="w-full h-full flex-grow relative cursor-grab active:cursor-grabbing" />

      {/* Left CAD Camera View Presets Toolbar */}
      <div className="absolute left-3 top-12 z-20 flex flex-col gap-1 bg-cad-bgSub/85 dark:bg-[#0c141f]/85 backdrop-blur-md border border-cad-border/80 p-1 rounded-xl shadow-lg select-none">
        <div className="text-[8px] font-mono text-cad-textMuted px-1 py-0.5 text-center font-bold border-b border-cad-border/50">
          VIEWS
        </div>
        {(['isometric', 'top', 'front', 'side'] as CameraPreset[]).map((preset) => (
          <button
            key={preset}
            onClick={() => handleViewPreset(preset)}
            className={`px-2 py-1 text-[10px] font-mono rounded-lg font-semibold transition-all uppercase ${
              activePreset === preset
                ? 'bg-cad-accent text-white shadow-xs'
                : 'text-cad-textSecondary hover:text-cad-textPrimary hover:bg-cad-panelElevated'
            }`}
          >
            {preset === 'isometric' ? 'ISO' : preset}
          </button>
        ))}
      </div>

      {/* Dynamic 3D Focus Highlight Pill */}
      {focusedComponent && focusedComponent !== 'overview' && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-30 pointer-events-auto flex items-center gap-2 bg-cad-panel/95 backdrop-blur-md border border-cad-accent/80 px-3 py-1 rounded-full shadow-xl font-mono text-xs">
          <span className="w-2 h-2 rounded-full bg-cad-accent animate-ping" />
          <span className="text-cad-textSecondary text-[11px]">Focused:</span>
          <span className="text-cad-textPrimary font-bold uppercase">
            {focusedComponent === 'feet' ? 'Wheels & Footing' :
             focusedComponent === 'drive' ? 'Drive & Motor' :
             focusedComponent === 'curves' ? 'Curves & Bends' :
             focusedComponent === 'guides' ? 'Side Guides' :
             focusedComponent === 'chain' ? 'Chain Surface' :
             focusedComponent === 'supports' ? 'Support Legs' :
             focusedComponent === 'infeed' ? 'Infeed Head' : focusedComponent}
          </span>
          <button
            onClick={handleFitToView}
            title="Reset to Full Overview"
            className="ml-1 text-[10px] font-bold text-cad-accent hover:text-white hover:bg-cad-accent px-2 py-0.5 rounded-full transition-colors flex items-center gap-1"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            <span>Reset</span>
          </button>
        </div>
      )}

      {/* Top Floating Active Configured Hardware Inspector Strip */}
      {showInspector && (
        <div className="absolute top-12 left-16 right-3 z-20 hidden md:flex items-center gap-2.5 overflow-x-auto select-none pointer-events-none py-0.5">
          {/* Active Motor Card */}
          <div
            onClick={() => handleFocusComponent('drive')}
            title="Click to focus 3D camera on Drive Motor"
            className={`pointer-events-auto flex items-center gap-2.5 bg-cad-bgSub/85 dark:bg-[#0c141f]/85 backdrop-blur-md border px-2.5 py-1.5 rounded-xl shadow-md transition-all cursor-pointer group hover:scale-[1.02] ${
              focusedComponent === 'drive'
                ? 'border-cad-warning ring-2 ring-cad-warning/40 bg-cad-warning/10'
                : 'border-cad-border/70 hover:border-cad-warning/60 hover:bg-cad-panel'
            }`}
          >
            <div className="w-7 h-7 rounded-lg bg-white dark:bg-[#080E16] border border-cad-border/80 p-0.5 flex items-center justify-center shrink-0 shadow-2xs">
              <img
                src={motorImage}
                alt="Active Motor"
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <div className="font-mono text-[10px] leading-tight">
              <div className="font-bold text-cad-textPrimary flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span className="group-hover:text-cad-warning transition-colors">{motorTitle}</span>
              </div>
              <div className="text-cad-textMuted text-[9px] mt-0.5">
                {motorPower} kW &bull; {drivePosLabel}
              </div>
            </div>
          </div>

          {/* Active Chain Card */}
          <div
            onClick={() => handleFocusComponent('chain')}
            title="Click to focus 3D camera on Chain Surface"
            className={`pointer-events-auto flex items-center gap-2.5 bg-cad-bgSub/85 dark:bg-[#0c141f]/85 backdrop-blur-md border px-2.5 py-1.5 rounded-xl shadow-md transition-all cursor-pointer group hover:scale-[1.02] ${
              focusedComponent === 'chain'
                ? 'border-cad-accent ring-2 ring-cad-accent/40 bg-cad-accent/10'
                : 'border-cad-border/70 hover:border-cad-accent/60 hover:bg-cad-panel'
            }`}
          >
            <div className="w-7 h-7 rounded-lg bg-white dark:bg-[#080E16] border border-cad-border/80 p-0.5 flex items-center justify-center shrink-0 shadow-2xs">
              <img
                src={chainImage}
                alt="Active Chain"
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <div className="font-mono text-[10px] leading-tight">
              <div className="font-bold text-cad-textPrimary flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                <span className="group-hover:text-cad-accent transition-colors">{chainMaterialName}</span>
              </div>
              <div className="text-cad-textMuted text-[9px] mt-0.5">
                W: {configuration.width} mm &bull; Pitch {dynamicPitch} mm
              </div>
            </div>
          </div>

          {/* Active Support & Footing Card */}
          <div
            onClick={() => handleFocusComponent('supports')}
            title="Click to focus 3D camera on Supports & Footing"
            className={`pointer-events-auto flex items-center gap-2.5 bg-cad-bgSub/85 dark:bg-[#0c141f]/85 backdrop-blur-md border px-2.5 py-1.5 rounded-xl shadow-md transition-all cursor-pointer group hover:scale-[1.02] ${
              focusedComponent === 'supports'
                ? 'border-cad-success ring-2 ring-cad-success/40 bg-cad-success/10'
                : 'border-cad-border/70 hover:border-cad-success/60 hover:bg-cad-panel'
            }`}
          >
            <div className="w-7 h-7 rounded-lg bg-white dark:bg-[#080E16] border border-cad-border/80 p-0.5 flex items-center justify-center shrink-0 shadow-2xs">
              <img
                src={supportImage}
                alt="Active Support"
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <div className="font-mono text-[10px] leading-tight">
              <div className="font-bold text-cad-textPrimary flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="group-hover:text-cad-success transition-colors">{supportTypeTitle}</span>
              </div>
              <div className="text-cad-textMuted text-[9px] mt-0.5">
                {supportSubtitle}
              </div>
            </div>
          </div>

          {/* Active Curves Card (when curved) */}
          {isCurved && (
            <div
              onClick={() => handleFocusComponent('curves')}
              title="Click to focus 3D camera on Curves & Bends"
              className={`pointer-events-auto flex items-center gap-2.5 bg-cad-bgSub/85 dark:bg-[#0c141f]/85 backdrop-blur-md border px-2.5 py-1.5 rounded-xl shadow-md transition-all cursor-pointer group hover:scale-[1.02] ${
                focusedComponent === 'curves'
                  ? 'border-purple-400 ring-2 ring-purple-400/40 bg-purple-500/10'
                  : 'border-cad-border/70 hover:border-purple-400/60 hover:bg-cad-panel'
              }`}
            >
              <div className="w-7 h-7 rounded-lg bg-white dark:bg-[#080E16] border border-cad-border/80 p-0.5 flex items-center justify-center shrink-0 shadow-2xs">
                <img
                  src="/images/conveyor-curve-track.png"
                  alt="Curved Section"
                  className="max-h-full max-w-full object-contain"
                />
              </div>
              <div className="font-mono text-[10px] leading-tight">
                <div className="font-bold text-cad-textPrimary flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                  <span className="group-hover:text-purple-400 transition-colors">{curveTitle}</span>
                </div>
                <div className="text-cad-textMuted text-[9px] mt-0.5">
                  {curveSubtitle}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bottom Floating CAD Controls Toolbar */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 sm:gap-1.5 bg-cad-bgSub/90 dark:bg-[#0c141f]/90 backdrop-blur-lg border border-cad-border/80 px-2.5 py-1.5 rounded-2xl shadow-2xl select-none max-w-[96%] overflow-x-auto">
        {/* Navigation Group */}
        <button
          onClick={handleFitToView}
          title="Fit Model to Screen (Reset Camera)"
          className="flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-mono font-medium text-cad-textSecondary hover:text-cad-textPrimary hover:bg-cad-panelElevated transition-all"
        >
          <Compass className="w-3.5 h-3.5 text-cad-accent" />
          <span className="hidden sm:inline text-[11px]">Fit View</span>
        </button>

        <button
          onClick={handleToggleAutoRotate}
          title="Toggle Turntable Auto-Rotation"
          className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-mono font-medium transition-all ${
            autoRotate
              ? 'bg-cad-accent/20 text-cad-accent border border-cad-accent/40 shadow-2xs'
              : 'text-cad-textSecondary hover:text-cad-textPrimary hover:bg-cad-panelElevated'
          }`}
        >
          {autoRotate ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline text-[11px]">Turntable</span>
        </button>

        <div className="w-[1px] h-4 bg-cad-border/60 mx-0.5" />

        {/* CAD Inspection Group */}
        <button
          onClick={handleToggleDimensions}
          title="Toggle 3D Dimension Callouts"
          className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-mono font-medium transition-all ${
            showDimensions
              ? 'bg-cad-accent/20 text-cad-accent border border-cad-accent/40 shadow-2xs'
              : 'text-cad-textSecondary hover:text-cad-textPrimary hover:bg-cad-panelElevated'
          }`}
        >
          <Ruler className="w-3.5 h-3.5" />
          <span className="hidden md:inline text-[11px]">Dimensions</span>
        </button>

        <button
          onClick={handleToggleWireframe}
          title="Toggle Wireframe CAD Mode"
          className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-mono font-medium transition-all ${
            wireframe
              ? 'bg-cad-accent/20 text-cad-accent border border-cad-accent/40 shadow-2xs'
              : 'text-cad-textSecondary hover:text-cad-textPrimary hover:bg-cad-panelElevated'
          }`}
        >
          <Box className="w-3.5 h-3.5" />
          <span className="hidden md:inline text-[11px]">Wireframe</span>
        </button>

        <button
          onClick={handleTogglePathDebug}
          title="Toggle Centerline & Direction Vectors"
          className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-mono font-medium transition-all ${
            showPathDebug
              ? 'bg-cad-success/20 text-cad-success border border-cad-success/40 shadow-2xs'
              : 'text-cad-textSecondary hover:text-cad-textPrimary hover:bg-cad-panelElevated'
          }`}
        >
          <Route className="w-3.5 h-3.5" />
          <span className="hidden md:inline text-[11px]">Path</span>
        </button>

        <div className="w-[1px] h-4 bg-cad-border/60 mx-0.5" />

        {/* Simulation Group */}
        <button
          onClick={handleToggleFlow}
          title="Toggle Animated Travel Direction Flow"
          className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-mono font-medium transition-all ${
            showFlow
              ? 'bg-cad-accent/20 text-cad-accent border border-cad-accent/40 shadow-2xs'
              : 'text-cad-textSecondary hover:text-cad-textPrimary hover:bg-cad-panelElevated'
          }`}
        >
          <Play className="w-3.5 h-3.5" />
          <span className="hidden sm:inline text-[11px]">Flow</span>
        </button>

        <button
          onClick={handleToggleProducts}
          title="Toggle Transported Product Demo Packages"
          className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-mono font-medium transition-all ${
            showProducts
              ? 'bg-cad-warning/20 text-cad-warning border border-cad-warning/40 shadow-2xs'
              : 'text-cad-textSecondary hover:text-cad-textPrimary hover:bg-cad-panelElevated'
          }`}
        >
          <Package className="w-3.5 h-3.5" />
          <span className="hidden sm:inline text-[11px]">Products</span>
        </button>

        <div className="w-[1px] h-4 bg-cad-border/60 mx-0.5" />

        {/* Fullscreen Button */}
        <button
          onClick={handleToggleFullscreen}
          title="Toggle Fullscreen"
          className="p-1.5 text-cad-textSecondary hover:text-cad-textPrimary hover:bg-cad-panelElevated rounded-xl transition-all"
        >
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Axis Coordinate Legend */}
      <div className="absolute right-3 bottom-3 z-20 pointer-events-none hidden sm:flex items-center gap-2.5 text-[9px] font-mono text-cad-textMuted bg-cad-bgSub/85 dark:bg-[#0c141f]/85 px-2.5 py-1 rounded-xl border border-cad-border/70 backdrop-blur-md shadow-sm">
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400" /> <span>+X Len</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> <span>+Y Ht</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400" /> <span>+Z Wid</span>
        </div>
      </div>
    </div>
  );
};
