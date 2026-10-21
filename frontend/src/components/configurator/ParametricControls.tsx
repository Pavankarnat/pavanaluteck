import React, { useState } from 'react';
import {
  Shield,
  Sparkles,
  Layers,
  Sliders,
  ArrowUpDown,
  CornerDownRight,
  Split,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Zap,
  RotateCcw,
  Eye,
  Maximize2
} from 'lucide-react';
import {
  ConveyorConfiguration,
  ChainMaterial,
  DrivePosition,
  SupportType,
  FootType,
  HeightMode,
  DriveKind,
  EnginePosition,
  EngineAngle,
  CurveType,
  CurveDirection,
  SideGuideType,
  SideGuideConfiguration
} from '../../types/conveyor';
import { ConfigurationService } from '../../services/configurationService';
import { ValidationService } from '../../services/validationService';
import { PRODUCT_ASSETS } from '../../services/productAssetService';
import { FocusTarget } from '../3d/ConveyorScene';
import { resolveCurveRadius } from '../3d/pathMath';

interface ParametricControlsProps {
  configuration: ConveyorConfiguration;
  onChange: (config: ConveyorConfiguration) => void;
  onReset?: () => void;
  onFocusComponent?: (component: FocusTarget) => void;
}

type TabType = 'dimensions' | 'drive' | 'supports' | 'curves' | 'guides';

