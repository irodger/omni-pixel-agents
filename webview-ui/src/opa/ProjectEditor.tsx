import { useCallback, useEffect, useRef, useState } from 'react';

import type { OpaProjectSnapshot } from '../../../core/src/messages.js';
import { ZoomControls } from '../components/ZoomControls.js';
import { ZOOM_MAX, ZOOM_MIN } from '../constants.js';
import { useEditorActions } from '../hooks/useEditorActions.js';
import { useEditorKeyboard } from '../hooks/useEditorKeyboard.js';
import { t } from '../i18n/index.js';
import { OfficeCanvas } from '../office/components/OfficeCanvas.js';
import { EditorState } from '../office/editor/editorState.js';
import { EditorToolbar } from '../office/editor/EditorToolbar.js';
import { OfficeState } from '../office/engine/officeState.js';
import { getPetCount } from '../office/sprites/petSpriteData.js';
import type { OfficeLayout } from '../office/types.js';
import { projectDraft } from './projectDraft.js';
import type { useCampus } from './useCampus.js';
import { projectViewport } from './viewport.js';

export function ProjectEditor({
  project,
  shared,
  campus,
  readOnly,
  onClose,
}: {
  project: OpaProjectSnapshot;
  shared: OfficeLayout;
  campus: ReturnType<typeof useCampus>;
  readOnly: boolean;
  onClose: () => void;
}) {
  const [draft] = useState(() => projectDraft(project, shared));
  const [officeState] = useState(() => new OfficeState(draft.layout));
  const [editorState] = useState(() => new EditorState());
  const getOffice = useCallback(() => officeState, [officeState]);
  // All edits, undo and redo stay local until the explicit project save succeeds.
  const editor = useEditorActions(getOffice, editorState, false);
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const { handleZoomChange, panRef } = editor;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const disabled = readOnly || busy || campus.connection !== 'connected';
  const changedElsewhere = (project.layoutVersion ?? 0) !== draft.expectedRevision;
  const close = useCallback(() => {
    if (busy) return;
    if (!editor.isDirty || window.confirm(t('Discard unsaved project changes?'))) onClose();
  }, [busy, editor.isDirty, onClose]);
  useEffect(() => {
    const element = dialog.current!;
    const prior = document.activeElement;
    element.showModal();
    const bounds = stage.current!.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // Leave room for the bottom tool palette rather than centering on expansion tiles.
    const toolSpace = Math.min(190, bounds.height / 3);
    const fit = projectViewport(
      draft.layout,
      bounds.width * dpr,
      (bounds.height - toolSpace) * dpr,
    );
    const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.floor(fit.zoom)));
    handleZoomChange(zoom);
    panRef.current = {
      x: (fit.panX * zoom) / fit.zoom,
      y: (fit.panY * zoom) / fit.zoom - (toolSpace * dpr) / 2,
    };

    return () => {
      element.close();
      if (prior instanceof HTMLElement && prior.isConnected) prior.focus();
    };
  }, [draft, handleZoomChange, panRef]);
  const setLastSavedLayout = editor.setLastSavedLayout;
  useEffect(() => {
    editorState.isEditMode = true;
    setLastSavedLayout(draft.layout);
  }, [editorState, draft, setLastSavedLayout]);
  useEditorKeyboard(
    !disabled,
    editorState,
    editor.handleDeleteSelected,
    editor.handleRotateSelected,
    editor.handleToggleState,
    editor.handleUndo,
    editor.handleRedo,
    editor.handleEditorSelectionChange,
    close,
  );
  async function save() {
    if (disabled || changedElsewhere) return;
    setBusy(true);
    setError('');
    try {
      await campus.saveLayout(draft.command(officeState.getLayout()));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'LAYOUT_INVALID');
    } finally {
      setBusy(false);
    }
  }
  const selUid = editorState.selectedFurnitureUid;
  const selColor = selUid
    ? (officeState.getLayout().furniture.find((f) => f.uid === selUid)?.color ?? null)
    : null;
  return (
    <dialog
      ref={dialog}
      className="opa-project-editor"
      aria-labelledby="opa-editor-title"
      onCancel={(e) => {
        e.preventDefault();
        // Active editor hotkeys handle Escape in stages (selection, tool, exit).
        if (disabled) close();
      }}
    >
      <header>
        <h2 id="opa-editor-title">
          {t('Edit project office')}: {project.name}
        </h2>
        <p>{project.path}</p>
        <div className="opa-header-actions">
          <button
            className="opa-button"
            disabled={disabled || !editorState.undoStack.length}
            onClick={editor.handleUndo}
          >
            {t('Undo')}
          </button>
          <button
            className="opa-button"
            disabled={disabled || !editorState.redoStack.length}
            onClick={editor.handleRedo}
          >
            {t('Redo')}
          </button>
          <button
            className="opa-button"
            disabled={disabled || changedElsewhere || !editor.isDirty}
            onClick={() => void save()}
          >
            {t('Save project office')}
          </button>
          <button className="opa-button" disabled={busy} onClick={close}>
            {t('Close')}
          </button>
        </div>
        {changedElsewhere && (
          <p role="alert">
            {t('LAYOUT_CONFLICT')} {t('Close and reopen the editor to load the latest layout.')}
          </p>
        )}
        {error && <p role="alert">{t(error)}</p>}
        {busy && <p role="status">{t('Saving…')}</p>}
      </header>
      <div ref={stage} className="opa-project-editor-stage" inert={disabled}>
        <ZoomControls zoom={editor.zoom} onZoomChange={editor.handleZoomChange} />
        <OfficeCanvas
          officeState={officeState}
          onClick={() => {}}
          isEditMode={true}
          editorState={editorState}
          onEditorTileAction={editor.handleEditorTileAction}
          onEditorEraseAction={editor.handleEditorEraseAction}
          onEditorSelectionChange={editor.handleEditorSelectionChange}
          onDeleteSelected={editor.handleDeleteSelected}
          onRotateSelected={editor.handleRotateSelected}
          onDrop={editor.handleDrop}
          editorTick={editor.editorTick}
          zoom={editor.zoom}
          onZoomChange={editor.handleZoomChange}
          panRef={editor.panRef}
          showAreas={false}
          activeAreaLabel={null}
        />
        <EditorToolbar
          activeTool={editorState.activeTool}
          selectedTileType={editorState.selectedTileType}
          selectedFurnitureType={editorState.placingType}
          selectedFurnitureUid={selUid}
          selectedFurnitureColor={selColor}
          floorColor={editorState.floorColor}
          wallColor={editorState.wallColor}
          selectedWallSet={editorState.selectedWallSet}
          onToolChange={editor.handleToolChange}
          onTileTypeChange={editor.handleTileTypeChange}
          onFloorColorChange={editor.handleFloorColorChange}
          onWallColorChange={editor.handleWallColorChange}
          onWallSetChange={editor.handleWallSetChange}
          onSelectedFurnitureColorChange={editor.handleSelectedFurnitureColorChange}
          pickedFurnitureColor={editorState.pickedFurnitureColor}
          onPickedFurnitureColorChange={editor.handlePickedFurnitureColorChange}
          onColorPickToggle={editor.handleColorPickToggle}
          onFurnitureTypeChange={editor.handleFurnitureTypeChange}

          activePetTypes={officeState.getActivePetTypes()}
          petCount={getPetCount()}
          onPetToggle={editor.handlePetToggle}
          carpetVariant={editor.carpetVariant}
          carpetColor={editor.carpetColor}
          carpetAccentColor={editor.carpetAccentColor}
          onCarpetVariantChange={editor.handleCarpetVariantChange}
          onCarpetColorChange={editor.handleCarpetColorChange}
          onCarpetAccentColorChange={editor.handleCarpetAccentColorChange}
          areas={officeState.getLayout().areas ?? []}
          selectedAreaLabel={editor.selectedAreaLabel}
          directories={[]}
          areasAvailable={false}
          areaMappings={{}}
          onSelectArea={editor.handleSelectArea}
          onAddArea={editor.handleAddArea}
          onRemoveArea={editor.handleRemoveArea}
          onRenameArea={editor.handleRenameArea}
          onAreaColorChange={editor.handleAreaColorChange}
          onAreaMappingChange={() => {}}
        />
      </div>
    </dialog>
  );
}
