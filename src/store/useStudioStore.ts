import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AnnotationCategory,
  CanvasViewMode,
  DesignVariant,
  DevicePreset,
  DisambiguationControl,
  FlowEdge,
  FlowProject,
  PriorityTier,
  RuntimeSettings,
  ScreenAnnotation,
  ScreenNode,
  StudioTool,
  TraversalTrace,
} from '../types/studio';
import { createStarterProject } from './presets';
import { DEFAULT_RUNTIME_SETTINGS } from '../ai/budgetPolicy';
import { computeAutoLayout } from '../graph/autoLayout';
import { applyTraceToGraph, compileWorkflowGraph } from '../graph/compiler';
import { buildMultimodalContext } from '../ai/contextBuilder';
import {
  assessPromptAmbiguity,
  evaluateScreenWithAI,
  generateNewFlowFromDisambiguation,
  generateVariantForScreen,
  refineScreenWithAI,
} from '../ai/geminiClient';
import { runSimulatedPersonas } from '../eval/traversalRunner';

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 7)}-${Date.now().toString(36).slice(-4)}`;
}

interface StudioState {
  project: FlowProject;
  settings: RuntimeSettings;
  activeTool: StudioTool;
  isPlayModeOpen: boolean;
  isSettingsOpen: boolean;
  compareScreenId: string | null;
  isBusy: boolean;
  busyLabel: string | null;
  toast: { id: number; text: string; tone?: 'info' | 'success' | 'warning' } | null;

  // UI & Navigation
  setActiveTool: (tool: StudioTool) => void;
  selectScreen: (screenId: string | null) => void;
  selectEdge: (edgeId: string | null) => void;
  setCanvasView: (view: CanvasViewMode) => void;
  setDevicePreset: (preset: DevicePreset) => void;
  setPlayModeOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setCompareScreenId: (screenId: string | null) => void;
  showToast: (text: string, tone?: 'info' | 'success' | 'warning') => void;
  clearToast: () => void;

  // Screen & Variant CRUD + Cognitive Load Controls
  updateScreenPosition: (screenId: string, position: { x: number; y: number }) => void;
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
  updateEdge: (edgeId: string, patch: Partial<Pick<FlowEdge, 'label' | 'edgeType' | 'isFinalFlowEdge'>>) => void;
  deleteEdge: (edgeId: string) => void;

  // Annotations & Revisions
  addAnnotation: (
    screenId: string,
    payload: Omit<ScreenAnnotation, 'id' | 'mentionTag' | 'createdAt' | 'revisions' | 'status'>
  ) => string;
  editAnnotation: (
    screenId: string,
    annotationId: string,
    comment: string,
    category?: AnnotationCategory
  ) => void;
  toggleAnnotationIncludeInAi: (screenId: string, annotationId: string) => void;
  setAllScreenAnnotationsIncludeInAi: (screenId: string, include: boolean) => void;
  toggleAnnotationStatus: (screenId: string, annotationId: string) => void;
  restoreAnnotationRevision: (screenId: string, annotationId: string, revisionId: string) => void;
  deleteAnnotation: (screenId: string, annotationId: string) => void;

  // Budget & Settings
  updateSettings: (patch: Partial<RuntimeSettings>) => void;
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
  runPersonaSimulation: () => void;
  applyCompiledGraphWinners: () => void;
  resetProject: () => void;
}

export const useStudioStore = create<StudioState>()(
  persist(
    (set, get) => ({
      project: createStarterProject(),
      settings: { ...DEFAULT_RUNTIME_SETTINGS },
      activeTool: 'select',
      isPlayModeOpen: false,
      isSettingsOpen: false,
      compareScreenId: null,
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

      selectScreen: (screenId) =>
        set((s) => ({
          project: {
            ...s.project,
            selectedScreenId: screenId,
            selectedEdgeId: screenId ? null : s.project.selectedEdgeId,
          },
        })),

      selectEdge: (edgeId) =>
        set((s) => ({
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
        get().showToast('Marked option as Finalized version for this screen', 'success');
      },

      toggleVariantHidden: (screenId, variantId) =>
        set((s) => {
          const screen = s.project.screens[screenId];
          if (!screen) return s;
          const target = screen.variants.find((v) => v.id === variantId);
          if (!target) return s;

          const nextHidden = !target.isHidden;
          // Prevent hiding the last visible option
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
              rationale: 'Click "Expand to Live UI" or prompt @' + slug + ' to generate options.',
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
        const id = uid('ann');
        const screen = get().project.screens[screenId];
        const existingCount = Object.values(get().project.screens)
          .flatMap((sc) => sc.annotations)
          .filter((a) => a.kind === payload.kind).length;
        const mentionTag =
          payload.kind === 'paint-region'
            ? `Mask-${existingCount + 1}`
            : `Pin-${existingCount + 1}`;
        const now = Date.now();
        const ann: ScreenAnnotation = {
          ...payload,
          id,
          mentionTag,
          status: 'open',
          createdAt: now,
          revisions: [
            {
              id: uid('rev'),
              revisionNumber: 1,
              timestamp: now,
              author: payload.author,
              comment: payload.comment,
              category: payload.category,
              status: 'open',
            },
          ],
        };

        if (screen) {
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
          get().showToast(`Saved @${mentionTag} (Revision v1)`, 'success');
        }
        return id;
      },

      editAnnotation: (screenId, annotationId, comment, category) =>
        set((s) => {
          const screen = s.project.screens[screenId];
          if (!screen) return s;
          const now = Date.now();
          const nextAnnotations = screen.annotations.map((ann) => {
            if (ann.id !== annotationId) return ann;
            const nextRevNum = ann.revisions.length + 1;
            const nextCat = category ?? ann.category;
            return {
              ...ann,
              comment,
              category: nextCat,
              revisions: [
                ...ann.revisions,
                {
                  id: uid('rev'),
                  revisionNumber: nextRevNum,
                  timestamp: now,
                  author: 'designer' as const,
                  comment,
                  category: nextCat,
                  status: ann.status,
                },
              ],
            };
          });
          return {
            project: {
              ...s.project,
              screens: {
                ...s.project.screens,
                [screenId]: { ...screen, annotations: nextAnnotations },
              },
            },
            toast: { id: now, text: 'Saved new annotation revision', tone: 'success' },
          };
        }),

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
          const now = Date.now();
          return {
            project: {
              ...s.project,
              screens: {
                ...s.project.screens,
                [screenId]: {
                  ...screen,
                  annotations: screen.annotations.map((ann) => {
                    if (ann.id !== annotationId) return ann;
                    const nextStatus = ann.status === 'open' ? 'resolved' : 'open';
                    return {
                      ...ann,
                      status: nextStatus,
                      revisions: [
                        ...ann.revisions,
                        {
                          id: uid('rev'),
                          revisionNumber: ann.revisions.length + 1,
                          timestamp: now,
                          author: 'designer',
                          comment: ann.comment,
                          category: ann.category,
                          status: nextStatus,
                        },
                      ],
                    };
                  }),
                },
              },
            },
          };
        }),

      restoreAnnotationRevision: (screenId, annotationId, revisionId) =>
        set((s) => {
          const screen = s.project.screens[screenId];
          if (!screen) return s;
          const now = Date.now();
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
                    return {
                      ...ann,
                      comment: rev.comment,
                      category: rev.category,
                      status: 'open',
                      revisions: [
                        ...ann.revisions,
                        {
                          id: uid('rev'),
                          revisionNumber: ann.revisions.length + 1,
                          timestamp: now,
                          author: 'designer',
                          comment: rev.comment,
                          category: rev.category,
                          status: 'open',
                        },
                      ],
                    };
                  }),
                },
              },
            },
            toast: { id: now, text: 'Restored revision as latest version', tone: 'info' },
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
            models: patch.models
              ? { ...s.settings.models, ...patch.models }
              : s.settings.models,
          },
        })),

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
        const { project, settings } = get();
        const req = project.pendingDisambiguation;
        if (!req) return;

        const summaryLines = req.controls.map((c) => {
          if (c.kind === 'choice-cards') return `${c.label}: ${c.selectedIds.join(', ')}`;
          if (c.kind === 'visual-preview') return `${c.label}: ${c.selectedId}`;
          if (c.kind === 'slider') return `${c.label}: ${c.value}${c.unit}`;
          return `${c.label}: ${c.selected.join(', ')}`;
        });

        set({
          isBusy: true,
          busyLabel: 'Synthesizing progressive user flow from disambiguation...',
          project: { ...project, pendingDisambiguation: null },
        });

        try {
          const res = await generateNewFlowFromDisambiguation(
            req.originalPrompt,
            summaryLines.join('\n'),
            project,
            settings
          );
          const positions = computeAutoLayout(
            res.data.screens,
            res.data.edges,
            'flow',
            project.devicePreset
          );
          const laidOutScreens: Record<string, ScreenNode> = {};
          for (const [id, sc] of Object.entries(res.data.screens)) {
            laidOutScreens[id] = { ...sc, position: positions[id] ?? sc.position };
          }
          const firstScreenId = Object.keys(laidOutScreens)[0] ?? null;

          set((s) => ({
            isBusy: false,
            busyLabel: null,
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
          }));
          get().showToast(
            `Generated ${Object.keys(laidOutScreens).length}-screen flow (${res.usage.totalTokens.toLocaleString()} tok${res.usedMock ? ' · Demo' : ''})`,
            'success'
          );
        } catch (err) {
          set({ isBusy: false, busyLabel: null });
          get().showToast(`Generation failed: ${(err as Error).message}`, 'warning');
        }
      },

      submitPrompt: async (prompt, skipAmbiguity = false) => {
        const trimmed = prompt.trim();
        if (!trimmed) return;
        const { project, settings } = get();

        if (!skipAmbiguity) {
          set({ isBusy: true, busyLabel: 'Checking intent ambiguity...' });
          const amb = await assessPromptAmbiguity(trimmed, project, settings);
          set((s) => ({
            project: {
              ...s.project,
              tokenLedger: [...s.project.tokenLedger, amb.usage],
            },
          }));
          if (amb.data.ambiguous && amb.data.request) {
            set((s) => ({
              isBusy: false,
              busyLabel: null,
              project: { ...s.project, pendingDisambiguation: amb.data.request },
            }));
            get().showToast(
              `Disambiguate in 3 clicks to save ~${Math.round(
                amb.data.request.estimatedTokenSavings / 1000
              )}k tokens`,
              'info'
            );
            return;
          }
        }

        // Direct Fast Path -> Refine targeted @Screen(s) with strictly included annotations
        const context = buildMultimodalContext(trimmed, get().project, get().project.selectedScreenId);
        const target = context.targetScreens[0];
        if (!target) {
          set({ isBusy: false, busyLabel: null });
          get().showToast('Select a screen or mention @ScreenSlug to refine', 'warning');
          return;
        }

        set({
          isBusy: true,
          busyLabel: `Refining @${target.slug} (${context.includedAnnotations.length} included annotation${
            context.includedAnnotations.length === 1 ? '' : 's'
          })...`,
        });

        try {
          const res = await refineScreenWithAI(context, get().project, settings);
          const now = Date.now();
          const newVarId = uid('var');

          set((s) => {
            const sc = s.project.screens[res.data.targetScreenId];
            if (!sc) return { isBusy: false, busyLabel: null };

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

            const resolvedSet = new Set(res.data.resolvedAnnotationIds);
            const nextAnnotations = sc.annotations.map((ann) => {
              if (!resolvedSet.has(ann.id)) return ann;
              return {
                ...ann,
                status: 'resolved' as const,
                revisions: [
                  ...ann.revisions,
                  {
                    id: uid('rev'),
                    revisionNumber: ann.revisions.length + 1,
                    timestamp: now,
                    author: 'ai-evaluator' as const,
                    comment: `${ann.comment} [Addressed in ${res.data.newVariantLabel}]`,
                    category: ann.category,
                    status: 'resolved' as const,
                    resolvedByVariantId: newVarId,
                  },
                ],
              };
            });

            return {
              isBusy: false,
              busyLabel: null,
              project: {
                ...s.project,
                selectedScreenId: sc.id,
                screens: {
                  ...s.project.screens,
                  [sc.id]: {
                    ...sc,
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
            `Created "${res.data.newVariantLabel}" on @${target.slug} (${res.usage.totalTokens.toLocaleString()} tok${
              context.excludedAnnotationCount > 0
                ? ` · ${context.excludedAnnotationCount} excluded note kept private`
                : ''
            })`,
            'success'
          );
        } catch (err) {
          set({ isBusy: false, busyLabel: null });
          get().showToast(`AI refinement failed: ${(err as Error).message}`, 'warning');
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
            'Toggle "Include in AI" ON for at least one open annotation first',
            'warning'
          );
          return;
        }
        const mentionTags = included.map((a) => `@${a.mentionTag}`).join(' ');
        const directive =
          extraDirective?.trim() ||
          `Refine @${screen.slug} addressing ${mentionTags || 'open feedback'} while preserving flow continuity.`;
        await get().submitPrompt(directive, true);
      },

      exploreNewVariant: async (screenId, styleHint) => {
        const { project, settings } = get();
        const screen = project.screens[screenId];
        if (!screen) return;

        set({
          isBusy: true,
          busyLabel:
            screen.fidelity === 'skeleton'
              ? `Expanding @${screen.slug} from Skeleton to Live UI...`
              : `Exploring new alternative for @${screen.slug}...`,
        });

        try {
          const res = await generateVariantForScreen(screen, project, settings, styleHint);
          const newVarId = uid('var');
          const now = Date.now();

          set((s) => {
            const sc = s.project.screens[screenId];
            if (!sc) return { isBusy: false, busyLabel: null };
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
              isBusy: false,
              busyLabel: null,
              project: {
                ...s.project,
                screens: {
                  ...s.project.screens,
                  [screenId]: {
                    ...sc,
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

          get().showToast(
            `Added "${res.data.label}" to @${screen.slug} (${res.usage.totalTokens.toLocaleString()} tok)`,
            'success'
          );
        } catch (err) {
          set({ isBusy: false, busyLabel: null });
          get().showToast(`Variant generation failed: ${(err as Error).message}`, 'warning');
        }
      },

      runUXEval: async (screenId) => {
        const { project, settings } = get();
        const targets = screenId
          ? [project.screens[screenId]].filter(Boolean)
          : Object.values(project.screens).filter(
              (s) => s.isInFinalFlow && s.fidelity === 'interactive'
            );

        if (targets.length === 0) return;

        set({
          isBusy: true,
          busyLabel:
            targets.length === 1
              ? `Evaluating UX & flow continuity on @${targets[0].slug}...`
              : `Running UX Evaluation across ${targets.length} Final Flow screens...`,
        });

        try {
          let totalAddedPins = 0;
          let totalTok = 0;

          for (const target of targets) {
            const res = await evaluateScreenWithAI(target, get().project, settings);
            totalTok += res.usage.totalTokens;
            const now = Date.now();

            set((s) => {
              const sc = s.project.screens[target.id];
              if (!sc) return s;

              const existingPinCount = Object.values(s.project.screens)
                .flatMap((x) => x.annotations)
                .filter((a) => a.kind === 'point-element').length;

              const newPins: ScreenAnnotation[] = res.data.aiPins.map((p, i) => ({
                ...p,
                id: uid('ann-ai'),
                mentionTag: `Pin-${existingPinCount + i + 1}`,
                createdAt: now,
                revisions: [
                  {
                    id: uid('rev'),
                    revisionNumber: 1,
                    timestamp: now,
                    author: 'ai-evaluator',
                    comment: p.comment,
                    category: p.category,
                    status: 'open',
                  },
                ],
              }));
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

          set({ isBusy: false, busyLabel: null });
          get().showToast(
            `UX Eval complete (${totalAddedPins} AI critique pin${totalAddedPins === 1 ? '' : 's'} · ${totalTok.toLocaleString()} tok)`,
            'success'
          );
        } catch (err) {
          set({ isBusy: false, busyLabel: null });
          get().showToast(`Evaluation error: ${(err as Error).message}`, 'warning');
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
          `Recorded traversal (${trace.steps.length} steps · ${
            trace.completed ? 'Completed ✓' : 'Exited / Backtracked'
          }) → Updated Beta(α,β) weights`,
          'success'
        );
      },

      runPersonaSimulation: () => {
        const traces = runSimulatedPersonas(get().project);
        let screens = get().project.screens;
        let edges = get().project.edges;

        for (const t of traces) {
          const res = applyTraceToGraph(screens, edges, t);
          screens = res.screens;
          edges = res.edges;
        }

        const completedCount = traces.filter((t) => t.completed).length;
        set((s) => ({
          project: {
            ...s.project,
            screens,
            edges,
            traces: [...traces, ...s.project.traces].slice(0, 40),
            tokenLedger: [
              ...s.project.tokenLedger,
              {
                id: uid('tok'),
                timestamp: Date.now(),
                action: 'simulate-personas',
                priority: 'core',
                model: s.settings.models.standard,
                promptTokens: 1120,
                outputTokens: 840,
                thoughtTokens: 0,
                totalTokens: 1960,
              },
            ],
          },
        }));

        get().showToast(
          `Simulated ${traces.length} user personas (${completedCount}/${traces.length} completed) → Updated Workflow Graph rewards`,
          'success'
        );
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
          `Compiled Tree → Graph: Locked ${lockedCount} proven Exploit screen(s), focused Explore budget on ${compiled.bottleneckScreenIds.length} bottleneck(s)`,
          'success'
        );
      },

      resetProject: () => {
        set({
          project: createStarterProject(),
          activeTool: 'select',
          compareScreenId: null,
          isPlayModeOpen: false,
        });
        get().showToast('Reset to RoastCraft starter project', 'info');
      },
    }),
    {
      name: 'forkcast-studio-v1',
      partialize: (state) => ({
        project: state.project,
        settings: state.settings,
      }),
    }
  )
);