export const ParametricControls: React.FC<ParametricControlsProps> = ({
  configuration,
  onChange,
  onReset,
  onFocusComponent
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('dimensions');
  const [selectedMotorViewIndex, setSelectedMotorViewIndex] = useState<number>(0);
  const [selectedDriveComponent, setSelectedDriveComponent] = useState<'reductor' | 'motor-head' | 'normal-head'>('reductor');
  const [showMotorModal, setShowMotorModal] = useState<boolean>(false);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    if (tab === 'dimensions') onFocusComponent?.('chain');
    else if (tab === 'drive') onFocusComponent?.('drive');
    else if (tab === 'supports') {
      if (configuration.workingHeight.type === 'without-support') {
        onFocusComponent?.('overview');
      } else {
        onFocusComponent?.('supports');
      }
    }
    else if (tab === 'curves') onFocusComponent?.('curves');
    else if (tab === 'guides') onFocusComponent?.('guides');
  };

  // Engineering Validation
  const validation = ValidationService.validate(configuration);
  const availableWidths = ConfigurationService.getAvailableWidths(configuration.chainMaterial);
  const supportPositions = ConfigurationService.calculateSupportLegPositions(configuration);

  // Current selected motor details
  const selectedMotorId = (configuration.motor?.id || 'motor-001') as keyof typeof PRODUCT_ASSETS.motors;
  const currentMotorAsset = PRODUCT_ASSETS.motors[selectedMotorId] || PRODUCT_ASSETS.motors['motor-001'];

  const updateConfig = (updates: Partial<ConveyorConfiguration>) => {
    onChange({
      ...configuration,
      ...updates
    });
  };

  const handleMaterialChange = (mat: ChainMaterial) => {
    let newWidth = configuration.width;
    if (mat !== 'plastic' && newWidth > 190.5) {
      newWidth = 190.5;
    }
    updateConfig({
      chainMaterial: mat,
      width: newWidth
    });
    onFocusComponent?.('chain');
  };

  const handleWidthChange = (width: number) => {
    updateConfig({ width });
    onFocusComponent?.('chain');
  };

  const handleLengthChange = (length: number) => {
    const clampedLength = Math.max(600, Math.min(12000, length));
    const updates: Partial<ConveyorConfiguration> = { length: clampedLength };

    if (configuration.shape === 'curved' && configuration.curves && configuration.curves.length > 0) {
      const firstCurve = configuration.curves[0];
      const leadIn = firstCurve.offset || 1500;
      const radius = resolveCurveRadius(firstCurve, configuration.width);
      const arcLen = (firstCurve.angle / 180.0) * Math.PI * radius;
      const exitLen = Math.max(300, clampedLength - (leadIn + arcLen));
      updates.endHorizontalPathLength = Math.round(exitLen);
    }

    updateConfig(updates);
    onFocusComponent?.('overview');
  };

  const handleLoadChange = (load: number) => {
    updateConfig({ loadPerMeter: Math.max(1, Math.min(125, load)) });
  };

  const handleDrivePositionChange = (pos: DrivePosition) => {
    updateConfig({ drivePosition: pos });
    onFocusComponent?.('drive');
  };

  const handleSupportTypeChange = (type: SupportType) => {
    updateConfig({
      workingHeight: {
        ...configuration.workingHeight,
        type,
        enabled: type !== 'without-support'
      }
    });
    if (type === 'without-support') {
      onFocusComponent?.('overview');
    } else {
      onFocusComponent?.('supports');
    }
  };

  const handleHeightModeChange = (heightMode: HeightMode) => {
    updateConfig({
      workingHeight: {
        ...configuration.workingHeight,
        heightMode
      }
    });
    onFocusComponent?.('feet');
  };

  const handleFootTypeChange = (footType: FootType) => {
    updateConfig({
      workingHeight: {
        ...configuration.workingHeight,
        footType
      }
    });
    onFocusComponent?.('feet');
  };

  const handleHeightChange = (height: number) => {
    updateConfig({
      workingHeight: {
        ...configuration.workingHeight,
        height: Math.max(700, Math.min(1500, height))
      }
    });
    onFocusComponent?.('feet');
  };

  const handleShapeChange = (shape: 'straight' | 'curved') => {
    if (shape === 'curved') {
      const defaultCurves = configuration.curves && configuration.curves.length > 0
        ? configuration.curves
        : [
          {
            id: 'curve-1',
            curveType: 'wheelband' as CurveType,   // the client's ZP90 wheel bend
            angle: 90,
            radius: 400,
            direction: 'left' as CurveDirection,
            offset: 700,
            distanceFromPrevious: 700
          }
        ];
      updateConfig({ shape: 'curved', curves: defaultCurves, endHorizontalPathLength: configuration.endHorizontalPathLength ?? 700 });
      onFocusComponent?.('curves');
    } else {
      updateConfig({ shape: 'straight' });
      onFocusComponent?.('overview');
    }
  };

  const handleAddCurve = () => {
    const currentCurves = configuration.curves || [];
    if (currentCurves.length >= 5) return;

    const newCurveIndex = currentCurves.length;
    const newCurve = {
      id: `curve-${newCurveIndex + 1}`,
      curveType: 'wheelband' as CurveType,   // the client's ZP90 wheel bend
      angle: 90,
      radius: 400,
      direction: 'left' as CurveDirection,
      offset: newCurveIndex === 0 ? 700 : 700 + newCurveIndex * 1200,
      distanceFromPrevious: 700
    };

    updateConfig({
      shape: 'curved',
      curves: [...currentCurves, newCurve]
    });
    onFocusComponent?.('curves');
  };

  const handleRemoveCurve = (index: number) => {
    const currentCurves = [...(configuration.curves || [])];
    currentCurves.splice(index, 1);
    if (currentCurves.length === 0) {
      updateConfig({ shape: 'straight', curves: [] });
      onFocusComponent?.('overview');
    } else {
      updateConfig({ curves: currentCurves });
      onFocusComponent?.('curves');
    }
  };

  const handleUpdateCurve = (index: number, updates: Partial<typeof configuration.curves[0]>) => {
    const currentCurves = [...(configuration.curves || [])];
    currentCurves[index] = {
      ...currentCurves[index],
      ...updates
    };
    updateConfig({ curves: currentCurves });
    onFocusComponent?.('curves');
  };

  const handleSideGuideToggle = (enabled: boolean) => {
    if (enabled) {
      updateConfig({
        sideGuides: [
          {
            id: 'sg-1',
            type: '904516',
            widthBetweenGuides: configuration.width + 20,
            heightAboveChain: 60
          }
        ]
      });
      onFocusComponent?.('guides');
    } else {
      updateConfig({ sideGuides: undefined });
      onFocusComponent?.('overview');
    }
  };

  const handleUpdateSideGuide = (updates: Partial<SideGuideConfiguration>) => {
    if (!configuration.sideGuides || configuration.sideGuides.length === 0) return;
    const current = [...configuration.sideGuides];
    current[0] = { ...current[0], ...updates };
    updateConfig({ sideGuides: current });
    onFocusComponent?.('guides');
  };

  return (
    <div className="flex flex-col h-full bg-cad-panel border border-cad-border rounded-lg overflow-hidden shadow-xl transition-colors duration-200">
      {/* Navigation Tabs Header */}
      <div className="flex border-b border-cad-border bg-cad-bgSub overflow-x-auto select-none no-scrollbar">
        <button
          onClick={() => handleTabChange('dimensions')}
          className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-mono font-bold uppercase transition-colors whitespace-nowrap border-b-2 ${activeTab === 'dimensions'
            ? 'border-cad-accent text-cad-textPrimary bg-cad-panel'
            : 'border-transparent text-cad-textSecondary hover:text-cad-textPrimary hover:bg-cad-panel/60'
            }`}
        >
          <Sliders className="w-3.5 h-3.5 text-cad-accent" /> Size & Mat
        </button>

        <button
          onClick={() => handleTabChange('drive')}
          className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-mono font-bold uppercase transition-colors whitespace-nowrap border-b-2 ${activeTab === 'drive'
            ? 'border-cad-accent text-cad-textPrimary bg-cad-panel'
            : 'border-transparent text-cad-textSecondary hover:text-cad-textPrimary hover:bg-cad-panel/60'
            }`}
        >
          <Zap className="w-3.5 h-3.5 text-cad-warning" /> Drive & Motor
        </button>

        <button
          onClick={() => handleTabChange('supports')}
          className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-mono font-bold uppercase transition-colors whitespace-nowrap border-b-2 ${activeTab === 'supports'
            ? 'border-cad-accent text-cad-textPrimary bg-cad-panel'
            : 'border-transparent text-cad-textSecondary hover:text-cad-textPrimary hover:bg-cad-panel/60'
            }`}
        >
          <ArrowUpDown className="w-3.5 h-3.5 text-cad-success" /> Supports
        </button>

        <button
          onClick={() => handleTabChange('curves')}
          className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-mono font-bold uppercase transition-colors whitespace-nowrap border-b-2 ${activeTab === 'curves'
            ? 'border-cad-accent text-cad-textPrimary bg-cad-panel'
            : 'border-transparent text-cad-textSecondary hover:text-cad-textPrimary hover:bg-cad-panel/60'
            }`}
        >
          <CornerDownRight className="w-3.5 h-3.5 text-cad-accent" /> Curves ({configuration.curves?.length || 0})
        </button>

        <button
          onClick={() => handleTabChange('guides')}
          className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-mono font-bold uppercase transition-colors whitespace-nowrap border-b-2 ${activeTab === 'guides'
            ? 'border-cad-accent text-cad-textPrimary bg-cad-panel'
            : 'border-transparent text-cad-textSecondary hover:text-cad-textPrimary hover:bg-cad-panel/60'
            }`}
        >
          <Split className="w-3.5 h-3.5 text-purple-400" /> Guides
        </button>
      </div>

      {/* Tab Panels */}
      <div className="p-4 space-y-5 flex-grow overflow-y-auto max-h-[620px]">
        {/* ========================================================
            TAB 1: Material & Dimensions
        ======================================================== */}
        {activeTab === 'dimensions' && (
          <div className="space-y-5">
            {/* Visual Component Banner: Chain & Beam Profile */}
            <div className="border border-cad-border bg-cad-bgSub rounded-lg p-3 flex items-center gap-3">
              <div className="w-16 h-16 bg-white dark:bg-[#080E16] rounded border border-cad-border p-1 flex items-center justify-center shrink-0">
                <img
                  src={PRODUCT_ASSETS.chains[configuration.chainMaterial]?.primaryImage || '/images/conveyor-modular-chain-link.png'}
                  alt="Modular Chain Link"
                  className="max-h-full max-w-full object-contain"
                />
              </div>
              <div className="flex-grow font-mono">
                <div className="text-[10px] uppercase font-bold text-cad-accent">
                  CHAIN TRAVEL SURFACE
                </div>
                <div className="text-xs font-bold text-cad-textPrimary uppercase">
                  {PRODUCT_ASSETS.chains[configuration.chainMaterial]?.name || 'Modular Chain'}
                </div>
                <div className="text-[10px] text-cad-textMuted mt-0.5">
                  Pitch: {ConfigurationService.getChainPitch(configuration.width)} mm &bull; Track: {configuration.width} mm
                </div>
              </div>
            </div>

            {/* Chain Material Selection Cards with Images */}
            <div>
              <label className="text-[11px] font-mono font-bold text-cad-textSecondary uppercase tracking-wider block mb-2">
                Chain Material Specification
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'steel', label: 'Steel', icon: Shield, desc: 'Heavy duty' },
                  { id: 'stainless-steel', label: 'Stainless', icon: Sparkles, desc: 'AISI 304' },
                  { id: 'plastic', label: 'POM Plastic', icon: Layers, desc: 'Low friction' }
                ].map((mat) => {
                  const isSelected = configuration.chainMaterial === mat.id;
                  const Icon = mat.icon;
                  return (
                    <button
                      key={mat.id}
                      type="button"
                      onClick={() => handleMaterialChange(mat.id as ChainMaterial)}
                      className={`p-2.5 rounded border text-left transition-all flex flex-col justify-between ${isSelected
                        ? 'border-cad-accent bg-cad-accent/15 ring-1 ring-cad-accent shadow-xs'
                        : 'border-cad-border bg-cad-bgSub hover:border-cad-textMuted'
                        }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <Icon className={`w-3.5 h-3.5 ${isSelected ? 'text-cad-accent' : 'text-cad-textSecondary'}`} />
                          {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-cad-accent" />}
                        </div>
                        <div className="h-12 flex items-center justify-center bg-white dark:bg-[#080E16] rounded border border-cad-border/60 p-1 mb-2">
                          <img
                            src="/images/conveyor-modular-chain-link.png"
                            alt={mat.label}
                            className="max-h-full max-w-full object-contain"
                          />
                        </div>
                        <div className={`text-xs font-mono font-bold uppercase ${isSelected ? 'text-cad-textPrimary' : 'text-cad-textSecondary'}`}>
                          {mat.label}
                        </div>
                        <div className="text-[9px] font-mono text-cad-textMuted mt-0.5">{mat.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Track Width / Chain Width */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-[11px] font-mono font-bold text-cad-textSecondary uppercase tracking-wider">
                  width of the chain
                </label>
                <span className="text-xs font-mono font-bold text-cad-textPrimary">{configuration.width} mm</span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                {[63, 82.5, 114.3, 190.5, 254, 304.8].map((w) => {
                  const isAvailable = availableWidths.includes(w);
                  const isSelected = configuration.width === w;
                  return (
                    <button
                      key={w}
                      type="button"
                      disabled={!isAvailable}
                      onClick={() => handleWidthChange(w)}
                      className={`py-1.5 px-1 rounded font-mono text-xs font-bold border transition-colors ${isSelected
                        ? 'border-cad-accent bg-cad-accent text-white'
                        : isAvailable
                          ? 'border-cad-border bg-cad-bgSub text-cad-textSecondary hover:border-cad-textMuted hover:text-cad-textPrimary'
                          : 'border-cad-borderSubtle bg-cad-bg text-cad-textMuted opacity-40 cursor-not-allowed'
                        }`}
                    >
                      {w}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Conveyor Length */}
            <div className="border-t border-cad-border pt-4">
              <div className="flex justify-between items-center mb-2">
                <label className="text-[11px] font-mono font-bold text-cad-textSecondary uppercase tracking-wider">
                  converyor axis to axis length
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={600}
                    max={12000}
                    step={100}
                    value={configuration.length}
                    onChange={(e) => handleLengthChange(Number(e.target.value))}
                    className="cad-input w-24 rounded px-2 py-1 text-right font-mono text-xs font-bold focus:border-cad-accent outline-none"
                  />
                  <span className="text-xs font-mono text-cad-textSecondary">mm</span>
                </div>
              </div>

              <input
                type="range"
                min={600}
                max={12000}
                step={100}
                value={configuration.length}
                onChange={(e) => handleLengthChange(Number(e.target.value))}
                className="cad-slider w-full cursor-pointer"
              />
              <div className="flex justify-between text-[9px] font-mono text-cad-textMuted mt-1">
                <span>600 mm</span>
                <span>3000 mm</span>
                <span>6000 mm</span>
                <span>12000 mm</span>
              </div>
            </div>

            {/* Load Capacity */}
            <div className="border-t border-cad-border pt-4">
              <div className="flex justify-between items-center mb-2">
                <label className="text-[11px] font-mono font-bold text-cad-textSecondary uppercase tracking-wider">
                  max load on the conveyor
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={5}
                    max={125}
                    step={5}
                    value={configuration.loadPerMeter}
                    onChange={(e) => handleLoadChange(Number(e.target.value))}
                    className="cad-input w-20 rounded px-2 py-1 text-right font-mono text-xs font-bold focus:border-cad-accent outline-none"
                  />
                  <span className="text-xs font-mono text-cad-textSecondary">kg/m</span>
                </div>
              </div>

              <input
                type="range"
                min={5}
                max={125}
                step={5}
                value={configuration.loadPerMeter}
                onChange={(e) => handleLoadChange(Number(e.target.value))}
                className="cad-slider w-full cursor-pointer"
              />
            </div>
          </div>
        )}

        {/* ========================================================
            TAB 2: Drive & Motor
        ======================================================== */}
        {activeTab === 'drive' && (
          <div className="space-y-5">
            {/* 1. Drive System Selection (Interactive Cards with Real Photos) */}
            <div>
              <label className="text-[11px] font-mono font-bold text-cad-textSecondary uppercase tracking-wider block mb-2">
                Drive System Selection
              </label>
              <div className="grid grid-cols-2 gap-2.5 font-mono">
                {[
                  { id: 'normal', label: 'Motor Head', desc: 'Direct drive head', img: '/images/conveyor-drive-unit-1.png' },
                  { id: 'reductor', label: 'Reductor', desc: 'Gearbox reducer', img: '/images/conveyor-motor-gearbox.png' }
                ].map((d) => {
                  const isSelected = (configuration.driveKind || (configuration.driveMountType === 'fixed' ? 'normal' : 'reductor')) === d.id;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => {
                        updateConfig({
                          driveKind: d.id as DriveKind,
                          driveMountType: d.id === 'reductor' ? 'reductor' : 'fixed'
                        });
                        setSelectedDriveComponent(d.id === 'normal' ? 'motor-head' : 'reductor');
                        onFocusComponent?.('drive');
                      }}
                      className={`p-2.5 rounded-lg border flex flex-col items-center justify-between text-center transition-all ${isSelected
                        ? 'border-cad-accent bg-cad-accent/15 ring-1 ring-cad-accent text-cad-textPrimary shadow-xs'
                        : 'border-cad-border bg-cad-bgSub text-cad-textSecondary hover:border-cad-textMuted'
                        }`}
                    >
                      <div className="flex items-center justify-between w-full mb-1.5">
                        <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${isSelected ? 'border-cad-accent bg-cad-accent' : 'border-cad-border'}`}>
                          {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white block" />}
                        </span>
                        <span className="text-[11px] font-bold uppercase truncate">{d.label}</span>
                      </div>
                      <div className="h-16 w-full bg-white dark:bg-[#080E16] rounded border border-cad-border/60 p-1 flex items-center justify-center overflow-hidden mb-1">
                        <img src={d.img} alt={d.label} className="max-h-full max-w-full object-contain" />
                      </div>
                      <span className="text-[9px] text-cad-textMuted leading-tight">{d.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Select the Engine Position (With Left, Right, and Bottom / Below Belt Options) */}
            <div className="border-t border-cad-border pt-4">
              <label className="text-[11px] font-mono font-bold text-cad-textSecondary uppercase tracking-wider block mb-2">
                Select the engine position
              </label>

              <div className="bg-cad-bgSub border border-cad-border rounded-lg p-3 space-y-3 font-mono">
                <div className="relative flex items-center justify-between px-3 py-4 bg-cad-panel border border-cad-border rounded">
                  {/* Start Infeed Column */}
                  <div className="flex flex-col gap-3.5 z-10">
                    <span className="text-[10px] font-bold text-cad-textMuted uppercase">Infeed (Start)</span>
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-cad-textPrimary hover:text-cad-accent transition-colors">
                      <input
                        type="radio"
                        name="enginePos"
                        checked={configuration.drivePosition === 'start-left'}
                        onChange={() => handleDrivePositionChange('start-left')}
                        className="accent-cad-accent cursor-pointer"
                      />
                      <span>Left</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-cad-textPrimary hover:text-cad-accent transition-colors">
                      <input
                        type="radio"
                        name="enginePos"
                        checked={configuration.drivePosition === 'start-right'}
                        onChange={() => handleDrivePositionChange('start-right')}
                        className="accent-cad-accent cursor-pointer"
                      />
                      <span>Right</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-cad-textPrimary hover:text-cad-accent transition-colors">
                      <input
                        type="radio"
                        name="enginePos"
                        checked={configuration.drivePosition === 'below-belt-start'}
                        onChange={() => handleDrivePositionChange('below-belt-start')}
                        className="accent-cad-accent cursor-pointer"
                      />
                      <span className="text-cad-accent font-extrabold">Bottom</span>
                    </label>
                  </div>

                  {/* Conveyor Graphic Body with Central Arrow */}
                  <div className="flex-grow mx-4 h-12 bg-[#144473] dark:bg-[#10375E] rounded flex items-center justify-center shadow-inner relative overflow-hidden">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <span className="text-[9px] font-bold text-blue-200 tracking-wider">START</span>
                      <svg viewBox="0 0 48 16" className="w-10 sm:w-12 h-5 fill-white shrink-0">
                        <path d="M0 6 L32 6 L32 1 L48 8 L32 15 L32 10 L0 10 Z" />
                      </svg>
                      <span className="text-[9px] font-bold text-blue-200 tracking-wider">END</span>
                    </div>
                  </div>

                  {/* End Discharge Column */}
                  <div className="flex flex-col gap-3.5 z-10 text-right">
                    <span className="text-[10px] font-bold text-cad-textMuted uppercase">Discharge (End)</span>
                    <label className="flex items-center justify-end gap-2 cursor-pointer text-xs font-bold text-cad-textPrimary hover:text-cad-accent transition-colors">
                      <span>Left</span>
                      <input
                        type="radio"
                        name="enginePos"
                        checked={configuration.drivePosition === 'end-left' || configuration.drivePosition === 'left'}
                        onChange={() => handleDrivePositionChange('end-left')}
                        className="accent-cad-accent cursor-pointer"
                      />
                    </label>
                    <label className="flex items-center justify-end gap-2 cursor-pointer text-xs font-bold text-cad-textPrimary hover:text-cad-accent transition-colors">
                      <span>Right</span>
                      <input
                        type="radio"
                        name="enginePos"
                        checked={configuration.drivePosition === 'end-right' || configuration.drivePosition === 'right'}
                        onChange={() => handleDrivePositionChange('end-right')}
                        className="accent-cad-accent cursor-pointer"
                      />
                    </label>
                    <label className="flex items-center justify-end gap-2 cursor-pointer text-xs font-bold text-cad-textPrimary hover:text-cad-accent transition-colors">
                      <span className="text-cad-accent font-extrabold">Bottom</span>
                      <input
                        type="radio"
                        name="enginePos"
                        checked={configuration.drivePosition === 'below-belt-end'}
                        onChange={() => handleDrivePositionChange('below-belt-end')}
                        className="accent-cad-accent cursor-pointer"
                      />
                    </label>
                  </div>
                </div>

                <div className="flex justify-between items-center text-[10px] text-cad-textMuted px-1">
                  <span>Infeed Head Terminal (Start)</span>
                  <span>Discharge Head Terminal (End)</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================
            TAB 3: Height & Supports (Matches User Screenshot)
        ======================================================== */}
        {activeTab === 'supports' && (
          <div className="space-y-5">
            {/* 1. Support Construction Type Selection */}
            <div>
              <label className="text-[11px] font-mono font-bold text-cad-textSecondary uppercase tracking-wider block mb-2">
                Support Construction Type
              </label>
              <div className="grid grid-cols-2 gap-2.5 font-mono">
                {[
                  { id: 'fixed', label: 'Fixed Legs', desc: 'Rigid aluminium extrusion' },
                  { id: 'mechanically-adjustable', label: 'Mechanical', desc: 'Telescoping column' },
                  { id: 'electrically-adjustable', label: 'Electrical', desc: 'Motorized actuator' },
                  { id: 'without-support', label: 'No Support', desc: 'Direct gantry / table' }
                ].map((s) => {
                  const isSelected = (configuration.workingHeight.type || 'fixed') === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => handleSupportTypeChange(s.id as SupportType)}
                      className={`p-3 rounded-lg border text-left font-mono transition-all min-w-0 overflow-hidden ${isSelected
                        ? 'border-cad-accent bg-cad-accent/15 ring-1 ring-cad-accent text-cad-textPrimary shadow-xs'
                        : 'border-cad-border bg-cad-bgSub text-cad-textSecondary hover:border-cad-textMuted'
                        }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1 min-w-0">
                        <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${isSelected ? 'border-cad-accent bg-cad-accent' : 'border-cad-border'}`}>
                          {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white block" />}
                        </span>
                        <span className="text-xs font-bold uppercase truncate min-w-0">{s.label}</span>
                      </div>
                      <p className="text-[10px] text-cad-textMuted leading-tight truncate">{s.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Height Architecture Options and Conveyor Diagram */}
            {configuration.workingHeight.type !== 'without-support' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
                <div className="space-y-3 font-mono">
                  {/* 1. Fixed conveyor height */}
                  <div
                    onClick={() => handleHeightModeChange('fixed')}
                    className={`p-3 rounded border cursor-pointer transition-all ${
                      (configuration.workingHeight.heightMode || 'fixed') === 'fixed'
                        ? 'border-cad-accent bg-cad-accent/10 ring-1 ring-cad-accent'
                        : 'border-cad-border bg-cad-bgSub hover:border-cad-textMuted'
                    }`}
                  >
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-cad-textPrimary">
                      <input
                        type="radio"
                        name="heightMode"
                        checked={(configuration.workingHeight.heightMode || 'fixed') === 'fixed'}
                        onChange={() => handleHeightModeChange('fixed')}
                        className="accent-cad-accent cursor-pointer"
                      />
                      <span>Fixed conveyor height</span>
                    </label>

                    {(configuration.workingHeight.heightMode || 'fixed') === 'fixed' && (
                      <div className="mt-2.5 bg-cad-panel p-2.5 rounded border border-cad-border space-y-1.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-bold text-cad-textSecondary">Enter the height:</span>
                          <span className="font-mono text-cad-accent font-bold text-xs">{configuration.workingHeight.height} mm</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <input
                              type="number"
                              min={700}
                              max={1500}
                              step={25}
                              value={configuration.workingHeight.height}
                              onChange={(e) => handleHeightChange(Number(e.target.value))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleHeightChange(configuration.workingHeight.height);
                                }
                              }}
                              className="w-full bg-cad-bgSub border border-cad-border rounded px-3 py-1.5 font-mono text-xs font-bold text-cad-textPrimary outline-none focus:border-cad-accent text-center"
                            />
                            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-cad-textMuted pointer-events-none">
                              mm
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleHeightChange(configuration.workingHeight.height)}
                            className="px-4 py-1.5 bg-cad-accent hover:bg-cad-accent/90 text-white rounded font-mono text-xs font-bold transition-colors cursor-pointer shrink-0"
                          >
                            Enter
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 2. Adjustable conveyor height */}
                  <div
                    onClick={() => handleHeightModeChange('adjustable')}
                    className={`p-3 rounded border cursor-pointer transition-all ${
                      configuration.workingHeight.heightMode === 'adjustable'
                        ? 'border-cad-accent bg-cad-accent/10 ring-1 ring-cad-accent'
                        : 'border-cad-border bg-cad-bgSub hover:border-cad-textMuted'
                    }`}
                  >
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-cad-textPrimary">
                      <input
                        type="radio"
                        name="heightMode"
                        checked={configuration.workingHeight.heightMode === 'adjustable'}
                        onChange={() => handleHeightModeChange('adjustable')}
                        className="accent-cad-accent cursor-pointer"
                      />
                      <span>Adjustable conveyor height</span>
                    </label>

                    {configuration.workingHeight.heightMode === 'adjustable' && (
                      <div className="mt-2.5 pl-6 space-y-1.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-between items-center text-[10px] text-cad-textSecondary">
                          <span>Range: 700 – 1400 mm</span>
                          <strong className="text-cad-accent">{configuration.workingHeight.height} mm</strong>
                        </div>
                        <input
                          type="range"
                          min={700}
                          max={1400}
                          step={25}
                          value={configuration.workingHeight.height}
                          onChange={(e) => handleHeightChange(Number(e.target.value))}
                          className="cad-slider w-full cursor-pointer"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Conveyor Frame & Legs Visual Illustration */}
                <div className="bg-white dark:bg-[#080E16] border border-cad-border rounded-lg p-3 flex flex-col items-center justify-center min-h-[180px] overflow-hidden">
                  <img
                    src={
                      configuration.workingHeight.type === 'mechanically-adjustable'
                        ? '/images/conveyor-support-stand.png'
                        : configuration.workingHeight.type === 'electrically-adjustable'
                        ? '/images/conveyor-sensor-column-1.png'
                        : '/images/conveyor-support-leg-assembly.png'
                    }
                    alt="Conveyor Structural Legs"
                    className="max-h-36 max-w-full object-contain"
                  />
                  <span className="text-[10px] font-mono font-bold text-cad-textPrimary mt-2 text-center">
                    {configuration.workingHeight.type === 'mechanically-adjustable'
                      ? 'Telescoping Mechanical Stand Column'
                      : configuration.workingHeight.type === 'electrically-adjustable'
                      ? 'Motorized Linear Actuator Column'
                      : 'ALUFLEX Rigid Extrusion Leg Assembly'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="bg-cad-bgSub border border-cad-border rounded-lg p-4 flex items-center gap-4">
                <img
                  src="/images/conveyor-mounting-plate.png"
                  alt="Direct Mounting Plate"
                  className="w-16 h-16 object-contain rounded bg-white p-1 border border-cad-border"
                />
                <div>
                  <h4 className="text-xs font-mono font-bold text-cad-textPrimary">Direct Machine Mount (Without Legs)</h4>
                  <p className="text-[11px] text-cad-textSecondary mt-0.5">
                    Conveyor frame is supplied with bottom mounting brackets for integration onto client machinery or tabletop structures.
                  </p>
                </div>
              </div>
            )}

            {/* Footing & Wheels Options (Only visible when support legs exist) */}
            {configuration.workingHeight.type !== 'without-support' && (
              <>
                <div className="border-t border-cad-border pt-4">
                  <label className="text-[11px] font-mono font-bold text-cad-textSecondary uppercase tracking-wider block mb-3">
                    Footing & Wheel Selection
                  </label>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 font-mono">
                    {[
                      {
                        id: 'anchor-angle',
                        label: 'Anchor angle',
                        svg: (
                          <svg viewBox="0 0 48 48" className="w-10 h-10 mx-auto" fill="none">
                            <rect x="22" y="6" width="5" height="24" rx="1" fill="#475569" />
                            <path d="M22 28 L14 40 L6 40 L6 43 L16 43 L26 28 Z" fill="#334155" />
                            <circle cx="11" cy="41.5" r="1.5" fill="#94A3B8" />
                          </svg>
                        )
                      },
                      {
                        id: 'adjustable',
                        label: 'Adjustable',
                        svg: (
                          <svg viewBox="0 0 48 48" className="w-10 h-10 mx-auto" fill="none">
                            <rect x="22" y="6" width="4" height="24" fill="#94A3B8" />
                            <rect x="20" y="20" width="8" height="5" rx="1" fill="#64748B" />
                            <path d="M14 38 L20 30 L28 30 L34 38 Z" fill="#475569" />
                            <rect x="12" y="38" width="24" height="4" rx="1.5" fill="#1E293B" />
                          </svg>
                        )
                      },
                      {
                        id: 'fixed',
                        label: 'Fixed',
                        svg: (
                          <svg viewBox="0 0 48 48" className="w-10 h-10 mx-auto" fill="none">
                            <rect x="14" y="8" width="20" height="4" rx="1" fill="#475569" />
                            <path d="M18 12 L18 28 L30 28 L30 12 Z" fill="#64748B" />
                            <circle cx="24" cy="28" r="13" fill="#1E293B" />
                            <circle cx="24" cy="28" r="6" fill="#64748B" />
                            <circle cx="24" cy="28" r="2.5" fill="#94A3B8" />
                          </svg>
                        )
                      },
                      {
                        id: 'wheel-without-brake',
                        label: 'wheel without break',
                        svg: (
                          <svg viewBox="0 0 48 48" className="w-10 h-10 mx-auto" fill="none">
                            <rect x="16" y="8" width="18" height="4" rx="1" fill="#475569" />
                            <path d="M22 12 L28 12 L25 17 Z" fill="#64748B" />
                            <path d="M25 16 L19 28 L23 30 L28 17 Z" fill="#64748B" />
                            <circle cx="20" cy="29" r="13" fill="#1E293B" />
                            <circle cx="20" cy="29" r="6" fill="#475569" />
                            <circle cx="20" cy="29" r="2.5" fill="#94A3B8" />
                          </svg>
                        )
                      },
                      {
                        id: 'wheel-with-brake',
                        label: 'wheel with break',
                        svg: (
                          <svg viewBox="0 0 48 48" className="w-10 h-10 mx-auto" fill="none">
                            <rect x="18" y="8" width="18" height="4" rx="1" fill="#475569" />
                            <path d="M12 11 L20 11 L18 14 L10 14 Z" fill="#0284C7" />
                            <path d="M25 14 L20 28 L24 30 L28 16 Z" fill="#64748B" />
                            <circle cx="21" cy="29" r="13" fill="#1E293B" />
                            <circle cx="21" cy="29" r="6" fill="#475569" />
                            <circle cx="21" cy="29" r="2.5" fill="#94A3B8" />
                          </svg>
                        )
                      }
                    ].map((ft) => {
                      const currentFoot = configuration.workingHeight.footType || 'adjustable';
                      const isSelected = currentFoot === ft.id || (ft.id === 'adjustable' && currentFoot === 'articulated-foot');
                      return (
                        <button
                          key={ft.id}
                          type="button"
                          onClick={() => handleFootTypeChange(ft.id as FootType)}
                          className={`p-2.5 rounded border text-center flex flex-col items-center justify-between transition-all ${
                            isSelected
                              ? 'border-cad-accent bg-cad-accent/15 ring-1 ring-cad-accent shadow-xs'
                              : 'border-cad-border bg-cad-bgSub hover:border-cad-textMuted'
                          }`}
                        >
                          <div className="h-12 w-full flex items-center justify-center mb-1">
                            {ft.svg}
                          </div>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${isSelected ? 'border-cad-accent bg-cad-accent' : 'border-cad-border'}`}>
                              {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white block" />}
                            </span>
                            <span className={`text-[10px] font-bold text-left leading-tight ${isSelected ? 'text-cad-textPrimary' : 'text-cad-textSecondary'}`}>
                              {ft.label}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Live Leg Pair Calculation Info */}
                <div className="bg-cad-bgSub border border-cad-border p-3 rounded flex items-center justify-between text-xs font-mono">
                  <div>
                    <span className="text-cad-textSecondary">Calculated Legs: </span>
                    <strong className="text-cad-success font-bold">{supportPositions.length} pairs</strong>
                  </div>
                  <div className="text-cad-textSecondary text-[11px]">
                    Leg Spacing: <strong className="text-cad-textPrimary">&le; 2500 mm span</strong>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ========================================================
            TAB 4: Curves (Parametric Bends & Horizontal End Path)
        ======================================================== */}
        {activeTab === 'curves' && (
          <div className="space-y-5">
            {/* Visual Curved Track Reference */}
            <div className="border border-cad-border bg-cad-bgSub rounded-lg p-3 flex items-center gap-3">
              <div className="w-16 h-16 bg-white dark:bg-[#080E16] rounded border border-cad-border p-1 flex items-center justify-center shrink-0">
                <img
                  src={PRODUCT_ASSETS.frames.curve.primaryImage}
                  alt="Curved Extrusion Profile"
                  className="max-h-full max-w-full object-contain"
                />
              </div>
              <div className="flex-grow font-mono text-xs">
                <div className="text-[10px] text-cad-accent font-bold uppercase">CURVED TRACK PROFILE</div>
                <div className="font-bold text-cad-textPrimary">Precision Aluminium Bend</div>
                <div className="text-[10px] text-cad-textMuted mt-0.5">Low-friction wear strip guides &bull; Wheel & Normal bends</div>
              </div>
            </div>

            {/* Straight vs Curved Mode Toggle */}
            <div className="flex items-center justify-between bg-cad-bgSub p-3 rounded border border-cad-border">
              <div>
                <span className="text-xs font-mono font-bold text-cad-textPrimary uppercase tracking-wider block">
                  Conveyor Shape
                </span>
                <span className="text-[10px] text-cad-textSecondary font-mono">
                  {configuration.shape === 'curved' ? 'Parametric Multi-Curve Path' : 'Linear Straight Track'}
                </span>
              </div>
              <div className="flex bg-cad-panel border border-cad-border rounded p-0.5 font-mono">
                <button
                  type="button"
                  onClick={() => handleShapeChange('straight')}
                  className={`px-3 py-1 text-xs rounded font-bold transition-colors ${
                    configuration.shape === 'straight' ? 'bg-cad-accent text-white' : 'text-cad-textSecondary hover:text-cad-textPrimary'
                  }`}
                >
                  Straight
                </button>
                <button
                  type="button"
                  onClick={() => handleShapeChange('curved')}
                  className={`px-3 py-1 text-xs rounded font-bold transition-colors ${
                    configuration.shape === 'curved' ? 'bg-cad-accent text-white' : 'text-cad-textSecondary hover:text-cad-textPrimary'
                  }`}
                >
                  Curved
                </button>
              </div>
            </div>

            {configuration.shape === 'curved' && (
              <div className="space-y-4">
                <div className="flex justify-between items-center font-mono">
                  <span className="text-[11px] font-bold text-cad-textSecondary uppercase tracking-wider">
                    Bends / Curves ({configuration.curves?.length || 0}/5)
                  </span>
                  {(configuration.curves?.length || 0) < 5 && (
                    <button
                      type="button"
                      onClick={handleAddCurve}
                      className="flex items-center gap-1 px-2.5 py-1 bg-cad-accent/15 hover:bg-cad-accent/25 border border-cad-accent/40 text-cad-accent hover:text-cad-textPrimary rounded text-xs font-bold transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Curve
                    </button>
                  )}
                </div>

                {configuration.curves?.map((curve, idx) => {
                  const isWheelBend = curve.curveType === 'wheelband';
                  const currentRadius = resolveCurveRadius(curve, configuration.width);

                  return (
                    <div key={curve.id || idx} className="bg-cad-bgSub border border-cad-border rounded-lg p-3.5 space-y-3 font-mono">
                      <div className="flex justify-between items-center border-b border-cad-border pb-2">
                        <span className="text-xs font-bold text-cad-textPrimary">Curve #{idx + 1}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveCurve(idx)}
                          className="text-cad-error hover:text-red-400 text-xs flex items-center gap-1 font-bold"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Remove
                        </button>
                      </div>

                      {/* 1. Curve Type: Normal Curve Bend vs Wheel Bend */}
                      <div>
                        <label className="text-[10px] text-cad-textSecondary block mb-1.5 font-bold uppercase">
                          Curve Bend Type
                        </label>
                        <div className="grid grid-cols-1 gap-2 text-xs">
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateCurve(idx, {
                                curveType: 'wheelband',
                                radius: 400
                              })
                            }
                            className={`p-2 rounded border text-left transition-all ${
                              isWheelBend
                                ? 'border-cad-accent bg-cad-accent/15 text-cad-textPrimary ring-1 ring-cad-accent font-bold'
                                : 'border-cad-border bg-cad-panel text-cad-textSecondary hover:border-cad-textMuted'
                            }`}
                          >
                            <span className="block text-xs">ZP90 wheel bend (client part)</span>
                            <span className="text-[9px] text-cad-textMuted font-normal">Radius R400 - the client's CAD bend</span>
                          </button>
                        </div>
                      </div>

                      {/* 2. Curve Radius (Required for all bends) */}
                      <div className="space-y-1">
                        <div className="flex justify-between items-center text-xs">
                          <label className="text-[10px] text-cad-textSecondary uppercase font-bold">
                            Radius for this bend (mm)
                          </label>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={currentRadius}
                              min={isWheelBend ? 150 : 300}
                              max={isWheelBend ? 350 : 2000}
                              step={25}
                              onChange={(e) => {
                                // the client's ZP90 wheel bend has a fixed radius (R400)
                              }}
                              className="cad-input w-20 rounded px-2 py-0.5 text-right font-bold text-xs"
                            />
                            <span className="text-cad-textSecondary text-xs">mm</span>
                          </div>
                        </div>
                        <input
                          type="range"
                          value={currentRadius}
                          min={isWheelBend ? 150 : 300}
                          max={isWheelBend ? 350 : 2000}
                          step={25}
                          onChange={(e) => {
                                // the client's ZP90 wheel bend has a fixed radius (R400)
                              }}
                          className="cad-slider w-full cursor-pointer"
                        />
                      </div>

                      {/* 3. Sequential Distance / Offset Inputs */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                        {/* Curve 1: Position offset from start. Curve 2+: Distance between previous and current */}
                        <div className="sm:col-span-1">
                          <label className="text-[10px] text-cad-textSecondary block mb-1 font-bold">
                            {idx === 0
                              ? 'Position offset from the start offset of the curve (mm)'
                              : `Distance between curve ${idx} and ${idx + 1} (mm)`}
                          </label>
                          {idx === 0 ? (
                            <input
                              type="number"
                              value={curve.offset || 1500}
                              step={100}
                              min={300}
                              max={10000}
                              onChange={(e) => handleUpdateCurve(idx, { offset: Number(e.target.value) })}
                              className="cad-input w-full rounded px-2 py-1 font-bold"
                            />
                          ) : (
                            <input
                              type="number"
                              value={curve.distanceFromPrevious || 800}
                              step={50}
                              min={200}
                              max={10000}
                              onChange={(e) => handleUpdateCurve(idx, { distanceFromPrevious: Number(e.target.value) })}
                              className="cad-input w-full rounded px-2 py-1 font-bold"
                            />
                          )}
                        </div>

                        <div>
                          <label className="text-[10px] text-cad-textSecondary block mb-1 font-bold">Direction</label>
                          <select
                            value={curve.direction}
                            onChange={(e) => handleUpdateCurve(idx, { direction: e.target.value as CurveDirection })}
                            className="cad-input w-full rounded px-2 py-1 font-bold"
                          >
                            <option value="left">Left</option>
                            <option value="right">Right</option>
                          </select>
                        </div>

                        <div>
                          <label className="text-[10px] text-cad-textSecondary block mb-1 font-bold">Angle</label>
                          <select
                            value={curve.angle}
                            onChange={(e) => handleUpdateCurve(idx, { angle: Number(e.target.value) })}
                            className="cad-input w-full rounded px-2 py-1 font-bold"
                          >
                            <option value={90}>90&deg;</option>
                            <option value={180}>180&deg;</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Length of the end horizontal path */}
                <div className="bg-cad-bgSub border border-cad-border rounded-lg p-3.5 space-y-2 font-mono">
                  <div className="flex justify-between items-center text-xs">
                    <label className="text-[11px] font-bold text-cad-textPrimary uppercase tracking-wider">
                      Length of the end horizontal path (mm)
                    </label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={200}
                        max={6000}
                        step={50}
                        value={configuration.endHorizontalPathLength ?? 1000}
                        onChange={(e) => updateConfig({ endHorizontalPathLength: Number(e.target.value) })}
                        className="cad-input w-24 rounded px-2 py-1 text-right font-bold text-xs"
                      />
                      <span className="text-cad-textSecondary text-xs">mm</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={200}
                    max={6000}
                    step={50}
                    value={configuration.endHorizontalPathLength ?? 1000}
                    onChange={(e) => updateConfig({ endHorizontalPathLength: Number(e.target.value) })}
                    className="cad-slider w-full cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-cad-textMuted">
                    <span>Discharge tangent run</span>
                    <span>Min: 200 mm &bull; Max: 6000 mm</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================
            TAB 5: Guides & Automation Controls (Exact User Labels)
        ======================================================== */}
        {activeTab === 'guides' && (
          <div className="space-y-5">
            {/* Real Side Guide Section Card */}
            <div className="border border-cad-border bg-cad-bgSub rounded-lg p-3 flex items-center gap-3">
              <div className="w-16 h-16 bg-white dark:bg-[#080E16] rounded border border-cad-border p-1 flex items-center justify-center shrink-0">
                <img
                  src={PRODUCT_ASSETS.frames.straight.primaryImage}
                  alt="Side Guide Rail System"
                  className="max-h-full max-w-full object-contain"
                />
              </div>
              <div className="flex-grow font-mono text-xs">
                <div className="text-[10px] text-cad-accent font-bold uppercase">LATERAL RESTRAINT</div>
                <div className="font-bold text-cad-textPrimary">Anodized Aluminium Guide Rail</div>
                <div className="text-[10px] text-cad-textMuted mt-0.5">Adjustable polymer wear strips &bull; Clamped brackets</div>
              </div>
            </div>

            {/* Side Guides Enable Toggle */}
            <div className="flex items-center justify-between bg-cad-bgSub p-3 rounded border border-cad-border font-mono">
              <div>
                <span className="text-xs font-bold text-cad-textPrimary uppercase tracking-wider block">
                  Lateral Side Guides
                </span>
                <span className="text-[10px] text-cad-textSecondary">
                  {configuration.sideGuides && configuration.sideGuides.length > 0 ? 'Enabled on both rails' : 'Without side guides'}
                </span>
              </div>
              <input
                type="checkbox"
                checked={!!(configuration.sideGuides && configuration.sideGuides.length > 0)}
                onChange={(e) => handleSideGuideToggle(e.target.checked)}
                className="w-4 h-4 cursor-pointer accent-[#174A86]"
              />
            </div>

            {configuration.sideGuides && configuration.sideGuides.length > 0 && (
              <div className="space-y-4 border-t border-cad-border pt-4 font-mono">
                {/* 1. gap or dist between side guides */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-xs">
                    <label className="text-[11px] font-bold text-cad-textPrimary uppercase tracking-wider">
                      gap or dist between side guides (mm)
                    </label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={configuration.sideGuides[0].widthBetweenGuides}
                        min={configuration.width}
                        max={configuration.width + 250}
                        step={5}
                        onChange={(e) => handleUpdateSideGuide({ widthBetweenGuides: Number(e.target.value) })}
                        className="cad-input w-20 rounded px-2 py-0.5 text-right font-bold text-xs"
                      />
                      <span className="text-cad-textSecondary text-xs">mm</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={configuration.width}
                    max={configuration.width + 250}
                    step={5}
                    value={configuration.sideGuides[0].widthBetweenGuides}
                    onChange={(e) => handleUpdateSideGuide({ widthBetweenGuides: Number(e.target.value) })}
                    className="cad-slider w-full cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-cad-textMuted">
                    <span>Chain Width: {configuration.width} mm</span>
                    <span>Max Clearance: {configuration.width + 250} mm</span>
                  </div>
                </div>

                {/* 2. side gap between top of the chain to bottom of the guide */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-xs">
                    <label className="text-[11px] font-bold text-cad-textPrimary uppercase tracking-wider">
                      side gap between top of the chain to bottem of the guide (mm)
                    </label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={configuration.sideGuides[0].bottomClearanceGap ?? 15}
                        min={0}
                        max={100}
                        step={5}
                        onChange={(e) => handleUpdateSideGuide({ bottomClearanceGap: Number(e.target.value) })}
                        className="cad-input w-20 rounded px-2 py-0.5 text-right font-bold text-xs"
                      />
                      <span className="text-cad-textSecondary text-xs">mm</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={configuration.sideGuides[0].bottomClearanceGap ?? 15}
                    onChange={(e) => handleUpdateSideGuide({ bottomClearanceGap: Number(e.target.value) })}
                    className="cad-slider w-full cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-cad-textMuted">
                    <span>Direct flush: 0 mm</span>
                    <span>High clearance: 100 mm</span>
                  </div>
                </div>

                {/* Guide Rail Profile Selection */}
                <div className="space-y-1">
                  <label className="text-[10px] text-cad-textSecondary block uppercase font-bold">
                    Guide Profile Section
                  </label>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => handleUpdateSideGuide({ type: '904516' })}
                      className={`p-2 rounded border text-left transition-all ${
                        configuration.sideGuides[0].type === '904516'
                          ? 'border-cad-accent bg-cad-accent/15 text-cad-textPrimary ring-1 ring-cad-accent font-bold'
                          : 'border-cad-border bg-cad-panel text-cad-textSecondary hover:border-cad-textMuted'
                      }`}
                    >
                      <span className="block text-xs">Single Rail Profile (904516)</span>
                      <span className="text-[9px] text-cad-textMuted font-normal">22mm height &bull; standard packets</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUpdateSideGuide({ type: '904515' })}
                      className={`p-2 rounded border text-left transition-all ${
                        configuration.sideGuides[0].type === '904515'
                          ? 'border-cad-accent bg-cad-accent/15 text-cad-textPrimary ring-1 ring-cad-accent font-bold'
                          : 'border-cad-border bg-cad-panel text-cad-textSecondary hover:border-cad-textMuted'
                      }`}
                    >
                      <span className="block text-xs">Double Rail Profile (904515)</span>
                      <span className="text-[9px] text-cad-textMuted font-normal">35mm height &bull; tall bottles/boxes</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}
      </div>

      {/* Expanded Motor Modal */}
      {showMotorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-[#0F172A] border border-cad-border rounded-xl p-6 max-w-xl w-full shadow-2xl space-y-4 font-mono">
            <div className="flex items-center justify-between border-b border-cad-border pb-3">
              <div>
                <span className="text-xs text-cad-warning font-bold uppercase">PRODUCT SPECIFICATION</span>
                <h3 className="text-base font-bold text-cad-textPrimary">{currentMotorAsset.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowMotorModal(false)}
                className="text-cad-textSecondary hover:text-cad-textPrimary text-xs font-bold px-2 py-1 rounded bg-cad-panel border border-cad-border"
              >
                CLOSE [✕]
              </button>
            </div>

            <div className="h-64 bg-slate-50 dark:bg-[#080E16] rounded-lg border border-cad-border p-4 flex items-center justify-center">
              <img
                src={currentMotorAsset.views?.[selectedMotorViewIndex]?.image || currentMotorAsset.primaryImage}
                alt={currentMotorAsset.name}
                className="max-h-full max-w-full object-contain"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              {currentMotorAsset.views?.map((v, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setSelectedMotorViewIndex(idx)}
                  className={`p-2 rounded border text-center transition-colors ${selectedMotorViewIndex === idx
                    ? 'border-cad-warning bg-cad-warning/15 text-cad-textPrimary'
                    : 'border-cad-border bg-cad-panel text-cad-textSecondary'
                    }`}
                >
                  <span className="text-[10px] font-bold uppercase">{v.label}</span>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-cad-border">
              <div>
                <span className="text-cad-textMuted text-[10px]">POWER RATING:</span>
                <div className="font-bold text-cad-textPrimary">{currentMotorAsset.powerKw} kW</div>
              </div>
              <div>
                <span className="text-cad-textMuted text-[10px]">RATED TORQUE:</span>
                <div className="font-bold text-cad-textPrimary">{currentMotorAsset.torqueNm} Nm</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
