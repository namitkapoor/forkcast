import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AnnotationCategory,
  CanvasViewMode,
  ChatMessage,
  DesignVariant,
  DevicePreset,
  DisambiguationControl,
  FlowEdge,
  FlowProject,
  LlmTaskConfig,
  LlmTaskKey,
  PendingPinDraft,
  PriorityTier,
  RuntimeSettings,
  ScreenAnnotation,
  ScreenNode,
  StudioTool,
  TokenUsageEntry,
  TraversalTrace,
} from '../types/studio';
import { createStarterProject } from './presets';
import { DEFAULT_RUNTIME_SETTINGS } from '../ai/budgetPolicy';
import { getEnvApiKey, loadEnvRuntimeSettings } from '../ai/llmConfig';
import { asyncJobs, isAbortError } from '../ai/asyncController';
import { computeAutoLayout } from '../graph/autoLayout';
import { applyTraceToGraph, compileWorkflowGraph } from '../graph/compiler';
import { buildMultimodalContext } from '../ai/contextBuilder';
import {
  appendRevision,
  createAnnotationId,
  createRevisionId,
  formatVersionedRef,
  nextAnnotationMentionTag,
} from '../domain/annotations';
import { stripReferenceTokenFromText } from '../domain/references';
import {
  assessPromptAmbiguity,
  evaluateScreenWithAI,
  generateNewFlowFromDisambiguation,
  generateVariantForScreen,
  refineScreenWithAI,
  simulatePersonasWithAI,
} from '../ai/geminiClient';

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 7)}-${Date.now().toString(36).slice(-4)}`;
}

export type RightRailMode = 'chat' | 'inspector' | 'split';

interface StudioState {
  project: FlowProject;
  settings: RuntimeSettings;
  activeTool: StudioTool;
  rightRailMode: RightRailMode;
  isLeftSidebarOpen: boolean;
  isPlayModeOpen: boolean;
  isSettingsOpen: boolean;
  compareScreenId: string | null;
  pendingPinDraft: PendingPinDraft | null;
  chatDraft: string;
  detachedContextKeys: string[];
  chatMessages: ChatMessage[];
  isBusy: boolean;
  busyLabel: string | null;
  toast: { id: number; text: string; tone?: 'info' | 'success' | 'warning' } | null;

  // UI & Navigation
  setActiveTool: (tool: StudioTool) => void;
  setRightRailMode: (mode: RightRailMode) => void;
  setLeftSidebarOpen: (open: boolean) => void;
  selectScreen: (screenId: string | null, openInspector?: boolean) => void;
  selectEdge: (edgeId: string | null) => void;
  setCanvasView: (view: CanvasViewMode) => void;
  setDevicePreset: (preset: DevicePreset) => void;
  setPlayModeOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setCompareScreenId: (screenId: string | null) => void;
  setPendingPinDraft: (draft: PendingPinDraft | null) => void;
  setChatDraft: (draft: string) => void;
  appendToChatDraft: (snippet: string, unmuteKeys?: string[]) => void;
  detachContextItem: (key: string, baseHandle: string) => void;
  clearAllChatContext: () => void;
  clearChatMessages: () => void;
  cancelActiveAiJob: () => void;
  showToast: (text: string, tone?: 'info' | 'success' | 'warning') => void;
  clearToast: () => void;

  // Screen & Variant CRUD + Cognitive Load Controls
  updateScreenPosition: (screenId: string, position: { x: number; y: number }) => void;
  setScreenStatus: (screenId: string, status: ScreenNode['status']) => void;
  setActiveVariant: (screenId: string, variantId: string) => void;
  setFinalizedVariant: (screenId: string, variantId: string) => void;
  toggleVariantHidden: (screenId: string, variantId: string) => void;
  toggleScreenInFinalFlow: (screenId: string) => void;
  setScreenPriority: (screenId: string, priority: PriorityTier) => void;
  toggleScreenPolicyMode: (screenId: string) => void;
  addBlankScreen: (title?: string) => void;
  deleteScreen: (screenId: string) => void;

  // Edges
  connectScreens: (sourceId: string, targetId: string, label?: string) => void;
  updateEdge: (
    edgeId: string,
    patch: Partial<Pick<FlowEdge, 'label' | 'edgeType' | 'isFinalFlowEdge'>>
  ) => void;
  deleteEdge: (edgeId: string) => void;

  // Annotations & Revisions
  addAnnotation: (
    screenId: string,
    payload: Omit<ScreenAnnotation, 'id' | 'mentionTag' | 'createdAt' | 'revisions' | 'status'>
  ) => ScreenAnnotation | null;
  editAnnotation: (
    screenId: string,
    annotationId: string,
    comment: string,
    category?: AnnotationCategory
  ) => ScreenAnnotation | null;
  toggleAnnotationIncludeInAi: (screenId: string, annotationId: string) => void;
  setAllScreenAnnotationsIncludeInAi: (screenId: string, include: boolean) => void;
  toggleAnnotationStatus: (screenId: string, annotationId: string) => void;
  restoreAnnotationRevision: (screenId: string, annotationId: string, revisionId: string) => void;
  deleteAnnotation: (screenId: string, annotationId: string) => void;

  // Budget & Settings
  updateSettings: (patch: Partial<RuntimeSettings>) => void;
  updateLlmTaskConfig: (
    taskKey: LlmTaskKey,
    patch: Partial<Pick<LlmTaskConfig, 'model' | 'thinkingLevel'>>
  ) => void;
  reloadSettingsFromEnv: () => void;
  updateTotalBudget: (tokens: number) => void;
  updateTierShare: (tier: PriorityTier, share: number) => void;

  // Disambiguation Controls
  updateDisambiguationControl: (
    controlId: string,
    updater: (control: DisambiguationControl) => DisambiguationControl
  ) => void;
  dismissDisambiguation: () => void;
  confirmDisambiguation: () => Promise<void>;

  // AI & Traversal Workflows
  submitPrompt: (prompt: string, skipAmbiguity?: boolean) => Promise<void>;
  sendIncludedFeedbackToAI: (screenId: string, extraDirective?: string) => Promise<void>;
  exploreNewVariant: (screenId: string, styleHint?: string) => Promise<void>;
  runUXEval: (screenId?: string) => Promise<void>;
  recordTraversalTrace: (trace: TraversalTrace) => void;
  recordTokenUsage: (entry: TokenUsageEntry) => void;
  runPersonaSimulation: () => Promise<void>;
  applyCompiledGraphWinners: () => void;
  resetProject: () => void;
}

export const useStudioStore = create<StudioState>()(
  persist(
    (set, get) => ({
      project: createStarterProject(),
      settings: { ...DEFAULT_RUNTIME_SETTINGS },
      activeTool: 'select',
      rightRailMode: 'chat',
      isLeftSidebarOpen: true,
      isPlayModeOpen: false,
      isSettingsOpen: false,
      compareScreenId: null,
      pendingPinDraft: null,
      chatDraft: '',
      detachedContextKeys: [],
      chatMessages: [
        {
          id: 'msg-welcome',
          role: 'assistant',
          timestamp: Date.now(),
          text: 'Pin any UI element (C), paint a region (B), or type @Pin to reference versioned annotations (e.g. @Pin-1:v2) and screens (@Checkout). Your chat stays persistent across all screens.',
        },
      ],
      isBusy: false,
      busyLabel: null,
      toast: null,

      setActiveTool: (tool) => {
        if (tool === 'play') {
          set({ activeTool: 'select', isPlayModeOpen: true });
          return;
        }
        set({ activeTool: tool });
      },

      setRightRailMode: (mode) => set({ rightRailMode: mode }),
      setLeftSidebarOpen: (open) => set({ isLeftSidebarOpen: open }),

      selectScreen: (screenId, openInspector = false) =>
        set((s) => ({
          rightRailMode: openInspector ? 'inspector' : s.rightRailMode,
          detachedContextKeys: screenId
            ? s.detachedContextKeys.filter((k) => k !== `screen:${screenId}`)
            : s.detachedContextKeys,
          project: {
            ...s.project,
            selectedScreenId: screenId,
            selectedEdgeId: screenId ? null : s.project.selectedEdgeId,
          },
        })),

      selectEdge: (edgeId) =>
        set((s) => ({
          rightRailMode: edgeId && s.rightRailMode === 'chat' ? 'chat' : s.rightRailMode,
          project: {
            ...s.project,
            selectedEdgeId: edgeId,
            selectedScreenId: edgeId ? null : s.project.selectedScreenId,
          },
        })),

      setCanvasView: (view) =>
        set((s) => {
          const positions = computeAutoLayout(
            s.project.screens,
            s.project.edges,
            view,
            s.project.devicePreset
          );
          const nextScreens: Record<string, ScreenNode> = {};
          for (const [id, screen] of Object.entries(s.project.screens)) {
            nextScreens[id] = {
              ...screen,
              position: positions[id] ?? screen.position,
            };
          }
          return {
            project: {
              ...s.project,
              canvasView: view,
              screens: nextScreens,
            },
          };
        }),

      setDevicePreset: (preset) =>
        set((s) => {
          const positions = computeAutoLayout(
            s.project.screens,
            s.project.edges,
            s.project.canvasView === 'free' ? 'flow' : s.project.canvasView,
            preset
          );
          const nextScreens: Record<string, ScreenNode> = {};
          for (const [id, screen] of Object.entries(s.project.screens)) {
            nextScreens[id] = {
              ...screen,
              position:
                s.project.canvasView === 'free'
                  ? screen.position
                  : (positions[id] ?? screen.position),
            };
          }
          return {
            project: {
              ...s.project,
              devicePreset: preset,
              screens: nextScreens,
            },
          };
        }),

      setPlayModeOpen: (open) => set({ isPlayModeOpen: open }),
      setSettingsOpen: (open) => set({ isSettingsOpen: open }),
      setCompareScreenId: (screenId) => set({ compareScreenId: screenId }),
      setPendingPinDraft: (draft) => set({ pendingPinDraft: draft }),
      setChatDraft: (draft) => set({ chatDraft: draft }),

      appendToChatDraft: (snippet, unmuteKeys = []) =>
        set((s) => {
          const cur = s.chatDraft;
          const sep =
            snippet && cur.length > 0 && !cur.endsWith(' ') ? ' ' : '';
          const unmuteSet = new Set(unmuteKeys);

          // Automatically unmute any screen or annotation matching `snippet` (e.g. `@Pin-2:v1` or `@Checkout`)
          const clean = snippet.trim().replace(/^@/, '').replace(/:v?\d+$/i, '').toLowerCase();
          if (clean) {
            for (const sc of Object.values(s.project.screens)) {
              if (sc.slug.toLowerCase() === clean) unmuteSet.add(`screen:${sc.id}`);
              for (const ann of sc.annotations) {
                if (ann.mentionTag.toLowerCase() === clean) {
                  unmuteSet.add(`ann:${ann.id}`);
                  unmuteSet.add(`screen:${sc.id}`);
                }
              }
            }
          }

          return {
            rightRailMode: s.rightRailMode === 'inspector' ? 'chat' : s.rightRailMode,
            detachedContextKeys:
              unmuteSet.size > 0
                ? s.detachedContextKeys.filter((k) => !unmuteSet.has(k))
                : s.detachedContextKeys,
            chatDraft: snippet ? `${cur}${sep}${snippet} ` : cur,
          };
        }),

      detachContextItem: (key, baseHandle) =>
        set((s) => {
          let nextDraft = stripReferenceTokenFromText(s.chatDraft, baseHandle);
          const keysToAdd = new Set<string>(s.detachedContextKeys);
          keysToAdd.add(key);

          // If detaching an entire screen, also strip & detach any pins belonging to that screen
          if (key.startsWith('screen:')) {
            const sid = key.slice('screen:'.length);
            const sc = s.project.screens[sid];
            if (sc) {
              for (const ann of sc.annotations) {
                keysToAdd.add(`ann:${ann.id}`);
                nextDraft = stripReferenceTokenFromText(nextDraft, ann.mentionTag);
              }
            }
          }

          return {
            chatDraft: nextDraft,
            detachedContextKeys: Array.from(keysToAdd),
          };
        }),

      clearAllChatContext: () =>
        set((s) => {
          const keys = new Set(s.detachedContextKeys);
          if (s.project.selectedScreenId) {
            keys.add(`screen:${s.project.selectedScreenId}`);
            const sc = s.project.screens[s.project.selectedScreenId];
            sc?.annotations.forEach((a) => keys.add(`ann:${a.id}`));
          }
          // Strip all @Reference tokens from draft while preserving normal words
          const cleanedDraft = s.chatDraft
            .replace(/(?:^|\s)@[A-Za-z0-9_:-]+/g, ' ')
            .replace(/[ \t]{2,}/g, ' ')
            .trimStart();
          return {
            chatDraft: cleanedDraft,
            detachedContextKeys: Array.from(keys),
          };
        }),

      clearChatMessages: () =>
        set({
          chatMessages: [
            {
              id: uid('msg'),
              role: 'assistant',
              timestamp: Date.now(),
              text: 'Chat cleared. Type @Pin or @Screen to reference versioned pins and screens.',
            },
          ],
        }),

      cancelActiveAiJob: () => {
        asyncJobs.cancelAll();
        set((s) => {
          const resetScreens: Record<string, ScreenNode> = {};
          for (const [id, sc] of Object.entries(s.project.screens)) {
            resetScreens[id] = sc.status !== 'idle' ? { ...sc, status: 'idle' } : sc;
          }
          return {
            isBusy: false,
            busyLabel: null,
            project: { ...s.project, screens: resetScreens },
            toast: { id: Date.now(), text: 'Cancelled in-flight AI request', tone: 'info' },
          };
        });
      },

      showToast: (text, tone = 'info') => set({ toast: { id: Date.now(), text, tone } }),
      clearToast: () => set({ toast: null }),

      updateScreenPosition: (screenId, position) =>
        set((s) => {
          const screen = s.project.screens[screenId];
          if (!screen) return s;
          return {
            project: {
              ...s.project,
              screens: {
                ...s.project.screens,
                [screenId]: { ...screen, position },
              },
            },
          };
        }),

      setScreenStatus: (screenId, status) =>
        set((s) => {
          const sc = s.project.screens[screenId];
          if (!sc) return s;
          return {
            project: {
              ...s.project,
              screens: {
                ...s.project.screens,
                [screenId]: { ...sc, status },
              },
            },
          };
        }),

      setActiveVariant: (screenId, variantId) =>
        set((s) => {
          const screen = s.project.screens[screenId];
          if (!screen) return s;
          const variant = screen.variants.find((v) => v.id === variantId);
          if (!variant) return s;
          return {
            project: {
              ...s.project,
              screens: {
                ...s.project.screens,
                [screenId]: {
                  ...screen,
                  activeVariantId: variantId,
                  fidelity: variant.fidelity,
                },
              },
            },
          };
        }),

      setFinalizedVariant: (screenId, variantId) => {
        set((s) => {
          const screen = s.project.screens[screenId];
          if (!screen) return s;
          const nextVariants = screen.variants.map((v) =>
            v.id === variantId
              ? {
                  ...v,
                  isHidden: false,
                  banditStats: {
                    ...v.banditStats,
                    alpha: Number((v.banditStats.alpha + 1.0).toFixed(2)),
                  },
                }
              : v
          );
          return {
            project: {
              ...s.project,
              screens: {
                ...s.project.screens,
                [screenId]: {
                  ...screen,
                  variants: nextVariants,
                  finalizedVariantId: variantId,
                  activeVariantId: variantId,
                  isInFinalFlow: true,
                },
              },
            },
          };
        });
        get().showToast('Marked option as Finalized version', 'success');
      },

      toggleVariantHidden: (screenId, variantId) =>
        set((s) => {
          const screen = s.project.screens[screenId];
          if (!screen) return s;
          const target = screen.variants.find((v) => v.id === variantId);
          if (!target) return s;

          const nextHidden = !target.isHidden;
          const visibleAfter = screen.variants.filter((v) =>
            v.id === variantId ? !nextHidden : !v.isHidden
          );
          if (visibleAfter.length === 0) {
            return {
              toast: {
                id: Date.now(),
                text: 'Keep at least one option visible on the screen',
                tone: 'warning',
              },
            };
          }

          const nextVariants = screen.variants.map((v) =>
            v.id === variantId ? { ...v, isHidden: nextHidden } : v
          );

          let nextActiveId = screen.activeVariantId;
          if (nextHidden && screen.activeVariantId === variantId) {
            const finalizedVisible = visibleAfter.find((v) => v.id === screen.finalizedVariantId);
            nextActiveId = finalizedVisible?.id ?? visibleAfter[0].id;
          }

          return {
            project: {
              ...s.project,
              screens: {
                ...s.project.screens,
                [screenId]: {
                  ...screen,
                  variants: nextVariants,
                  activeVariantId: nextActiveId,
                },
              },
            },
          };
        }),

      toggleScreenInFinalFlow: (screenId) =>
        set((s) => {
          const screen = s.project.screens[screenId];
          if (!screen) return s;
          return {
            project: {
              ...s.project,
              screens: {
                ...s.project.screens,
                [screenId]: { ...screen, isInFinalFlow: !screen.isInFinalFlow },
              },
            },
          };
        }),

      setScreenPriority: (screenId, priority) =>
        set((s) => {
          const screen = s.project.screens[screenId];
          if (!screen) return s;
          return {
            project: {
              ...s.project,
              screens: {
                ...s.project.screens,
                [screenId]: { ...screen, priority },
              },
            },
          };
        }),

      toggleScreenPolicyMode: (screenId) =>
        set((s) => {
          const screen = s.project.screens[screenId];
          if (!screen) return s;
          const nextMode =
            screen.policyMode === 'exploit-locked' ? 'explore' : 'exploit-locked';
          return {
            project: {
              ...s.project,
              screens: {
                ...s.project.screens,
                [screenId]: { ...screen, policyMode: nextMode },
              },
            },
          };
        }),

      addBlankScreen: (title = 'New Screen') => {
        const id = uid('scr');
        const varId = uid('var');
        const count = Object.keys(get().project.screens).length + 1;
        const slug = `${title.replace(/[^A-Za-z0-9]/g, '') || 'Screen'}${count}`;
        const newNode: ScreenNode = {
          id,
          slug,
          title: `${title} ${count}`,
          stage: 'Exploration',
          description: 'New micro-UI state added on canvas.',
          priority: 'standard',
          policyMode: 'explore',
          fidelity: 'skeleton',
          isInFinalFlow: false,
          position: { x: 240 + (count % 4) * 460, y: 520 },
          activeVariantId: varId,
          finalizedVariantId: null,
          annotations: [],
          evaluation: null,
          status: 'idle',
          variants: [
            {
              id: varId,
              label: 'Skeleton Draft',
              rationale: 'Click "Expand to Interactive UI" or prompt @' + slug + ' to generate.',
              fidelity: 'skeleton',
              isHidden: false,
              html: '',
              skeletonBullets: [
                'Primary header & user goal framing',
                'Interactive core control / card group',
                'Primary CTA wired to next screen',
              ],
              createdAt: Date.now(),
              modelUsed: 'manual',
              tokensUsed: 0,
              banditStats: {
                alpha: 2,
                beta: 2,
                impressions: 0,
                completions: 0,
                hesitations: 0,
                backtracks: 0,
                avgDwellMs: 0,
              },
            },
          ],
        };

        set((s) => ({
          project: {
            ...s.project,
            selectedScreenId: id,
            screens: { ...s.project.screens, [id]: newNode },
          },
        }));
      },

      deleteScreen: (screenId) =>
        set((s) => {
          const nextScreens = { ...s.project.screens };
          delete nextScreens[screenId];
          const nextEdges: Record<string, FlowEdge> = {};
          for (const [eid, edge] of Object.entries(s.project.edges)) {
            if (edge.sourceScreenId !== screenId && edge.targetScreenId !== screenId) {
              nextEdges[eid] = edge;
            }
          }
          return {
            project: {
              ...s.project,
              selectedScreenId:
                s.project.selectedScreenId === screenId ? null : s.project.selectedScreenId,
              screens: nextScreens,
              edges: nextEdges,
            },
          };
        }),

      connectScreens: (sourceId, targetId, label = 'Continue') => {
        if (sourceId === targetId) return;
        const existing = Object.values(get().project.edges).find(
          (e) => e.sourceScreenId === sourceId && e.targetScreenId === targetId
        );
        if (existing) {
          get().showToast('Screens are already connected', 'warning');
          return;
        }
        const id = uid('edge');
        const src = get().project.screens[sourceId];
        const dst = get().project.screens[targetId];
        const isFinal = Boolean(src?.isInFinalFlow && dst?.isInFinalFlow);

        set((s) => ({
          project: {
            ...s.project,
            selectedEdgeId: id,
            selectedScreenId: null,
            edges: {
              ...s.project.edges,
              [id]: {
                id,
                sourceScreenId: sourceId,
                targetScreenId: targetId,
                label,
                edgeType: 'primary',
                isFinalFlowEdge: isFinal,
                metrics: { traversals: 0, completions: 0, backtracks: 0 },
              },
            },
          },
        }));
        get().showToast(`Connected @${src?.slug ?? sourceId} → @${dst?.slug ?? targetId}`, 'success');
      },

      updateEdge: (edgeId, patch) =>
        set((s) => {
          const edge = s.project.edges[edgeId];
          if (!edge) return s;
          return {
            project: {
              ...s.project,
              edges: {
                ...s.project.edges,
                [edgeId]: { ...edge, ...patch },
              },
            },
          };
        }),

      deleteEdge: (edgeId) =>
        set((s) => {
          const nextEdges = { ...s.project.edges };
          delete nextEdges[edgeId];
          return {
            project: {
              ...s.project,
              selectedEdgeId: s.project.selectedEdgeId === edgeId ? null : s.project.selectedEdgeId,
              edges: nextEdges,
            },
          };
        }),

      addAnnotation: (screenId, payload) => {
        const screen = get().project.screens[screenId];
        if (!screen) return null;

        const id = createAnnotationId();
        const mentionTag = nextAnnotationMentionTag(get().project, payload.kind);
        const now = Date.now();
        const ann: ScreenAnnotation = {
          ...payload,
          id,
          mentionTag,
          status: 'open',
          createdAt: now,
          revisions: [
            {
              id: createRevisionId(),
              revisionNumber: 1,
              timestamp: now,
              author: payload.author,
              comment: payload.comment,
              category: payload.category,
              status: 'open',
            },
          ],
        };

        set((s) => ({
          project: {
            ...s.project,
            screens: {
              ...s.project.screens,
              [screenId]: {
                ...s.project.screens[screenId],
                annotations: [...s.project.screens[screenId].annotations, ann],
              },
            },
          },
        }));
        get().showToast(`Saved ${formatVersionedRef(ann, 1)} on @${screen.slug}`, 'success');
        return ann;
      },

      editAnnotation: (screenId, annotationId, comment, category) => {
        let updatedAnn: ScreenAnnotation | null = null;
        set((s) => {
          const screen = s.project.screens[screenId];
          if (!screen) return s;
          const nextAnnotations = screen.annotations.map((ann) => {
            if (ann.id !== annotationId) return ann;
            updatedAnn = appendRevision(ann, {
              comment,
              category: category ?? ann.category,
              author: 'designer',
            });
            return updatedAnn;
          });
          return {
            project: {
              ...s.project,
              screens: {
                ...s.project.screens,
                [screenId]: { ...screen, annotations: nextAnnotations },
              },
            },
            toast: {
              id: Date.now(),
              text: updatedAnn
                ? `Saved ${formatVersionedRef(updatedAnn)}`
                : 'Saved annotation revision',
              tone: 'success',
            },
          };
        });
        return updatedAnn;
      },

      toggleAnnotationIncludeInAi: (screenId, annotationId) =>
        set((s) => {
          const screen = s.project.screens[screenId];
          if (!screen) return s;
          return {
            project: {
              ...s.project,
              screens: {
                ...s.project.screens,
                [screenId]: {
                  ...screen,
                  annotations: screen.annotations.map((ann) =>
                    ann.id === annotationId
                      ? { ...ann, includeInAiFeedback: !ann.includeInAiFeedback }
                      : ann
                  ),
                },
              },
            },
          };
        }),

      setAllScreenAnnotationsIncludeInAi: (screenId, include) =>
        set((s) => {
          const screen = s.project.screens[screenId];
          if (!screen) return s;
          return {
            project: {
              ...s.project,
              screens: {
                ...s.project.screens,
                [screenId]: {
                  ...screen,
                  annotations: screen.annotations.map((ann) => ({
                    ...ann,
                    includeInAiFeedback: include,
                  })),
                },
              },
            },
          };
        }),

      toggleAnnotationStatus: (screenId, annotationId) =>
        set((s) => {
          const screen = s.project.screens[screenId];
          if (!screen) return s;
          return {
            project: {
              ...s.project,
              screens: {
                ...s.project.screens,
                [screenId]: {
                  ...screen,
                  annotations: screen.annotations.map((ann) =>
                    ann.id === annotationId
                      ? appendRevision(ann, {
                          status: ann.status === 'open' ? 'resolved' : 'open',
                          author: 'designer',
                        })
                      : ann
                  ),
                },
              },
            },
          };
        }),

      restoreAnnotationRevision: (screenId, annotationId, revisionId) =>
        set((s) => {
          const screen = s.project.screens[screenId];
          if (!screen) return s;
          return {
            project: {
              ...s.project,
              screens: {
                ...s.project.screens,
                [screenId]: {
                  ...screen,
                  annotations: screen.annotations.map((ann) => {
                    if (ann.id !== annotationId) return ann;
                    const rev = ann.revisions.find((r) => r.id === revisionId);
                    if (!rev) return ann;
                    return appendRevision(ann, {
                      comment: rev.comment,
                      category: rev.category,
                      status: 'open',
                      author: 'designer',
                    });
                  }),
                },
              },
            },
            toast: {
              id: Date.now(),
              text: 'Restored revision as latest version',
              tone: 'info',
            },
          };
        }),

      deleteAnnotation: (screenId, annotationId) =>
        set((s) => {
          const screen = s.project.screens[screenId];
          if (!screen) return s;
          return {
            project: {
              ...s.project,
              screens: {
                ...s.project.screens,
                [screenId]: {
                  ...screen,
                  annotations: screen.annotations.filter((a) => a.id !== annotationId),
                },
              },
            },
          };
        }),

      updateSettings: (patch) =>
        set((s) => ({
          settings: {
            ...s.settings,
            ...patch,
            llmTasks: patch.llmTasks
              ? { ...s.settings.llmTasks, ...patch.llmTasks }
              : s.settings.llmTasks,
          },
        })),

      updateLlmTaskConfig: (taskKey, patch) =>
        set((s) => ({
          settings: {
            ...s.settings,
            llmTasks: {
              ...s.settings.llmTasks,
              [taskKey]: {
                ...s.settings.llmTasks[taskKey],
                ...patch,
              },
            },
          },
        })),

      reloadSettingsFromEnv: () => {
        const fresh = loadEnvRuntimeSettings();
        set({ settings: fresh });
        get().showToast('Synced all Gemini 4 models & thinking levels from .env', 'info');
      },

      updateTotalBudget: (totalTokenBudget) =>
        set((s) => ({
          project: {
            ...s.project,
            budgetConfig: {
              ...s.project.budgetConfig,
              totalTokenBudget: Math.max(25_000, totalTokenBudget),
            },
          },
        })),

      updateTierShare: (tier, share) =>
        set((s) => {
          const clamped = Math.min(0.85, Math.max(0.05, share));
          const others = (['core', 'standard', 'supporting'] as PriorityTier[]).filter(
            (t) => t !== tier
          );
          const remaining = 1 - clamped;
          const prevOtherSum =
            s.project.budgetConfig.tierShares[others[0]] +
            s.project.budgetConfig.tierShares[others[1]];
          const ratio0 =
            prevOtherSum > 0 ? s.project.budgetConfig.tierShares[others[0]] / prevOtherSum : 0.5;
          const nextShares = {
            ...s.project.budgetConfig.tierShares,
            [tier]: Number(clamped.toFixed(2)),
            [others[0]]: Number((remaining * ratio0).toFixed(2)),
            [others[1]]: Number((remaining * (1 - ratio0)).toFixed(2)),
          };
          return {
            project: {
              ...s.project,
              budgetConfig: {
                ...s.project.budgetConfig,
                tierShares: nextShares,
              },
            },
          };
        }),

      updateDisambiguationControl: (controlId, updater) =>
        set((s) => {
          const req = s.project.pendingDisambiguation;
          if (!req) return s;
          return {
            project: {
              ...s.project,
              pendingDisambiguation: {
                ...req,
                controls: req.controls.map((c) => (c.id === controlId ? updater(c) : c)),
              },
            },
          };
        }),

      dismissDisambiguation: () =>
        set((s) => ({
          project: { ...s.project, pendingDisambiguation: null },
        })),

      confirmDisambiguation: async () => {
        const req = get().project.pendingDisambiguation;
        if (!req) return;

        const jobId = 'flow-architect';
        const signal = asyncJobs.startJob(jobId);

        const summaryLines = req.controls.map((c) => {
          if (c.kind === 'choice-cards') return `${c.label}: ${c.selectedIds.join(', ')}`;
          if (c.kind === 'visual-preview') return `${c.label}: ${c.selectedId}`;
          if (c.kind === 'slider') return `${c.label}: ${c.value}${c.unit}`;
          return `${c.label}: ${c.selected.join(', ')}`;
        });

        set((s) => ({
          isBusy: true,
          busyLabel: `Synthesizing flow (${s.settings.llmTasks.FLOW_ARCHITECT.model} · ${s.settings.llmTasks.FLOW_ARCHITECT.thinkingLevel})...`,
          project: { ...s.project, pendingDisambiguation: null },
        }));

        try {
          const res = await generateNewFlowFromDisambiguation(
            req.originalPrompt,
            summaryLines.join('\n'),
            get().project,
            get().settings,
            signal
          );
          const positions = computeAutoLayout(
            res.data.screens,
            res.data.edges,
            'flow',
            get().project.devicePreset
          );
          const laidOutScreens: Record<string, ScreenNode> = {};
          for (const [id, sc] of Object.entries(res.data.screens)) {
            laidOutScreens[id] = { ...sc, position: positions[id] ?? sc.position };
          }
          const firstScreenId = Object.keys(laidOutScreens)[0] ?? null;

          set((s) => ({
            project: {
              ...s.project,
              name: res.data.projectName,
              productBrief: req.originalPrompt,
              canvasView: 'flow',
              selectedScreenId: firstScreenId,
              screens: laidOutScreens,
              edges: res.data.edges,
              tokenLedger: [...s.project.tokenLedger, res.usage],
            },
            chatMessages: [
              ...s.chatMessages,
              {
                id: uid('msg'),
                role: 'assistant',
                timestamp: Date.now(),
                text: `Generated ${Object.keys(laidOutScreens).length}-screen user journey "${res.data.projectName}".`,
                modelUsed: res.usage.model,
                thinkingLevel: res.usage.thinkingLevel,
                usedMock: res.usedMock,
                tokens: {
                  prompt: res.usage.promptTokens,
                  output: res.usage.outputTokens,
                  thought: res.usage.thoughtTokens,
                  total: res.usage.totalTokens,
                },
              },
            ],
          }));
          get().showToast(
            `Generated ${Object.keys(laidOutScreens).length}-screen flow`,
            'success'
          );
        } catch (err) {
          if (!isAbortError(err)) {
            const msg = (err as Error).message || String(err);
            set((s) => ({
              chatMessages: [
                ...s.chatMessages,
                { id: uid('msg'), role: 'error', timestamp: Date.now(), text: msg },
              ],
            }));
          }
        } finally {
          asyncJobs.finishJob(jobId);
          set({ isBusy: false, busyLabel: null });
        }
      },

      submitPrompt: async (prompt, skipAmbiguity = false) => {
        const trimmed = prompt.trim();
        if (!trimmed) return;

        const jobId = 'submit-prompt';
        const signal = asyncJobs.startJob(jobId);

        const initialContext = buildMultimodalContext(
          trimmed,
          get().project,
          get().project.selectedScreenId,
          new Set(get().detachedContextKeys)
        );

        const userMsg: ChatMessage = {
          id: uid('msg'),
          role: 'user',
          timestamp: Date.now(),
          text: trimmed,
          attachedMentions: [
            ...initialContext.targetScreens.map((sc) => `@${sc.slug}`),
            ...initialContext.includedRefs.map((r) => r.token),
          ],
          excludedAnnotationCount: initialContext.excludedAnnotationCount,
        };

        set((s) => ({
          chatMessages: [...s.chatMessages, userMsg],
        }));

        let targetScreenIdForCleanup: string | null = null;

        try {
          if (!skipAmbiguity) {
            set((s) => ({
              isBusy: true,
              busyLabel: `Checking ambiguity (${s.settings.llmTasks.DISAMBIGUATE.model} · ${s.settings.llmTasks.DISAMBIGUATE.thinkingLevel})...`,
            }));

            const amb = await assessPromptAmbiguity(
              trimmed,
              get().project,
              get().settings,
              signal
            );

            if (amb.usage.totalTokens > 0) {
              set((s) => ({
                project: {
                  ...s.project,
                  tokenLedger: [...s.project.tokenLedger, amb.usage],
                },
              }));
            }

            if (amb.data.ambiguous && amb.data.request) {
              const disambigReq = amb.data.request;
              set((s) => ({
                project: { ...s.project, pendingDisambiguation: disambigReq },
                chatMessages: [
                  ...s.chatMessages,
                  {
                    id: uid('msg'),
                    role: 'assistant',
                    timestamp: Date.now(),
                    text: `Clarify 3 quick visual choices below before generating — ${disambigReq.rationale}`,
                    modelUsed: amb.usage.model,
                    thinkingLevel: amb.usage.thinkingLevel,
                    usedMock: amb.usedMock,
                  },
                ],
              }));
              return;
            }
          }

          // Re-build context from latest fresh store state (respecting detached context items!)
          const context = buildMultimodalContext(
            trimmed,
            get().project,
            get().project.selectedScreenId,
            new Set(get().detachedContextKeys)
          );
          const target = context.targetScreens[0];

          if (!target) {
            set((s) => ({
              chatMessages: [
                ...s.chatMessages,
                {
                  id: uid('msg'),
                  role: 'error',
                  timestamp: Date.now(),
                  text: 'Select a screen on the canvas or mention @ScreenSlug / @Pin-N:vK in your prompt.',
                },
              ],
            }));
            return;
          }

          targetScreenIdForCleanup = target.id;
          get().setScreenStatus(target.id, 'generating');

          const isCore = target.priority === 'core' && target.policyMode !== 'exploit-locked';
          const activeTask = isCore
            ? get().settings.llmTasks.REFINE_CORE
            : get().settings.llmTasks.REFINE_SMALL;

          set({
            isBusy: true,
            busyLabel: `Iterating @${target.slug} with ${activeTask.model} (${activeTask.thinkingLevel}) · ${context.includedRefs.length} versioned pin(s)...`,
          });

          const res = await refineScreenWithAI(context, get().project, get().settings, signal);
          const now = Date.now();
          const newVarId = uid('var');
          const resolvedSet = new Set(res.data.resolvedAnnotationIds);
          const addressedTokens = context.includedRefs
            .filter((r) => resolvedSet.has(r.annotation.id))
            .map((r) => r.token);

          set((s) => {
            const sc = s.project.screens[res.data.targetScreenId];
            if (!sc) return s;

            const newVariant: DesignVariant = {
              id: newVarId,
              label: res.data.newVariantLabel,
              rationale: res.data.rationale,
              fidelity: 'interactive',
              isHidden: false,
              html: res.data.html,
              createdAt: now,
              parentVariantId: sc.activeVariantId ?? undefined,
              modelUsed: res.usage.model,
              tokensUsed: res.usage.totalTokens,
              banditStats: {
                alpha: 3.5,
                beta: 1.5,
                impressions: 1,
                completions: 1,
                hesitations: 0,
                backtracks: 0,
                avgDwellMs: 4800,
              },
            };

            const nextAnnotations = sc.annotations.map((ann) => {
              if (!resolvedSet.has(ann.id)) return ann;
              return appendRevision(ann, {
                comment: `${ann.comment} [Addressed in ${res.data.newVariantLabel}]`,
                status: 'resolved',
                author: 'ai-evaluator',
                resolvedByVariantId: newVarId,
              });
            });

            const assistantMsg: ChatMessage = {
              id: uid('msg'),
              role: 'assistant',
              timestamp: now,
              text: res.data.rationale,
              targetScreenId: sc.id,
              targetScreenSlug: sc.slug,
              createdVariantId: newVarId,
              createdVariantLabel: res.data.newVariantLabel,
              resolvedMentionTags: addressedTokens,
              excludedAnnotationCount: context.excludedAnnotationCount,
              modelUsed: res.usage.model,
              thinkingLevel: res.usage.thinkingLevel,
              usedMock: res.usedMock,
              tokens: {
                prompt: res.usage.promptTokens,
                output: res.usage.outputTokens,
                thought: res.usage.thoughtTokens,
                total: res.usage.totalTokens,
              },
            };

            return {
              chatMessages: [...s.chatMessages, assistantMsg],
              project: {
                ...s.project,
                selectedScreenId: sc.id,
                screens: {
                  ...s.project.screens,
                  [sc.id]: {
                    ...sc,
                    status: 'idle',
                    fidelity: 'interactive',
                    variants: [...sc.variants, newVariant],
                    activeVariantId: newVarId,
                    annotations: nextAnnotations,
                  },
                },
                tokenLedger: [...s.project.tokenLedger, res.usage],
              },
            };
          });

          get().showToast(
            `Created "${res.data.newVariantLabel}" on @${target.slug}`,
            'success'
          );
        } catch (err) {
          if (!isAbortError(err)) {
            const message = (err as Error).message || String(err);
            set((s) => ({
              chatMessages: [
                ...s.chatMessages,
                {
                  id: uid('msg'),
                  role: 'error',
                  timestamp: Date.now(),
                  text: message,
                  retryPrompt: trimmed,
                },
              ],
              toast: { id: Date.now(), text: `Gemini 4 error: ${message}`, tone: 'warning' },
            }));
          }
        } finally {
          asyncJobs.finishJob(jobId);
          if (targetScreenIdForCleanup) {
            get().setScreenStatus(targetScreenIdForCleanup, 'idle');
          }
          set({ isBusy: false, busyLabel: null });
        }
      },

      sendIncludedFeedbackToAI: async (screenId, extraDirective) => {
        const screen = get().project.screens[screenId];
        if (!screen) return;
        const included = screen.annotations.filter(
          (a) => a.status === 'open' && a.includeInAiFeedback
        );
        if (included.length === 0 && !extraDirective?.trim()) {
          get().showToast(
            'Toggle "Include in AI" ON for at least one annotation or mention @Pin-N:vK directly',
            'warning'
          );
          return;
        }
        const versionedTokens = included.map((a) => formatVersionedRef(a)).join(' ');
        const directive =
          extraDirective?.trim() ||
          `Iterate @${screen.slug} implementing ${versionedTokens || 'open feedback'} while preserving flow continuity.`;
        await get().submitPrompt(directive, true);
      },

      exploreNewVariant: async (screenId, styleHint) => {
        const screen = get().project.screens[screenId];
        if (!screen) return;

        const jobId = `variant-${screenId}`;
        const signal = asyncJobs.startJob(jobId);
        get().setScreenStatus(screenId, 'generating');

        set({
          isBusy: true,
          busyLabel:
            screen.fidelity === 'skeleton'
              ? `Expanding @${screen.slug} to interactive UI...`
              : `Exploring alternative for @${screen.slug}...`,
        });

        try {
          const res = await generateVariantForScreen(
            get().project.screens[screenId],
            get().project,
            get().settings,
            styleHint,
            signal
          );
          const newVarId = uid('var');
          const now = Date.now();

          set((s) => {
            const sc = s.project.screens[screenId];
            if (!sc) return s;
            const newVariant: DesignVariant = {
              id: newVarId,
              label: res.data.label,
              rationale: res.data.rationale,
              fidelity: 'interactive',
              isHidden: false,
              html: res.data.html,
              createdAt: now,
              parentVariantId: sc.activeVariantId ?? undefined,
              modelUsed: res.usage.model,
              tokensUsed: res.usage.totalTokens,
              banditStats: {
                alpha: 2.8,
                beta: 1.8,
                impressions: 0,
                completions: 0,
                hesitations: 0,
                backtracks: 0,
                avgDwellMs: 0,
              },
            };

            return {
              chatMessages: [
                ...s.chatMessages,
                {
                  id: uid('msg'),
                  role: 'assistant',
                  timestamp: now,
                  text: res.data.rationale,
                  targetScreenId: sc.id,
                  targetScreenSlug: sc.slug,
                  createdVariantId: newVarId,
                  createdVariantLabel: res.data.label,
                  modelUsed: res.usage.model,
                  thinkingLevel: res.usage.thinkingLevel,
                  usedMock: res.usedMock,
                  tokens: {
                    prompt: res.usage.promptTokens,
                    output: res.usage.outputTokens,
                    thought: res.usage.thoughtTokens,
                    total: res.usage.totalTokens,
                  },
                },
              ],
              project: {
                ...s.project,
                screens: {
                  ...s.project.screens,
                  [screenId]: {
                    ...sc,
                    status: 'idle',
                    fidelity: 'interactive',
                    variants: [...sc.variants, newVariant],
                    activeVariantId: newVarId,
                    finalizedVariantId:
                      sc.fidelity === 'skeleton' ? newVarId : sc.finalizedVariantId,
                  },
                },
                tokenLedger: [...s.project.tokenLedger, res.usage],
              },
            };
          });

          get().showToast(`Added "${res.data.label}" to @${screen.slug}`, 'success');
        } catch (err) {
          if (!isAbortError(err)) {
            const msg = (err as Error).message || String(err);
            set((s) => ({
              chatMessages: [
                ...s.chatMessages,
                { id: uid('msg'), role: 'error', timestamp: Date.now(), text: msg },
              ],
              toast: { id: Date.now(), text: `Variant error: ${msg}`, tone: 'warning' },
            }));
          }
        } finally {
          asyncJobs.finishJob(jobId);
          get().setScreenStatus(screenId, 'idle');
          set({ isBusy: false, busyLabel: null });
        }
      },

      runUXEval: async (screenId) => {
        const targets = screenId
          ? [get().project.screens[screenId]].filter(Boolean)
          : Object.values(get().project.screens).filter(
              (s) => s.isInFinalFlow && s.fidelity === 'interactive'
            );

        if (targets.length === 0) return;

        const jobId = 'ux-eval';
        const signal = asyncJobs.startJob(jobId);

        set({
          isBusy: true,
          busyLabel:
            targets.length === 1
              ? `Evaluating UX on @${targets[0].slug}...`
              : `Evaluating UX across ${targets.length} Final Flow screens...`,
        });

        try {
          let totalAddedPins = 0;

          for (const target of targets) {
            if (signal.aborted) break;
            get().setScreenStatus(target.id, 'evaluating');

            const freshTarget = get().project.screens[target.id];
            if (!freshTarget) continue;

            const res = await evaluateScreenWithAI(
              freshTarget,
              get().project,
              get().settings,
              signal
            );
            const now = Date.now();

            set((s) => {
              const sc = s.project.screens[target.id];
              if (!sc) return s;

              let tempProject = s.project;
              const newPins: ScreenAnnotation[] = res.data.aiPins.map((p) => {
                const mentionTag = nextAnnotationMentionTag(tempProject, 'point-element');
                const created: ScreenAnnotation = {
                  ...p,
                  id: createAnnotationId('ann-ai'),
                  mentionTag,
                  createdAt: now,
                  revisions: [
                    {
                      id: createRevisionId(),
                      revisionNumber: 1,
                      timestamp: now,
                      author: 'ai-evaluator',
                      comment: p.comment,
                      category: p.category,
                      status: 'open',
                    },
                  ],
                };
                tempProject = {
                  ...tempProject,
                  screens: {
                    ...tempProject.screens,
                    [sc.id]: {
                      ...tempProject.screens[sc.id],
                      annotations: [...tempProject.screens[sc.id].annotations, created],
                    },
                  },
                };
                return created;
              });
              totalAddedPins += newPins.length;

              const updatedVariants = sc.variants.map((v) => {
                if (v.id !== sc.activeVariantId) return v;
                const evalBoost = res.data.report.overallScore >= 82 ? 1.2 : 0;
                const evalPenalty = res.data.report.overallScore < 76 ? 1.1 : 0;
                return {
                  ...v,
                  banditStats: {
                    ...v.banditStats,
                    alpha: Number((v.banditStats.alpha + evalBoost).toFixed(2)),
                    beta: Number((v.banditStats.beta + evalPenalty).toFixed(2)),
                  },
                };
              });

              return {
                project: {
                  ...s.project,
                  screens: {
                    ...s.project.screens,
                    [target.id]: {
                      ...sc,
                      status: 'idle',
                      evaluation: res.data.report,
                      variants: updatedVariants,
                      annotations: [...sc.annotations, ...newPins],
                    },
                  },
                  tokenLedger: [...s.project.tokenLedger, res.usage],
                },
              };
            });
          }

          get().showToast(
            `UX Eval complete (${totalAddedPins} new versioned AI pin${totalAddedPins === 1 ? '' : 's'})`,
            'success'
          );
        } catch (err) {
          if (!isAbortError(err)) {
            get().showToast(`UX Eval failed: ${(err as Error).message}`, 'warning');
          }
        } finally {
          asyncJobs.finishJob(jobId);
          for (const t of targets) {
            get().setScreenStatus(t.id, 'idle');
          }
          set({ isBusy: false, busyLabel: null });
        }
      },

      recordTraversalTrace: (trace) => {
        set((s) => {
          const updated = applyTraceToGraph(s.project.screens, s.project.edges, trace);
          return {
            project: {
              ...s.project,
              screens: updated.screens,
              edges: updated.edges,
              traces: [trace, ...s.project.traces].slice(0, 30),
            },
          };
        });
        get().showToast(
          `Recorded traversal (${trace.steps.length} steps) → Updated Beta(α,β) weights`,
          'success'
        );
      },

      recordTokenUsage: (entry) =>
        set((s) => ({
          project: {
            ...s.project,
            tokenLedger: [...s.project.tokenLedger, entry],
          },
        })),

      runPersonaSimulation: async () => {
        const jobId = 'persona-sim';
        const signal = asyncJobs.startJob(jobId);

        set((s) => ({
          isBusy: true,
          busyLabel: `Simulating personas (${s.settings.llmTasks.PERSONA_SIM.model} · ${s.settings.llmTasks.PERSONA_SIM.thinkingLevel})...`,
        }));

        try {
          const res = await simulatePersonasWithAI(get().project, get().settings, signal);
          let screens = get().project.screens;
          let edges = get().project.edges;

          for (const t of res.data) {
            const updated = applyTraceToGraph(screens, edges, t);
            screens = updated.screens;
            edges = updated.edges;
          }

          const completedCount = res.data.filter((t) => t.completed).length;
          set((s) => ({
            project: {
              ...s.project,
              screens,
              edges,
              traces: [...res.data, ...s.project.traces].slice(0, 40),
              tokenLedger: [...s.project.tokenLedger, res.usage],
            },
          }));

          get().showToast(
            `Simulated ${res.data.length} personas (${completedCount}/${res.data.length} completed)`,
            'success'
          );
        } catch (err) {
          if (!isAbortError(err)) {
            get().showToast(`Persona simulation error: ${(err as Error).message}`, 'warning');
          }
        } finally {
          asyncJobs.finishJob(jobId);
          set({ isBusy: false, busyLabel: null });
        }
      },

      applyCompiledGraphWinners: () => {
        const compiled = compileWorkflowGraph(get().project);
        let lockedCount = 0;

        set((s) => {
          const nextScreens: Record<string, ScreenNode> = {};
          for (const [id, screen] of Object.entries(s.project.screens)) {
            const insight = compiled.insights[id];
            if (!insight) {
              nextScreens[id] = screen;
              continue;
            }
            const shouldLock = insight.recommendedPolicy === 'exploit-locked';
            if (shouldLock) lockedCount += 1;
            nextScreens[id] = {
              ...screen,
              policyMode: insight.recommendedPolicy,
              finalizedVariantId:
                shouldLock && insight.recommendedVariantId
                  ? insight.recommendedVariantId
                  : screen.finalizedVariantId,
              activeVariantId:
                shouldLock && insight.recommendedVariantId
                  ? insight.recommendedVariantId
                  : screen.activeVariantId,
            };
          }
          return {
            project: {
              ...s.project,
              canvasView: 'compiled',
              screens: nextScreens,
            },
          };
        });

        get().showToast(
          `Compiled Tree → Locked ${lockedCount} Exploit winner(s), focused Explore on ${compiled.bottleneckScreenIds.length} bottleneck(s)`,
          'success'
        );
      },

      resetProject: () => {
        asyncJobs.cancelAll();
        set({
          project: createStarterProject(),
          activeTool: 'select',
          compareScreenId: null,
          pendingPinDraft: null,
          isPlayModeOpen: false,
          isBusy: false,
          busyLabel: null,
        });
        get().showToast('Reset to RoastCraft starter project', 'info');
      },
    }),
    {
      name: 'forkcast-studio-v1',
      partialize: (state) => ({
        project: state.project,
        chatMessages: state.chatMessages.slice(-40),
        rightRailMode: state.rightRailMode,
        settings: {
          apiKey: state.settings.apiKey === getEnvApiKey() ? '' : state.settings.apiKey,
          useMockFallback: state.settings.useMockFallback,
        },
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<StudioState> | undefined;
        const envDefaults = loadEnvRuntimeSettings();
        const savedKey = p?.settings?.apiKey?.trim() || '';
        const resolvedKey = savedKey || envDefaults.apiKey;
        const usedEnvKey = !savedKey && Boolean(envDefaults.apiKey);

        // Reset any stale 'generating'/'evaluating' status saved mid-flight in localStorage
        const hydratedProject = p?.project
          ? { ...current.project, ...p.project }
          : current.project;
        const cleanedScreens: Record<string, ScreenNode> = {};
        for (const [id, sc] of Object.entries(hydratedProject.screens)) {
          cleanedScreens[id] = sc.status !== 'idle' ? { ...sc, status: 'idle' } : sc;
        }

        return {
          ...current,
          rightRailMode: p?.rightRailMode ?? current.rightRailMode,
          project: { ...hydratedProject, screens: cleanedScreens },
          chatMessages:
            p?.chatMessages && p.chatMessages.length > 0
              ? p.chatMessages
              : current.chatMessages,
          settings: {
            ...envDefaults,
            apiKey: resolvedKey,
            useMockFallback: usedEnvKey
              ? envDefaults.useMockFallback
              : (p?.settings?.useMockFallback ?? !resolvedKey),
          },
        };
      },
    }
  )
);
