import { useState } from 'react';

import { t } from '../i18n/index.js';
import { type CampusRoute, publicLink } from './deepLinks.js';

export function LinkControls({ route }: { route: CampusRoute }) {
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState('');
  return (
    <>
      <button
        type="button"
        className="opa-button"
        onClick={async () => {
          try {
            const link = publicLink(window.location.href, route);
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            } catch {
              setFallback(link);
            }
          } catch {
            setFallback(t('Share links are unavailable in this host. Open OPA in your browser.'));
          }
        }}
      >
        {t('Copy link')}
      </button>
      {copied && <span role="status">{t('Link copied without access credentials.')}</span>}
      {fallback && (
        <p role="status">
          <input
            aria-label={t('Link or fallback')}
            readOnly
            value={fallback}
            onFocus={(e) => e.target.select()}
          />
        </p>
      )}
    </>
  );
}
