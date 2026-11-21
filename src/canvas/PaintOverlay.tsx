import React, { useRef, useState } from 'react';
import { Loader2, Mic, MicOff, Send, Sparkles, X } from 'lucide-react';
import type { AnnotationCategory } from '../types/studio';
import { useVoiceInput } from '../hooks/useVoiceInput';

interface PaintOverlayProps {
  width: number;
  height: number;
  onSaveMask: (payload: {
    strokes: Array<Array<{ xPercent: number; yPercent: number }>>;
    boundingBoxPercent: { x: number; y: number; w: number; h: number };
    xPercent: number;
    yPercent: number;
    maskDataUrl: string;
    comment: string;
    category: AnnotationCategory;
    includeInAiFeedback: boolean;
    sendImmediately: boolean;
  }) => void;
  onCancel: () => void;
}

export const PaintOverlay: React.FC<PaintOverlayProps> = ({
  width,
  height,
  onSaveMask,
  onCancel,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [strokes, setStrokes] = useState<Array<Array<{ xPercent: number; yPercent: number }>>>([]);
  const [showPopover, setShowPopover] = useState(false);
  const [comment, setComment] = useState('');
  const commentRef = useRef(comment);
  commentRef.current = comment;
  const [category, setCategory] = useState<AnnotationCategory>('layout');
  const [includeInAi, setIncludeInAi] = useState(true);

  const { isListening, isTranscribing, isSupported, toggleListening } = useVoiceInput({
    getCurrentText: () => commentRef.current,
    onTextUpdate: (nextText) => setComment(nextText),
  });

  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return {
      x,
      y,
      xPercent: Math.min(99, Math.max(1, Math.round((x / rect.width) * 100))),
      yPercent: Math.min(99, Math.max(1, Math.round((y / rect.height) * 100))),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    setShowPopover(false);
    setIsDrawing(true);
    const pt = getPoint(e);
    setStrokes((prev) => [...prev, [{ xPercent: pt.xPercent, yPercent: pt.yPercent }]]);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.strokeStyle = 'rgba(236, 72, 153, 0.72)';
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    e.stopPropagation();
    const pt = getPoint(e);
    setStrokes((prev) => {
      if (prev.length === 0) return prev;
      const copy = [...prev];
      copy[copy.length - 1] = [
        ...copy[copy.length - 1],
        { xPercent: pt.xPercent, yPercent: pt.yPercent },
      ];
      return copy;
    });
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    e.stopPropagation();
    setIsDrawing(false);
    setShowPopover(true);
  };

  const computeBounds = () => {
    const allPts = strokes.flat();
    if (allPts.length === 0) {
      return { x: 25, y: 25, w: 30, h: 25 };
    }
    const xs = allPts.map((p) => p.xPercent);
    const ys = allPts.map((p) => p.yPercent);
    const minX = Math.max(2, Math.min(...xs) - 3);
    const maxX = Math.min(98, Math.max(...xs) + 3);
    const minY = Math.max(2, Math.min(...ys) - 3);
    const maxY = Math.min(98, Math.max(...ys) + 3);
    return {
      x: Math.round(minX),
      y: Math.round(minY),
      w: Math.max(8, Math.round(maxX - minX)),
      h: Math.max(8, Math.round(maxY - minY)),
    };
  };

  const handleCommit = (sendImmediately: boolean) => {
    if (!comment.trim()) return;
    const box = computeBounds();
    const dataUrl = canvasRef.current?.toDataURL('image/png') ?? '';
    onSaveMask({
      strokes,
      boundingBoxPercent: box,
      xPercent: Math.round(box.x + box.w / 2),
      yPercent: Math.round(box.y + box.h / 2),
      maskDataUrl: dataUrl,
      comment: comment.trim(),
      category,
      includeInAiFeedback: includeInAi,
      sendImmediately,
    });
  };

  return (
    <div
      className="absolute inset-0 z-30 nodrag nopan"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="w-full h-full cursor-crosshair bg-pink-500/5 ring-2 ring-inset ring-pink-500/70"
      />

      {!showPopover && strokes.length === 0 && (
        <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full bg-pink-600/95 text-white text-[11px] font-medium shadow-lg whitespace-nowrap">
          Paint over any region to target AI · Release to speak or type
        </div>
      )}

      {showPopover && (
        <div
          className="absolute left-3 right-3 bottom-3 rounded-xl bg-[#18181d]/98 border border-pink-500/50 p-3 shadow-2xl space-y-2.5 backdrop-blur-md"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-pink-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Paint &amp; Speak Region Mask
            </span>
            <button
              onClick={onCancel}
              className="text-zinc-400 hover:text-zinc-100 p-0.5 rounded"
              title="Cancel paint"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex gap-1.5">
            <input
              autoFocus
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleCommit(false);
                }
              }}
              placeholder='e.g. "Turn just this block into a sticky summary"'
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-pink-400"
            />
            {isSupported && (
              <button
                type="button"
                onClick={toggleListening}
                className={`px-2 py-1.5 rounded-lg border text-xs flex items-center gap-1 transition ${
                  isListening
                    ? 'bg-rose-600 border-rose-400 text-white animate-pulse'
                    : isTranscribing
                    ? 'bg-violet-600/30 border-violet-400/60 text-violet-200'
                    : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:text-white'
                }`}
                title="Paint & Speak via Gemini streaming transcription"
              >
                {isTranscribing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : isListening ? (
                  <MicOff className="w-3.5 h-3.5" />
                ) : (
                  <Mic className="w-3.5 h-3.5" />
                )}
              </button>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as AnnotationCategory)}
                className="bg-zinc-900 border border-zinc-700 rounded-md px-1.5 py-1 text-[11px] text-zinc-300"
              >
                <option value="layout">Layout</option>
                <option value="hierarchy">Hierarchy</option>
                <option value="usability">Usability</option>
                <option value="copy">Copy</option>
                <option value="accessibility">Accessibility</option>
                <option value="flow">Flow</option>
              </select>

              <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeInAi}
                  onChange={(e) => setIncludeInAi(e.target.checked)}
                  className="rounded accent-emerald-500"
                />
                Include in AI
              </label>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={!comment.trim()}
                onClick={() => handleCommit(false)}
                className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-100 text-[11px] font-medium"
              >
                Save Rev v1
              </button>
              <button
                type="button"
                disabled={!comment.trim()}
                onClick={() => handleCommit(true)}
                className="px-2.5 py-1 rounded-lg bg-pink-600 hover:bg-pink-500 disabled:opacity-40 text-white text-[11px] font-semibold flex items-center gap-1"
              >
                <Send className="w-3 h-3" /> Apply AI
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
