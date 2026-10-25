import { useState } from 'react';

import { t } from '../i18n/index.js';
import { isBrowserRuntime } from '../runtime.js';
import { vscodeProjectLink } from './deepLinks.js';

export function ProjectIdeLink({ path }: { path: string }) {
  const [local, setLocal] = useState(false);
  const uri = isBrowserRuntime ? vscodeProjectLink(path) : null;
  return (
    <details>
      <summary>{t('Open in IDE')}</summary>
      <p>
        {t(
          'IDE availability cannot be detected here. Copy the folder path if opening is unsupported.',
        )}
      </p>
      <input
        aria-label={t('Project folder')}
        readOnly
        value={path}
        onFocus={(e) => e.target.select()}
      />
      {uri && (
        <>
          <label>
            <input type="checkbox" checked={local} onChange={(e) => setLocal(e.target.checked)} />
            {t('VS Code is installed on this computer and this folder is local.')}
          </label>
          {local && (
            <a className="opa-button" href={uri}>
              {t('Open in VS Code')}
            </a>
          )}
        </>
      )}
    </details>
  );
}
