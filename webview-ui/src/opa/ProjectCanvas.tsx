import { useEffect, useRef } from 'react';

import type { OpaProjectSnapshot } from '../../../core/src/messages.js';
import { t } from '../i18n/index.js';
import { startGameLoop } from '../office/engine/gameLoop.js';
import { renderFrame } from '../office/engine/renderer.js';
import type { OfficeLayout } from '../office/types.js';
import { ProjectOffice } from './projectOffice.js';
import { projectViewport } from './viewport.js';

export function ProjectCanvas({
  project,
  layout,
}: {
  project: OpaProjectSnapshot;
  layout: OfficeLayout;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const world = useRef<ProjectOffice | null>(null);
  if (!world.current) world.current = new ProjectOffice(layout);
  useEffect(() => {
    world.current!.sync(project);
  }, [project]);
  useEffect(() => {
    const canvas = canvasRef.current!;
    const office = world.current!.office;
    const resize = new ResizeObserver(() => {
      const bounds = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(bounds.width * devicePixelRatio));
      canvas.height = Math.max(1, Math.round(bounds.height * devicePixelRatio));
    });
    resize.observe(canvas);
    const stop = startGameLoop(canvas, {
      update: (dt) => office.update(dt),
      render: (ctx) => {
        const map = office.getLayout();
        const { zoom, panX, panY } = projectViewport(map, canvas.width, canvas.height);
        renderFrame(
          ctx,
          canvas.width,
          canvas.height,
          office.tileMap,
          office.furniture,
          office.getCharacters(),
          zoom,
          panX,
          panY,
          undefined,
          undefined,
          map.tileColors,
          map.cols,
          map.rows,
          map.carpetTiles,
          map.areas,
          map.areaTiles,
          false,
          null,
          office.pets,
        );
      },
    });
    return () => {
      stop();
      resize.disconnect();
    };
  }, []);
  return (
    <canvas
      className="opa-project-canvas"
      ref={canvasRef}
      role="img"
      aria-label={t('{project} office, {count} agents', {
        project: project.name,
        count: project.agents.length,
      })}
    />
  );
}
