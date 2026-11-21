import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import type { DevicePreset } from '../types/studio';

export interface PointPickPayload {
  screenId: string;
  selector: string;
  tagName: string;
  textSnippet: string;
  boundingBox: { x: number; y: number; w: number; h: number };
  xPercent: number;
  yPercent: number;
}

export interface PlayClickPayload {
  screenId: string;
  edgeId: string | null;
  text: string;
  isDeadClick: boolean;
}

interface ScreenIframeProps {
  screenId: string;
  html: string;
  devicePreset: DevicePreset;
  displayWidth: number;
  displayHeight: number;
  mode: 'view' | 'point' | 'play';
  onPointPick?: (payload: PointPickPayload) => void;
  onPlayClick?: (payload: PlayClickPayload) => void;
}

export const ScreenIframe: React.FC<ScreenIframeProps> = ({
  screenId,
  html,
  devicePreset,
  displayWidth,
  displayHeight,
  mode,
  onPointPick,
  onPlayClick,
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const nativeWidth = devicePreset === 'desktop' ? 1280 : 390;
  const nativeHeight = devicePreset === 'desktop' ? 800 : 844;
  const scale = Math.min(displayWidth / nativeWidth, displayHeight / nativeHeight);

  const syncModeToIframe = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'fc:set-mode', mode: modeRef.current },
      '*'
    );
  }, []);

  const srcDoc = useMemo(() => {
    const safeScreenId = JSON.stringify(screenId);
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <script>
    window.__FC_MODE__ = 'view';
    window.addEventListener('message', function(ev) {
      if (ev.data && ev.data.type === 'fc:set-mode') {
        window.__FC_MODE__ = ev.data.mode;
        var hb = document.getElementById('__fc_hover_box');
        if (window.__FC_MODE__ !== 'point' && hb) hb.style.display = 'none';
      }
    });
  </script>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: ${nativeWidth}px;
      min-height: ${nativeHeight}px;
      font-family: 'Inter', -apple-system, sans-serif;
      overflow-x: hidden;
    }
    #__fc_hover_box {
      position: fixed;
      pointer-events: none;
      border: 2px solid #3b82f6;
      background: rgba(59, 130, 246, 0.14);
      border-radius: 6px;
      z-index: 999999;
      display: none;
      transition: all 50ms ease;
    }
    #__fc_hover_tag {
      position: absolute;
      top: -24px;
      left: -2px;
      background: #2563eb;
      color: #fff;
      font-size: 11px;
      font-family: ui-monospace, monospace;
      padding: 2px 7px;
      border-radius: 4px;
      white-space: nowrap;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
  </style>
</head>
<body>
  ${html}
  <div id="__fc_hover_box"><span id="__fc_hover_tag"></span></div>
  <script>
    (function() {
      const SCREEN_ID = ${safeScreenId};
      const hoverBox = document.getElementById('__fc_hover_box');
      const hoverTag = document.getElementById('__fc_hover_tag');

      function cssPath(el) {
        if (!el || el === document.body) return 'body';
        if (el.id) return '#' + el.id;
        const tag = el.tagName.toLowerCase();
        const cls = (el.className && typeof el.className === 'string')
          ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.')
          : '';
        return tag + cls;
      }

      document.addEventListener('mousemove', function(e) {
        if (window.__FC_MODE__ !== 'point') return;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || el === document.body || el === document.documentElement || el.id === '__fc_hover_box') {
          hoverBox.style.display = 'none';
          return;
        }
        const rect = el.getBoundingClientRect();
        hoverBox.style.display = 'block';
        hoverBox.style.left = rect.left + 'px';
        hoverBox.style.top = rect.top + 'px';
        hoverBox.style.width = rect.width + 'px';
        hoverBox.style.height = rect.height + 'px';
        const snippet = (el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 28);
        hoverTag.textContent = '<' + el.tagName.toLowerCase() + '>' + (snippet ? ' "' + snippet + '"' : '');
      }, true);

      document.addEventListener('mouseleave', function() {
        if (hoverBox) hoverBox.style.display = 'none';
      });

      document.addEventListener('click', function(e) {
        const el = e.target;
        if (!el) return;

        if (window.__FC_MODE__ === 'point') {
          e.preventDefault();
          e.stopPropagation();
          const rect = el.getBoundingClientRect();
          const xPercent = Math.round((e.clientX / window.innerWidth) * 100);
          const yPercent = Math.round((e.clientY / window.innerHeight) * 100);
          window.parent.postMessage({
            type: 'fc:point-pick',
            payload: {
              screenId: SCREEN_ID,
              selector: cssPath(el),
              tagName: el.tagName.toLowerCase(),
              textSnippet: (el.innerText || el.getAttribute('value') || '').trim().replace(/\\s+/g, ' ').slice(0, 60),
              boundingBox: {
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                w: Math.round(rect.width),
                h: Math.round(rect.height),
              },
              xPercent: Math.min(96, Math.max(4, xPercent)),
              yPercent: Math.min(96, Math.max(4, yPercent)),
            }
          }, '*');
          return;
        }

        if (window.__FC_MODE__ === 'play') {
          e.preventDefault();
          e.stopPropagation();
          const edgeEl = el.closest ? el.closest('[data-fc-edge]') : null;
          const interactiveEl = el.closest ? el.closest('button, a, input, select, [role="button"], [data-fc-edge]') : null;
          window.parent.postMessage({
            type: 'fc:play-click',
            payload: {
              screenId: SCREEN_ID,
              edgeId: edgeEl ? edgeEl.getAttribute('data-fc-edge') : null,
              text: ((interactiveEl || el).innerText || '').trim().slice(0, 48),
              isDeadClick: !interactiveEl,
            }
          }, '*');
        }
      }, true);

      window.parent.postMessage({ type: 'fc:ready', screenId: SCREEN_ID }, '*');
    })();
  </script>
</body>
</html>`;
  }, [html, nativeWidth, nativeHeight, screenId]);

  useEffect(() => {
    syncModeToIframe();
  }, [mode, syncModeToIframe]);

  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      if (!ev.data || typeof ev.data !== 'object') return;
      if (ev.data.type === 'fc:ready' && ev.data.screenId === screenId) {
        syncModeToIframe();
        return;
      }
      if (ev.data.type === 'fc:point-pick' && ev.data.payload?.screenId === screenId) {
        onPointPick?.(ev.data.payload as PointPickPayload);
      }
      if (ev.data.type === 'fc:play-click' && ev.data.payload?.screenId === screenId) {
        onPlayClick?.(ev.data.payload as PlayClickPayload);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [screenId, onPointPick, onPlayClick, syncModeToIframe]);

  const interactive = mode === 'point' || mode === 'play';

  return (
    <div
      className="relative overflow-hidden bg-white select-none"
      style={{ width: displayWidth, height: displayHeight }}
    >
      <iframe
        ref={iframeRef}
        title={`screen-${screenId}`}
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        onLoad={syncModeToIframe}
        style={{
          width: nativeWidth,
          height: nativeHeight,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          pointerEvents: interactive ? 'auto' : 'none',
          border: 0,
        }}
      />
    </div>
  );
};
